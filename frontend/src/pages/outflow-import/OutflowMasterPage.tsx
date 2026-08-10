// src/pages/outflow-import/OutflowMasterPage.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Columns3, Layers, Search, Upload, Wallet, X } from "lucide-react";
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
} from "@/types/NirmaanStack/OutflowImportBatch";
import { OPEN_ROW_STATUSES } from "./outflowImportStatus";
import { ConfirmAllMatchedDialog } from "./components/ConfirmAllMatchedDialog";
import { DecisionDialog } from "./components/DecisionDialog";
import { ImportStatementDialog } from "./components/ImportStatementDialog";
import { ImportSummaryPanel } from "./components/ImportSummaryPanel";
import { useOutflowRows } from "./useOutflowRows";
import { ApprovedRecordsPanel } from "./components/ApprovedRecordsPanel";
import { SkippedRowsDialog } from "./components/SkippedRowsDialog";
import { UnpairedStacksDialog } from "./components/UnpairedStacksDialog";
import {
    ClearFiltersButton,
    OutflowRowsTable,
    TablePagination,
} from "./components/OutflowRowsTable";
import {
    DEFAULT_TAB,
    OUTFLOW_COLUMNS,
    OUTFLOW_TABS,
    decidedRows,
    decisionOrigin,
    isConfirmable,
    seedDecisions,
    SCOPE_FOR_TAB,
    type DecisionOrigin,
    type OutflowTab,
    type RowDecision,
    describeFrappeError,
    tabCountParts,
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

    const [tab, setTab] = useState<OutflowTab>(DEFAULT_TAB);
    /**
     * The far-right view, which is NOT one of the three tabs.
     *
     * ⚠️ IT IS NOT AN `OutflowTab` AND MUST NOT BECOME ONE. The three tabs are three SCOPES over
     * `Outflow Import Row`; this reads the three LEDGERS and has no import row anywhere in it. A
     * fourth entry in `OUTFLOW_TABS` would put it through `SCOPE_FOR_TAB`, which has nothing to map
     * it to, and would hand it a `tab_counts` number describing a different population entirely.
     */
    const [showingApproved, setShowingApproved] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [decisions, setDecisions] = useState<ReadonlyMap<string, RowDecision>>(new Map());
    const [openRow, setOpenRow] = useState<OutflowImportRow | null>(null);
    const [busy, setBusy] = useState(false);
    // The server's refusal for a SINGLE-row confirm. Rendered inside the decision dialog, where
    // the click happened -- a toast would be gone before the reviewer looked up from the record
    // list they are about to correct.
    const [confirmError, setConfirmError] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [confirmingAll, setConfirmingAll] = useState(false);
    const [resolvingStacks, setResolvingStacks] = useState(false);
    const [showingSkipped, setShowingSkipped] = useState(false);
    const [selectedImport, setSelectedImport] = useState<string | undefined>(deepLinkedBatch);

    /**
     * The table's whole query, and what came back.
     *
     * ⚠️ EXTRACTED AT T2 SO THE SKIPPED DIALOG COULD SHARE IT. Search, funnels, sort, paging and the
     * facet fetch used to live here as loose state; two surfaces needing the same table meant either
     * one hook or two engines behind one question, and the client filter engine was deleted at X3
     * for being the second engine. Selection and decisions deliberately stayed here -- see the
     * hook's docstring for why they are not the hook's to own.
     */
    const table = useOutflowRows({ scope: SCOPE_FOR_TAB[tab], batch: deepLinkedBatch });
    const { rows, loading: rowsLoading, mutate: mutateRows } = table;

    const { data: importsData, mutate: mutateImports } = useFrappeGetCall<{
        message: OutflowImportOption[];
    }>("nirmaan_stack.api.outflow_import.review.list_imports", {}, "outflow-imports");

    /**
     * How many stacks still need a person (chunk E3).
     *
     * ⚠️ FETCHED FOR THE COUNT ALONE, so the button can be ABSENT rather than disabled when there
     * is nothing to resolve. A permanently visible "Resolve stacks (0)" would be one more control
     * to learn and dismiss on every visit, and the case it serves is rare -- three stacks on a
     * 1,043-row statement. It is a separate read from the table's because it spans every import
     * and ignores every filter, which is exactly what the table's does not.
     */
    const { data: stacksData, mutate: mutateStacks } = useFrappeGetCall<{
        message: { stacks: unknown[]; total: number };
    }>(
        "nirmaan_stack.api.outflow_import.review.get_unpaired_stacks",
        {},
        "outflow-unpaired-stacks-count"
    );
    const unpairedStacks = stacksData?.message?.total ?? 0;

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
    /**
     * Which rows may be ticked, computed PER ROW rather than per tab (2026-08-10 retab).
     *
     * ⚠️ IT KEYS ON THE STATUS DERIVER, not on the tab. The new tabs deliberately do not partition
     * open from terminal -- "Matched / Settled" pairs an open status with a terminal one -- so
     * asking the tab is asking the wrong question. `OPEN_ROW_STATUSES` is the same set that decides
     * whether anyone still owes this row a decision, which is exactly what "can I tick it" means.
     */
    const selectableRowNames = useMemo(
        () => new Set(rows.filter((r) => OPEN_ROW_STATUSES.has(r.row_status)).map((r) => r.name)),
        [rows]
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
        await Promise.all([mutateRows(), mutateSummary(), mutateImports(), mutateStacks()]);
    }, [mutateRows, mutateSummary, mutateImports, mutateStacks]);

    /**
     * The facet values one funnel offers, fetched when it opens.
     *
     * ⚠️ IT SENDS EVERY FILTER EXCEPT THE FUNNEL'S OWN. A funnel that filtered its own options would
     * collapse to whatever is already ticked the moment it opened, and there would be no way back to
     * the values you unticked. The server enforces the same thing; this is the caller half.
     *
     * Held in a ref-stable callback because the table passes it straight into an effect dep.
     */
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

    // ⚠️ STABLE. The decision dialog feeds this into a `useCallback` that a child effect depends
    // on; a fresh arrow every render would re-fire that effect on every render of the page.
    const dismissConfirmError = useCallback(() => setConfirmError(null), []);

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
        setConfirmError(null);
        try {
            await settleOne(openRow, decision);
            setOpenRow(null);
            await refreshAll();
        } catch (err: any) {
            // ⚠️ THIS `catch` IS THE DEFECT THE OWNER REPORTED, AND ITS ABSENCE WAS THE WHOLE BUG.
            // A refused settle rejected the promise, nothing caught it, and the dialog just sat
            // there -- so a deliberate server rule ("this record is 2,19,000 away from the
            // transfer") was indistinguishable from a dead button. The BULK path had always
            // reported its failures; this single-row path never did.
            setConfirmError(describeFrappeError(err, "The settle failed."));
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
                    // The server's own sentence, not Frappe's "There was an error." envelope.
                    failures.push(
                        `${row.beneficiary_name}: ${describeFrappeError(err, "the settle failed")}`
                    );
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
                    {/* ⚠️ ABSENT, NOT DISABLED, when there is nothing to resolve. The case is rare
                        -- three stacks on a 1,043-row statement -- and a permanent "Resolve
                        stacks (0)" would be one more control to learn and dismiss on every visit. */}
                    {unpairedStacks > 0 && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setResolvingStacks(true)}
                        >
                            <Layers className="mr-2 h-4 w-4" />
                            Resolve {unpairedStacks}{" "}
                            {unpairedStacks === 1 ? "stack" : "stacks"}
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
                onConfirmAllMatched={() => setConfirmingAll(true)}
                onRunMatch={handleMatch}
                onShowSkipped={() => setShowingSkipped(true)}
            />

            {/* ⚠️ THE SCOPE OF THE TABLE, SAID OUT LOUD. The panel above describes ONE import and
                the table below spans every one -- deliberate, and the reason this screen answers
                both "how did that statement go?" and "what do I still owe a decision on?". But the
                two put a count labelled "matched" directly above a tab labelled "Matched", over
                different populations, and nothing said so: the panel's button read 688 while the
                tab read 893, and both were right. One line is cheaper than either number moving. */}
            <p className={`text-xs text-muted-foreground ${showingApproved ? "hidden" : ""}`}>
                {deepLinkedBatch
                    ? `Transactions in ${deepLinkedBatch}. The summary above describes the import selected there.`
                    : "Transactions across every import. The summary above describes one import only."}
            </p>

            <div className="flex flex-wrap items-center gap-2 border-b">
                {OUTFLOW_TABS.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => {
                            setTab(t.id);
                            setShowingApproved(false);
                            setSelected(new Set());
                        }}
                        className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
                            tab === t.id && !showingApproved
                                ? "border-primary font-medium text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {t.label}
                        {/* ⚠️ THE COUNTS DESCRIBE THE CURRENT SEARCH, not the whole table. A search
                            matching four rows must not show "Settled 812" beside it.

                            ⚠️ THE `matched` TAB RENDERS TWO NUMBERS, and that is a correctness fix
                            rather than decoration -- it holds an OPEN status beside a TERMINAL one,
                            so one number there meant two things and was read as the terminal one
                            (863 under "Matched / Settled" while nothing was settled). The split
                            comes from the pure `tabCountParts`; the other two tabs are unchanged.

                            ⚠️ KEYED THROUGH `SCOPE_FOR_TAB` inside that helper, never by the tab id.
                            The endpoint returns its counts under the SCOPE names, and the two
                            vocabularies differ on purpose -- the pre-retab code special-cased the
                            one tab whose id and scope disagreed, which is a bug waiting for the
                            second one. */}
                        {tabCountParts(t.id, table.tabCounts, table.statusCounts).map((part) => (
                            <span
                                key={part.key}
                                className={`rounded-full px-1.5 text-xs tabular-nums ${
                                    part.tone ?? "bg-muted"
                                }`}
                            >
                                {part.count ?? "—"}
                                {part.label ? ` ${part.label}` : ""}
                            </span>
                        ))}
                    </button>
                ))}

                {/* ⚠️ A BUTTON, NOT A FOURTH TAB (owner, 2026-08-11), and the distinction is the
                    whole reason it looks different. The three tabs to its left are three SCOPES over
                    ONE population — `Outflow Import Row` — so their counts sit in a row precisely
                    because they can be compared and subtracted. This opens a view over three OTHER
                    doctypes with no import row in it at all. Rendering it as a tab put a control for
                    a different population into a grammar that invites arithmetic against 996 / 145 /
                    863, which is the exact confusion this whole clean-up started from.

                    ⚠️ `ml-auto` IS LOAD-BEARING, not alignment taste: pushing it to the far right of
                    the strip is what stops it reading as the next item in the sequence. */}
                <Button
                    variant={showingApproved ? "default" : "outline"}
                    size="sm"
                    className="ml-auto mb-1"
                    aria-pressed={showingApproved}
                    onClick={() => setShowingApproved((on) => !on)}
                    title="Everything approved and not yet paid, across all three ledgers — not scoped to any import"
                >
                    <Wallet className="mr-2 h-4 w-4" />
                    Approved Payments/Expenses
                </Button>
            </div>

            {showingApproved && <ApprovedRecordsPanel />}

            <div className={showingApproved ? "hidden" : "flex flex-wrap items-center gap-2"}>
                <div className="relative max-w-sm flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        className="h-8 pl-8 pr-8"
                        placeholder="Search remarks, reference or beneficiary…"
                        value={table.search}
                        onChange={(e) => table.setSearch(e.target.value)}
                    />
                    {table.search && (
                        <button
                            type="button"
                            aria-label="Clear search"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                            onClick={() => table.setSearch("")}
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                <ColumnsMenu hidden={table.hidden} onToggle={table.setHidden} />
                <ClearFiltersButton count={table.filterCount} onClear={table.clearFilters} />

                <span className="ml-auto text-xs text-muted-foreground">
                    {table.total.toLocaleString()} {table.total === 1 ? "transfer" : "transfers"}
                </span>
            </div>

            {!showingApproved &&
                (rowsLoading && !rows.length ? (
                <div className="flex h-40 items-center justify-center">
                    <TailSpin color="#D03B45" height={30} width={30} />
                </div>
            ) : (
                <>
                    <OutflowRowsTable
                        rows={rows}
                        loadFacetValues={table.loadFacetValues}
                        query={table.search}
                        filters={table.filters}
                        sort={table.sort}
                        hiddenColumns={table.hidden}
                        selected={selected}
                        decidedRowNames={decidedNames}
                        originByRow={originByRow}
                        selectableRowNames={selectableRowNames}
                        onSort={table.toggleSort}
                        onFilter={table.setFilter}
                        onToggleRow={toggleRow}
                        onToggleAll={toggleAll}
                        onOpenDecision={setOpenRow}
                    />
                    <TablePagination
                        total={table.total}
                        limit={table.pageSize}
                        offset={table.page * table.pageSize}
                        busy={rowsLoading}
                        onPage={table.setPage}
                    />
                    </>
                ))}

            {/* ⚠️ REPORTS HOW MANY SELECTED ROWS ARE ACTUALLY DECIDED, not how many are ticked
                (owner ruling). It never silently acts on a row nobody resolved, and it does not
                refuse the whole action either -- the rest are ready. Paged, it counts among the
                rows LOADED; "Confirm all matched" in the summary is the whole-import action.

                ⚠️ NO LONGER GATED ON A TAB (2026-08-10 retab). Only open rows can be ticked at all
                now -- the table enforces that per row -- so a non-empty selection means there is
                something to confirm, whichever tab it was made on. */}
            {!showingApproved && selected.size > 0 && (
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

            <SkippedRowsDialog
                batch={selectedImport}
                skippedRows={summary?.totals?.skipped_rows}
                failedRows={summary?.totals?.failed_rows}
                open={showingSkipped}
                onOpenChange={setShowingSkipped}
            />

            <UnpairedStacksDialog
                open={resolvingStacks}
                onOpenChange={setResolvingStacks}
                onSettled={refreshAll}
            />

            <DecisionDialog
                row={openRow}
                decision={openRow ? decisions.get(openRow.name) : undefined}
                onChange={(decision) => openRow && setDecision(openRow.name, decision)}
                onConfirm={handleConfirmOne}
                onSkip={async (reason) => {
                    if (openRow) await handleSkip(openRow, reason);
                }}
                onRerun={handleMatch}
                onClose={() => {
                    setOpenRow(null);
                    setConfirmError(null);
                }}
                busy={busy}
                error={confirmError}
                onDismissError={dismissConfirmError}
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
