// src/pages/outflow-import/OutflowMasterPage.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Columns3, Lock, Search, Unlock, Upload, X } from "lucide-react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
    OutflowImportOption,
    OutflowImportRow,
    OutflowImportSummary,
    OutflowRowsPage,
} from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";

import { CloseBatchDialog } from "./components/CloseBatchDialog";
import { ConfirmAllMatchedDialog } from "./components/ConfirmAllMatchedDialog";
import { DecisionDialog } from "./components/DecisionDialog";
import { ImportStatementDialog } from "./components/ImportStatementDialog";
import { ImportSummaryPanel } from "./components/ImportSummaryPanel";
import {
    ClearFiltersButton,
    OutflowRowsTable,
    TablePagination,
} from "./components/OutflowRowsTable";
import {
    DEFAULT_PAGE_SIZE,
    DEFAULT_HIDDEN_COLUMNS,
    OUTFLOW_COLUMNS,
    OUTFLOW_TABS,
    activeFilterCount,
    decidedRows,
    decisionOrigin,
    isConfirmable,
    seedDecisions,
    serverQuery,
    tabForStatus,
    type ColumnFilters,
    type DecisionOrigin,
    type OutflowTab,
    type RowDecision,
    type SortState,
} from "./outflowTableModel";

/**
 * Bulk Import Outflow -- ONE screen (slices X3 + X4).
 *
 * ⚠️ THE SHAPE REVERSED HERE, AND THE OLD SHAPE IS WORTH STATING SO THE CHANGE IS LEGIBLE. Until
 * X3 a SHEET was a place: you opened a list of imports, opened one, and saw its rows. Rows only
 * ever existed inside their import. Now the TRANSACTIONS are the thing -- one table across every
 * import -- and an import is an attribute of a row, a column and a filter. Importing adds to the
 * table rather than creating somewhere to go.
 *
 * ⚠️ THE SUMMARY ABOVE IT IS SCOPED TO ONE IMPORT WHILE THE TABLE SPANS ALL OF THEM. That is
 * deliberate: "how did that statement go?" and "what do I still owe a decision on?" are different
 * questions, and this is the screen that answers both. Clicking a figure in the summary scopes the
 * table to it, which is the seam between the two.
 *
 * ⚠️ DECISIONS ARE STILL CLIENT STATE UNTIL CONFIRMED, exactly as before. A reviewer works down the
 * list and confirms a batch of rows; nothing is written until they do. That is why the bulk bar
 * counts DECIDED rows rather than selected ones -- and, now that the table is paged, why it counts
 * only among the rows actually loaded. "Confirm all matched" in the summary is the answer for
 * acting on a whole import at once, and it is driven from the server for exactly that reason.
 */
export const OutflowMasterPage = () => {
    // A deep link to one import still resolves -- it lands here with the table pre-scoped, so every
    // bookmark and every link written before X3 keeps working.
    const { id: deepLinkedBatch } = useParams<{ id: string }>();

    const [tab, setTab] = useState<OutflowTab>("pending");
    const [query, setQuery] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const [filters, setFilters] = useState<ColumnFilters>({});
    const [sort, setSort] = useState<SortState>({ columnId: "added_on", direction: "desc" });
    const [page, setPage] = useState(0);
    const [hidden, setHidden] = useState<Set<string>>(new Set(DEFAULT_HIDDEN_COLUMNS));
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [decisions, setDecisions] = useState<ReadonlyMap<string, RowDecision>>(new Map());
    const [openRow, setOpenRow] = useState<OutflowImportRow | null>(null);
    const [busy, setBusy] = useState(false);
    const [importing, setImporting] = useState(false);
    const [confirmingAll, setConfirmingAll] = useState(false);
    const [closing, setClosing] = useState(false);
    const [selectedImport, setSelectedImport] = useState<string | undefined>(deepLinkedBatch);

    // Typing must not fire a query per keystroke now that search is a round trip.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(timer);
    }, [query]);

    // Any change to what is being asked for resets to the first page. Without this, narrowing a
    // filter while on page 4 shows an empty table that looks like "no results".
    useEffect(() => {
        setPage(0);
    }, [tab, debouncedQuery, filters, sort, deepLinkedBatch]);

    const rowsQuery = useMemo(
        () =>
            serverQuery({
                tab,
                query: debouncedQuery,
                filters,
                sort,
                page,
                batch: deepLinkedBatch,
            }),
        [tab, debouncedQuery, filters, sort, page, deepLinkedBatch]
    );

    const {
        data: pageData,
        isLoading: rowsLoading,
        mutate: mutateRows,
    } = useFrappeGetCall<{ message: OutflowRowsPage }>(
        "nirmaan_stack.api.outflow_import.review.get_outflow_rows",
        // The SDK keys its cache on the arguments, so a JSON-serialisable object is what makes each
        // distinct query its own cache entry rather than one entry that keeps being overwritten.
        { ...rowsQuery, facets: JSON.stringify(rowsQuery.facets ?? {}) },
        `outflow-rows-${JSON.stringify(rowsQuery)}`
    );

    const { data: importsData, mutate: mutateImports } = useFrappeGetCall<{
        message: OutflowImportOption[];
    }>("nirmaan_stack.api.outflow_import.review.list_imports", {}, "outflow-imports");

    const imports = useMemo(() => importsData?.message ?? [], [importsData]);

    // The picker defaults to the NEWEST import -- `list_imports` is ordered for exactly that -- and
    // a deep link overrides it. Only ever set when nothing is chosen, so it cannot fight the user.
    useEffect(() => {
        if (selectedImport || !imports.length) return;
        setSelectedImport(imports[0].name);
    }, [imports, selectedImport]);

    const {
        data: summaryData,
        isLoading: summaryLoading,
        mutate: mutateSummary,
    } = useFrappeGetCall<{ message: OutflowImportSummary }>(
        "nirmaan_stack.api.outflow_import.review.get_import_summary",
        { batch: selectedImport },
        selectedImport ? `outflow-summary-${selectedImport}` : null
    );

    const summary = summaryData?.message;

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

    const rows = useMemo(() => pageData?.message?.rows ?? [], [pageData]);
    const total = pageData?.message?.total ?? 0;
    const tabCounts = pageData?.message?.tab_counts;

    /**
     * Adopt the match run's own picks as decisions, as soon as the rows land.
     *
     * ⚠️ SEEDING IS NOT SETTLING. It fills in the same choice a person would have clicked; the row
     * still has to be ticked and confirmed, and that confirmation is still the only thing that
     * writes.
     *
     * `seedDecisions` never overwrites a decision a reviewer made -- including one they deliberately
     * CLEARED -- and returns the SAME map when it adds nothing, so paging back and forth does not
     * churn state. That matters more now than it did on the batch page: this effect runs on every
     * page of every filter.
     */
    useEffect(() => {
        setDecisions((prev) => seedDecisions(rows, prev));
    }, [rows]);

    const decidedNames = useMemo(
        () =>
            new Set(rows.filter((r) => isConfirmable(r, decisions.get(r.name))).map((r) => r.name)),
        [rows, decisions]
    );
    const readyToConfirm = useMemo(
        () => decidedRows(rows, selected, decisions),
        [rows, selected, decisions]
    );
    const originByRow = useMemo(() => {
        const out = new Map<string, DecisionOrigin>();
        for (const row of rows) out.set(row.name, decisionOrigin(row, decisions.get(row.name)));
        return out;
    }, [rows, decisions]);

    const refreshAll = useCallback(async () => {
        await Promise.all([mutateRows(), mutateSummary(), mutateImports()]);
    }, [mutateRows, mutateSummary, mutateImports]);

    /**
     * The facet values one funnel offers, fetched when it opens.
     *
     * ⚠️ IT SENDS EVERY FILTER EXCEPT THE FUNNEL'S OWN. A funnel that filtered its own options would
     * collapse to whatever is already ticked the moment it opened, and there would be no way back to
     * the values you unticked. The server enforces the same thing; this is the caller half.
     *
     * Held in a ref-stable callback because the table passes it straight into an effect dep.
     */
    const filtersRef = useRef(filters);
    filtersRef.current = filters;
    const scopeRef = useRef(rowsQuery.scope);
    scopeRef.current = rowsQuery.scope;
    const searchRef = useRef(debouncedQuery);
    searchRef.current = debouncedQuery;

    const loadFacetValues = useCallback(
        async (columnId: string): Promise<string[]> => {
            const others: ColumnFilters = { ...filtersRef.current };
            delete others[columnId];
            const query = serverQuery({
                tab,
                query: searchRef.current,
                filters: others,
                batch: deepLinkedBatch,
            });
            const params = new URLSearchParams({
                column: columnId,
                scope: scopeRef.current,
            });
            if (query.batch) params.set("batch", query.batch);
            if (query.search) params.set("search", query.search);
            if (query.amount_min != null) params.set("amount_min", String(query.amount_min));
            if (query.amount_max != null) params.set("amount_max", String(query.amount_max));

            const response = await fetch(
                `/api/method/nirmaan_stack.api.outflow_import.review.get_outflow_facet_values?${params}`,
                { headers: { Accept: "application/json" } }
            );
            if (!response.ok) throw new Error(`Could not load values (${response.status}).`);
            return (await response.json())?.message?.values ?? [];
        },
        [tab, deepLinkedBatch]
    );

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
        if (!selectedImport) return;
        await runMatch({ batch: selectedImport });
        await refreshAll();
    }, [runMatch, selectedImport, refreshAll]);

    const handleImported = useCallback(
        async (batch: string) => {
            // The new import becomes the one being summarised -- it is what somebody just did, and
            // it is what they are about to work on.
            setSelectedImport(batch);
            await refreshAll();
        },
        [refreshAll]
    );

    /**
     * A figure in the summary was clicked: scope the table to exactly those rows.
     *
     * The tab has to move too, because a status set lives in one tab -- clicking "Settled" while
     * the Pending tab is showing would filter to a status the tab excludes and show nothing.
     */
    const handleFocusStatuses = useCallback((statuses: string[]) => {
        setFilters((prev) => ({ ...prev, row_status: statuses }));
        setTab(tabForStatus(statuses[0]));
        setSelected(new Set());
    }, []);

    const handleClose = useCallback(
        async (reason: string) => {
            if (!selectedImport) return;
            await callClose({ batch: selectedImport, reason: reason || undefined });
            await refreshAll();
        },
        [callClose, selectedImport, refreshAll]
    );

    const handleReopen = useCallback(async () => {
        if (!selectedImport) return;
        await callReopen({ batch: selectedImport });
        await refreshAll();
    }, [callReopen, selectedImport, refreshAll]);

    const filterCount = activeFilterCount(filters);

    return (
        <div className="flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">Bulk Import Outflow</h2>
                {deepLinkedBatch && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        showing {deepLinkedBatch} only
                    </span>
                )}
                <div className="ml-auto flex gap-2">
                    {summary?.import.closed_at ? (
                        <Button variant="outline" size="sm" onClick={handleReopen}>
                            <Unlock className="mr-2 h-4 w-4" />
                            Reopen import
                        </Button>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!selectedImport}
                            onClick={() => setClosing(true)}
                        >
                            <Lock className="mr-2 h-4 w-4" />
                            Close import
                        </Button>
                    )}
                    <Button size="sm" onClick={() => setImporting(true)}>
                        <Upload className="mr-2 h-4 w-4" />
                        Import statement
                    </Button>
                </div>
            </div>

            <ImportSummaryPanel
                summary={summary}
                imports={imports}
                selected={selectedImport}
                loading={summaryLoading}
                matching={matching}
                onSelect={setSelectedImport}
                onFocusStatuses={handleFocusStatuses}
                onConfirmAllMatched={() => setConfirmingAll(true)}
                onRunMatch={handleMatch}
            />

            {summary?.import.closed_at && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Closed by {summary.import.closed_by} on{" "}
                    {formatDate(summary.import.closed_at.split(/[ T]/)[0])}
                    {summary.import.close_reason ? ` — ${summary.import.close_reason}` : ""}. Rows
                    left undecided keep their status and can still be settled.
                </p>
            )}

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
                        {/* ⚠️ THE COUNTS DESCRIBE THE CURRENT SEARCH, not the whole table. A search
                            matching four rows must not show "Settled 812" beside it. */}
                        <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
                            {tabCounts
                                ? t.id === "pending"
                                    ? tabCounts.open
                                    : tabCounts[t.id]
                                : "—"}
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
                    {total.toLocaleString()} {total === 1 ? "transfer" : "transfers"}
                </span>
            </div>

            {rowsLoading && !rows.length ? (
                <div className="flex h-40 items-center justify-center">
                    <TailSpin color="#D03B45" height={30} width={30} />
                </div>
            ) : (
                <>
                    <OutflowRowsTable
                        rows={rows}
                        loadFacetValues={loadFacetValues}
                        query={debouncedQuery}
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
                    <TablePagination
                        total={total}
                        limit={rowsQuery.limit || DEFAULT_PAGE_SIZE}
                        offset={rowsQuery.offset}
                        busy={rowsLoading}
                        onPage={setPage}
                    />
                </>
            )}

            {/* ⚠️ REPORTS HOW MANY SELECTED ROWS ARE ACTUALLY DECIDED, not how many are ticked
                (owner ruling). It never silently acts on a row nobody resolved, and it does not
                refuse the whole action either -- the rest are ready. Paged, it counts among the
                rows LOADED; "Confirm all matched" in the summary is the whole-import action. */}
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

            <ImportStatementDialog
                open={importing}
                onOpenChange={setImporting}
                onImported={handleImported}
            />

            <ConfirmAllMatchedDialog
                batch={selectedImport}
                open={confirmingAll}
                onOpenChange={setConfirmingAll}
                onSettled={refreshAll}
            />

            {selectedImport && (
                <CloseBatchDialog
                    batch={selectedImport}
                    open={closing}
                    onOpenChange={setClosing}
                    onConfirm={handleClose}
                />
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

export const Component = OutflowMasterPage;
export default OutflowMasterPage;
