// src/pages/outflow-import/OutflowMasterPage.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Columns3, History, Search, Upload, Wallet, X } from "lucide-react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { exportToCsv } from "@/utils/exportToCsv";
import type {
    OutflowImportOption,
    OutflowImportRow,
    OutflowImportSummary,
} from "@/types/NirmaanStack/OutflowImportBatch";
import { OPEN_ROW_STATUSES } from "./outflowImportStatus";
import { ConfirmAllMatchedDialog } from "./components/ConfirmAllMatchedDialog";
import { DecisionDialog } from "./components/DecisionDialog";
import { ExportButton } from "./components/ExportButton";
import { exportFileBase, toExportColumns } from "./outflowExport";
import { ImportHistoryDialog } from "./components/ImportHistoryDialog";
import { ImportStatementDialog } from "./components/ImportStatementDialog";
import { ImportSummaryPanel } from "./components/ImportSummaryPanel";
import { useOutflowRows } from "./useOutflowRows";
import { useOutflowPeriod } from "./useOutflowPeriodStore";
import { useOutflowSource } from "./useOutflowSourceStore";
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
    const location = useLocation();

    /**
     * @param carryTab a tab to survive the navigation. See the note on the seed below: the two
     *   paths are separate route entries, so selecting an import REMOUNTS this page and `tab` —
     *   ordinary page state — goes back to its default. Only the post-import pin passes this;
     *   every other caller wants the reset, because a different import is a different set of rows.
     */
    const handleSelectImport = useCallback(
        (batch?: string, carryTab?: OutflowTab) => {
            // ⚠️ THE PERIOD PARAMS ARE DROPPED ON THE WAY IN AND RESTORED ON THE WAY OUT BY THE
            // STORE, not carried here. A period in the URL of an import-scoped screen would be a
            // filter that is written down but not applied — the same contradiction the disabled
            // control exists to avoid, in the address bar.
            navigate(
                batch ? `/bulk-import-outflow/${encodeURIComponent(batch)}` : "/bulk-import-outflow",
                carryTab ? { state: { outflowTab: carryTab } } : undefined
            );
        },
        [navigate]
    );

    /**
     * Which of the three tabs is open.
     *
     * ⚠️ IT SEEDS FROM THE HISTORY ENTRY'S STATE, and that is the ONE thing carrying a tab across a
     * remount. Selecting an import navigates between two separate route entries, which unmounts and
     * rebuilds this component — correct in general (different rows, so a stale selection and
     * un-confirmed decisions should go), but it would also throw away the `matched` tab a Cashbook
     * import deliberately moves to, at the exact moment the pin sends the reader to that statement.
     * The period does not need this because it lives in a module-level store; a tab is nobody
     * else's business, so it travels with the one navigation that has a reason to keep it.
     *
     * An unrecognised value falls back to the default rather than being trusted — the state comes
     * off a history entry a bookmark or a back button can carry.
     */
    const [tab, setTab] = useState<OutflowTab>(() => {
        const carried = (location.state as { outflowTab?: unknown } | null)?.outflowTab;
        return OUTFLOW_TABS.some((t) => t.id === carried) ? (carried as OutflowTab) : DEFAULT_TAB;
    });
    // Read by the import handler, which runs while `tab`'s own setter is still queued.
    const tabRef = useRef(tab);
    tabRef.current = tab;
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
    const [showingHistory, setShowingHistory] = useState(false);
    const [confirmingAll, setConfirmingAll] = useState(false);
    const [showingSkipped, setShowingSkipped] = useState(false);
    /**
     * The server's refusal for an export, rendered in its own `AlertDialog`.
     *
     * ⚠️ INLINE, NEVER A TOAST — this screen's standing convention (`confirmError` in the decision
     * dialog, the named failure list after a bulk confirm). The export refusal in particular is a
     * SENTENCE WITH TWO NUMBERS AND AN INSTRUCTION in it, and a toast that has faded is a refusal
     * nobody can act on.
     */
    const [exportError, setExportError] = useState<string | null>(null);
    /**
     * The statement a just-finished import staged, waiting for its dialog to close.
     *
     * ⚠️ A REF, NOT STATE, AND THAT IS LOAD-BEARING. Cashbook calls `onImported` and `onOpenChange`
     * in the SAME tick, so a state update written by the first would still be queued when the
     * second reads it, and the pin would silently never happen. It also carries the TAB, because
     * `setTab` is queued for exactly the same reason.
     */
    const pendingPinRef = useRef<{ batch: string; tab: OutflowTab } | null>(null);

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
    // The screen's source scope (slice CF/S2). The panel edits it; `useOutflowRows` applies it as
    // the `source` funnel's value, so the two controls cannot hold different answers.
    const { sources, setSources } = useOutflowSource();

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
    const {
        data: importsData,
        isLoading: importsLoading,
        mutate: mutateImports,
    } = useFrappeGetCall<{
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
     * The whole current view, unpaged, for a spreadsheet.
     *
     * ⚠️ IT IS AN IMPERATIVE CALL, NOT A `useFrappeGetCall`. An SWR read would fetch up to twenty
     * thousand rows on mount and again on every filter change, for a file nobody has asked for yet,
     * and would then hold the result in cache. This runs once, on a click.
     */
    const { call: callExport } = useFrappePostCall<{
        message: { rows: OutflowImportRow[]; total: number };
    }>("nirmaan_stack.api.outflow_import.review.export_outflow_rows");


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

    /**
     * Take the view with you.
     *
     * ⚠️ IT SENDS THE TABLE'S OWN QUERY — `exportQuery`, which is the query the table just sent with
     * only the paging stripped off. The filters, the scope (the open tab) and the sort all ride
     * along, so the file holds exactly the transfers on screen, in the same order. Nothing here
     * re-derives any of them; see the hook for why `filterQuery` could not be widened to do it.
     *
     * ⚠️ `facets` IS SERIALISED HERE FOR THE SAME REASON `filterArgs` SERIALISES IT — one nested
     * value, and a silently-dropped facet would produce a file WIDER than the table that asked for
     * it, with nothing in either saying so.
     *
     * ⚠️ IT PASSES THE FULL `OUTFLOW_COLUMNS`, NEVER THE VISIBLE SUBSET. A CSV is an archive, not a
     * screenshot: the hidden columns are rare lookups, and a rare lookup is exactly what somebody
     * opens a downloaded statement to do. `toExportColumns` takes no `hidden` argument precisely so
     * no call site can reintroduce the question.
     */
    const handleExport = useCallback(async () => {
        setExportError(null);
        try {
            const response = await callExport({
                ...table.exportQuery,
                facets: JSON.stringify(table.exportQuery.facets ?? {}),
            });
            const exported = response?.message?.rows ?? [];
            exportToCsv(
                exportFileBase(table.exportQuery.scope),
                exported,
                // The cast the adapter's docstring describes: `OutflowExportColumn` is the shape
                // `exportToCsv` actually reads, and TanStack's `ColumnDef` cannot express it
                // without augmenting `ColumnMeta` app-wide.
                toExportColumns(OUTFLOW_COLUMNS) as any
            );
        } catch (err) {
            // ⚠️ THE SERVER'S OWN SENTENCE, RENDERED VERBATIM. Over the cap it already names both
            // numbers and the levers that narrow; rewriting it here would give the screen a second
            // opinion about a limit only the server knows, free to go stale the day it moves.
            setExportError(describeFrappeError(err, "The export failed."));
        }
    }, [callExport, table.exportQuery]);

    const handleImported = useCallback(
        async (
            batch: string,
            _statementPeriod?: { from?: string | null; to?: string | null },
            source?: string
        ) => {
            /**
             * ⚠️ THE PERIOD NO LONGER MOVES ON AN UPLOAD (owner reversal, 2026-08-20). Until now
             * this handler called `setPeriod` with the statement's own declared window, and the
             * reasoning was sound as far as it went: statements are routinely uploaded weeks after
             * the transfers moved, so a fresh import can land entirely outside the default
             * `last 30 days` and the screen would refresh to a summary that does not mention it and
             * a table that does not list it — which reads as a failed upload. The owner took the
             * other side of the cost: an upload is not a reason to rewrite the window somebody
             * deliberately set up before uploading, and it is a filter they never touched moving
             * under them.
             *
             * ⚠️ THE DEFECT IT PREVENTED IS ANSWERED BY PINNING INSTEAD, NOT BY DOING NOTHING.
             * Selecting an import IGNORES the period entirely (owner ruling — `useOutflowRows`
             * withholds it whenever a batch is pinned), so the pin puts the WHOLE statement in view
             * while the period's value survives untouched in its store, ready for the moment the
             * reader goes back to "All imports". Doing nothing at all would leave someone who just
             * imported a thousand transfers looking at a screen that mentions none of them, which
             * is the very "reads as a failed upload" defect the period move existed to prevent.
             *
             * ⚠️ THE PIN IS DEFERRED TO THE DIALOG'S CLOSE, and it must be. Pinning navigates to
             * `/bulk-import-outflow/<id>`, which REMOUNTS this page; Cashfree keeps its dialog open
             * through step 4 (CF/S7), so pinning here would unmount the wizard in the middle of the
             * confirm step. Cashbook closes immediately after importing. One open→closed transition
             * serves both, so there is one rule rather than a per-source special case.
             *
             * ⚠️ DO NOT "RESTORE" THE `setPeriod` CALL. Its absence is the ruling, and with the pin
             * in place a period move would ALSO be inert on the very screen it was written for — a
             * pinned import ignores the period.
             */

            /**
             * ⚠️ THE SOURCE SCOPE IS CLEARED FOR THE PERIOD'S EXACT REASON (slice CF/S2, found in
             * the CF/S7 browser walk). A reviewer narrowed to Cashbook who then imports a Cashfree
             * statement would land on a screen that does not list it and a summary that does not
             * count it — the same "reads as a failed upload" defect the period rule above exists to
             * prevent, arriving through the other control.
             *
             * ⚠️ CLEARED, NOT SET TO THE IMPORTED SOURCE. Clearing can only ever WIDEN what is in
             * view, so it cannot hide anything; setting it would silently narrow the screen for
             * somebody who was deliberately looking at everything.
             */
            setSources([]);

            /**
             * ⚠️ A CASHBOOK IMPORT LANDS ON THE TAB THAT HOLDS IT (owner ruling Q22).
             *
             * Every Cashbook row ends `Settled` — it created a record rather than finding one — and
             * the default tab is Not-Matched, which is the WORKLIST. So the screen would refresh,
             * immediately after creating a hundred expenses, to an empty table. That reads as an
             * import that did nothing, which is the exact opposite of what happened.
             *
             * Cashfree keeps the default: its rows arrive needing a person, so the worklist IS
             * where they belong and moving somebody away from it would hide their work.
             *
             * ⚠️ IT HAS TO TRAVEL WITH THE PIN, and setting it here alone would no longer be
             * enough. The pin navigates between two route entries, so this page remounts and `tab`
             * — page state — is rebuilt at its default; the Cashbook reader would land on the
             * pinned statement's empty worklist, which is exactly the outcome this ruling exists to
             * prevent. Setting it here STILL matters for the case where the pin navigates nowhere
             * (re-importing while already pinned to that same statement, where nothing remounts).
             */
            const nextTab: OutflowTab = source === "Cashbook" ? "matched" : tabRef.current;
            setTab(nextTab);

            // Remembered, not acted on — the pin fires when the dialog closes. See the ref's own
            // note for why both halves are held here rather than read back at that moment.
            pendingPinRef.current = { batch, tab: nextTab };

            await refreshAll();
        },
        [refreshAll, setSources, setTab]
    );

    /**
     * The import dialog's dismiss, and the one place the post-import pin fires.
     *
     * ⚠️ ON THE open→closed TRANSITION, NEVER AT IMPORT TIME. See `handleImported`: Cashfree's
     * wizard stays open through its confirm step and pinning navigates, which would unmount it
     * mid-flow. Every close route in that dialog — its footer buttons, its own `Dialog`'s dismiss,
     * the Cashbook path that closes itself the moment the rows are created — goes through this one
     * callback, so there is nothing to keep in step.
     *
     * A close with nothing pending (the dialog was opened and abandoned) navigates nowhere.
     */
    const handleImportDialogOpenChange = useCallback(
        (open: boolean) => {
            setImporting(open);
            if (open) return;
            const pending = pendingPinRef.current;
            pendingPinRef.current = null;
            if (pending) handleSelectImport(pending.batch, pending.tab);
        },
        [handleSelectImport]
    );

    return (
        <div className="flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">Bulk Import Outflow</h2>
                {/* ⚠️ THE "showing X only" CHIP IS GONE (2026-08-12). It existed when a deep link was
                    a MODE you could not leave, so the screen had to announce that it was in one. The
                    Import selector now states the same fact in a control you can act on, and a chip
                    repeating it would be a second, un-clickable copy of the answer. */}
                <div className="ml-auto flex items-center gap-2">
                    {/* ⚠️ AN ICON, BESIDE THE ACTION IT IS THE HISTORY OF (owner ruling, slice
                        CF/S4). It replaced the filename list at the foot of the summary card. It is
                        icon-only because it opens a read-only list and sits next to the primary
                        action — two labelled buttons here would read as two things to do. */}
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowingHistory(true)}
                        title="Import history"
                        aria-label="Import history"
                    >
                        <History className="h-4 w-4" />
                    </Button>
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
                sources={sources}
                onSourcesChange={setSources}
                imports={importOptions}
                selectedImport={selectedImport}
                onSelectImport={handleSelectImport}
                loading={summaryLoading}
                matching={matching}
                onConfirmAllMatched={() => setConfirmingAll(true)}
                onRunMatch={handleMatch}
                onShowSkipped={() => setShowingSkipped(true)}
            />

            {/* ⚠️ THE "same period" LINE IS GONE (owner ruling, slice CF/S1), AND WHAT IT WAS
                GUARDING IS WORTH RECORDING SO IT IS NOT RE-ADDED AS AN OBVIOUS GAP. It began as a
                warning that the panel and the table described DIFFERENT populations -- the panel's
                button read 688 while the tab read 893, and both numbers were right. P1 made them
                one population, which left the sentence merely naming a window that the Period
                control above states in a form you can act on. A caption repeating a control is a
                second, un-clickable copy of the answer.

                Its pinned variant went with it for the same reason: the Period control already
                reads "Not applied · whole statement" while an import is selected, which is the same
                fact in the place a reader looks for it. */}

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

                {/* ⚠️ EXPORT SITS WITH THE COUNT, NOT WITH Columns AND Clear filters, AND THAT IS
                    THE REASON FOR THE `ml-auto` GROUP. Everything to the left CHANGES the view —
                    which columns you see, which filters apply. Export does not change it; it TAKES
                    it with you. The count states what you are currently looking at and Export says
                    "give me that", so the two are one thought and read as one. Grouped with the
                    view-changing controls it would read as a third way to alter the table, which is
                    the one thing it never does. */}
                <div className="ml-auto flex items-center gap-2">
                    <ExportButton total={table.total} onExport={handleExport} />
                    <span className="text-xs text-muted-foreground">
                        {table.total.toLocaleString()}{" "}
                        {table.total === 1 ? "transfer" : "transfers"}
                    </span>
                </div>
            </div>

            {/* ⚠️ THE SERVER'S REFUSAL, RENDERED WORD FOR WORD. Over the cap it already names how
                many rows the view holds, what the limit is, and which controls narrow it — so this
                dialog carries the message and adds nothing. A client-side rewrite would be a second
                statement of a limit only the server enforces, and the two would drift the day it
                moves. One `Close`: there is nothing to confirm, only something to read. */}
            <AlertDialog
                open={exportError !== null}
                onOpenChange={(open) => !open && setExportError(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        {/* ⚠️ THE TITLE IS DELIBERATELY NOT "Too many transfers to export". The cap
                            is the usual refusal but not the only one that lands here — a dropped
                            connection or a permission failure comes through the same catch — and a
                            heading naming a limit above a message about something else is a
                            confident wrong answer. The body always names the real reason, including
                            both numbers when it is the cap. */}
                        <AlertDialogTitle>Could not export</AlertDialogTitle>
                        <AlertDialogDescription>{exportError}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction onClick={() => setExportError(null)}>
                            Close
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

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

            {/* ⚠️ `onRefresh` IS NOT `onImported` (slice CF/S7). The dialog now stays open through
                the confirm step, so it needs a way to re-read this screen after each settle without
                also moving the period and the tab — `handleImported` does both, correctly, but only
                once, when the statement arrives. */}
            <ImportStatementDialog
                open={importing}
                onOpenChange={handleImportDialogOpenChange}
                onImported={handleImported}
                onRefresh={refreshAll}
            />

            {/* ⚠️ IT TAKES `importOptions`, THE SAME LIST THE IMPORT SELECTOR RENDERS, so the two
                cannot disagree about which statements exist or in what order. Every row here is a
                way to select one, and offering a statement the picker does not have would be a dead
                end. It obeys the source scope and ignores the period -- see the dialog's own note on
                why that asymmetry is deliberate. */}
            <ImportHistoryDialog
                open={showingHistory}
                onOpenChange={setShowingHistory}
                imports={importOptions}
                sources={sources}
                selectedImport={selectedImport}
                onSelectImport={handleSelectImport}
                loading={importsLoading}
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
