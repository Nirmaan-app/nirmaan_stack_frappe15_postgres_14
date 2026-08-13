// src/pages/outflow-import/OutflowMasterPage.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Columns3, Search, Upload, Wallet, X } from "lucide-react";
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
import { useOutflowPeriod } from "./useOutflowPeriodStore";
import { ApprovedRecordsPanel } from "./components/ApprovedRecordsPanel";
import { SkippedRowsDialog } from "./components/SkippedRowsDialog";
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
    type PartialIntent,
    type RowDecision,
    type SettleableRecord,
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
 * ⚠️ THE SUMMARY AND THE TABLE DESCRIBE ONE POPULATION SINCE P1, AND THEY USED TO DESCRIBE TWO. The
 * panel summarised a single import chosen from a picker while the table spanned every one, and the
 * domain doc recorded that mismatch as the DESIGN (owner ruling 2026-08-10). The owner reversed it
 * on 2026-08-12: a PERIOD control at the top scopes both, and every sibling read -- the summary, the
 * confirm dialog, the Skipped dialog, the re-match -- is handed the SAME filter set, which the
 * server applies through the one `_row_filters` builder.
 *
 * ⚠️ THE SURVIVING HALF OF THAT RULING IS KEPT DELIBERATELY: reading a figure must never move the
 * tab. The status figures still REPORT rather than scope, and changing the period does not change
 * which tab is open.
 *
 * ⚠️ DECISIONS ARE STILL CLIENT STATE UNTIL CONFIRMED, exactly as before. A reviewer works down the
 * list and confirms a batch of rows; nothing is written until they do. That is why the bulk bar
 * counts DECIDED rows rather than selected ones -- and, now that the table is paged, why it counts
 * only among the rows actually loaded. "Confirm all matched" in the summary is the answer for
 * acting on a whole import at once, and it is driven from the server for exactly that reason.
 */
export const OutflowMasterPage = () => {
    /**
     * The selected import, or undefined for ALL of them.
     *
     * ⚠️ THE ROUTE PARAM IS THE SELECTION — there is no second copy in page state, and that is what
     * keeps the two from contradicting each other. `/bulk-import-outflow/:id` used to be a separate
     * "deep-linked" MODE with its own header and no way back; it is now simply the URL that says
     * which import the selector has chosen. Picking one navigates there, picking "All imports"
     * navigates back to the bare path, and every pre-existing bookmark keeps working while gaining a
     * way out of itself.
     *
     * ⚠️ THE TWO PATHS ARE SEPARATE ROUTE ENTRIES, so switching REMOUNTS this page. That is correct
     * rather than merely tolerable: a different import is a different set of rows, and the ticked
     * selection and the un-confirmed decisions belong to the rows they were made on. The period
     * survives, because it lives in a module-level store rather than here.
     */
    const { id: selectedImport } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const handleSelectImport = useCallback(
        (batch?: string) => {
            // ⚠️ THE PERIOD PARAMS ARE DROPPED ON THE WAY IN AND RESTORED ON THE WAY OUT BY THE
            // STORE, not carried here. A period in the URL of an import-scoped screen would be a
            // filter that is written down but not applied — the same contradiction the disabled
            // control exists to avoid, in the address bar.
            navigate(batch ? `/bulk-import-outflow/${encodeURIComponent(batch)}` : "/bulk-import-outflow");
        },
        [navigate]
    );

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
    const [showingSkipped, setShowingSkipped] = useState(false);

    /**
     * The table's whole query, and what came back.
     *
     * ⚠️ EXTRACTED AT T2 SO THE SKIPPED DIALOG COULD SHARE IT. Search, funnels, sort, paging and the
     * facet fetch used to live here as loose state; two surfaces needing the same table meant either
     * one hook or two engines behind one question, and the client filter engine was deleted at X3
     * for being the second engine. Selection and decisions deliberately stayed here -- see the
     * hook's docstring for why they are not the hook's to own.
     */
    const table = useOutflowRows({ scope: SCOPE_FOR_TAB[tab], batch: selectedImport });
    const { rows, loading: rowsLoading, mutate: mutateRows } = table;

    /**
     * The period the whole screen is scoped to (slice P1).
     *
     * ⚠️ READ FROM THE STORE HERE AND FROM `useOutflowRows` THERE — deliberately NOT threaded as a
     * prop. Four surfaces need the same window (this panel, the master table, the Skipped dialog's
     * own separate table, and the confirm dialog), and a prop would reach three of them.
     */
    const { period, setPeriod } = useOutflowPeriod();

    /**
     * ⚠️ THE SUMMARY TAKES THE TABLE'S OWN FILTERS, MINUS THE SCOPE. This is what makes the panel
     * the aggregate of the table beneath it rather than a second opinion about a different
     * population — the objection behind the 2026-08-10 ruling that P1 revises. `filterQuery` is
     * derived from the query the table just sent, so the two cannot drift.
     */
    const { filterQuery } = table;

    /**
     * The filter set as it goes ON THE WIRE — ONE object for every sibling read.
     *
     * ⚠️ `facets` MUST BE SERIALISED HERE, NOT AT EACH CALL SITE. It is the only nested value in the
     * set, and these are GET calls: an object reaches the server as `[object Object]`, which
     * `_parsed_facets` then drops SILENTLY (it swallows a parse failure on purpose, so a stale
     * bookmark shows an unfiltered table rather than an error page). The failure mode is therefore
     * invisible — a funnel that works on the table and is quietly ignored by the summary, the
     * confirm dialog and the re-match. Serialising once, where the object is built, is what stops
     * the four from disagreeing.
     */
    const filterArgs = useMemo(
        () => ({ ...filterQuery, facets: JSON.stringify(filterQuery.facets ?? {}) }),
        [filterQuery]
    );

    const {
        data: summaryData,
        isLoading: summaryLoading,
        mutate: mutateSummary,
    } = useFrappeGetCall<{ message: OutflowImportSummary }>(
        "nirmaan_stack.api.outflow_import.review.get_outflow_summary",
        filterArgs,
        `outflow-summary-${JSON.stringify(filterArgs)}`
    );

    const summary = summaryData?.message;
    const { data: importsData, mutate: mutateImports } = useFrappeGetCall<{
        message: OutflowImportOption[];
    }>("nirmaan_stack.api.outflow_import.review.list_imports", {}, "outflow-imports");

    const importOptions = useMemo(() => importsData?.message ?? [], [importsData]);

    // ⚠️ PERIOD-WIDE, NOT PER BATCH (slice P1). `match_period` resolves which imports the current
    // filters touch and loops `match_batch` over them -- the matching UNIT is still one whole
    // statement, because its four global passes reason over a batch at once. See the button's
    // tooltip, which states the overspill that follows from that.
    const { call: runMatch, loading: matching } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.match_period"
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
    // ⚠️ A SEPARATE ENDPOINT, AND THE SEPARATION IS THE GUARD (slice PS). The bulk confirm loops
    // `settleOne`, which calls `settle_row`; a partial can only ever be reached from one reviewer
    // answering one question about one row, which is what keeps it outside the settle window
    // without widening it.
    const { call: callSettlePartial } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.expenses.settle_row_partial"
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
     * Settle part of an approved payment and carry the balance forward (slice PS).
     *
     * ⚠️ IT SHARES `handleConfirmOne`'S ERROR HANDLING FOR THE SAME REASON THAT CATCH EXISTS. A
     * refused partial must surface the server's own sentence in the footer, not vanish -- the
     * silent-rejection defect the owner reported is exactly what an unhandled rejection here would
     * recreate, one dialog deeper.
     */
    const handlePartialSettle = useCallback(
        async (record: SettleableRecord, intent: PartialIntent) => {
            if (!openRow) return;
            setBusy(true);
            setConfirmError(null);
            try {
                await callSettlePartial({
                    row: openRow.name,
                    target_name: record.name,
                    intent,
                });
                setOpenRow(null);
                await refreshAll();
            } catch (err: any) {
                setConfirmError(describeFrappeError(err, "The partial settle failed."));
            } finally {
                setBusy(false);
            }
        },
        [openRow, callSettlePartial, refreshAll]
    );

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
        await runMatch(filterArgs);
        await refreshAll();
    }, [runMatch, filterArgs, refreshAll]);

    const handleImported = useCallback(
        async (_batch: string, statementPeriod?: { from?: string | null; to?: string | null }) => {
            /**
             * ⚠️ THE SCREEN MOVES TO THE STATEMENT THAT WAS JUST IMPORTED (slice P1), and it has to.
             * A statement is routinely uploaded weeks after the transfers in it moved, so a fresh
             * import can land entirely OUTSIDE the default `last 30 days` window — the page would
             * refresh to a summary that does not mention it and a table that does not list it,
             * which reads as a failed upload rather than as a period doing its job.
             *
             * ⚠️ IT SETS THE STATEMENT'S OWN PERIOD RATHER THAN CLEARING TO ALL TIME. "Here is the
             * statement you just imported" is the useful answer; "here is every transfer ever
             * staged" is merely a wide one, and it throws away the scoping somebody may have set up
             * before uploading. The dates come from the upload result, so they are the statement's
             * declared period and not a guess.
             *
             * A statement with no period at all (an empty or unparseable date column) falls back to
             * clearing the filter — showing everything is wrong-but-visible, where leaving a narrow
             * window would be wrong-and-invisible.
             */
            const from = statementPeriod?.from;
            const to = statementPeriod?.to;
            setPeriod(
                from && to
                    ? { operator: "Between", value: [from.split(/[ T]/)[0], to.split(/[ T]/)[0]] }
                    : null
            );
            await refreshAll();
        },
        [refreshAll, setPeriod]
    );

    return (
        <div className="flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">Bulk Import Outflow</h2>
                {/* ⚠️ THE "showing X only" CHIP IS GONE (2026-08-12). It existed when a deep link was
                    a MODE you could not leave, so the screen had to announce that it was in one. The
                    Import selector now states the same fact in a control you can act on, and a chip
                    repeating it would be a second, un-clickable copy of the answer. */}
                <div className="ml-auto flex gap-2">
                    <Button size="sm" onClick={() => setImporting(true)}>
                        <Upload className="mr-2 h-4 w-4" />
                        Import statement
                    </Button>
                </div>
            </div>

            <ImportSummaryPanel
                summary={summary}
                period={period}
                onPeriodChange={setPeriod}
                imports={importOptions}
                selectedImport={selectedImport}
                onSelectImport={handleSelectImport}
                loading={summaryLoading}
                matching={matching}
                onConfirmAllMatched={() => setConfirmingAll(true)}
                onRunMatch={handleMatch}
                onShowSkipped={() => setShowingSkipped(true)}
            />

            {/* ⚠️ THE SCOPE OF THE TABLE, SAID OUT LOUD -- AND IT SAYS SOMETHING DIFFERENT SINCE P1.
                It used to warn that the panel and the table described DIFFERENT populations (the
                panel's button read 688 while the tab read 893, and both were right). They now
                describe the SAME one, so the line's job changed from reconciling two numbers to
                naming the window both of them are counting. */}
            <p className={`text-xs text-muted-foreground ${showingApproved ? "hidden" : ""}`}>
                {selectedImport
                    ? "The summary above and the tabs below describe this whole import — the period does not apply."
                    : "The summary above and the tabs below describe the same period."}
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

            {/* ⚠️ BOTH TAKE THE PERIOD'S FILTERS, NOT A BATCH (slice P1). The confirm dialog acts on
                the rows the panel's button counted, and the Skipped dialog holds the rows the
                Skipped chip counted -- so both have to select the population those numbers came
                from. Scoping either to one import while the chip above it counted a period is the
                "button 688, table 893" defect in a new place. */}
            <ConfirmAllMatchedDialog
                filters={filterArgs}
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

            <DecisionDialog
                row={openRow}
                decision={openRow ? decisions.get(openRow.name) : undefined}
                onChange={(decision) => openRow && setDecision(openRow.name, decision)}
                onConfirm={handleConfirmOne}
                onPartialSettle={handlePartialSettle}
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
