// src/pages/outflow-import/components/DecisionDialog.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { AlertTriangle, Check, ExternalLink, Loader2, X } from "lucide-react";

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
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    amountVerdict,
    isConfirmable,
    parseRecordKey,
    recordKey,
    settlementLink,
    settleBlocker,
    type DecisionTarget,
    type RowDecision,
    type SettleBlock,
    type SettleableRecord,
} from "../outflowTableModel";
import {
    EMPTY_FILTERS,
    facetValues,
    hasActiveFilters,
    nextSortState,
    visibleRecords,
    type RecordFilters,
    type RecordSort,
    type RecordSortColumn,
} from "../recordPickerView";
import { ROW_MISMATCHED } from "../outflowImportStatus";
import { SettleableRecordTable } from "./SettleableRecordTable";

const PROJECT_EXPENSE = "Project Expenses";
const NON_PROJECT_EXPENSE = "Non Project Expenses";

/**
 * ⚠️ HIDDEN, NOT DELETED (owner, slice R2). "Create a new expense" is off this dialog for now, so
 * linking an approved record and skipping are the only two ways to resolve a row. Everything behind
 * it is intact -- the form below, `RowDecision.newExpense`, the `new` branch of `isConfirmable`, and
 * the `create_expense` endpoint -- so bringing it back is this one line. Deleting any of that is
 * what would make it expensive to reverse.
 */
const SHOW_CREATE_NEW_EXPENSE = false;

/**
 * ⚠️ HIDDEN, NOT DELETED (owner ruling 2026-08-10) -- same treatment, and for the same reason.
 * "Skip this row" is off this dialog. `review.skip_row`, its required-reason guard, the
 * `Skipped` status, the Skipped tab and the auto-skip path at upload are ALL untouched: automatic
 * skips (a failed transfer, an already-recorded duplicate) still happen and still land in that tab.
 * What is gone is the MANUAL skip button.
 *
 * ⚠️ STATE THE CONSEQUENCE RATHER THAN DISCOVER IT LATER: linking an approved record is now the
 * ONLY way a person can resolve an open row. A transfer with genuinely nothing to settle against --
 * and 145 of them exist on the first real statement -- has no terminal state available from this
 * screen, so it stays open indefinitely and keeps counting against "Still open". Closing the import
 * is the only way to set it aside, and closing is bookkeeping: it does not change a row's status.
 * Flipping this one const back is the whole reversal.
 */
const SHOW_SKIP_ROW = false;

const CREATE_NEW_TARGET: { id: DecisionTarget; label: string; hint: string } = {
    id: "new",
    label: "Create a new expense",
    hint: "nothing to link to — record it here, already Paid",
};

interface Props {
    row: OutflowImportRow | null;
    decision: RowDecision | undefined;
    onChange: (decision: RowDecision) => void;
    onConfirm: () => Promise<void> | void;
    onSkip: (reason: string) => Promise<void> | void;
    onRerun: () => Promise<void> | void;
    onClose: () => void;
    busy?: boolean;
    /** The server's refusal for this row, if the last confirm was refused. */
    error?: string | null;
    onDismissError?: () => void;
}

/**
 * The decision dialog: why the system suggests what it does, and the four ways to resolve the row.
 *
 * ⚠️ THE DIALOG OWNS ITS OWN SCROLLBAR. Header and footer are pinned and only the BODY scrolls.
 * Letting the scrim scroll instead pushes Confirm off-screen -- the one control the dialog exists
 * for -- which is a defect the prototype's live walk found and no unit test could have.
 *
 * ⚠️ MISMATCHED ROWS GET THIS SAME FULL DIALOG. Reporting a disagreement with no way to act on it
 * was the defect the owner named, so there is deliberately no read-only variant.
 *
 * ⚠️ EVERY OPTION OPENS IN PLACE, with everything it needs inside it. Nothing floats outside the
 * option it belongs to, so it is never ambiguous which control belongs to which choice.
 *
 * ⚠️ THIS DIALOG NO LONGER PRE-SELECTS ANYTHING, AND MUST NOT START AGAIN (slice R1). The match
 * run now writes its single pick onto the row itself, and the PAGE seeds every row's decision from
 * that when the batch loads. Pre-selecting here could only ever work once a reviewer had already
 * opened the row -- which is exactly why a matched transfer could not read as ready in the table,
 * and why confirming twenty of them meant opening twenty dialogs. It also re-derived the
 * "exactly one candidate" rule from a DIFFERENT candidate list than the row's own note counted, so
 * the two could disagree about the same row. One rule, on the server, in `sole_suggestion`.
 */
export const DecisionDialog = ({
    row,
    decision,
    onChange,
    onConfirm,
    onSkip,
    onRerun,
    onClose,
    busy = false,
    error = null,
    onDismissError,
}: Props) => {
    const [skipReason, setSkipReason] = useState("");
    const [skipping, setSkipping] = useState(false);
    const [picked, setPicked] = useState<SettleableRecord | null>(null);
    const [blocked, setBlocked] = useState<SettleBlock | null>(null);

    useEffect(() => {
        setSkipReason("");
        setPicked(null);
        setBlocked(null);
    }, [row?.name]);

    // Reference-stable, or the effect in `LinkPaymentSection` that reports the selection would
    // re-fire on every render of this dialog.
    //
    // Changing the pick CLEARS the last refusal: that message names a record, so leaving it up
    // beside a different one would be describing a choice the reviewer has already abandoned.
    const handleSelectedRecordChange = useCallback(
        (record: SettleableRecord | null) => {
            setPicked(record);
            onDismissError?.();
        },
        [onDismissError]
    );

    /**
     * ⚠️ THE CHECK RUNS ON THE CLICK, NOT ON THE BUTTON'S `disabled`, AND THAT IS THE POINT.
     *
     * The owner's report was that picking a record ₹2,19,000 away from the transfer left Confirm
     * looking perfectly clickable, and clicking it did nothing at all -- which reads as a broken
     * front end. Two separate things caused that and both are fixed: the page swallowed the
     * server's refusal (see `handleConfirmOne`), and nothing on this screen said the pick was going
     * to be refused.
     *
     * Disabling the button instead would have restored the OTHER half of the same complaint: a dead
     * control with no explanation. A click that opens a dialog SAYING why is the honest shape --
     * the reviewer gets an answer at the moment they ask the question.
     */
    const handleConfirmClick = useCallback(() => {
        const block = settleBlocker(picked, row?.amount ?? 0);
        if (block) {
            setBlocked(block);
            return;
        }
        onConfirm();
    }, [picked, row?.amount, onConfirm]);

    if (!row) return null;

    return (
        <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
            {/* grid-rows-[auto_1fr_auto] + min-h-0 on the body is what pins header and footer and
                gives the BODY the scrollbar. `max-h-[85vh]` bounds the whole thing to the
                viewport; without the bound the scrim scrolls instead.
                ⚠️ 860px -> 960px WITH THE RECORD TABLE. Seven columns of real facts need the room;
                at 860 the vendor and project columns truncate on almost every row, which defeats
                the reason those facts became columns. */}
            <DialogContent className="grid max-h-[85vh] w-[min(92vw,960px)] grid-rows-[auto_1fr_auto] gap-0 overflow-hidden p-0 sm:max-w-none">
                <header className="border-b px-6 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 className="text-base font-semibold">{row.beneficiary_name}</h2>
                        <span className="text-lg font-semibold tabular-nums">
                            {formatToRoundedIndianRupee(row.amount)}
                        </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {row.added_on ? formatDate(row.added_on.split(/[ T]/)[0]) : "no date"}
                        {row.bank_reference_no ? ` · ref ${row.bank_reference_no}` : ""}
                        {row.bank_account ? ` · a/c ${row.bank_account}` : ""}
                    </p>
                    {row.remarks && (
                        <p className="mt-1 text-sm text-muted-foreground">“{row.remarks}”</p>
                    )}
                </header>

                <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-4">
                    <WhyThisSuggestion row={row} />

                    {/* ⚠️ ONE SECTION, ALWAYS OPEN. It replaced three cards -- one per ledger --
                        that made the reviewer say WHICH KIND of record this was before they were
                        shown any. That is a question the bank statement does not answer: a transfer
                        to a vendor may have been raised as a Project Payment or booked as a Project
                        Expense, and the only way to find out was to open each card in turn. With
                        one list there is nothing to choose first, so there is no card to click. */}
                    <LinkPaymentSection
                        row={row}
                        decision={decision}
                        onChange={onChange}
                        dimmed={decision?.target === "new"}
                        onSelectedRecordChange={handleSelectedRecordChange}
                    />

                    {SHOW_CREATE_NEW_EXPENSE && (
                        <TargetOption
                            target={CREATE_NEW_TARGET}
                            row={row}
                            decision={decision}
                            onChange={onChange}
                        />
                    )}
                </div>

                {/* ⚠️ IN THE FOOTER, BESIDE THE BUTTON THAT CAUSED IT -- not a toast. The reviewer
                    is looking at the record list they are about to correct; a message that fades
                    from the corner of the screen is how the refusal went unseen in the first place.
                    It clears when they change the pick, so it can never describe a stale choice. */}
                {error && (
                    <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-6 py-3 text-sm text-destructive">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                            <p className="font-medium">This transfer was not recorded.</p>
                            <p className="text-xs">{error}</p>
                        </div>
                    </div>
                )}

                <footer className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-6 py-3">
                    <Button variant="ghost" size="sm" onClick={() => onRerun()} disabled={busy}>
                        Re-run match
                    </Button>
                    <div className="flex-1" />
                    {SHOW_SKIP_ROW && skipping ? (
                        <div className="flex w-full items-center gap-2 sm:w-auto">
                            <Input
                                autoFocus
                                value={skipReason}
                                placeholder="Why is this row being skipped?"
                                onChange={(e) => setSkipReason(e.target.value)}
                                className="h-8 w-full sm:w-72"
                            />
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={!skipReason.trim() || busy}
                                onClick={() => onSkip(skipReason.trim())}
                            >
                                Skip
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setSkipping(false)}>
                                Cancel
                            </Button>
                        </div>
                    ) : (
                        <>
                            {/* A skip is a DECISION, which is why it requires a typed reason. */}
                            {SHOW_SKIP_ROW && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setSkipping(true)}
                                >
                                    Skip this row
                                </Button>
                            )}
                            {/* ⚠️ GATED ON THE SAME `isConfirmable` THE BULK BAR COUNTS WITH, so
                                the two surfaces can never disagree about whether a row is ready.
                                It also closes a real hole: the ledger now arrives with the chosen
                                record rather than from a card clicked first, so a cleared selection
                                leaves no target at all -- and this button would have posted a
                                settle with an undefined doctype. */}
                            <Button
                                size="sm"
                                onClick={handleConfirmClick}
                                disabled={busy || !isConfirmable(row, decision)}
                            >
                                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Confirm → Paid
                            </Button>
                        </>
                    )}
                </footer>
            </DialogContent>

            <AmountOutsideWindowDialog
                block={blocked}
                onClose={() => setBlocked(null)}
            />
        </Dialog>
    );
};

/**
 * Why this pick will not be recorded, said before anything is posted.
 *
 * ⚠️ ITS WHOLE JOB IS TO STOP A RULE READING AS A FAULT. The write guard in `settle.py` refuses a
 * record whose amount is outside the settle window, and it always has. What the reviewer saw was a
 * live control that did nothing -- so the honest failure of a deliberate rule was indistinguishable
 * from a broken button. Every line below is chosen against that: it names the rule, states plainly
 * that NOTHING has been written, and gives the two real ways forward.
 *
 * ⚠️ THERE IS NO "TRY ANYWAY". The server will refuse this pick with certainty, so an override would
 * offer a guaranteed failure -- which is the same defect again, one screen later.
 *
 * ⚠️ IT DOES NOT NAME THE WINDOW'S VALUE. That number lives in `services/outflow_import/amounts.py`
 * and has changed twice; printing it here would be a second copy that drifts, and the reviewer does
 * not need it -- they need to know THIS pick is too far apart, which the difference already says.
 */
const AmountOutsideWindowDialog = ({
    block,
    onClose,
}: {
    block: SettleBlock | null;
    onClose: () => void;
}) => (
    <AlertDialog open={Boolean(block)} onOpenChange={(open) => !open && onClose()}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>This record cannot be settled here</AlertDialogTitle>
                <AlertDialogDescription asChild>
                    <div className="space-y-3 text-sm">
                        <p>
                            <span className="font-mono">{block?.recordName}</span> is for{" "}
                            <span className="font-medium tabular-nums">
                                {formatToIndianRupee(block?.recordAmount ?? 0)}
                            </span>
                            , but{" "}
                            <span className="font-medium tabular-nums">
                                {formatToIndianRupee(block?.bankAmount ?? 0)}
                            </span>{" "}
                            left the bank — a difference of{" "}
                            <span className="font-medium tabular-nums">
                                {formatToIndianRupee(Math.abs(block?.difference ?? 0))}
                            </span>
                            .
                        </p>
                        <p>
                            An import may only settle a record whose amount matches the transfer,
                            give or take bank rounding. This gap is far larger than that, so the
                            server would refuse it.
                        </p>
                        {/* The reassurance is the point of the whole dialog. */}
                        <p className="font-medium text-foreground">
                            Nothing has been recorded, and nothing will be.
                        </p>
                        <p className="text-muted-foreground">
                            A deduction such as TDS looks exactly like this — settle those in the
                            payments screen. Otherwise pick the record that matches this transfer,
                            or record it as a new expense.
                        </p>
                    </div>
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogAction onClick={onClose}>Choose another record</AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
);

/**
 * Why the system suggests this, in plain English (owner ruling).
 *
 * Derived from the row's own status and note rather than a second copy of the matching rules --
 * `status.py` already wrote the sentence a reviewer needs, and re-deriving it here would give the
 * screen an opinion the server does not share.
 */
const WhyThisSuggestion = ({ row }: { row: OutflowImportRow }) => {
    const bullets: string[] = [];
    if (row.bank_reference_no) {
        bullets.push(
            `The bank reference ${row.bank_reference_no} is not recorded on any payment yet.`
        );
    }
    if (row.outcome_note) bullets.push(row.outcome_note);
    // ⚠️ THIS USED TO BRANCH ON `row_status === "Unmatched"`, AND THAT STATUS IS GONE (merged into
    // `Mismatched`, owner 2026-08-10). The line only makes sense for ONE of the merged status's two
    // causes -- the FOUND-NOTHING one, where "we looked and offered you nothing" needs explaining.
    // On the other cause a record WAS found, and is already recorded as Paid; telling that reader
    // "only approved records are offered here" answers a question they did not ask.
    //
    // The two are told apart by `related_payments`, which the endpoint populates precisely when an
    // already-Paid record shares this transfer's reference. Keying on the NOTE TEXT would have
    // worked too and is exactly the guessing `rowSettlementLinks` documents as forbidden: the
    // sentence is written for a person, and the database already holds the fact.
    if (row.row_status === ROW_MISMATCHED && !(row.related_payments ?? []).length) {
        bullets.push("Only approved records are ever offered here.");
    }
    if (!bullets.length) return null;

    return (
        <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Why the system suggests this
            </p>
            <ul className="list-inside list-disc space-y-1 text-sm">
                {bullets.map((b) => (
                    <li key={b}>{b}</li>
                ))}
            </ul>
        </div>
    );
};

/**
 * The one way to resolve a row: find the approved record this transfer paid, in any ledger.
 *
 * ⚠️ IT IS A SECTION, NOT A SELECTABLE CARD, because it is the only option. A radio with nothing
 * to choose against is a control that cannot be wrong, and asking for a click before showing the
 * list would put a step in front of the only thing this dialog does.
 */
const LinkPaymentSection = ({
    row,
    decision,
    onChange,
    dimmed,
    onSelectedRecordChange,
}: {
    row: OutflowImportRow;
    decision: RowDecision | undefined;
    onChange: (decision: RowDecision) => void;
    dimmed: boolean;
    // Passed straight through to `RecordPicker`, which is where the candidate list -- and so the
    // server's `suggested` flag -- actually lives.
    onSelectedRecordChange: (record: SettleableRecord | null) => void;
}) => (
    <div className={`rounded-md border border-muted-foreground/20 ${dimmed ? "opacity-40" : ""}`}>
        <div className="px-3 py-2.5">
            <p className="text-sm font-medium">Link payment</p>
            <p className="text-xs text-muted-foreground">
                the approved record this transfer paid — payment or expense
            </p>
        </div>
        <div className="border-t px-3 py-3">
            <RecordPicker
                row={row}
                decision={decision ?? {}}
                onChange={onChange}
                onSelectedRecordChange={onSelectedRecordChange}
            />
        </div>
    </div>
);

const TargetOption = ({
    target,
    row,
    decision,
    onChange,
}: {
    target: { id: DecisionTarget; label: string; hint: string };
    row: OutflowImportRow;
    decision: RowDecision | undefined;
    onChange: (decision: RowDecision) => void;
}) => {
    const chosen = decision?.target === target.id;

    return (
        <div
            className={`rounded-md border transition-colors ${
                chosen ? "border-primary bg-primary/5" : "border-muted-foreground/20"
            }`}
        >
            <button
                type="button"
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
                onClick={() =>
                    onChange({
                        target: "new",
                        newExpense: decision?.newExpense ?? {
                            doctype: PROJECT_EXPENSE,
                            description: row.remarks || "",
                        },
                    })
                }
            >
                <span
                    className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                        chosen ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`}
                />
                <span>
                    <span className="block text-sm font-medium">{target.label}</span>
                    <span className="block text-xs text-muted-foreground">{target.hint}</span>
                </span>
            </button>

            {chosen && (
                <div className="border-t px-3 py-3">
                    <NewExpenseForm row={row} decision={decision!} onChange={onChange} />
                </div>
            )}
        </div>
    );
};

/**
 * A search box over a RADIO TABLE of approved records (owner ruling 2026-08-07, replacing the
 * dropdown), with a verdict line for whichever one is chosen.
 *
 * ⚠️ IT PRE-SELECTS NOTHING, AND THAT IS DELIBERATE (slice R1). It used to tick the sole record
 * whose amount matched. The only rows that still reach this picker with nothing chosen are rows the
 * MATCHER DECLINED -- unmatched, mismatched, or one of several candidates -- so an auto-tick here
 * would be the screen overruling the matcher on the weakest signal it has: amount alone, no vendor,
 * no account, and across all three ledgers not even the right kind of record. The one pre-selection
 * in this feature comes from `sole_suggestion` on the server, via the page.
 *
 * ⚠️ THIS BROWSES APPROVED RECORDS. IT DOES NOT SHOW THE MATCHER'S OUTPUT, and the difference is
 * the whole point of this component.
 *
 * It used to read `get_row_candidates`, which is the MATCHER's result. When the matcher found
 * nothing the dropdown was EMPTY -- so "link one by hand", the escape hatch for everything the
 * matcher cannot see, could not be used at all. Found on the owner's first real import.
 *
 * The tolerance does not fix that case either: a TDS payment differs by thousands and will never
 * match, and a beneficiary that resolves to no vendor never reaches Pass B. Those are exactly the
 * rows a person has to resolve by hand.
 *
 * ⚠️ RECORDS OUTSIDE THE TOLERANCE ARE SHOWN, NOT HIDDEN, and marked. Someone hunting a TDS payment
 * needs to SEE the one that differs by 2,000 to learn it cannot be settled here -- silently
 * filtering it out looks like the record does not exist.
 */
const RecordPicker = ({
    row,
    decision,
    onChange,
    onSelectedRecordChange,
}: {
    row: OutflowImportRow;
    decision: RowDecision;
    onChange: (decision: RowDecision) => void;
    onSelectedRecordChange: (record: SettleableRecord | null) => void;
}) => {
    const [filters, setFilters] = useState<RecordFilters>(EMPTY_FILTERS);
    const [sort, setSort] = useState<RecordSort | null>(null);

    // A different transfer is a different question -- carrying one row's filters onto the next
    // would hide records for a reason that is no longer on screen.
    useEffect(() => {
        setFilters(EMPTY_FILTERS);
        setSort(null);
    }, [row.name]);

    // ⚠️ NO `target_doctype`, WHICH IS WHAT MAKES THIS ONE LIST. A blank one means all three
    // ledgers, merged and RANKED server-side by how much each record looks like this transfer --
    // so the reviewer recognises a record instead of first classifying the transfer.
    //
    // ⚠️ NO `search` AND NO `limit` EITHER, AND THE SWR KEY IS THEREFORE STABLE PER ROW (slice N1).
    // It used to carry the search text, which minted a new key -- and so a new REQUEST -- on every
    // keystroke. The whole approved pool now arrives in one call and every narrowing below is
    // local, which is what makes filtering and sorting instant.
    const { data, isLoading } = useFrappeGetCall<{ message: SettleableRecord[] }>(
        "nirmaan_stack.api.outflow_import.review.search_settleable_records",
        { row: row.name },
        `settleable-${row.name}`
    );

    // ⚠️ THE SERVER'S ORDER IS THE RANKING, SO IT IS NOT RE-SORTED HERE. This used to call
    // `orderBySuggestion`, which re-sorted by amount and would now silently undo the similarity
    // ranking it arrives in.
    const pool = useMemo(() => data?.message ?? [], [data]);
    const facets = useMemo(() => facetValues(pool), [pool]);
    const options = useMemo(() => visibleRecords(pool, filters, sort), [pool, filters, sort]);

    const handleSort = useCallback(
        (column: RecordSortColumn) => setSort((current) => nextSortState(current, column)),
        []
    );

    // ⚠️ LOOKED UP IN THE WHOLE POOL, NOT THE FILTERED VIEW. A reviewer who picks a record and then
    // narrows the list would otherwise watch their own choice become invisible AND unconfirmable --
    // the footer reads the selection from here, so a filtered-out pick would disable Confirm with
    // nothing on screen explaining why. Matched on BOTH halves: a bare name is not unique across
    // three ledgers.
    const selected = pool.find(
        (o) => o.name === decision.linkTo && o.target_doctype === decision.target
    );
    const selectedHidden = Boolean(selected) && !options.some((o) => o === selected);

    // ⚠️ REPORTED UPWARD BECAUSE THE FOOTER HAS TO KNOW WHAT WAS PICKED. The candidate list, and
    // therefore the server's `suggested` flag, lives only in here -- the page's `RowDecision`
    // carries a doctype and a NAME and nothing about the record's amount. Without this the Confirm
    // button cannot tell a settleable pick from one the server will refuse, which is exactly how it
    // came to post, be refused, and show nothing.
    useEffect(() => {
        onSelectedRecordChange(selected ?? null);
    }, [selected, onSelectedRecordChange]);

    return (
        <div className="space-y-3">
            <div className="space-y-1.5">
                <Label className="text-xs">Find an approved record</Label>
                <Input
                    className="h-8"
                    // It searches the nickname and the contact person too, and says so: those two
                    // are how a vendor is found by someone who knows the person rather than the
                    // registered name.
                    placeholder="Search by id, vendor, nickname, contact, PO number or project…"
                    value={filters.text}
                    onChange={(e) => setFilters({ ...filters, text: e.target.value })}
                />
            </div>

            {/* ⚠️ THE COUNT LINE AND THE CLEAR CONTROL SIT TOGETHER, ABOVE THE TABLE. A filtered
                table that does not say it is filtered is how a reviewer concludes a record does
                not exist -- and the way out has to be beside the number that reports it. */}
            {!isLoading && pool.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                        {options.length === pool.length
                            ? `${pool.length} approved record${pool.length === 1 ? "" : "s"}`
                            : `Showing ${options.length} of ${pool.length} approved records`}
                    </span>
                    {hasActiveFilters(filters, sort) && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => {
                                setFilters(EMPTY_FILTERS);
                                setSort(null);
                            }}
                        >
                            <X className="mr-1 h-3 w-3" />
                            Clear filters
                        </Button>
                    )}
                </div>
            )}

            {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading records…</p>
            ) : !pool.length ? (
                <p className="text-sm text-muted-foreground">
                    There are no approved payments or expenses to link to.
                </p>
            ) : !options.length ? (
                // ⚠️ "NOTHING MATCHES" IS A DIFFERENT SENTENCE FROM "THERE IS NOTHING", and the
                // difference decides what the reviewer does next. This branch also has to offer the
                // way back, because the filters that emptied the table are in a header the table no
                // longer renders -- the control that caused this can hide itself.
                <div className="space-y-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    <p>No approved record matches the filters you have set.</p>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                            setFilters(EMPTY_FILTERS);
                            setSort(null);
                        }}
                    >
                        Clear filters
                    </Button>
                </div>
            ) : (
                <SettleableRecordTable
                    records={options}
                    bankAmount={row.amount}
                    sort={sort}
                    onSort={handleSort}
                    filters={filters}
                    facets={facets}
                    onFiltersChange={setFilters}
                    selected={
                        decision.target && decision.linkTo
                            ? recordKey({
                                  target_doctype: decision.target,
                                  name: decision.linkTo,
                              })
                            : ""
                    }
                    // ⚠️ THE LEDGER COMES FROM THE RECORD. It used to come from the card clicked
                    // beforehand; with one list there is no such card, so picking a record is what
                    // decides which table gets written.
                    onSelect={(value) => {
                        const picked = parseRecordKey(value);
                        if (!picked) return;
                        onChange({ ...decision, target: picked.target, linkTo: picked.name });
                    }}
                />
            )}

            {/* The chosen record is still chosen and still confirmable -- but it is no longer on
                screen, so say so rather than let the verdict line below describe a row the reviewer
                cannot see. */}
            {selectedHidden && (
                <p className="text-xs text-amber-700">
                    Your chosen record is hidden by the current filters.
                </p>
            )}

            {selected && <RecordVerdict record={selected} bankAmount={row.amount} />}

            {/* ⚠️ CLEARING IS A SEPARATE ACT FROM CHOOSING. A Radix Select cannot return to "no
                value" through the dropdown -- every item sets one -- so without this a reviewer who
                picked the wrong record could never get back to undecided, only to a different
                wrong record.
                ⚠️ IT NOW CLEARS THE LEDGER TOO. It used to keep it, because the ledger was a
                separate earlier choice worth preserving; with one list the ledger is part of the
                record, and leaving it behind would strand a target with no record under it. */}
            {decision.linkTo && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => onChange({ ...decision, target: undefined, linkTo: null })}
                >
                    <X className="mr-1 h-3 w-3" />
                    Clear selection
                </Button>
            )}
        </div>
    );
};

/**
 * What choosing THIS record means, in one line under the table.
 *
 * ⚠️ IT SHRANK FROM A FULL DETAIL CARD WHEN THE LIST BECAME A TABLE, and the deletion is the point.
 * That card repeated the ledger, the id, the vendor, the project, the date and the amount -- every
 * one of which is now a COLUMN the reviewer can read on the chosen row itself. What a column cannot
 * carry is the sentence explaining what the amount difference MEANS, and the way out to the record,
 * so those are what is left.
 *
 * ⚠️ THREE STATES, NOT TWO. Exact / within the tolerance / outside it. Two states would have to call
 * a 31-paise difference either "same" (untrue) or a warning (misleading, since the system settles it
 * happily) -- and the bank rounds to the rupee on about a third of all payments, so that middle case
 * is the common one, not the rare one.
 *
 * The tolerance's VALUE is deliberately not named here: it lives on the server, and a number
 * repeated in the client would drift the moment the owner changed it -- which has happened twice.
 */
const RecordVerdict = ({
    record,
    bankAmount,
}: {
    record: SettleableRecord;
    bankAmount: number;
}) => {
    const verdict = amountVerdict(record.amount, bankAmount);
    const settleable = record.suggested;
    const link = settlementLink(record.target_doctype, record.name);
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
            <p
                className={`flex items-center gap-1.5 text-xs ${
                    settleable ? "text-emerald-700" : "text-amber-700"
                }`}
            >
                {verdict.same ? (
                    <>
                        <Check className="h-3.5 w-3.5 shrink-0" />
                        <span>
                            <span className="font-mono">{record.name}</span> is the same amount as
                            the bank row
                        </span>
                    </>
                ) : settleable ? (
                    <>
                        <Check className="h-3.5 w-3.5 shrink-0" />
                        <span>
                            {/* ⚠️ To the paise -- the rounded formatter ceils, and the gap this
                                branch describes is USUALLY under a rupee, so it read "differs by
                                ₹1" for 31 paise. */}
                            <span className="font-mono">{record.name}</span> differs by{" "}
                            {formatToIndianRupee(Math.abs(verdict.difference))} — within the
                            accepted rounding tolerance, so this can be settled
                        </span>
                    </>
                ) : (
                    <>
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>
                            <span className="font-mono">{record.name}</span> differs by{" "}
                            {formatToIndianRupee(Math.abs(verdict.difference))} — too far
                            apart to settle here. A deduction such as TDS looks like this; settle it
                            in the payments screen
                        </span>
                    </>
                )}
            </p>
            {/* Opening the record is a READ, and it navigates away from a dialog holding an
                unconfirmed decision -- so it is a quiet link, never a button competing with
                Confirm. */}
            {link && (
                <Link
                    to={link.href}
                    title={link.title}
                    className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                >
                    Open <ExternalLink className="h-3.5 w-3.5" />
                </Link>
            )}
        </div>
    );
};

/**
 * The whole new-expense form, in place.
 *
 * ⚠️ THE PROJECT LIST IS `tendering_status = "Won"`, WHICH IS A DIFFERENT FIELD FROM `status`.
 * ⚠️ A CEO-HOLD PROJECT IS SHOWN, DISABLED, WITH THE REASON. CEO Hold blocks every expense
 * operation, and silently hiding those projects would make their absence inexplicable to whoever
 * goes looking for one.
 * ⚠️ Amount, payment date and reference are READ-ONLY from the bank row: the statement is the
 * source of truth for all three.
 */
const NewExpenseForm = ({
    row,
    decision,
    onChange,
}: {
    row: OutflowImportRow;
    decision: RowDecision;
    onChange: (decision: RowDecision) => void;
}) => {
    const form = decision.newExpense ?? { doctype: PROJECT_EXPENSE };
    const isProject = form.doctype === PROJECT_EXPENSE;

    const { data: projects } = useFrappeGetDocList<{
        name: string;
        project_name: string;
        status: string;
    }>(
        "Projects",
        {
            fields: ["name", "project_name", "status"],
            filters: [["tendering_status", "=", "Won"]],
            limit: 0,
            orderBy: { field: "project_name", order: "asc" },
        },
        isProject ? undefined : null
    );

    const { data: typesData } = useFrappeGetCall<{ message: { name: string }[] }>(
        "nirmaan_stack.api.outflow_import.expenses.get_expense_types",
        { doctype: form.doctype },
        form.doctype ? `expense-types-${form.doctype}` : null
    );

    const patch = (over: Partial<NonNullable<RowDecision["newExpense"]>>) =>
        onChange({ ...decision, newExpense: { ...form, ...over } });

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Kind</Label>
                <Select
                    value={form.doctype}
                    // ⚠️ Expense Type is SCOPED -- project=1 and non_project=1 are disjoint sets --
                    // so switching ledger MUST clear the chosen type or it carries a type the
                    // server will refuse.
                    onValueChange={(value) =>
                        patch({
                            doctype: value as "Project Expenses" | "Non Project Expenses",
                            expenseType: null,
                            project: value === PROJECT_EXPENSE ? form.project : null,
                        })
                    }
                >
                    <SelectTrigger className="h-9">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={PROJECT_EXPENSE}>Project expense</SelectItem>
                        <SelectItem value={NON_PROJECT_EXPENSE}>Non project expense</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {isProject && (
                <div className="space-y-1.5">
                    <Label className="text-xs">Project</Label>
                    <Select
                        value={form.project ?? ""}
                        onValueChange={(value) => patch({ project: value })}
                    >
                        <SelectTrigger className="h-9">
                            <SelectValue placeholder="Choose a project…" />
                        </SelectTrigger>
                        <SelectContent>
                            {(projects ?? []).map((project) => {
                                const onHold = project.status === "CEO Hold";
                                return (
                                    <SelectItem
                                        key={project.name}
                                        value={project.name}
                                        disabled={onHold}
                                    >
                                        {project.project_name}
                                        {onHold && (
                                            <span className="ml-2 text-xs text-muted-foreground">
                                                — on CEO Hold, expenses blocked
                                            </span>
                                        )}
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>
                </div>
            )}

            <div className="space-y-1.5">
                <Label className="text-xs">Expense type</Label>
                <Select
                    value={form.expenseType ?? ""}
                    onValueChange={(value) => patch({ expenseType: value })}
                >
                    <SelectTrigger className="h-9">
                        <SelectValue placeholder="Choose a type…" />
                    </SelectTrigger>
                    <SelectContent>
                        {(typesData?.message ?? []).map((type) => (
                            <SelectItem key={type.name} value={type.name}>
                                {type.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Description</Label>
                <Input
                    className="h-9"
                    value={form.description ?? ""}
                    placeholder="What was this for?"
                    onChange={(e) => patch({ description: e.target.value })}
                />
            </div>

            {/* Read-only from the bank row -- the statement is the source of truth. */}
            <ReadOnlyField label="Amount" value={formatToRoundedIndianRupee(row.amount)} />
            <ReadOnlyField
                label="Payment date"
                value={row.added_on ? formatDate(row.added_on.split(/[ T]/)[0]) : "—"}
            />
            <ReadOnlyField
                label="Payment reference"
                value={row.bank_reference_no || "—"}
                className="sm:col-span-2"
            />
        </div>
    );
};

const ReadOnlyField = ({
    label,
    value,
    className = "",
}: {
    label: string;
    value: string;
    className?: string;
}) => (
    <div className={`space-y-1.5 ${className}`}>
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input className="h-9 bg-muted/50" value={value} readOnly tabIndex={-1} />
    </div>
);
