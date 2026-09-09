// src/pages/outflow-import/components/DecisionDialog.tsx

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { AlertTriangle, Check, ExternalLink, Loader2, X } from "lucide-react";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
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

import { allocateButtonLabel, allocationBar, type AllocationBar } from "../allocationView";
import { ROW_PARTIALLY_ALLOCATED } from "../outflowImportStatus";
import {
    AMOUNT_GAP_HINT,
    INTENT_DEDUCTION,
    INTENT_PART_PAYMENT,
    amountVerdict,
    availableDecisionTargets,
    candidateKeySet,
    describeFrappeError,
    deductionOffer,
    deductionRefusalText,
    isConfirmable,
    isCreditRow,
    ledgerLabel,
    matcherCandidateLine,
    parseRecordKey,
    partialOffer,
    receiptStoredAmount,
    recordKey,
    settlementLink,
    settleBlockText,
    settleBlocker,
    tickAllowedForFanOut,
    type DecisionTarget,
    type DeductionOffer,
    type MatcherCandidate,
    type PartialIntent,
    type PartialOffer,
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
import { SettleableRecordTable } from "./SettleableRecordTable";

/**
 * One SETTLED leg already on this transfer (Task 7, ADR-0020 fan-out). Read straight off the
 * `Outflow Row Match` doctype -- no new backend endpoint exists for this, so the dialog reads the
 * same doctype `get_batch_rows`/`allocate_row`/`reverse_allocation` already read and write. Doc
 * permissions already admit the outflow-access roles (System Manager / Nirmaan Accountant /
 * Nirmaan Accountant Lead), so this is an ordinary `useFrappeGetDocList` list read, not a new
 * enforcement boundary.
 */
interface AllocatedLeg {
    name: string;
    target_doctype: string;
    target_name: string;
    target_amount: number;
    match_kind: string;
    matched_at?: string | null;
}

const PROJECT_EXPENSE = "Project Expenses";
const NON_PROJECT_EXPENSE = "Non Project Expenses";

/**
 * ⚠️ BACK ON (owner, slice B5, 2026-09-07), AND IT IS NOW THE PRIMARY WAY TO RESOLVE A ROW -- not
 * a fallback. The third import source, `ICICI Bank Statement`, is CREATE-ONLY: it has no settlement
 * path at all, so almost every one of its ~711 ingested debits is resolved by a person recording a
 * new `Project Expenses` / `Non Project Expenses` here. With this off, that whole source has no
 * terminal state a reviewer can reach.
 *
 * ⚠️ WHY IT WAS EVER OFF, BECAUSE THE OLD COMMENT READ LIKE A SAFETY RULING AND WAS NOT ONE. It
 * went dark in `f0330514`, whose actual subject was collapsing three per-ledger cards into ONE
 * "Link payment" list; hiding this was collateral from that simplification. The spec
 * (`docs/outflow-import/workflow.html`) has designed the feature IN throughout and treats it as the
 * ordinary resolution for a transfer with nothing to link to. Nothing was ever found wrong with the
 * path itself -- which is exactly why "hidden, not deleted" was the right call then and why this is
 * one line now.
 *
 * ⚠️ THE PATH HAD BEEN DARK SINCE 2026-08-07, so it was re-traced end to end at B5 rather than
 * merely re-enabled: the form below, `RowDecision.newExpense`, the `new` branch of `isConfirmable`
 * (which the bulk bar's `countDecided` reads too), `OutflowMasterPage.settleOne`'s create branch,
 * `expenses.create_expense` / `get_expense_types`, and `settle.create_expense_from_row`. The
 * contract still matches: the client sends doctype + type + project + description only, and every
 * figure -- amount, payment date, reference -- is read SERVER-SIDE off the staged bank row.
 *
 * ⚠️ `SHOW_SKIP_ROW` STAYS OFF (see below). B5 turns on exactly one of the two hidden exits; the
 * owner kept manual skip closed, so this is now the only terminal state a person can reach for a
 * row with no approved record behind it.
 */
const SHOW_CREATE_NEW_EXPENSE = true;

/**
 * ⚠️ HIDDEN, NOT DELETED (owner ruling 2026-08-10) -- same treatment, and for the same reason.
 * "Skip this row" is off this dialog. `review.skip_row`, its required-reason guard, the
 * `Skipped` status, the Skipped tab and the auto-skip path at upload are ALL untouched: automatic
 * skips (a failed transfer, an already-recorded duplicate) still happen and still land in that tab.
 * What is gone is the MANUAL skip button.
 *
 * ⚠️ STATE THE CONSEQUENCE RATHER THAN DISCOVER IT LATER -- AND IT CHANGED AT B5. While this and
 * `SHOW_CREATE_NEW_EXPENSE` were BOTH off, linking an approved record was the only way a person
 * could resolve an open row, so a transfer with genuinely nothing to settle against -- 145 of them
 * on the first real statement -- had no terminal state at all and stayed open indefinitely against
 * "Still open". Turning "Create a new expense" back on is what closes that hole: such a row is now
 * RECORDED rather than set aside, which is the better answer anyway because the money did leave the
 * account. What is still unavailable is declaring a row resolved WITHOUT writing anything -- a
 * genuine skip. Closing the import remains the only way to set one aside, and closing is
 * bookkeeping: it does not change a row's status. Flipping this one const back is the whole
 * reversal.
 */
const SHOW_SKIP_ROW = false;

/**
 * ⚠️ THE KILL SWITCH FOR PARTIAL SETTLEMENT (slice PS), in the same place and the same style as the
 * two above. Flipping it to `false` restores the pre-PS dead-end dialog exactly: the offer is the
 * ONLY entry point to `settle_row_partial`, so the endpoint becomes unreachable from the product
 * without it. Nothing already written rolls back — see the plan's §7.
 */
const SHOW_PARTIAL_SETTLE = true;

const CREATE_NEW_TARGET: { id: DecisionTarget; label: string; hint: string } = {
    id: "new",
    label: "Create a new expense",
    hint: "nothing to link to — record it here, already Paid",
};

/**
 * ⚠️ OFFERED ON A CREDIT ROW ONLY (slice B6), AND `direction` IS THE ONLY THING THAT CAN SAY SO.
 * `amount` is the positive magnitude the statement printed on every source, so nothing else on the
 * row distinguishes money that arrived from money that left.
 *
 * ⚠️ WHAT IT WRITES HAS NO DRAFT STATE AND NO APPROVAL. `Project Inflows` carries no status field,
 * and every consumer sums it unfiltered — project aggregates, the payment summary, customer
 * financials, and the CEO Cashflow Hold gap. A recorded inflow is LIVE the instant it commits and
 * can release a hold. The bank row IS the review gate (owner ruling Q8, option c), which is why the
 * hint says "recorded straight away" rather than implying anything downstream will check it.
 */
const CREATE_INFLOW_TARGET: { id: DecisionTarget; label: string; hint: string } = {
    id: "inflow",
    label: "Create a project inflow",
    hint: "money received — recorded straight away against a project",
};

/**
 * The SECOND thing a credit row can become (slice B7): money in that belongs to no project.
 *
 * ⚠️ THE HINT SAYS "as a negative expense" IN THE CARD HEADER, BEFORE THE FORM IS EVEN OPENED, AND
 * THAT IS THE POINT. There is no non-project inflow doctype in this app and none is being created
 * (owner ruling Q3, ADR-0016 decision 3): a non-project receipt is recorded as a `Non Project
 * Expense` with a NEGATIVE amount. That is the app's own existing construct for money coming back —
 * the create dialog says "use negative for refunds", the list renders a negative amount green — but
 * a reviewer picking a card should not have to already know that. The consequence they are choosing
 * has to be legible from the choice.
 */
const CREATE_RECEIPT_TARGET: { id: DecisionTarget; label: string; hint: string } = {
    id: "receipt",
    label: "Record a non-project receipt",
    hint: "money received against no project — stored as a negative non-project expense",
};

interface Props {
    row: OutflowImportRow | null;
    decision: RowDecision | undefined;
    onChange: (decision: RowDecision) => void;
    onConfirm: () => Promise<void> | void;
    /**
     * Settle PART of the picked record, carrying the balance forward (slice PS).
     *
     * ⚠️ THE INTENT IS PASSED UP RATHER THAN ASSUMED. The endpoint requires it and has no default,
     * so the reviewer's answer has to travel with the call — see `PartialIntentChoice`.
     */
    onPartialSettle: (record: SettleableRecord, intent: PartialIntent) => Promise<void> | void;
    /**
     * Undo one Settled leg of an allocation (Task 7, ADR-0020 fan-out). A reason is REQUIRED --
     * `reverse_allocation` throws without one, the same standard `skip_row` already holds.
     */
    onReverseAllocation: (match: string, reason: string) => Promise<void> | void;
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
    onPartialSettle,
    onReverseAllocation,
    onSkip,
    onRerun,
    onClose,
    busy = false,
    error = null,
    onDismissError,
}: Props) => {
    const [skipReason, setSkipReason] = useState("");
    const [skipping, setSkipping] = useState(false);
    // ⚠️ PLURAL SINCE TASK 7 (ADR-0020 fan-out) -- the picker is now a checkbox group. `picked`
    // below is the SINGLE-record derivation the pre-existing amount-window / partial-settle detour
    // needs; that detour is about ONE record against the whole transfer and does not generalise to
    // a tick-set, which the balance bar governs instead.
    const [pickedRecords, setPickedRecords] = useState<SettleableRecord[]>([]);
    const picked = pickedRecords.length === 1 ? pickedRecords[0] : null;
    const [blocked, setBlocked] = useState<SettleBlock | null>(null);
    const [reversingLeg, setReversingLeg] = useState<AllocatedLeg | null>(null);

    // ⚠️ FETCHED HERE, AT THE TOP, AND NOT INSIDE THE PICKER (slice N3). It used to have two
    // consumers -- the picker's row markers and the "Why the system suggests this" block, which
    // stood its stored sentence down once this live count replaced it. That block is GONE (slice
    // D2) and the picker is now the only consumer, so this could in principle move down into it.
    // It stays here deliberately: one fetch, at the level that owns the row, is what guarantees a
    // single count on screen -- and a second fetch lower down is exactly the disagreement slice N3
    // was written to remove.
    const { data: candidateData } = useFrappeGetCall<{
        message: { settleable_candidates?: MatcherCandidate[] };
    }>(
        "nirmaan_stack.api.outflow_import.review.get_row_candidates",
        { row: row?.name },
        row?.name ? `row-candidates-${row.name}` : null
    );
    const matcherCandidates = useMemo(
        () => candidateKeySet(candidateData?.message?.settleable_candidates),
        [candidateData]
    );

    const isPartiallyAllocated = row?.row_status === ROW_PARTIALLY_ALLOCATED;

    /**
     * The legs this transfer has ALREADY settled (Task 7, ADR-0020 fan-out).
     *
     * ⚠️ NO DEDICATED ENDPOINT EXISTS FOR "one row's current allocation" -- `get_row_allocation`
     * was never built, and the `legs` a write returns only cover THAT write. This reads the
     * `Outflow Row Match` doctype directly instead: an ordinary `useFrappeGetDocList`, the same
     * doc-permission-gated pattern every other Frappe list read in this app uses, and it already
     * admits the outflow-access roles (System Manager / Nirmaan Accountant / Nirmaan Accountant
     * Lead). Fetched only while the row is `Partially Allocated` -- the one status where an
     * incomplete leg set is the reason the row is still open.
     */
    const {
        data: legsData,
        error: legsError,
        isLoading: legsLoading,
    } = useFrappeGetDocList<AllocatedLeg>(
        "Outflow Row Match",
        {
            fields: ["name", "target_doctype", "target_name", "target_amount", "match_kind", "matched_at"],
            filters: [
                ["import_row", "=", row?.name ?? ""],
                ["match_kind", "=", "Settled"],
            ],
            orderBy: { field: "matched_at", order: "asc" },
            limit: 0,
        },
        row && isPartiallyAllocated ? `row-legs-${row.name}` : null
    );
    const allocatedLegs = useMemo(() => legsData ?? [], [legsData]);
    /**
     * ⚠️ REVIEW FIX 1 -- `[]` IS NOT "NO LEGS" WHILE THIS IS LOADING OR FAILED. On a `Partially
     * Allocated` row `[]` is the SWR default before the first response lands, and it is also what a
     * transient network failure leaves behind -- neither means the row has nothing settled against
     * it. Feeding either straight into `allocationBar` prints a confident `allocated ₹0 · left
     * ₹<the whole transfer>` on a row that already has money written against it, exactly the
     * "posts, is refused, shows nothing" shape this dialog's other guards exist to prevent, one
     * layer up. `legsUnknown` gates the bar and the button on this being resolved rather than
     * merely absent.
     */
    const legsUnknown = isPartiallyAllocated && (legsLoading || Boolean(legsError));

    // ⚠️ TICKED AMOUNTS COME FROM `pickedRecords`, NOT FROM `decision.linkTargets`. The picker
    // reports the actual `SettleableRecord`s it resolved its ticks to, which is what carries an
    // AMOUNT -- `linkTargets` is only ids. See `RecordPicker`.
    const bar: AllocationBar = useMemo(
        () => allocationBar(row?.amount ?? 0, allocatedLegs, pickedRecords.map((r) => r.amount)),
        [row?.amount, allocatedLegs, pickedRecords]
    );

    useEffect(() => {
        setSkipReason("");
        setPickedRecords([]);
        setBlocked(null);
        setReversingLeg(null);
    }, [row?.name]);

    // Reference-stable, or the effect in `RecordPicker` that reports the selection would re-fire
    // on every render of this dialog.
    //
    // Changing the pick CLEARS the last refusal: that message names a record, so leaving it up
    // beside a different one would be describing a choice the reviewer has already abandoned.
    const handleSelectedRecordsChange = useCallback(
        (records: SettleableRecord[]) => {
            setPickedRecords(records);
            onDismissError?.();
        },
        [onDismissError]
    );

    const handleReverseConfirm = useCallback(
        async (reason: string) => {
            if (!reversingLeg) return;
            // Same shape as `AmountOutsideWindowDialog`'s `onPartialSettle` below: the parent
            // catches and surfaces its own failure internally (see `handleReverseAllocation` in
            // `OutflowMasterPage`), so this always closes the small confirm afterwards.
            await onReverseAllocation(reversingLeg.name, reason);
            setReversingLeg(null);
        },
        [reversingLeg, onReverseAllocation]
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
    // The SHAPE both answers share, computed once. `deductionOffer` layers its two extra rules on
    // top of it, exactly as `deduction_eligibility` layers on `partial_eligibility` server-side —
    // one copy of the shared half on each side of the wire.
    const partialShape = SHOW_PARTIAL_SETTLE ? partialOffer(picked, row?.amount ?? 0) : null;

    const handleConfirmClick = useCallback(() => {
        // ⚠️ THE SINGLE-RECORD AMOUNT-WINDOW DETOUR ONLY APPLIES TO A SINGLE TICK (Task 7). It is
        // about ONE record's amount against the whole transfer; a fan-out tick-set is governed by
        // the balance bar instead (`bar.over` already disables Confirm at the button, below).
        if (pickedRecords.length === 1) {
            const block = settleBlocker(picked, row?.amount ?? 0);
            if (block) {
                setBlocked(block);
                return;
            }
        }
        onConfirm();
    }, [picked, pickedRecords.length, row?.amount, onConfirm]);

    if (!row) return null;

    // ⚠️ REVIEW FIX 3 -- ONE SOURCE FOR "HOW MANY ARE TICKED", NOT TWO THAT CAN DISAGREE.
    // `decision.linkTargets.size` counts every ticked KEY, including one the pool hasn't resolved
    // yet (still loading) or no longer contains (left the Approved pool since it was ticked) --
    // `pickedRecords` is what `bar` and the single-tick amount-window detour ALREADY read, so
    // deriving `ticks` from anything else lets the label say "Allocate 1 record" while the bar
    // beneath it counts that tick as zero, and lets `handleConfirmClick` skip `settleBlocker`
    // (gated on `pickedRecords.length`) for a tick the label just claimed was there.
    const ticks = pickedRecords.length;
    // ⚠️ WHICH ENDPOINT/LABEL, NOT WHETHER THE DECISION IS CONFIRMABLE -- `isConfirmable` already
    // answered that above `bar.over`'s reach on purpose (over-ticking is a COMPLETE decision, it is
    // merely one the button refuses to send). `isLinkDecision` mirrors the same three-way exclusion
    // `isConfirmable` reads: a "create something new" card in progress must keep the ordinary
    // "Confirm → Paid" wording and must never be blocked by a leftover, dimmed tick-set's `bar`.
    const isLinkDecision =
        decision?.target !== "new" && decision?.target !== "inflow" && decision?.target !== "receipt";
    // ⚠️ REVIEW FIX 1, ROUND 2 -- THE LABEL MUST NOT CLAIM COMPLETION IT HAS NOT VERIFIED. `bar` is
    // computed from `allocatedLegs`, which reads as a confident `[]` while `legsUnknown` is true
    // (still loading, or the fetch failed and persists until the row is re-opened). `confirmDisabled`
    // already refuses the CLICK in that state, but the button's TEXT was still able to say
    // "· completes this transfer" off a balance nobody has read yet -- the same false-confidence
    // defect FIX 1 fixed for the bar, one component further down. Short-circuiting HERE, at the
    // call site, rather than passing `complete: bar.complete && !legsUnknown`, is deliberate: the
    // intent ("never claim completion on an unknown balance") is legible without having to also
    // read what `bar.complete` means.
    const confirmLabel =
        isLinkDecision && ticks > 0
            ? legsUnknown
                ? allocateButtonLabel({ ticks, complete: false })
                : allocateButtonLabel({ ticks, complete: bar.complete })
            : "Confirm → Paid";
    // ⚠️ `bar.over` ONLY GATES THE BUTTON, NEVER `isConfirmable` -- see `allocationView.ts` and the
    // picker below. Disabling the ROWS instead would make it a puzzle: the reviewer may want to
    // untick something else first.
    //
    // ⚠️ REVIEW FIX 1 -- ALSO GATED ON `legsUnknown`. `bar` is computed from `allocatedLegs`, which
    // is a confident-looking `[]` while the legs are still loading or failed to load; posting a
    // confirm against that wrong balance is exactly the "posts, is refused, shows nothing" defect
    // this dialog exists to prevent, one layer up.
    const confirmDisabled =
        busy ||
        !isConfirmable(row, decision) ||
        (isLinkDecision && (bar.over || legsUnknown));

    /**
     * ⚠️ WHICH CARDS THIS ROW GETS IS MEMBERSHIP IN THE ONE PARTITION, NEVER A `direction` TEST
     * WRITTEN AGAIN HERE. `availableDecisionTargets` and `isConfirmable` read the same two lists,
     * so the dialog cannot offer a disposition the footer would then refuse -- which is exactly
     * what a credit row got before this: the whole debit-side surface on screen, a record it could
     * select, and a Confirm button that went dead with nothing saying why.
     *
     * ⚠️ THIS IS NOT `dimmed`. That prop lowers opacity and leaves every radio live, so it can
     * only ever soften a choice the row is not allowed to make. The debit-side blocks are ABSENT
     * on a credit row, not faded.
     */
    const allowed = availableDecisionTargets(row);
    /** The three ledgers travel together in the partition — the link list is offered, or it is not. */
    const canLinkPayment =
        allowed.includes("Project Payments") ||
        allowed.includes("Project Expenses") ||
        allowed.includes("Non Project Expenses");

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
                    {/* ⚠️ ABOVE `LinkPaymentSection`, ON PURPOSE (Task 7, ADR-0020 fan-out). A
                        `Partially Allocated` row already has money written against it; the reviewer
                        needs to see what is already settled BEFORE the picker offers what is left,
                        never the other way round. */}
                    {isPartiallyAllocated && (
                        <AlreadyAllocatedSection
                            legs={allocatedLegs}
                            loading={legsLoading}
                            error={legsError ? describeFrappeError(legsError, "couldn't load") : null}
                            onReverse={setReversingLeg}
                            busy={busy}
                        />
                    )}

                    {/* ⚠️ ONE SECTION, ALWAYS OPEN. It replaced three cards -- one per ledger --
                        that made the reviewer say WHICH KIND of record this was before they were
                        shown any. That is a question the bank statement does not answer: a transfer
                        to a vendor may have been raised as a Project Payment or booked as a Project
                        Expense, and the only way to find out was to open each card in turn. With
                        one list there is nothing to choose first, so there is no card to click. */}
                    {canLinkPayment && (
                        <LinkPaymentSection
                            row={row}
                            decision={decision}
                            onChange={onChange}
                            // ⚠️ DIMMED BY ANY "create something new" CHOICE, not just the expense
                            // one (B6, widened again at B7). The records stay legible so the
                            // reviewer can see what they are declining — hiding them would remove
                            // the evidence for the choice.
                            dimmed={
                                decision?.target === "new" ||
                                decision?.target === "inflow" ||
                                decision?.target === "receipt"
                            }
                            onSelectedRecordsChange={handleSelectedRecordsChange}
                            matcherCandidates={matcherCandidates}
                        />
                    )}

                    {/* ⚠️ THE BALANCE BAR (Task 7, ADR-0020 fan-out) -- BELOW the picker, ABOVE the
                        footer, exactly where the design mockup puts it. It sums already-allocated
                        legs PLUS the current ticks, live, client-side (`allocationBar`); the server
                        re-asserts under a row lock. Shown only once there is something to report --
                        an untouched Matched row with zero ticks has nothing to say here yet.
                        ⚠️ REVIEW FIX 1 -- `legsUnknown` ALSO OPENS THIS, deliberately BEFORE the
                        confident branch, so a Partially Allocated row never renders a `₹0
                        allocated` figure while its real legs are still loading or failed to load.
                        A neutral, honest "not yet known" beats a wrong number on a money screen. */}
                    {canLinkPayment && (legsUnknown || ticks > 0 || allocatedLegs.length > 0) && (
                        legsUnknown ? (
                            <div className="rounded-md border border-muted-foreground/20 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                                Balance not yet known — waiting on what this transfer has already
                                settled.
                            </div>
                        ) : (
                            <div
                                className={`rounded-md border px-3 py-2 text-sm tabular-nums ${
                                    bar.over
                                        ? "border-red-300 bg-red-50 text-red-600"
                                        : "border-muted-foreground/20 bg-muted/30 text-muted-foreground"
                                }`}
                            >
                                allocated {formatToRoundedIndianRupee(bar.allocated)} · left{" "}
                                {formatToRoundedIndianRupee(bar.remaining)}
                                {bar.over && (
                                    <span className="ml-2 font-medium">
                                        — untick something before confirming
                                    </span>
                                )}
                            </div>
                        )
                    )}

                    {/* ⚠️ THE ABSENCE HAS TO SAY WHICH RULE CAUSED IT (the D1 principle, applied to
                        a whole missing half of the dialog). A credit row that simply arrived
                        without the record list and the create-expense card reads as a dialog that
                        failed to load. This names the axis -- money in -- and points at the two
                        cards below that DO apply, so the reviewer's next move is on screen. */}
                    {!canLinkPayment && (
                        <p className="rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                            This transfer is money received, so it is recorded rather than settled
                            against an approved payable. Choose one of the options below — a project
                            inflow, or a non-project receipt.
                        </p>
                    )}

                    {SHOW_CREATE_NEW_EXPENSE && allowed.includes("new") && (
                        <TargetOption
                            target={CREATE_NEW_TARGET}
                            decision={decision}
                            onChange={onChange}
                            seed={() => ({
                                target: "new",
                                newExpense: decision?.newExpense ?? {
                                    doctype: PROJECT_EXPENSE,
                                    description: row.remarks || "",
                                },
                            })}
                        >
                            <NewExpenseForm row={row} decision={decision!} onChange={onChange} />
                        </TargetOption>
                    )}

                    {/* ⚠️ CREDIT ROWS ONLY. On a debit this option does not exist at all, rather
                        than existing and being refused: recording money that LEFT the account as
                        money that arrived is not a mistake worth offering. The server refuses it
                        twice regardless — `_guard_is_a_credit` and the service — so this is the
                        screen agreeing with a rule, not the rule itself.
                        ⚠️ THROUGH `isCreditRow`, WHICH TRIMS -- the inline `=== "Credit"` this
                        replaced did not, so a `" Credit "` row had both credit cards hidden here
                        while `isConfirmable` read it as a credit. The two disagreed about the same
                        row. There is ONE definition of this axis and this is it. */}
                    {isCreditRow(row) && (
                        <TargetOption
                            target={CREATE_INFLOW_TARGET}
                            decision={decision}
                            onChange={onChange}
                            seed={() => ({
                                target: "inflow",
                                newInflow: decision?.newInflow ?? {},
                            })}
                        >
                            <NewInflowForm row={row} decision={decision!} onChange={onChange} />
                        </TargetOption>
                    )}

                    {/* ⚠️ THE SECOND CREDIT CARD, UNDER THE SAME `isCreditRow` GATE (slice B7) — and
                        deliberately BELOW the inflow one. The two divide on whether a project is
                        behind the money, and a client receipt against a project is both the commoner
                        case and the one with a real home; this is where the rest go. A reviewer who
                        can name a project should meet that option first. */}
                    {isCreditRow(row) && (
                        <TargetOption
                            target={CREATE_RECEIPT_TARGET}
                            decision={decision}
                            onChange={onChange}
                            seed={() => ({
                                target: "receipt",
                                newReceipt: decision?.newReceipt ?? {
                                    description: row.remarks || "",
                                },
                            })}
                        >
                            <NewReceiptForm row={row} decision={decision!} onChange={onChange} />
                        </TargetOption>
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
                            <Button size="sm" onClick={handleConfirmClick} disabled={confirmDisabled}>
                                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {confirmLabel}
                            </Button>
                        </>
                    )}
                </footer>
            </DialogContent>

            <AmountOutsideWindowDialog
                block={blocked}
                // ⚠️ COMPUTED FROM THE PICKED RECORD, NOT FROM THE BLOCK. `SettleBlock` carries
                // amounts but not the LEDGER or the parent order, and both gates need those —
                // reading them off the block would offer to split an expense and to deduct on a PO.
                offer={partialShape}
                deduction={deductionOffer(picked, partialShape)}
                busy={busy}
                onClose={() => setBlocked(null)}
                onPartialSettle={async (intent) => {
                    if (!picked) return;
                    await onPartialSettle(picked, intent);
                    setBlocked(null);
                }}
            />

            <ReverseAllocationDialog
                leg={reversingLeg}
                busy={busy}
                onClose={() => setReversingLeg(null)}
                onConfirm={handleReverseConfirm}
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
    offer,
    deduction,
    onClose,
    onPartialSettle,
    busy,
}: {
    block: SettleBlock | null;
    /** Non-null when this pick may be settled in parts. See `partialOffer`. */
    offer: PartialOffer | null;
    /** Whether the shortfall may be recorded as TDS, and if not, why. See `deductionOffer`. */
    deduction: DeductionOffer;
    onClose: () => void;
    onPartialSettle: (intent: PartialIntent) => void;
    busy: boolean;
}) => {
    /**
     * ⚠️ NEITHER ANSWER IS PRE-SELECTED, AND NOTHING MAY EVER DEFAULT IT.
     *
     * A shortfall is either a part payment (the balance is still owed) or a deduction such as TDS
     * (nothing more is owed). NOTHING IN THIS SYSTEM CAN TELL THEM APART — `Project Payments.tds`
     * is blank until a human writes it at fulfilment. A default is the screen guessing, and the
     * wrong guess in the part-payment direction creates an approved payment that will never be
     * paid, inflating what the PO thinks it still owes, forever. That is worse than the dead end
     * this replaces, which is why the primary button stays disabled until a person answers.
     */
    const [intent, setIntent] = useState<PartialIntent | null>(null);

    // A different pick is a different question. Carrying an answer across would let a click meant
    // for one record settle another.
    useEffect(() => setIntent(null), [block?.recordName]);

    const canOffer = SHOW_PARTIAL_SETTLE && Boolean(block) && Boolean(offer);

    return (
        <AlertDialog open={Boolean(block)} onOpenChange={(open) => !open && onClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {canOffer
                            ? "This record is larger than the transfer"
                            : "This record cannot be settled here"}
                    </AlertDialogTitle>
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

                            {canOffer && offer ? (
                                <>
                                    <p>Which of these happened?</p>
                                    <PartialIntentChoice
                                        offer={offer}
                                        deduction={deduction}
                                        intent={intent}
                                        onChange={setIntent}
                                    />
                                    {/* ⚠️ A WARNING BESIDE THE CHOICE, NEVER A CHANGE TO IT. A part
                                        payment can land on 2% by coincidence, so this must not
                                        gate, default or pre-select anything -- it exists so
                                        somebody about to create a phantom balance looks twice. */}
                                    {offer.tdsLike && (
                                        <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-amber-900">
                                            {formatToIndianRupee(offer.remainder)} is{" "}
                                            {offer.impliedPct.toFixed(2)}% of the payment — a common
                                            TDS rate. Check before choosing a part payment.
                                        </p>
                                    )}
                                    {intent === INTENT_PART_PAYMENT && (
                                        // The confirmation names what will be CREATED, because
                                        // there is no undo from inside the import (ruling Q9).
                                        <p className="font-medium text-foreground">
                                            This settles{" "}
                                            {formatToIndianRupee(offer.keep)} and creates a new
                                            approved payment of{" "}
                                            {formatToIndianRupee(offer.remainder)} for the balance.
                                        </p>
                                    )}
                                    {intent === INTENT_DEDUCTION && (
                                        <p className="font-medium text-foreground">
                                            This records{" "}
                                            {formatToIndianRupee(deduction.tds)} as TDS on{" "}
                                            <span className="font-mono">{block?.recordName}</span>{" "}
                                            and marks it Paid. The payment amount stays{" "}
                                            {formatToIndianRupee(block?.recordAmount ?? 0)}.
                                        </p>
                                    )}
                                </>
                            ) : (
                                <>
                                    {/* ⚠️ THE REASON, NOT A GENERIC PARAGRAPH (slice D1). This
                                        branch used to print one fixed explanation for every
                                        blocked pick, and three of its claims had gone stale --
                                        see `settleBlockText`, which owns the wording and is the
                                        one place to change it. */}
                                    <p>{settleBlockText(block)}</p>
                                    {/* The reassurance is the point of the whole dialog. */}
                                    <p className="font-medium text-foreground">
                                        Nothing has been recorded, and nothing will be.
                                    </p>
                                    <p className="text-muted-foreground">
                                        Pick the record that matches this transfer instead.
                                    </p>
                                </>
                            )}
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={onClose}>
                        {canOffer ? "Cancel" : "Choose another record"}
                    </AlertDialogCancel>
                    {canOffer && (
                        // One button, whose LABEL and payload follow the answer. Two buttons would
                        // let a stray click take the other branch — and the two branches write
                        // opposite things: one carries a balance forward, the other declares that
                        // nothing more is owed.
                        <AlertDialogAction
                            disabled={intent === null || busy}
                            onClick={() => intent && onPartialSettle(intent)}
                        >
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {intent === INTENT_DEDUCTION
                                ? `Record ${formatToRoundedIndianRupee(deduction.tds)} TDS and settle`
                                : `Settle ${formatToRoundedIndianRupee(
                                      offer?.keep ?? 0
                                  )} and carry the rest`}
                        </AlertDialogAction>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

/**
 * The two readings of one shortfall, as a radio group.
 *
 * ⚠️ A REAL `<input type="radio">` IN A REAL RADIOGROUP, for the reason `SettleableRecordTable`
 * gives about the record picker: arrow-key navigation, the roving tab stop and the announced group
 * name all come free from the platform, and this is a control that decides where money goes.
 */
const PartialIntentChoice = ({
    offer,
    deduction,
    intent,
    onChange,
}: {
    offer: PartialOffer;
    deduction: DeductionOffer;
    intent: PartialIntent | null;
    onChange: (next: PartialIntent) => void;
}) => {
    const options = [
        {
            id: INTENT_PART_PAYMENT as PartialIntent,
            title: "A part payment",
            body: `${formatToIndianRupee(offer.keep)} left the bank. ${formatToIndianRupee(
                offer.remainder
            )} is still owed and stays approved.`,
            disabled: false,
            reason: "",
        },
        {
            id: INTENT_DEDUCTION as PartialIntent,
            title: "A deduction (TDS or similar)",
            body: `The payment was settled in full and ${formatToIndianRupee(
                offer.remainder
            )} was withheld. Nothing more is owed.`,
            // ⚠️ DISABLED, NEVER HIDDEN, AND THIS IS THE SAFETY ARGUMENT OF THE WHOLE SLICE.
            // A reviewer looking at a real 2% TDS on a materials PO, offered only "part payment",
            // will take it — and that creates an approved balance for money nobody owes, which is
            // precisely the phantom the partial-settlement slice was built to prevent. Removing the
            // option is what would cause that; showing it greyed with its reason is what stops it.
            disabled: !deduction.eligible,
            reason: deductionRefusalText(deduction),
        },
    ];

    return (
        <div
            role="radiogroup"
            aria-label="What happened to the rest of this payment?"
            className="space-y-2"
        >
            {options.map((option) => (
                <label
                    key={option.id}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 transition-colors ${
                        option.disabled
                            ? "cursor-not-allowed border-muted-foreground/20 opacity-60"
                            : intent === option.id
                              ? "cursor-pointer border-primary bg-primary/5"
                              : "cursor-pointer border-muted-foreground/20 hover:bg-muted/50"
                    }`}
                >
                    <input
                        type="radio"
                        name="partial-intent"
                        className="mt-1 h-3.5 w-3.5 accent-primary disabled:cursor-not-allowed"
                        checked={intent === option.id}
                        disabled={option.disabled}
                        onChange={() => onChange(option.id)}
                    />
                    <span>
                        <span className="block font-medium text-foreground">{option.title}</span>
                        <span className="block text-xs text-muted-foreground">{option.body}</span>
                        {/* The reason travels WITH the disabled option. A greyed control with no
                            explanation is the dead-button complaint this dialog already exists to
                            answer once. */}
                        {option.disabled && option.reason && (
                            <span className="mt-0.5 block text-xs font-medium text-amber-700">
                                {option.reason}
                            </span>
                        )}
                    </span>
                </label>
            ))}
        </div>
    );
};

/*
 * ⚠️ `WhyThisSuggestion` WAS DELETED HERE (slice D2, owner 2026-08-12), and this note is what
 * stops it being rebuilt by someone reading the fetch above and wondering where the second
 * consumer went.
 *
 * It was a bulleted "Why the system suggests this" card at the top of the body, carrying at most
 * three sentences: the bank reference not being on any payment yet, the row's stored
 * `outcome_note`, and "Only approved records are ever offered here." All three predate the record
 * TABLE. Since slice N2 the table prints a per-row similarity reason and since N3 it marks the
 * rows the match run actually found, so the card restated -- one level less precisely, and for the
 * whole row rather than per record -- what the reviewer can now read against each candidate.
 *
 * It also cost vertical space the dialog does not have: it sat above a 420px table with "Clear
 * selection" below it, which is how that control ended up under the fold.
 *
 * NOTHING SERVER-SIDE CHANGED. `outcome_note`, `related_payments` and `bank_reference_no` are all
 * still written, still returned, and still read elsewhere -- the Skipped tab and the row table use
 * them. Only this one rendering is gone.
 */

/**
 * Settled legs already on this transfer (Task 7, ADR-0020 fan-out) -- rendered above
 * `LinkPaymentSection`, so the reviewer sees what is already settled before the picker offers what
 * is left.
 *
 * ⚠️ ONLY A `Project Payments` LEG OFFERS `Reverse`. `reverse_allocation` throws on any other
 * doctype ("Only a Project Payments allocation can be reversed here") -- the button is WITHHELD
 * rather than offered and refused, the same discipline `allocate_row`'s payments-only scope holds.
 */
const AlreadyAllocatedSection = ({
    legs,
    loading,
    error,
    onReverse,
    busy,
}: {
    legs: AllocatedLeg[];
    /** ⚠️ REVIEW FIX 1 -- an explicit loading state, so an empty `legs` array while this is still
     *  in flight never renders as "nothing to report" (a `Partially Allocated` row always has at
     *  least one leg). */
    loading: boolean;
    /** The fetch's own refusal, already worded via `describeFrappeError`, or `null`. */
    error: string | null;
    onReverse: (leg: AllocatedLeg) => void;
    busy: boolean;
}) => {
    if (loading) {
        return (
            <div className="rounded-md border border-muted-foreground/20 bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground">
                Loading what this transfer has already settled…
            </div>
        );
    }
    if (error) {
        return (
            <div className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                Could not load what this transfer has already settled ({error}). The balance below
                may be wrong until this loads — re-open this row before confirming anything.
            </div>
        );
    }
    if (!legs.length) return null;
    return (
        <div className="rounded-md border border-sky-600/30 bg-sky-50/40">
            <div className="px-3 py-2.5">
                <p className="text-sm font-medium text-sky-900">Already allocated</p>
                <p className="text-xs text-muted-foreground">
                    money this transfer has already settled, in an earlier sitting
                </p>
            </div>
            <div className="divide-y border-t">
                {legs.map((leg) => (
                    <div
                        key={leg.name}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                        <div className="min-w-0">
                            <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/70">
                                {ledgerLabel(leg.target_doctype)}
                            </span>
                            <span className="ml-1.5 font-mono">{leg.target_name}</span>
                            <span className="ml-1.5 tabular-nums text-muted-foreground">
                                {formatToRoundedIndianRupee(leg.target_amount)}
                            </span>
                            {leg.matched_at && (
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                    {formatDate(leg.matched_at.split(/[ T]/)[0])}
                                </span>
                            )}
                        </div>
                        {leg.target_doctype === "Project Payments" && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={busy}
                                onClick={() => onReverse(leg)}
                            >
                                Reverse
                            </Button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

/**
 * The small confirm behind `Reverse` -- a REQUIRED typed reason, the same standard `skip_row`
 * already holds: a decision that moves money has to say why.
 */
const ReverseAllocationDialog = ({
    leg,
    busy,
    onClose,
    onConfirm,
}: {
    leg: AllocatedLeg | null;
    busy: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void;
}) => {
    const [reason, setReason] = useState("");

    // A different leg is a different question -- carrying a reason across would attach one
    // reversal's explanation to another.
    useEffect(() => setReason(""), [leg?.name]);

    return (
        <AlertDialog open={Boolean(leg)} onOpenChange={(open) => !open && onClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Reverse this allocation?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-3 text-sm">
                            <p>
                                <span className="font-mono">{leg?.target_name}</span> (
                                {formatToIndianRupee(leg?.target_amount ?? 0)}) goes back to
                                Approved. This transfer's balance rises by the same amount, and the
                                record can be allocated again -- here or on a different transfer.
                            </p>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Reason (required)</Label>
                                <Input
                                    autoFocus
                                    value={reason}
                                    placeholder="Why is this allocation being reversed?"
                                    onChange={(e) => setReason(e.target.value)}
                                />
                            </div>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={!reason.trim() || busy}
                        onClick={() => onConfirm(reason.trim())}
                    >
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Reverse
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

/**
 * The FIRST way to resolve a row: find the approved record this transfer paid, in any ledger.
 * ("The one way" until slice B5 put "Create a new expense" back beneath it.)
 *
 * ⚠️ IT IS A SECTION, NOT A SELECTABLE CARD, AND IT STAYS ONE NOW THAT "Create a new expense" IS
 * BACK (slice B5). The original reason was that it was the only option; the reason it survives a
 * second option is different and stronger -- asking for a click before showing the list would put a
 * step in front of the question a reviewer should answer FIRST, which is "does an approved record
 * for this transfer already exist". Creating a duplicate expense beside a payment that was already
 * raised is the expensive mistake here, so the list is shown unasked and the create card sits below
 * it. Choosing the create card DIMS this section rather than hiding it: the records stay legible so
 * the reviewer can see what they are declining.
 */
const LinkPaymentSection = ({
    row,
    decision,
    onChange,
    dimmed,
    onSelectedRecordsChange,
    matcherCandidates,
}: {
    row: OutflowImportRow;
    decision: RowDecision | undefined;
    onChange: (decision: RowDecision) => void;
    dimmed: boolean;
    // Passed straight through to `RecordPicker`, which is where the candidate list -- and so the
    // server's `suggested` flag -- actually lives.
    onSelectedRecordsChange: (records: SettleableRecord[]) => void;
    /** `recordKey`s the match run found for this transfer (slice N3). */
    matcherCandidates: ReadonlySet<string>;
}) => (
    <div className={`rounded-md border border-muted-foreground/20 ${dimmed ? "opacity-40" : ""}`}>
        <div className="px-3 py-2.5">
            <p className="text-sm font-medium">Link payment</p>
            <p className="text-xs text-muted-foreground">
                {/* ⚠️ "one or more", not "the" (Task 7, ADR-0020 fan-out) -- one bank transfer may
                    now settle several approved Project Payments. */}
                the approved record(s) this transfer paid — payment or expense
            </p>
        </div>
        <div className="border-t px-3 py-3">
            <RecordPicker
                row={row}
                decision={decision ?? {}}
                onChange={onChange}
                onSelectedRecordsChange={onSelectedRecordsChange}
                matcherCandidates={matcherCandidates}
            />
        </div>
    </div>
);

/**
 * One "create something new" card: a radio header and, once chosen, its form in place.
 *
 * ⚠️ IT USED TO HARD-CODE `target: "new"` AND RENDER `NewExpenseForm` ITSELF, which was correct
 * while there was exactly one such card. Slice B6 adds a second (a project inflow), and a copy of
 * this component would be two cards free to drift in how they look and how they seed a decision.
 * The SEED is a prop rather than derived from `target.id` because only the caller knows what a
 * blank form for its own kind looks like.
 *
 * ⚠️ `children` IS CREATED EAGERLY AND RENDERED ONLY WHEN CHOSEN, which is why a call site may pass
 * `decision!` into a form that would not tolerate `undefined`: React never invokes the component
 * while the card is collapsed.
 */
const TargetOption = ({
    target,
    decision,
    onChange,
    seed,
    children,
}: {
    target: { id: DecisionTarget; label: string; hint: string };
    decision: RowDecision | undefined;
    onChange: (decision: RowDecision) => void;
    /** The decision to write when this card is picked. */
    seed: () => RowDecision;
    /** The form, rendered inside the card once it is chosen. */
    children: ReactNode;
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
                onClick={() => onChange(seed())}
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

            {chosen && <div className="border-t px-3 py-3">{children}</div>}
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
    onSelectedRecordsChange,
    matcherCandidates,
}: {
    row: OutflowImportRow;
    decision: RowDecision;
    onChange: (decision: RowDecision) => void;
    onSelectedRecordsChange: (records: SettleableRecord[]) => void;
    matcherCandidates: ReadonlySet<string>;
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

    // ⚠️ LOOKED UP IN THE WHOLE POOL, NOT THE FILTERED VIEW (ADR-0020 fan-out: now every TICKED
    // record, not just one). A reviewer who ticks a record and then narrows the list would
    // otherwise watch their own choice become invisible AND unconfirmable -- the footer reads the
    // selection from here, so a filtered-out pick would disable Confirm with nothing on screen
    // explaining why. `recordKey` folds doctype into the identity, so this is a plain Set lookup
    // rather than a bare-name match, which is not unique across three ledgers.
    const linkTargets = decision.linkTargets;
    const selectedRecords = useMemo(
        () => (linkTargets ? pool.filter((o) => linkTargets.has(recordKey(o))) : []),
        [pool, linkTargets]
    );
    const hiddenSelectedCount = selectedRecords.filter((r) => !options.includes(r)).length;

    /**
     * ⚠️ REVIEW FIX 4 -- STATE THE RULE WHERE IT LIVES, BEFORE THE CLICK. `allocate_row` hard-
     * refuses any fan-out (2+ targets, or a single tick on an already `Partially Allocated` row)
     * that contains a non-`Project Payments` record; `tickAllowedForFanOut` mirrors that exactly.
     * Computed over `options` (the VISIBLE rows), not the whole pool -- a hidden row cannot be
     * disabled on screen anyway.
     */
    const alreadyTickedDoctypes = useMemo(
        () => selectedRecords.map((r) => r.target_doctype),
        [selectedRecords]
    );
    const disabledKeys = useMemo(() => {
        const disabled = new Set<string>();
        for (const record of options) {
            const key = recordKey(record);
            if (linkTargets?.has(key)) continue; // never disable an already-ticked row
            if (!tickAllowedForFanOut(record.target_doctype, alreadyTickedDoctypes, row.row_status)) {
                disabled.add(key);
            }
        }
        return disabled;
    }, [options, linkTargets, alreadyTickedDoctypes, row.row_status]);

    // ⚠️ REPORTED UPWARD BECAUSE THE FOOTER HAS TO KNOW WHAT WAS PICKED. The candidate list, and
    // therefore the server's `suggested` flag, lives only in here -- the page's `RowDecision`
    // carries doctype+name pairs and nothing about a record's amount. Without this the balance bar
    // and the amount-window detour cannot tell a settleable pick from one the server will refuse,
    // which is exactly how it came to post, be refused, and show nothing.
    useEffect(() => {
        onSelectedRecordsChange(selectedRecords);
    }, [selectedRecords, onSelectedRecordsChange]);

    const candidateLine = matcherCandidateLine(matcherCandidates.size);

    return (
        <div className="space-y-3">
            {/* ⚠️ WHAT THE MATCH RUN FOUND -- NOT WHAT MAY BE PICKED (slice N3). `get_row_candidates`
                re-runs the match live and skips the four global passes, so one of these may already
                be claimed by another open row. The sentence states provenance for exactly that
                reason; promising availability would surface as a confirm that fails with
                `AlreadyPaidError` after the click. It is now the ONLY count on screen: the stored
                note it used to stand down (slice N3) was rendered by `WhyThisSuggestion`, which
                slice D2 deleted, so nothing else can disagree with this line. */}
            {candidateLine && (
                <p className="rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-xs">
                    {candidateLine}
                </p>
            )}

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
                    matcherCandidates={matcherCandidates}
                    sort={sort}
                    onSort={handleSort}
                    filters={filters}
                    facets={facets}
                    onFiltersChange={setFilters}
                    selected={linkTargets ?? EMPTY_LINK_TARGETS}
                    // ⚠️ REVIEW FIX 4 -- WITHHELD, NOT OFFERED-AND-REFUSED (same discipline
                    // `AlreadyAllocatedSection`'s `Reverse` button already holds). A disabled
                    // checkbox here means ticking it would make `allocate_row` throw.
                    disabledKeys={disabledKeys}
                    disabledReason="Ticking this would mix a non-payment record into a multi-record allocation, which the server refuses. Untick the others first, or link this one alone."
                    // ⚠️ TOGGLES ONE ENTRY IN THE SET, NEVER REPLACES IT (ADR-0020 fan-out). The
                    // ledger comes from the RECORD -- each `recordKey` already carries its own
                    // doctype -- and `target` is cleared here so a leftover "create something new"
                    // choice can never survive a tick (see `isConfirmable`'s comment on why `target`
                    // is no longer load-bearing for this branch).
                    onToggle={(value) => {
                        if (!parseRecordKey(value)) return;
                        const next = new Set(decision.linkTargets ?? []);
                        if (next.has(value)) {
                            next.delete(value);
                        } else {
                            // Belt-and-braces (review fix 4): the checkbox is already disabled for
                            // this case, but a stale render must not let the click through either.
                            if (disabledKeys.has(value)) return;
                            next.add(value);
                        }
                        onChange({ ...decision, target: undefined, linkTargets: next });
                    }}
                />
            )}

            {/* A ticked record is still ticked and still confirmable -- but it is no longer on
                screen, so say so rather than let the verdict lines below describe rows the reviewer
                cannot see. */}
            {hiddenSelectedCount > 0 && (
                <p className="text-xs text-amber-700">
                    {hiddenSelectedCount === 1
                        ? "One of your ticked records is hidden by the current filters."
                        : `${hiddenSelectedCount} of your ticked records are hidden by the current filters.`}
                </p>
            )}

            {selectedRecords.map((record) => (
                <RecordVerdict key={recordKey(record)} record={record} bankAmount={row.amount} />
            ))}

            {/* ⚠️ CLEARS EVERY TICK, NOT JUST ONE (ADR-0020 fan-out) -- a reviewer who ticked the
                wrong set needs one way back to undecided rather than unticking each box in turn.
                Individual boxes stay reachable in the table above for a partial correction. */}
            {linkTargets && linkTargets.size > 0 && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => onChange({ ...decision, target: undefined, linkTargets: new Set() })}
                >
                    <X className="mr-1 h-3 w-3" />
                    Clear selection
                </Button>
            )}
        </div>
    );
};

/** A stable empty set -- passed when a decision has no `linkTargets` yet, so the table's own
 *  `selected` prop never mints a fresh identity per render. */
const EMPTY_LINK_TARGETS: ReadonlySet<string> = new Set();

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
    // `document_name` is the ORDER this payment is against -- the app's own route (slice E3).
    const link = settlementLink(record.target_doctype, record.name, false, record.document_name);
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
                            {formatToIndianRupee(Math.abs(verdict.difference))} — {AMOUNT_GAP_HINT}
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

/**
 * The whole new-INFLOW form, in place (slice B6). Money received, recorded against a project.
 *
 * ⚠️ THE CUSTOMER IS SHOWN, NOT CHOSEN. It is a fact about the project — the existing
 * `NewInflowPayment.tsx` derives it exactly this way — and the server re-reads it and refuses a
 * value that disagrees. Offering a customer picker would let a reviewer state something the write
 * path is going to overrule.
 *
 * ⚠️ A PROJECT WITH NO CUSTOMER IS SHOWN WITH THE REASON, NOT SILENTLY DROPPED. Such a project
 * cannot receive money (owner ruling Q13, enforced server-side), and `isConfirmable` already keeps
 * Confirm disabled because `customer` stays blank — so this line is what turns a dead button into
 * an answer.
 *
 * ⚠️ CEO HOLD DOES **NOT** DISABLE A PROJECT HERE, and that is the deliberate difference from
 * `NewExpenseForm`. CEO Hold blocks spending; an inflow is money ARRIVING, and recording one is
 * exactly what shrinks the cashflow gap that caused the hold. The existing inflow dialog does not
 * block held projects either.
 *
 * ⚠️ Amount, payment date and reference are READ-ONLY from the bank row — the statement is the
 * source of truth for all three, and the server reads them off the staged row rather than the
 * payload.
 */
const NewInflowForm = ({
    row,
    decision,
    onChange,
}: {
    row: OutflowImportRow;
    decision: RowDecision;
    onChange: (decision: RowDecision) => void;
}) => {
    const form = decision.newInflow ?? {};

    const { data: projects } = useFrappeGetDocList<{
        name: string;
        project_name: string;
        customer?: string;
    }>(
        "Projects",
        {
            fields: ["name", "project_name", "customer"],
            filters: [["tendering_status", "=", "Won"]],
            limit: 0,
            orderBy: { field: "project_name", order: "asc" },
        },
        "outflow-inflow-won-projects"
    );

    // ⚠️ ONE ENDPOINT, GATED BY THE IMPORT'S OWN ACCESS RULE, ANSWERING BOTH QUESTIONS — the
    // customer and the project's invoices. It is the SAME read the write path performs, so the
    // screen cannot show a customer the server then disagrees with.
    const { data: contextData, isLoading: contextLoading } = useFrappeGetCall<{
        message: {
            customer: string | null;
            customer_name: string;
            invoices: { name: string; invoice_no?: string; amount?: number }[];
        };
    }>(
        "nirmaan_stack.api.outflow_import.inflows.get_inflow_context",
        { project: form.project },
        form.project ? `inflow-context-${form.project}` : null
    );
    const context = contextData?.message;

    const patch = (over: Partial<NonNullable<RowDecision["newInflow"]>>) =>
        onChange({ ...decision, newInflow: { ...form, ...over } });

    // The derived customer is folded into the decision as soon as it lands, because
    // `isConfirmable` gates on it — a project whose customer has not arrived yet is not confirmable,
    // and a project with none never becomes so.
    useEffect(() => {
        if (!form.project || contextLoading) return;
        const derived = context?.customer ?? null;
        if (derived === (form.customer ?? null)) return;
        onChange({ ...decision, newInflow: { ...form, customer: derived } });
        // `decision` and `form` are recreated on every keystroke elsewhere in the dialog; keying on
        // the two values that actually decide this is what stops the effect from looping.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.project, context?.customer, contextLoading]);

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Project</Label>
                <Select
                    value={form.project ?? ""}
                    // Changing the project changes who the money is from and which invoices exist,
                    // so both are cleared rather than carried onto a project they do not belong to.
                    onValueChange={(value) =>
                        patch({ project: value, customer: null, invoice: null })
                    }
                >
                    <SelectTrigger className="h-9">
                        <SelectValue placeholder="Choose a project…" />
                    </SelectTrigger>
                    <SelectContent>
                        {(projects ?? []).map((project) => (
                            <SelectItem key={project.name} value={project.name}>
                                {project.project_name}
                                {!project.customer && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        — no customer, cannot receive money
                                    </span>
                                )}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <ReadOnlyField
                label="Customer"
                value={
                    !form.project
                        ? "—"
                        : contextLoading
                          ? "Loading…"
                          : context?.customer
                            ? context.customer_name || context.customer
                            : "This project has no customer"
                }
            />

            <div className="space-y-1.5">
                <Label className="text-xs">Invoice (optional)</Label>
                <Select
                    value={form.invoice ?? ""}
                    onValueChange={(value) => patch({ invoice: value })}
                    disabled={!form.project || !(context?.invoices ?? []).length}
                >
                    <SelectTrigger className="h-9">
                        <SelectValue
                            placeholder={
                                !form.project
                                    ? "Choose a project first…"
                                    : (context?.invoices ?? []).length
                                      ? "Not against an invoice"
                                      : "No invoices on this project"
                            }
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {(context?.invoices ?? []).map((invoice) => (
                            <SelectItem key={invoice.name} value={invoice.name}>
                                {invoice.invoice_no || invoice.name}
                                {invoice.amount
                                    ? ` — ${formatToRoundedIndianRupee(invoice.amount)}`
                                    : ""}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {/* ⚠️ CLEARING IS A SEPARATE ACT FROM CHOOSING -- the same Radix limitation
                    `RecordPicker` documents: every item sets a value, so without this a reviewer who
                    linked the wrong invoice could only reach a different wrong one. The invoice is
                    OPTIONAL, which makes "none" a real answer rather than an undecided state. */}
                {form.invoice && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => patch({ invoice: null })}
                    >
                        <X className="mr-1 h-3 w-3" />
                        Not against an invoice
                    </Button>
                )}
            </div>

            {form.project && !contextLoading && !context?.customer && (
                <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:col-span-2">
                    This project has no customer, so money received against it cannot be recorded.
                    Add the customer to the project first.
                </p>
            )}

            {/* Read-only from the bank row -- the statement is the source of truth. */}
            <ReadOnlyField label="Amount received" value={formatToRoundedIndianRupee(row.amount)} />
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

/**
 * The whole non-project RECEIPT form, in place (slice B7). Money received that names no project.
 *
 * ⚠️ THE SIGN IS SHOWN, IN WORDS AND IN THE FIGURE, AND THAT IS THE POINT OF THIS FORM. The
 * reviewer is recording money that ARRIVED into a doctype called *Expenses* — the cost the owner
 * accepted when they ruled that a non-project receipt is a NEGATIVE `Non Project Expense` rather
 * than a new doctype (Q3; ADR-0016 decision 3, risk R3). The one failure this screen must never
 * produce is a reviewer seeing the positive figure the bank printed, confirming, and finding a
 * negative row they did not expect. So: the card header says "negative expense" before it is even
 * opened, the amount field is labelled "Will be stored as" and shows the negated figure, and a
 * line beneath explains why in the app's own terms.
 *
 * ⚠️ GREEN, NOT RED, AND THE APP ALREADY DECIDED THAT. `nonProjectExpensesColumns.tsx` renders a
 * negative non-project expense GREEN — money coming back is good news on that screen. Colouring it
 * red here to signal "careful, this is negative" would teach the reviewer the opposite of what the
 * list they are writing into will show them.
 *
 * ⚠️ NO PROJECT FIELD, AND ITS ABSENCE IS THE WHOLE DISTINCTION. A receipt with a project behind it
 * is an INFLOW and belongs in the card above; `Non Project Expenses` has no project column at all
 * (nor a vendor one, which is why the payer lands in the description server-side).
 *
 * ⚠️ THE TYPE LIST IS THE EXISTING `get_expense_types("Non Project Expenses")` — the same
 * `non_project = 1` query the create-expense form uses, and the same one the server's
 * `_assert_type_scope` checks against, so the form cannot offer a type the write path refuses.
 * ⚠️ Amount, payment date and reference are READ-ONLY from the bank row.
 */
const NewReceiptForm = ({
    row,
    decision,
    onChange,
}: {
    row: OutflowImportRow;
    decision: RowDecision;
    onChange: (decision: RowDecision) => void;
}) => {
    const form = decision.newReceipt ?? {};

    const { data: typesData } = useFrappeGetCall<{ message: { name: string }[] }>(
        "nirmaan_stack.api.outflow_import.expenses.get_expense_types",
        { doctype: NON_PROJECT_EXPENSE },
        // The SAME swr key the create-expense form uses for this doctype, on purpose: one cached
        // list, and no way for the two forms to show different types.
        `expense-types-${NON_PROJECT_EXPENSE}`
    );

    const patch = (over: Partial<NonNullable<RowDecision["newReceipt"]>>) =>
        onChange({ ...decision, newReceipt: { ...form, ...over } });

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
                <Label className="text-xs">Receipt type</Label>
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

            {/* ⚠️ THE SIGN, SAID PLAINLY AND IN GREEN -- see the component note. The label is "Will
                be stored as" rather than "Amount", because the number beside it is NOT the number
                on the statement: the bank printed a positive credit and this ledger will hold its
                negative. `receiptStoredAmount` is the same rule the server applies, so the two can
                never disagree about what the reviewer is about to write. */}
            <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Will be stored as</Label>
                <Input
                    className="h-9 bg-muted/50 font-medium text-green-700 dark:text-green-500"
                    value={`− ${formatToRoundedIndianRupee(
                        Math.abs(receiptStoredAmount(row.amount))
                    )}`}
                    readOnly
                    tabIndex={-1}
                />
            </div>

            <p className="rounded-md border border-green-600/30 bg-green-50 px-3 py-2 text-xs text-green-900 dark:bg-green-950/30 dark:text-green-200 sm:col-span-2">
                {formatToRoundedIndianRupee(row.amount)} came IN. There is no non-project inflow
                record in Nirmaan, so this is filed as a non-project expense with a negative amount —
                the same way a refund is recorded. It will show in green in the Non-Project Expenses
                list and reduces that total rather than adding to it.
            </p>

            <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Description</Label>
                <Input
                    className="h-9"
                    value={form.description ?? ""}
                    placeholder="What was this receipt for?"
                    onChange={(e) => patch({ description: e.target.value })}
                />
            </div>

            {/* Read-only from the bank row -- the statement is the source of truth. */}
            <ReadOnlyField
                label="Amount received (per statement)"
                value={formatToRoundedIndianRupee(row.amount)}
            />
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
