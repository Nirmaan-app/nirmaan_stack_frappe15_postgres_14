// src/pages/outflow-import/OutflowImportBatchPage.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Columns3, Lock, RefreshCw, Search, Unlock, X } from "lucide-react";
import { useFrappeGetCall, useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    OutflowImportBatch,
    OutflowImportRow,
} from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { CloseBatchDialog } from "./components/CloseBatchDialog";
import { DecisionDialog } from "./components/DecisionDialog";
import { ClearFiltersButton, OutflowRowsTable } from "./components/OutflowRowsTable";
import { DOCTYPE } from "./config/outflowImportTable.config";
import {
    DEFAULT_HIDDEN_COLUMNS,
    OUTFLOW_COLUMNS,
    OUTFLOW_TABS,
    activeFilterCount,
    decidedRows,
    decisionOrigin,
    isConfirmable,
    rowsForTab,
    seedDecisions,
    tabCounts,
    visibleRows,
    type ColumnFilters,
    type DecisionOrigin,
    type OutflowTab,
    type RowDecision,
    type SortState,
} from "./outflowTableModel";

/**
 * One import batch: three tabs over its transfers, and the decision dialog that resolves them.
 *
 * ⚠️ THE v2 WARNING ON THIS FILE SAID NOTHING HERE WRITES TO A FINANCIAL RECORD. THAT IS NO LONGER
 * TRUE and must not be restored: under the v3 spine, confirming a row settles a payment or an
 * expense. What holds instead is narrower -- every settle is a per-row human confirmation, nothing
 * settles itself, and the import never approves anything.
 *
 * ⚠️ DECISIONS ARE CLIENT STATE UNTIL CONFIRMED. A reviewer can work down the list resolving rows
 * and then confirm a batch of them; nothing is written until they do. That is the whole reason the
 * bulk bar counts DECIDED rows rather than selected ones.
 */
export const OutflowImportBatchPage = () => {
    const { id } = useParams<{ id: string }>();
    const [tab, setTab] = useState<OutflowTab>("pending");
    const [closing, setClosing] = useState(false);
    const [query, setQuery] = useState("");
    const [filters, setFilters] = useState<ColumnFilters>({});
    const [sort, setSort] = useState<SortState>({ columnId: null, direction: "asc" });
    const [hidden, setHidden] = useState<Set<string>>(new Set(DEFAULT_HIDDEN_COLUMNS));
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [decisions, setDecisions] = useState<ReadonlyMap<string, RowDecision>>(new Map());
    const [openRow, setOpenRow] = useState<OutflowImportRow | null>(null);
    const [busy, setBusy] = useState(false);

    const {
        data: batch,
        isLoading: batchLoading,
        error: batchError,
        mutate: mutateBatch,
    } = useFrappeGetDoc<OutflowImportBatch>(DOCTYPE, id, id ? undefined : null);

    const {
        data: rowsData,
        isLoading: rowsLoading,
        mutate: mutateRows,
    } = useFrappeGetCall<{ message: { rows: OutflowImportRow[] } }>(
        "nirmaan_stack.api.outflow_import.review.get_batch_rows",
        { batch: id },
        id ? undefined : null
    );

    const { call: runMatch, loading: matching } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.match_batch"
    );
    const { call: callSkip } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.skip_row"
    );
    const { call: callSettle } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.expenses.settle_row"
    );
    const { call: callCreate } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.expenses.create_expense"
    );
    const { call: callClose } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.close_batch"
    );
    const { call: callReopen } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.reopen_batch"
    );

    // Memoised so the seeding effect below has a dep that changes once per FETCH. `?? []` builds a
    // fresh array on every render, which as an effect dep is an infinite loop.
    const allRows = useMemo(() => rowsData?.message?.rows ?? [], [rowsData]);

    /**
     * Adopt the match run's own picks as decisions, as soon as the rows land.
     *
     * ⚠️ THIS IS WHY A MATCHED ROW READS AS READY IN THE TABLE. It used to happen inside the
     * decision dialog, which only mounts once a reviewer has clicked a row -- so the table could
     * never know, and confirming twenty matched transfers meant opening twenty dialogs to tick
     * twenty records the matcher had already chosen.
     *
     * ⚠️ SEEDING IS NOT SETTLING. It fills in the same choice a person would have clicked; the row
     * still has to be ticked and confirmed, and that confirmation is still the only thing that
     * writes. Nothing settles itself.
     *
     * `seedDecisions` returns the SAME map when it adds nothing, so this re-runs on every refetch
     * and re-renders on none of them.
     */
    useEffect(() => {
        setDecisions((prev) => seedDecisions(allRows, prev));
    }, [allRows]);

    const counts = useMemo(() => tabCounts(allRows), [allRows]);
    const tabRows = useMemo(() => rowsForTab(allRows, tab), [allRows, tab]);
    const shown = useMemo(
        () => visibleRows(tabRows, { query, filters, sort }),
        [tabRows, query, filters, sort]
    );

    const decidedNames = useMemo(
        () =>
            new Set(
                tabRows.filter((r) => isConfirmable(r, decisions.get(r.name))).map((r) => r.name)
            ),
        [tabRows, decisions]
    );
    const readyToConfirm = useMemo(
        () => decidedRows(tabRows, selected, decisions),
        [tabRows, selected, decisions]
    );
    /** Where each row's decision came from, so the table can say "the matcher picked this". */
    const originByRow = useMemo(() => {
        const out = new Map<string, DecisionOrigin>();
        for (const row of tabRows) out.set(row.name, decisionOrigin(row, decisions.get(row.name)));
        return out;
    }, [tabRows, decisions]);

    const refreshAll = useCallback(async () => {
        await Promise.all([mutateBatch(), mutateRows()]);
    }, [mutateBatch, mutateRows]);

    const handleSort = useCallback((columnId: string) => {
        setSort((prev) =>
            prev.columnId === columnId
                ? { columnId, direction: prev.direction === "asc" ? "desc" : "asc" }
                : { columnId, direction: "asc" }
        );
    }, []);

    const handleFilter = useCallback((columnId: string, value: ColumnFilters[string]) => {
        setFilters((prev) => ({ ...prev, [columnId]: value }));
    }, []);

    const toggleRow = useCallback((name: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            next.has(name) ? next.delete(name) : next.add(name);
            return next;
        });
    }, []);

    const toggleAll = useCallback((names: string[]) => {
        setSelected((prev) => {
            const everyOne = names.every((n) => prev.has(n));
            const next = new Set(prev);
            names.forEach((n) => (everyOne ? next.delete(n) : next.add(n)));
            return next;
        });
    }, []);

    const setDecision = useCallback((name: string, decision: RowDecision) => {
        setDecisions((prev) => new Map(prev).set(name, decision));
    }, []);

    /** Settle ONE row. The endpoint is per-row and atomic; a failure here leaves the rest alone. */
    const settleOne = useCallback(
        async (row: OutflowImportRow, decision: RowDecision) => {
            if (decision.target === "new") {
                const form = decision.newExpense!;
                await callCreate({
                    row: row.name,
                    doctype: form.doctype,
                    expense_type: form.expenseType,
                    project: form.project || undefined,
                    description: form.description || undefined,
                    vendor: form.vendor || undefined,
                });
            } else {
                await callSettle({
                    row: row.name,
                    target_doctype: decision.target,
                    target_name: decision.linkTo,
                });
            }
        },
        [callCreate, callSettle]
    );

    const handleConfirmOne = useCallback(async () => {
        if (!openRow) return;
        const decision = decisions.get(openRow.name);
        // Backstop to the dialog's disabled Confirm button: never post a settle for a row that is
        // not actually decided. The ledger arrives with the chosen record now, so a half-cleared
        // decision has no target to write against.
        if (!decision || !isConfirmable(openRow, decision)) return;
        setBusy(true);
        try {
            await settleOne(openRow, decision);
            setOpenRow(null);
            await refreshAll();
        } finally {
            setBusy(false);
        }
    }, [openRow, decisions, settleOne, refreshAll]);

    /**
     * ⚠️ SEQUENTIAL, AND IT ACTS ONLY ON THE ROWS THE BAR COUNTED. Each call is its own
     * transaction, so a failure on the third leaves the first two written and the rest
     * attemptable -- which is the honest shape for rows that were each decided separately. Firing
     * them in parallel would interleave savepoints on one connection.
     */
    const handleBulkConfirm = useCallback(async () => {
        if (!readyToConfirm.length) return;
        setBusy(true);
        const failures: string[] = [];
        try {
            for (const row of readyToConfirm) {
                try {
                    await settleOne(row, decisions.get(row.name)!);
                    setSelected((prev) => {
                        const next = new Set(prev);
                        next.delete(row.name);
                        return next;
                    });
                } catch (err: any) {
                    failures.push(`${row.beneficiary_name}: ${err?.message || "failed"}`);
                }
            }
        } finally {
            setBusy(false);
            await refreshAll();
        }
        if (failures.length) {
            // Named, not counted: "3 failed" tells nobody which three to go and look at.
            alert(`Some rows could not be settled:\n\n${failures.join("\n")}`);
        }
    }, [readyToConfirm, decisions, settleOne, refreshAll]);

    const handleSkip = useCallback(
        async (row: OutflowImportRow, reason: string) => {
            setBusy(true);
            try {
                await callSkip({ row: row.name, reason });
                setOpenRow(null);
                await refreshAll();
            } finally {
                setBusy(false);
            }
        },
        [callSkip, refreshAll]
    );

    const handleMatch = useCallback(async () => {
        await runMatch({ batch: id });
        await refreshAll();
    }, [runMatch, id, refreshAll]);

    const handleClose = useCallback(
        async (reason: string) => {
            await callClose({ batch: id, reason: reason || undefined });
            await refreshAll();
        },
        [callClose, id, refreshAll]
    );

    const handleReopen = useCallback(async () => {
        await callReopen({ batch: id });
        await refreshAll();
    }, [callReopen, id, refreshAll]);

    if (batchError) return <AlertDestructive error={batchError} />;
    if (batchLoading || !batch) {
        return (
            <div className="flex h-[40vh] items-center justify-center">
                <TailSpin color="#D03B45" height={40} width={40} />
            </div>
        );
    }

    const period = batch.period_from
        ? `${formatDate(batch.period_from)}${
              batch.period_to && batch.period_to !== batch.period_from
                  ? ` to ${formatDate(batch.period_to)}`
                  : ""
          }`
        : "--";
    const filterCount = activeFilterCount(filters);

    return (
        <div className="flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" asChild>
                    <Link to="/bulk-import-outflow">
                        <ArrowLeft className="mr-1 h-4 w-4" />
                        Back
                    </Link>
                </Button>
                <h2 className="text-xl font-bold tracking-tight">{batch.name}</h2>
                <Badge variant="outline">{batch.status}</Badge>
                <span className="text-sm text-muted-foreground">
                    {batch.source} - {period}
                </span>
                <div className="ml-auto flex gap-2">
                    {batch.closed_at ? (
                        <Button variant="outline" onClick={handleReopen}>
                            <Unlock className="mr-2 h-4 w-4" />
                            Reopen
                        </Button>
                    ) : (
                        <Button variant="outline" onClick={() => setClosing(true)}>
                            <Lock className="mr-2 h-4 w-4" />
                            Close import
                        </Button>
                    )}
                    <Button onClick={handleMatch} disabled={matching}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${matching ? "animate-spin" : ""}`} />
                        {matching ? "Matching..." : "Run match"}
                    </Button>
                </div>
            </div>

            <Card>
                <CardContent className="grid gap-4 py-4 sm:grid-cols-3 lg:grid-cols-6">
                    <Stat label="Transfers" value={String(batch.total_rows ?? 0)} />
                    <Stat
                        label="Decisions"
                        value={`${batch.reviewed_rows ?? 0} / ${batch.total_rows ?? 0}`}
                    />
                    <Stat label="Settled" value={String(batch.settled_rows ?? 0)} />
                    <Stat label="Skipped" value={String(batch.skipped_rows ?? 0)} />
                    <Stat
                        label="Transferred"
                        value={formatToRoundedIndianRupee(batch.gross_amount ?? 0)}
                    />
                    <Stat
                        label="Bank charges"
                        value={formatToRoundedIndianRupee(batch.charges_amount ?? 0)}
                    />
                </CardContent>
            </Card>

            {batch.closed_at && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Closed by {batch.closed_by} on {formatDate(batch.closed_at)}
                    {batch.close_reason ? ` - ${batch.close_reason}` : ""}. Rows left undecided keep
                    their status and can still be settled.
                </p>
            )}

            <CloseBatchDialog
                batch={batch.name}
                open={closing}
                onOpenChange={setClosing}
                onConfirm={handleClose}
            />

            {/* Three tabs replace the reconciliation report entirely: the same information,
                organised around what has to be done rather than what the reconciler noticed. */}
            <div className="flex gap-2 border-b">
                {OUTFLOW_TABS.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => {
                            setTab(t.id);
                            setSelected(new Set());
                        }}
                        className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
                            tab === t.id
                                ? "border-primary font-medium text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {t.label}
                        <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
                            {counts[t.id]}
                        </span>
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative max-w-sm flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        className="h-8 pl-8 pr-8"
                        placeholder="Search remarks, reference or beneficiary…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                        <button
                            type="button"
                            aria-label="Clear search"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                            onClick={() => setQuery("")}
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                <ColumnsMenu hidden={hidden} onToggle={setHidden} />
                <ClearFiltersButton count={filterCount} onClear={() => setFilters({})} />

                <span className="ml-auto text-xs text-muted-foreground">
                    {shown.length} of {tabRows.length}
                </span>
            </div>

            {rowsLoading ? (
                <div className="flex h-40 items-center justify-center">
                    <TailSpin color="#D03B45" height={30} width={30} />
                </div>
            ) : (
                <OutflowRowsTable
                    rows={shown}
                    facetSource={tabRows}
                    query={query}
                    filters={filters}
                    sort={sort}
                    hiddenColumns={hidden}
                    selected={selected}
                    decidedRowNames={decidedNames}
                    originByRow={originByRow}
                    selectable={tab === "pending"}
                    onSort={handleSort}
                    onFilter={handleFilter}
                    onToggleRow={toggleRow}
                    onToggleAll={toggleAll}
                    onOpenDecision={setOpenRow}
                />
            )}

            {/* ⚠️ REPORTS HOW MANY SELECTED ROWS ARE ACTUALLY DECIDED, not how many are ticked
                (owner ruling). It never silently acts on a row nobody resolved, and it does not
                refuse the whole action either -- the rest are ready. */}
            {tab === "pending" && selected.size > 0 && (
                <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-md border bg-background/95 p-3 shadow-lg backdrop-blur">
                    <span className="text-sm font-medium">{selected.size} selected</span>
                    <span className="text-xs text-muted-foreground">
                        {readyToConfirm.length} decided
                    </span>
                    <div className="ml-auto flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                            Clear
                        </Button>
                        <Button
                            size="sm"
                            disabled={!readyToConfirm.length || busy}
                            onClick={handleBulkConfirm}
                        >
                            {readyToConfirm.length
                                ? `Confirm ${readyToConfirm.length} decided`
                                : "Confirm decided"}
                        </Button>
                    </div>
                </div>
            )}

            <DecisionDialog
                row={openRow}
                decision={openRow ? decisions.get(openRow.name) : undefined}
                onChange={(decision) => openRow && setDecision(openRow.name, decision)}
                onConfirm={handleConfirmOne}
                onSkip={async (reason) => {
                    if (openRow) await handleSkip(openRow, reason);
                }}
                onRerun={handleMatch}
                onClose={() => setOpenRow(null)}
                busy={busy}
            />
        </div>
    );
};

const ColumnsMenu = ({
    hidden,
    onToggle,
}: {
    hidden: Set<string>;
    onToggle: (next: Set<string>) => void;
}) => (
    <Popover>
        <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
                <Columns3 className="mr-1.5 h-3.5 w-3.5" />
                Columns
            </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
            {OUTFLOW_COLUMNS.map((column) => (
                <label
                    key={column.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                >
                    <Checkbox
                        checked={!hidden.has(column.id)}
                        onCheckedChange={() => {
                            const next = new Set(hidden);
                            next.has(column.id) ? next.delete(column.id) : next.add(column.id);
                            onToggle(next);
                        }}
                    />
                    <span>{column.title}</span>
                </label>
            ))}
        </PopoverContent>
    </Popover>
);

const Stat = ({ label, value }: { label: string; value: string }) => (
    <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="font-medium tabular-nums">{value}</p>
    </div>
);

export const Component = OutflowImportBatchPage;
export default OutflowImportBatchPage;
