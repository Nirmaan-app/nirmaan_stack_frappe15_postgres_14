// src/pages/outflow-import/components/ConfirmAllMatchedDialog.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    CornerDownRight,
    Loader2,
    Search,
    X,
    XCircle,
} from "lucide-react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    EMPTY_CONFIRM_FILTERS,
    buildConfirmTree,
    confirmFilterCount,
    confirmFunnel,
    confirmSelectionSummary,
    describeFrappeError,
    filterConfirmRows,
    ledgerLabel,
    nodeSelectionState,
    ARBITRARY_SUGGESTION_RULES,
    matchBasisLabel,
    orderLabel,
    suggestionRuleLabel,
    toggleNode,
    type ConfirmFilters,
    type ConfirmVendorNode,
    type ConfirmableRow,
    type ConfirmOutcome,
    type NodeSelection,
} from "../outflowTableModel";

interface Props {
    batch?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSettled: () => Promise<void> | void;
}

interface Payload {
    batch: string;
    ready: ConfirmableRow[];
    /** Matched SEVERAL approved records, so the matcher deliberately picked none. */
    needs_you: ConfirmableRow[];
    /**
     * Had a pick, whose record has since been deleted.
     *
     * ⚠️ SEPARATE FROM `needs_you` BECAUSE THE SUMMARY PANEL COUNTS THESE AND THIS LIST CANNOT ACT
     * ON THEM. `confirmable_rows` -- the number on the panel's button -- counts matched rows
     * carrying a suggestion without checking the suggestion resolves; this endpoint checks. Folded
     * together, the gap between the button and the list was unexplainable from the screen.
     */
    stale: ConfirmableRow[];
    /** Every `Matched` row in this import: `ready + stale + needs_you`. */
    matched_rows: number;
    ready_value: number;
}

/**
 * Confirm every transfer the matcher was SURE about, for one import (slice X5).
 *
 * ⚠️ IT SAYS "CONFIRM", NEVER "APPROVE" (owner ruling 2026-08-09). This feature never approves
 * anything -- it records that already-approved money left the bank. A dialog headed "Approve"
 * would tell an accountant they are approving payments, which is false, and this is the one screen
 * where that misunderstanding would be acted on forty times in a row.
 *
 * ⚠️ ONE CALL PER ROW, DELIBERATELY -- NOT ONE BULK ENDPOINT. Each settle is its own savepoint and
 * its own commit, so a failure on the third leaves the first two written and the rest still
 * attempted. `settle_row`'s own docstring forbids the all-or-nothing shape in as many words: one
 * unsettleable row must never discard the good decisions around it. That reasoning gets STRONGER at
 * forty rows, not weaker, which is why the loop lives here rather than on the server where the easy
 * version of it would be a single transaction.
 *
 * ⚠️ FAILURES ARE NORMAL HERE. Payments get ticked Paid by hand all day, so some rows will be gone
 * by the time this runs. The per-row lock makes a stale confirm FAIL rather than write the wrong
 * thing -- so the results panel reports them plainly instead of treating them as an error state.
 */
export const ConfirmAllMatchedDialog = ({ batch, open, onOpenChange, onSettled }: Props) => {
    /**
     * ⚠️ A POSITIVE SELECTION, NOT A SKIP LIST, AND THE SWAP WAS FORCED BY THE ROLLUP. A skip set
     * answers "which of the visible rows did somebody untick", which is fine for a flat list where
     * everything is visible. Under a tree with search and facets the question a parent checkbox has
     * to answer is "how many of MY leaves are in", and a set of exclusions cannot answer it without
     * knowing the full population at every node. It also survives filtering by construction, which
     * is what `ConfirmSummary.hidden` exists to report.
     */
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [filters, setFilters] = useState<ConfirmFilters>(EMPTY_CONFIRM_FILTERS);
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(0);
    const [outcomes, setOutcomes] = useState<ConfirmOutcome[] | null>(null);

    /**
     * ⚠️ THE FETCH IS SUSPENDED ONCE THERE ARE RESULTS, AND THAT IS THE FIX, NOT A TUNING.
     *
     * On the first real 1,043-row run the results panel never appeared: the dialog finished 858
     * settles and then quietly showed the LIST again, refreshed, so 124 failures were collected and
     * thrown away without ever being read. Once the run is over, the confirmable list is not just
     * stale, it is IRRELEVANT -- the dialog is reporting what happened, and nothing arriving from
     * the server can improve that. Passing a null SWR key while `outcomes` is set means no
     * revalidation, no `data` change, no re-render that can reach the results view at all.
     *
     * Whatever exactly swapped the view (a focus revalidation is the best candidate; the run had
     * been idle for minutes), it can no longer happen, because the dependency is gone rather than
     * ordered more carefully.
     */
    const showResults = outcomes !== null;

    const { data, isLoading } = useFrappeGetCall<{ message: Payload }>(
        "nirmaan_stack.api.outflow_import.review.get_confirmable_rows",
        { batch },
        open && batch && !showResults ? `outflow-confirmable-${batch}` : null
    );

    const { call: callSettle } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.expenses.settle_row"
    );

    const ready = useMemo(() => data?.message?.ready ?? [], [data]);
    const needsYou = useMemo(() => data?.message?.needs_you ?? [], [data]);
    const stale = useMemo(() => data?.message?.stale ?? [], [data]);
    const funnel = useMemo(() => confirmFunnel(data?.message), [data]);

    // A dialog is reused; without this the second run opens showing the first one's results.
    useEffect(() => {
        if (open) return;
        setSelected(new Set());
        setFilters(EMPTY_CONFIRM_FILTERS);
        setExpanded(new Set());
        setOutcomes(null);
        setDone(0);
        setRunning(false);
    }, [open]);

    /**
     * Everything ready arrives TICKED (owner decision 2026-08-10).
     *
     * ⚠️ INCLUDING THE ROWS A RULE PICKED. Option B pre-selects a record on rows the matcher left
     * ambiguous, and treating those as suspect by default would make the rules pointless -- the
     * "Picked by" filter is the review path for them, not an unticked checkbox. M3 is provably
     * harmless, M1 acts on evidence, and M2 is fenced to a single project.
     *
     * ⚠️ SEEDED ONCE PER PAYLOAD, KEYED ON THE ROW NAMES. A refetch that returns the same rows must
     * not wipe a half-made selection; one that returns DIFFERENT rows is a different question and
     * starts again. Keying on the identity of the list rather than on the fetch is what separates
     * those two cases.
     */
    const readyKey = useMemo(() => ready.map((r) => r.name).join("|"), [ready]);
    useEffect(() => {
        if (!open || !readyKey) return;
        setSelected(new Set(readyKey.split("|")));
    }, [open, readyKey]);

    const visible = useMemo(() => filterConfirmRows(ready, filters), [ready, filters]);
    const tree = useMemo(() => buildConfirmTree(visible), [visible]);
    const summary = useMemo(
        () => confirmSelectionSummary(ready, visible, selected),
        [ready, visible, selected]
    );
    const filterCount = confirmFilterCount(filters);

    // The order the loop settles in: the SELECTION, not the visible tree. A filter narrows what is
    // on screen; it never silently narrows what the button was going to write.
    const chosen = useMemo(() => ready.filter((r) => selected.has(r.name)), [ready, selected]);

    const toggleRows = useCallback((rows: ConfirmableRow[]) => {
        setSelected((prev) => toggleNode(rows, prev));
    }, []);

    const toggleExpanded = useCallback((key: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    }, []);

    const run = useCallback(async () => {
        if (!chosen.length) return;
        setRunning(true);
        setDone(0);
        const results: ConfirmOutcome[] = [];
        for (const row of chosen) {
            try {
                await callSettle({
                    row: row.name,
                    target_doctype: row.target_doctype,
                    target_name: row.target_name,
                });
                results.push({ row, ok: true });
            } catch (err: any) {
                // ⚠️ NOT `err.message` -- see `describeFrappeError`. Frappe answers a `frappe.throw`
                // with the literal "There was an error.", so every refusal in this dialog used to
                // render identically and none of them could be acted on.
                results.push({
                    row,
                    ok: false,
                    error: describeFrappeError(
                        err,
                        `Could not settle ${row.target_name ?? "this record"}.`
                    ),
                });
            }
            setDone((n) => n + 1);
        }
        setOutcomes(results);
        setRunning(false);
        await onSettled();
    }, [chosen, callSettle, onSettled]);

    const settled = outcomes?.filter((o) => o.ok).length ?? 0;
    const failed = outcomes?.filter((o) => !o.ok) ?? [];

    return (
        <Dialog open={open} onOpenChange={(next) => (running ? null : onOpenChange(next))}>
            <DialogContent className="max-w-5xl">
                <DialogHeader>
                    <DialogTitle>
                        {/* ⚠️ NO NUMBER IN THE TITLE. It used to carry `chosen.length`, which
                            moves with the selection -- so the heading read "Confirm 831 matched"
                            directly above a line reading "833 ready to confirm", two live numbers a
                            few pixels apart measuring different things. That is the exact shape of
                            confusion this dialog was rebuilt to remove. The count belongs to the
                            button, which is the thing that acts, and to the summary bar. */}
                        {outcomes ? "Confirmation results" : "Confirm matched transfers"}
                    </DialogTitle>
                    <DialogDescription>
                        {outcomes
                            ? "Each row was settled on its own. A failure left the others untouched."
                            : "Each transfer is recorded against the approved record the matcher picked. Nothing here approves anything."}
                    </DialogDescription>
                </DialogHeader>

                {/* ⚠️ RESULTS TAKE ABSOLUTE PRECEDENCE, and are NOT gated on `!isLoading`. A
                    loading flag from a fetch that no longer runs must never be able to hide the
                    report of 858 writes -- the previous ordering made the two mutually
                    exclusive, which is how the failures went unseen. */}
                {!showResults && isLoading && (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                    </div>
                )}

                {showResults && outcomes && (
                    <div className="max-h-[50vh] space-y-2 overflow-y-auto">
                        <p className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            <span className="font-medium">{settled} settled</span>
                            {failed.length > 0 && (
                                <span className="text-muted-foreground">
                                    · {failed.length} could not be
                                </span>
                            )}
                        </p>
                        {failed.map((outcome) => (
                            <div
                                key={outcome.row.name}
                                className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm"
                            >
                                {/* Enough to FIND the row again without reading the table: who was
                                    paid, what it settles, and how much. A reason with no subject
                                    sends the reader hunting. */}
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                                    <span className="font-medium">
                                        {outcome.row.beneficiary_name}
                                    </span>
                                    <span className="tabular-nums text-xs text-muted-foreground">
                                        {formatToRoundedIndianRupee(outcome.row.amount)}
                                    </span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {outcome.row.target_name}
                                    </span>
                                    {outcome.row.bank_reference_no && (
                                        <span className="font-mono text-xs text-muted-foreground">
                                            UTR {outcome.row.bank_reference_no}
                                        </span>
                                    )}
                                </div>
                                <p className="pl-5 text-xs text-destructive">{outcome.error}</p>
                            </div>
                        ))}
                        {failed.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                Each line above is the reason the server gave. The commonest is a row
                                somebody settled by hand since the match ran — re-run the match to see
                                where those stand now.
                            </p>
                        )}
                    </div>
                )}

                {!showResults && !isLoading && (
                    <div className="max-h-[50vh] space-y-4 overflow-y-auto">
                        {/* ⚠️ THE FUNNEL, STATED. The summary panel's button counts every matched
                            row carrying a suggestion; this dialog can only act on the ones whose
                            record still resolves. Those two numbers are allowed to differ -- they
                            measure different things -- but they were differing SILENTLY, so the
                            button promised more than the list showed and nothing on either screen
                            said why. This line is the account.

                            It renders only when the numbers actually diverge: on a clean import
                            every matched row is ready, and restating that would be noise. */}
                        {funnel.ready !== funnel.matched && (
                            <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">
                                    {funnel.matched} matched
                                </span>{" "}
                                in this import ·{" "}
                                <span className="font-medium text-foreground">
                                    {funnel.ready} ready to confirm
                                </span>
                                {funnel.needsYou > 0 && (
                                    <> · {funnel.needsYou} matched more than one record</>
                                )}
                                {funnel.stale > 0 && (
                                    <> · {funnel.stale} point at a record that no longer exists</>
                                )}
                            </p>
                        )}

                        {ready.length === 0 && (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                                Nothing is ready to confirm in this import.
                            </p>
                        )}

                        {/* ⚠️ SEARCH AND FACETS NARROW WHAT IS SHOWN, NEVER WHAT IS SELECTED. A
                            filter that also deselected would make "Confirm 142" mean something
                            different depending on what was typed in a box above it. The footer
                            reports anything selected but off screen instead. */}
                        {ready.length > 0 && (
                            <div className="flex w-full flex-wrap items-center gap-2">
                                <div className="relative min-w-[180px] flex-1">
                                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        className="h-8 pl-8"
                                        placeholder="Vendor, project, order, reference…"
                                        value={filters.search}
                                        disabled={running}
                                        onChange={(e) =>
                                            setFilters((f) => ({ ...f, search: e.target.value }))
                                        }
                                    />
                                </div>
                                <Select
                                    value={filters.ledger || "any"}
                                    disabled={running}
                                    onValueChange={(v) =>
                                        setFilters((f) => ({ ...f, ledger: v === "any" ? "" : v }))
                                    }
                                >
                                    <SelectTrigger className="h-8 w-[150px]">
                                        <SelectValue placeholder="Ledger" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="any">Any ledger</SelectItem>
                                        <SelectItem value="Project Payments">Payments</SelectItem>
                                        <SelectItem value="Project Expenses">
                                            Project expenses
                                        </SelectItem>
                                        <SelectItem value="Non Project Expenses">
                                            Non-project expenses
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                {/* The review path for the rows Option B pre-selected. They arrive
                                    ticked like every other ready row; this is how you isolate them. */}
                                <Select
                                    value={filters.pickedBy || "any"}
                                    disabled={running}
                                    onValueChange={(v) =>
                                        setFilters((f) => ({ ...f, pickedBy: v === "any" ? "" : v }))
                                    }
                                >
                                    <SelectTrigger className="h-8 w-[176px]">
                                        <SelectValue placeholder="Picked by" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="any">Picked by anything</SelectItem>
                                        {/* ⚠️ THE ONE A REVIEWER SHOULD ACTUALLY OPEN. Both members
                                            chose between records nothing distinguishes; the other
                                            rules acted on evidence. Before T1 the arbitrary ones
                                            hid under "Only candidate". */}
                                        <SelectItem value="arbitrary">
                                            Chosen arbitrarily
                                        </SelectItem>
                                        <SelectItem value="sole">Only candidate</SelectItem>
                                        <SelectItem value="stack-pairing">
                                            Identical set, paired arbitrarily
                                        </SelectItem>
                                        <SelectItem value="rule">Any rule</SelectItem>
                                        <SelectItem value="project-in-remark">
                                            Remark named the project
                                        </SelectItem>
                                        <SelectItem value="nearest-amount">Nearest amount</SelectItem>
                                        <SelectItem value="interchangeable">
                                            Interchangeable records
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Checkbox
                                        checked={filters.changesOnly}
                                        disabled={running}
                                        onCheckedChange={(v) =>
                                            setFilters((f) => ({ ...f, changesOnly: Boolean(v) }))
                                        }
                                    />
                                    Changes only
                                </label>
                                {filterCount > 0 && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8"
                                        disabled={running}
                                        onClick={() => setFilters(EMPTY_CONFIRM_FILTERS)}
                                    >
                                        <X className="mr-1 h-3.5 w-3.5" />
                                        Clear {filterCount}
                                    </Button>
                                )}
                            </div>
                        )}

                        {ready.length > 0 && visible.length === 0 && (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                                No transfers match these filters.
                            </p>
                        )}

                        {tree.length > 0 && (
                            <div className="rounded-md border">
                                {tree.map((vendor) => (
                                    <VendorBranch
                                        key={vendor.key}
                                        node={vendor}
                                        selected={selected}
                                        expanded={expanded}
                                        running={running}
                                        onToggleRows={toggleRows}
                                        onToggleExpanded={toggleExpanded}
                                    />
                                ))}
                            </div>
                        )}

                        {summary.amountsChanging > 0 && (
                            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                    {summary.amountsChanging}{" "}
                                    {summary.amountsChanging === 1 ? "record" : "records"} will be
                                    updated to the amount that actually left the bank. The change is
                                    recorded against your name.
                                </span>
                            </p>
                        )}

                        {/* ⚠️ LISTED, NEVER CONFIRMABLE. These matched SEVERAL approved records, so
                            the matcher deliberately picked none -- there is nothing to confirm them
                            against, and a checkbox here would be a promise this dialog cannot keep. */}
                        {needsYou.length > 0 && (
                            <div className="rounded-md border bg-muted/30 p-3">
                                <p className="text-sm font-medium">
                                    {needsYou.length} matched more than one record
                                </p>
                                <p className="mb-2 text-xs text-muted-foreground">
                                    Nothing was pre-selected for these, so they are not part of this
                                    action. Open each one from the table to choose.
                                </p>
                                <ul className="space-y-0.5 text-xs text-muted-foreground">
                                    {needsYou.slice(0, 8).map((row) => (
                                        <li key={row.name} className="truncate">
                                            {row.beneficiary_name} ·{" "}
                                            {formatToRoundedIndianRupee(row.amount)}
                                        </li>
                                    ))}
                                    {needsYou.length > 8 && (
                                        <li>and {needsYou.length - 8} more</li>
                                    )}
                                </ul>
                            </div>
                        )}

                        {/* ⚠️ THE ROWS THE BUTTON COUNTED AND THIS LIST CANNOT ACT ON. The match run
                            picked a record for each of these and that record has since been
                            deleted, so they are inside the summary panel's `confirmable_rows` and
                            outside `ready`. They used to be folded in with "matched more than one
                            record", which is a different problem with a different fix -- and which
                            made the two screens' numbers impossible to reconcile from the screen. */}
                        {stale.length > 0 && (
                            <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3">
                                <p className="text-sm font-medium text-amber-900">
                                    {stale.length} point at a record that no longer exists
                                </p>
                                <p className="mb-2 text-xs text-amber-800">
                                    The match run picked a record for each of these and it has since
                                    been deleted. Re-run the match to look again, or open each one
                                    from the table.
                                </p>
                                <ul className="space-y-0.5 text-xs text-amber-800">
                                    {stale.slice(0, 8).map((row) => (
                                        <li key={row.name} className="truncate">
                                            {row.beneficiary_name} ·{" "}
                                            {formatToRoundedIndianRupee(row.amount)}
                                        </li>
                                    ))}
                                    {stale.length > 8 && <li>and {stale.length - 8} more</li>}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="sm:flex-col sm:items-stretch sm:gap-3">
                    {/* ⚠️ THE SUMMARY BAR IS A SAFETY CONTROL, NOT A FLOURISH. It states what
                        pressing the button will WRITE, at all times -- and the figure that matters
                        most is the one that appears nowhere else on the screen: how many approved
                        amounts this rewrites. Since X1 a confirm changes the record's figure
                        whenever the bank disagrees, and at this scale that is hundreds of silent
                        corrections. `hidden` is the other half: selection survives filtering, so
                        without it somebody could narrow to one vendor, read "12 transfers", and
                        confirm 142. */}
                    {!outcomes && ready.length > 0 && (
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                            <span>
                                <span className="font-medium tabular-nums text-foreground">
                                    {summary.transfers}
                                </span>{" "}
                                {summary.transfers === 1 ? "transfer" : "transfers"} ·{" "}
                                <span className="tabular-nums">{summary.vendors}</span>{" "}
                                {summary.vendors === 1 ? "vendor" : "vendors"} ·{" "}
                                <span className="tabular-nums">{summary.projects}</span>{" "}
                                {summary.projects === 1 ? "project" : "projects"}
                                {summary.amountsChanging > 0 && (
                                    <>
                                        {" · "}
                                        <span className="font-medium text-amber-700">
                                            {summary.amountsChanging} amounts will be rewritten
                                        </span>
                                    </>
                                )}
                                {summary.hidden > 0 && (
                                    <>
                                        {" · "}
                                        <span className="text-foreground">
                                            {summary.hidden} selected not shown by these filters
                                        </span>
                                    </>
                                )}
                            </span>
                            <span className="font-medium tabular-nums text-foreground">
                                {formatToRoundedIndianRupee(summary.value)}
                            </span>
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        {outcomes ? (
                            <Button onClick={() => onOpenChange(false)}>Close</Button>
                        ) : (
                            <>
                                <Button
                                    variant="outline"
                                    disabled={running}
                                    onClick={() => onOpenChange(false)}
                                >
                                    Cancel
                                </Button>
                                <Button disabled={!chosen.length || running} onClick={run}>
                                    {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {running
                                        ? `Confirming ${done} of ${chosen.length}…`
                                        : `Confirm ${chosen.length} ${
                                              chosen.length === 1 ? "transfer" : "transfers"
                                          }`}
                                </Button>
                            </>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


/**
 * One vendor, and its projects beneath it.
 *
 * ⚠️ THE PROJECT LEVEL IS RENDERED ONLY WHEN IT HAS SOMETHING TO SAY. 147 of the 210 vendors on the
 * first real statement sit on exactly one project, and 79 have a single transfer -- so a rigid three
 * level tree would be two expands to reach one row, most of the time, past a middle level that only
 * ever repeated what the vendor row already implied. When there is one project its name reads inline
 * here (`soleProject`) and the leaves hang directly off the vendor.
 */
const VendorBranch = ({
    node,
    selected,
    expanded,
    running,
    onToggleRows,
    onToggleExpanded,
}: {
    node: ConfirmVendorNode;
    selected: ReadonlySet<string>;
    expanded: ReadonlySet<string>;
    running: boolean;
    onToggleRows: (rows: ConfirmableRow[]) => void;
    onToggleExpanded: (key: string) => void;
}) => {
    const open = expanded.has(node.key);
    const state = nodeSelectionState(node.rows, selected);
    const flat = node.soleProject !== null;

    return (
        <div className="border-b last:border-b-0">
            <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40">
                <TriCheckbox
                    state={state}
                    disabled={running}
                    label={`Confirm every transfer for ${node.vendor}`}
                    onToggle={() => onToggleRows(node.rows)}
                />
                <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    onClick={() => onToggleExpanded(node.key)}
                >
                    {open ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate text-sm font-medium">{node.vendor}</span>
                    {flat ? (
                        <span className="truncate text-xs text-muted-foreground">
                            · {node.soleProject}
                        </span>
                    ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">
                            · {node.projects.length} projects
                        </span>
                    )}
                </button>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {node.rows.length} {node.rows.length === 1 ? "transfer" : "transfers"}
                </span>
                <span className="w-28 shrink-0 text-right text-sm font-medium tabular-nums">
                    {formatToRoundedIndianRupee(node.value)}
                </span>
            </div>

            {open && flat && (
                <div className="bg-muted/10">
                    {node.rows.map((row) => (
                        <LeafRow
                            key={row.name}
                            row={row}
                            depth={1}
                            checked={selected.has(row.name)}
                            disabled={running}
                            onToggle={() => onToggleRows([row])}
                        />
                    ))}
                </div>
            )}

            {open &&
                !flat &&
                node.projects.map((project) => {
                    const pOpen = expanded.has(project.key);
                    return (
                        <div key={project.key} className="bg-muted/10">
                            <div className="flex items-center gap-2 py-1.5 pl-8 pr-2 hover:bg-muted/40">
                                <TriCheckbox
                                    state={nodeSelectionState(project.rows, selected)}
                                    disabled={running}
                                    label={`Confirm every transfer for ${node.vendor} on ${project.project}`}
                                    onToggle={() => onToggleRows(project.rows)}
                                />
                                <button
                                    type="button"
                                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                    onClick={() => onToggleExpanded(project.key)}
                                >
                                    {pOpen ? (
                                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    ) : (
                                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    )}
                                    <span className="truncate text-sm">{project.project}</span>
                                </button>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                    {project.rows.length}
                                </span>
                                <span className="w-28 shrink-0 text-right text-sm tabular-nums">
                                    {formatToRoundedIndianRupee(project.value)}
                                </span>
                            </div>
                            {pOpen &&
                                project.rows.map((row) => (
                                    <LeafRow
                                        key={row.name}
                                        row={row}
                                        depth={2}
                                        checked={selected.has(row.name)}
                                        disabled={running}
                                        onToggle={() => onToggleRows([row])}
                                    />
                                ))}
                        </div>
                    );
                })}
        </div>
    );
};

/**
 * One transfer, with the record it settles indented underneath it.
 *
 * ⚠️ THE TRANSFER LEADS AND THE RECORD FOLLOWS, rather than sitting in columns beside it. The
 * transfer is the FACT -- money left the bank -- and the record is the claim about it. Two lines say
 * that; eight columns competing for the width of a dialog do not, and the one that loses is always
 * the amount, which is the fact that decides whether the row can be settled at all. The same
 * reasoning made the Link-payment table five columns rather than six.
 */
const LeafRow = ({
    row,
    depth,
    checked,
    disabled,
    onToggle,
}: {
    row: ConfirmableRow;
    depth: number;
    checked: boolean;
    disabled: boolean;
    onToggle: () => void;
}) => {
    const order = orderLabel(row);
    const rule = suggestionRuleLabel(row.suggestion_rule);
    const basis = matchBasisLabel(row.match_basis);
    // Amber for a pick nothing distinguished, sky for one made on evidence. Same tone language the
    // rest of this screen uses: amber is "a person should look".
    const arbitrary = ARBITRARY_SUGGESTION_RULES.has((row.suggestion_rule || "").trim());

    return (
        <div
            className="flex items-start gap-2 border-t py-1.5 pr-2 hover:bg-muted/30"
            style={{ paddingLeft: depth === 1 ? 34 : 58 }}
        >
            <Checkbox
                className="mt-0.5"
                checked={checked}
                disabled={disabled}
                onCheckedChange={onToggle}
                aria-label={`Confirm ${row.beneficiary_name ?? row.name}`}
            />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="tabular-nums text-muted-foreground">
                        {row.added_on ? formatDate(row.added_on.split(/[ T]/)[0]) : "—"}
                    </span>
                    <span className="truncate font-medium">{row.beneficiary_name || "—"}</span>
                    {row.bank_reference_no && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                            {row.bank_reference_no}
                        </span>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <CornerDownRight className="h-3 w-3 shrink-0" />
                    <Badge variant="outline" className="border-0 bg-muted text-[10px]">
                        {ledgerLabel(row.target_doctype ?? "")}
                    </Badge>
                    <span className="font-mono">{row.target_name}</span>
                    {/* ⚠️ NEVER LABELLED "PO" UNLESS IT IS ONE -- a quarter of the payments on a
                        real statement are against a Service Request. */}
                    {order && (
                        <span className="font-mono">
                            {order.kind} {order.name}
                        </span>
                    )}
                    {/* Why this record was pre-selected, when it was not simply the only one. */}
                    {basis && <span className="text-[11px]">{basis}</span>}
                    {rule && rule !== "Only candidate" && (
                        <Badge
                            variant="outline"
                            className={
                                arbitrary
                                    ? "border-amber-300 bg-amber-50 text-[10px] text-amber-800"
                                    : "border-sky-200 bg-sky-50 text-[10px] text-sky-800"
                            }
                        >
                            {rule}
                        </Badge>
                    )}
                </div>
            </div>
            {/* ⚠️ BOTH SIDES TO THE PAISE. Nearly every correction this feature makes is sub-rupee,
                so the rounded formatter turns the whole warning into "₹27,504 → ₹27,504": a change
                notice showing no change, on the one screen where it is being authorised. */}
            <div className="w-40 shrink-0 text-right tabular-nums">
                {row.amount_changes ? (
                    <div className="flex items-center justify-end gap-1 text-xs">
                        <span className="text-muted-foreground line-through">
                            {formatToIndianRupee(row.target_amount)}
                        </span>
                        <ArrowRight className="h-3 w-3 text-amber-600" />
                        <span className="font-medium text-amber-700">
                            {formatToIndianRupee(row.amount)}
                        </span>
                    </div>
                ) : (
                    <span className="text-sm">{formatToRoundedIndianRupee(row.amount)}</span>
                )}
            </div>
        </div>
    );
};

/**
 * A checkbox with the third state a tree needs.
 *
 * ⚠️ THE SHARED `Checkbox` CANNOT SHOW "PARTIAL", AND ITS FAILURE MODE IS THE DANGEROUS DIRECTION.
 * `components/ui/checkbox.tsx` renders a CheckIcon for the Radix Indicator, and Radix mounts that
 * Indicator for `indeterminate` as well as for `checked` -- so a half-selected vendor renders with a
 * TICK. It reads as "all of this branch is going in" at exactly the moment when some of it is not,
 * on a screen whose button writes money.
 *
 * That file is shadcn-generated and must not be hand-edited (root CLAUDE.md), and widening it would
 * change every checkbox in the app for one screen's need. So the third state is drawn HERE: the
 * indicator's glyph is hidden while indeterminate and a dash is laid over the same box. Radix keeps
 * ownership of the state, the keyboard behaviour and `aria-checked="mixed"` -- only the mark is ours.
 */
const TriCheckbox = ({
    state,
    disabled,
    label,
    onToggle,
}: {
    state: NodeSelection;
    disabled: boolean;
    label: string;
    onToggle: () => void;
}) => (
    <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <Checkbox
            className={
                state === "some"
                    ? "bg-primary text-primary-foreground [&_svg]:opacity-0"
                    : undefined
            }
            checked={state === "all" ? true : state === "some" ? "indeterminate" : false}
            disabled={disabled}
            onCheckedChange={onToggle}
            aria-label={label}
        />
        {state === "some" && (
            <span className="pointer-events-none absolute h-[2px] w-2 rounded-sm bg-primary-foreground" />
        )}
    </span>
);
