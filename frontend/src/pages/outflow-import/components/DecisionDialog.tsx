// src/pages/outflow-import/components/DecisionDialog.tsx

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import {
    AlertTriangle,
    Check,
    ChevronsUpDown,
    ExternalLink,
    Info,
    Loader2,
    SkipForward,
    X,
} from "lucide-react";

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
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
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
    SETTLE_MODE_HINT,
    SETTLE_MODE_LABEL,
    allocateButtonLabel,
    allocationBar,
    chooseSettleEndpoint,
    confirmGate,
    effectiveSettleMode,
    settleModeLocked,
    settlePickerFor,
    type AllocationBar,
    type SettleMode,
    matcherMarksVisible,
    pickerComparisonAmount,
} from "../allocationView";
import {
    descriptionRequired,
    INFLOW_TYPES,
} from "@/pages/non-project-inflows/nonProjectInflowModel";
import { ROW_PARTIALLY_ALLOCATED, canSkipByHand, canUndoOutflow } from "../outflowImportStatus";
import { useUserData } from "@/hooks/useUserData";
import type { UnreconcileResult } from "../unreconcileView";
import { UnreconcilePanel } from "./UnreconcileDialog";
import {
    INTENT_PART_PAYMENT,
    amountGapHint,
    amountVerdict,
    availableDecisionTargets,
    candidateKeySet,
    describeFrappeError,
    decisionLinkKeys,
    isConfirmable,
    isCreateTarget,
    isCreditRow,
    ledgerLabel,
    matcherCandidateLine,
    parseRecordKey,
    partialOffer,
    nonProjectInflowDescriptionSeed,
    recordKey,
    referenceValue,
    settlementLink,
    settleBlockRemedy,
    settleBlockText,
    settleBlocker,
    suggestRefundVendor,
    orderPaymentsHref,
    tickAllowedForFanOut,
    withRefundPick,
    toggleRefundAgainst,
    isRefundAgainst,
    toggleRefundAllocation,
    setRefundAllocationAmount,
    refundAllocationTotals,
    refundAllocationProblem,
    refundMiscAmount,
    REFUND_AGAINST_OPTIONS,
    REFUND_DOCUMENT_TYPES,
    REFUND_MISC_EXPENSE,
    type RefundAllocation,
    type RefundDocumentType,
    type VendorRefundForm,
    type DecisionTarget,
    type MatcherCandidate,
    type PartialIntent,
    type PartialOffer,
    type RowDecision,
    type SettleBlock,
    type SettleableRecord,
} from "../outflowTableModel";
import {
    EMPTY_FILTERS,
    SPLIT_PAYMENTS_ONLY_NOTE,
    facetValues,
    hasActiveFilters,
    nextSortState,
    recordPoolMessage,
    recordPoolState,
    splitCandidates,
    visibleRecords,
    type RecordFilters,
    type RecordSort,
    type RecordSortColumn,
} from "../recordPickerView";
import { FanOutRecordTable } from "./FanOutRecordTable";
import { decideAfterLinking, decideConfirmLabel, decideTickedAmount } from "../linkLinesView";
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

// ⚠️ `SHOW_SKIP_ROW` IS GONE (#1273, ADR-0022), reversing the 2026-08-10 ruling that hid manual skip
// and ADR-0016 R6. Skip is back as the "Nothing to link?" box at the BOTTOM of the body, under a
// divider -- below every link and create option, so linking stays the obvious first choice -- and only
// for Admin / Accountant Lead on an open, non-Cashbook line (`canSkipByHand`). The server re-checks
// all of it in `review.skip_row`.

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
 * The SECOND thing a credit row can become (#1266): money in that belongs to no project, recorded
 * as a `Non Project Inflow` (ADR-0016 Amendment A-D2). It replaced the B7 "non-project receipt"
 * card, which stored the credit as a NEGATIVE non-project expense. A credit row now offers exactly
 * this card and the project inflow card above it.
 */
const CREATE_NON_PROJECT_INFLOW_TARGET: { id: DecisionTarget; label: string; hint: string } = {
    id: "nonProjectInflow",
    label: "Create a non-project inflow",
    hint: "money received against no project — interest, an FD closure, a loan, or other",
};

/**
 * The THIRD thing a credit row can become: money a VENDOR paid back, recorded as one `Vendor Refund`
 * per paid PO or WO it is against, plus one Misc. Expense for the rest. No payment or expense is created.
 */
const CREATE_VENDOR_REFUND_TARGET: { id: DecisionTarget; label: string; hint: string } = {
    id: "vendorRefund",
    label: "Create a vendor refund",
    hint: "money a vendor paid back — one vendor refund per PO, WO or misc. expense it is against",
};

interface Props {
    row: OutflowImportRow | null;
    decision: RowDecision | undefined;
    onChange: (decision: RowDecision) => void;
    /**
     * The mode the reviewer has CHOSEN, before the row's own status has had its say (issue #1241).
     *
     * ⚠️ IT LIVES ON THE PAGE, NOT IN HERE, AND THAT IS DELIBERATE. The page is what actually calls
     * `settleOne`, so the mode has to be readable at confirm time; holding it in the dialog would
     * mean shipping it back up on every change and hoping the two copies agreed at the moment it
     * mattered. The page also owns "mode is not remembered between rows" -- it resets on the row
     * that is open, which is state only the page has.
     */
    settleMode: SettleMode;
    /**
     * ⚠️ IT MUST CLEAR THE TICKS (ADR-0020 B3). The two modes store the pick in DIFFERENT fields
     * (`linkTo` vs `linkTargets`) and mean different things by it, so carrying one across is how a
     * transfer gets split by accident. The page does the clearing, because it owns the decision.
     */
    onSettleModeChange: (next: SettleMode) => void;
    onConfirm: () => Promise<void> | void;
    /**
     * Settle PART of the picked record, carrying the balance forward (slice PS).
     *
     * ⚠️ THE INTENT IS PASSED UP RATHER THAN ASSUMED. The endpoint requires it and has no default,
     * so the declaration travels with the call. It has ONE legal value since slice TD was removed —
     * the reviewer no longer chooses between two readings — but the endpoint still rejects a missing
     * or unrecognised intent, which is what the parameter is for.
     */
    onPartialSettle: (record: SettleableRecord, intent: PartialIntent) => Promise<void> | void;
    /**
     * Ask the server whether a partial settle of `record` would be refused outright, BEFORE the
     * "carry the rest?" question opens (#1269). Resolves `true` when the question may be asked; on a
     * refusal the page shows the server's sentence and resolves `false`.
     */
    onCheckPartialSettle: (record: SettleableRecord) => Promise<boolean>;
    /**
     * An undo from the "Already allocated" section landed (#1275). The section is the shared
     * `UnreconcilePanel`, which posts `unreconcile_row` itself and hands the response up, so the page
     * can close this dialog, say what came off and refresh.
     */
    onUnreconciled: (result: UnreconcileResult) => Promise<void> | void;
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
    settleMode,
    onSettleModeChange,
    onConfirm,
    onPartialSettle,
    onCheckPartialSettle,
    onUnreconciled,
    onSkip,
    onRerun,
    onClose,
    busy = false,
    error = null,
    onDismissError,
}: Props) => {
    const { role, user_id } = useUserData();
    // ⚠️ PLURAL SINCE TASK 7 (ADR-0020 fan-out) -- the picker is now a checkbox group. `picked`
    // below is the SINGLE-record derivation the pre-existing amount-window / partial-settle detour
    // needs; that detour is about ONE record against the whole transfer and does not generalise to
    // a tick-set, which the balance bar governs instead.
    const [pickedRecords, setPickedRecords] = useState<SettleableRecord[]>([]);
    const picked = pickedRecords.length === 1 ? pickedRecords[0] : null;
    const [blocked, setBlocked] = useState<SettleBlock | null>(null);

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
    /**
     * ⚠️ SUPPRESSED ON A PARTLY-ALLOCATED ROW (issue #1243, AC6).
     *
     * `get_row_candidates` re-runs the matcher LIVE on every dialog open, and it has NO
     * frozen-status guard. Partly-allocated rows are frozen from matching everywhere else, so on
     * such a row this call answers a question about the WHOLE transfer that nobody asked: it marks
     * records that can no longer fit in what is left, and — worse — it marks records ALREADY SETTLED
     * AS LEGS OF THIS VERY ROW as though they were still on offer.
     *
     * ⚠️ SUPPRESSED, NEVER MADE REMAINDER-AWARE (owner ruling). Teaching the live re-match about the
     * remainder would push RANKING into the matcher, and this feature's standing fence is that the
     * browse ranking must never reach anything that settles (`similarity.py`'s first invariant, with
     * a test pinning the absent import both ways). The marker is a screen affordance, so the
     * correction belongs on the screen.
     *
     * ⚠️ THE COUNT SENTENCE GOES WITH IT, AND THAT IS WHY THIS IS ONE VARIABLE. `matcherCandidateLine`
     * reads `.size` from exactly this set, so an empty set silences the sentence too. Suppressing the
     * marks while leaving "6 approved records match this transfer … pick which one it settled" on
     * screen would recreate the slice-N3 defect the marks were built to fix: an instruction pointing
     * at nothing.
     */
    const matcherCandidates = useMemo(
        () =>
            matcherMarksVisible(row?.row_status ?? "")
                ? candidateKeySet(candidateData?.message?.settleable_candidates)
                : candidateKeySet(undefined),
        [candidateData, row?.row_status]
    );

    const isPartiallyAllocated = row?.row_status === ROW_PARTIALLY_ALLOCATED;

    /**
     * The mode that actually governs (issue #1241).
     *
     * ⚠️ DERIVED ONCE, HERE, AND HANDED DOWN -- never re-derived at a render site and never inside
     * the picker. `effectiveSettleMode` is the SAME function `chooseSettleEndpoint` applies on the
     * page's side of the confirm, so the control that collects the pick and the rule that routes it
     * cannot disagree about which endpoint that pick is heading for.
     *
     * ⚠️ `modeLocked` GOES THROUGH THE HELPER EVEN THOUGH `isPartiallyAllocated` ABOVE IS THE SAME
     * COMPARISON TODAY. They are two different questions -- "does this transfer already have legs?"
     * (which gates the legs fetch and the already-allocated section) and "does the reviewer get a
     * choice of mode?" -- that happen to share one answer. The mode question must read the function
     * `chooseSettleEndpoint` also reads, or a change to the locking rule would move the routing and
     * leave the radio behind. Do not collapse one into the other.
     */
    const modeLocked = settleModeLocked(row?.row_status ?? "");
    const effectiveMode = effectiveSettleMode(settleMode, row?.row_status ?? "");

    /**
     * The legs this transfer has ALREADY settled (Task 7, ADR-0020 fan-out).
     *
     * ⚠️ NO DEDICATED ENDPOINT EXISTS FOR "one row's current allocation" -- `get_row_allocation`
     * was never built. (⚠️ CORRECTED, issue #1243: this used to add "and the `legs` a write returns
     * only cover THAT write", which is FALSE. `allocate_row` returns every LIVE leg on the row, and
     * therefore an authoritative balance. The real reason a separate read exists is that the dialog
     * needs the balance BEFORE any write -- on open, with nothing submitted yet -- and a write
     * response cannot answer that. Left corrected rather than deleted: the sentence was load-bearing
     * enough to be believed, and the next reader is entitled to know it was wrong.)
     *
     * This reads the `Outflow Row Match` doctype directly instead: an ordinary `useFrappeGetDocList`, the same
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

    /**
     * What the RECORD PICKER measures every candidate against (issue #1243).
     *
     * ⚠️ THE BANKED REMAINDER, AND DELIBERATELY NOT `bar.remaining`. `bar` folds the current TICKS
     * in, because the bar has to move as the reviewer works. This must not: the pool is ranked once
     * per dialog open, and a list that re-ranks under the cursor mid-selection is worse than a
     * static answer (AC5). `pickerComparisonAmount` takes no ticks at all, which is what makes that
     * impossible rather than merely discouraged.
     *
     * ⚠️ `null` ON A ROW WITH NO LEGS, WHICH IS WHAT KEEPS AC4 TRUE. Such a row sends the endpoint
     * the same params and the same SWR key it always sent, so nothing about the overwhelming
     * majority of transfers changes.
     */
    const compareAmount = useMemo(
        () => pickerComparisonAmount(row?.amount ?? 0, allocatedLegs),
        [row?.amount, allocatedLegs]
    );

    // ⚠️ TICKED AMOUNTS COME FROM `pickedRecords`, NOT FROM `decision.linkTargets`. The picker
    // reports the actual `SettleableRecord`s it resolved its ticks to, which is what carries an
    // AMOUNT -- `linkTargets` is only ids. See `RecordPicker`.
    const bar: AllocationBar = useMemo(
        // #1299: `decideTickedAmount`, so a part-linked expense adds what this line moves into it,
        // not its whole amount.
        () =>
            allocationBar(
                row?.amount ?? 0,
                allocatedLegs,
                pickedRecords.map((r) => decideTickedAmount(r, row?.amount ?? 0))
            ),
        [row?.amount, allocatedLegs, pickedRecords]
    );

    useEffect(() => {
        setPickedRecords([]);
        setBlocked(null);
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
    // ⚠️ ONE ANSWER SINCE SLICE TD WAS REMOVED. This used to be the SHAPE two answers shared, with
    // `deductionOffer` layering a service check and a rate band on top; the deduction is now
    // withheld at approval by `services/payment_tds.py`, so a split is the only thing this dialog
    // can offer. Mirrors `partial_settle.partial_eligibility`; the server is still the authority.
    const partialShape = SHOW_PARTIAL_SETTLE ? partialOffer(picked, row?.amount ?? 0) : null;

    // #1269: which row + record is on screen NOW, read after the recorded-money check comes back, and
    // whether a check is already out. Refs, so reading them never re-renders the dialog.
    const currentPickRef = useRef("");
    currentPickRef.current = `${row?.name}|${picked?.name}`;
    const checkingPartialRef = useRef(false);

    const handleConfirmClick = useCallback(async () => {
        // ⚠️ THE AMOUNT-WINDOW DETOUR IS A **NORMAL-MODE** QUESTION, AND GATING IT ON THE MODE IS
        // WHAT MAKES THE WHOLE SLICE WORK (issue #1241). It asks "does this ONE record equal the
        // WHOLE transfer, and if not, was the shortfall a part payment or a deduction?" -- which is
        // exactly the question `settle_row` enforces. Task 7 already exempted a multi-tick fan-out
        // from it, "governed by the balance bar instead"; Split mode is that same fan-out at ONE
        // tick, so the exemption has to follow the mode rather than the count.
        //
        // ⚠️ WITHOUT THIS GATE THE FEATURE'S FIRST ACCEPTANCE CRITERION IS UNREACHABLE. `suggested`
        // is false for any record outside the settle window of the FULL transfer, so a deliberate
        // first leg -- the smaller-than-the-transfer tick this slice exists to allow -- would open
        // "this record is 2,19,000 away from the transfer" instead of being allocated.
        if (effectiveMode === "normal" && pickedRecords.length === 1) {
            const block = settleBlocker(picked, row?.amount ?? 0);
            if (block) {
                // ⚠️ #1269 -- THE REFUSAL COMES BEFORE THE SPLIT QUESTION. When this pick would
                // be offered "settle and carry the rest?", the server is asked first whether the
                // line's money is already recorded. Otherwise the reviewer answers a question about
                // a split that can never happen, and only then hears it was refused. A pick with
                // no offer opens the "cannot be settled here" dialog, which asks nothing.
                //
                // ⚠️ THE ANSWER IS DROPPED IF THE PICK MOVED WHILE IT WAS OUT, and a second click
                // while one check is out does nothing. Otherwise an answer about one record could
                // open the question for another, which was never checked.
                if (picked && partialShape) {
                    if (checkingPartialRef.current) return;
                    const asked = `${row?.name}|${picked.name}`;
                    checkingPartialRef.current = true;
                    try {
                        const allowed = await onCheckPartialSettle(picked);
                        if (!allowed || currentPickRef.current !== asked) return;
                    } finally {
                        checkingPartialRef.current = false;
                    }
                }
                setBlocked(block);
                return;
            }
        }
        onConfirm();
    }, [
        effectiveMode,
        picked,
        pickedRecords.length,
        row?.name,
        row?.amount,
        partialShape,
        onConfirm,
        onCheckPartialSettle,
    ]);

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
    const isLinkDecision = !isCreateTarget(decision?.target);
    // ⚠️ `bar.over` ONLY GATES THE BUTTON, NEVER `isConfirmable` -- see `allocationView.ts` and the
    // picker below. Disabling the ROWS instead would make it a puzzle: the reviewer may want to
    // untick something else first.
    //
    // ⚠️ REVIEW FIX 1 -- ALSO GATED ON `legsUnknown`. `bar` is computed from `allocatedLegs`, which
    // is a confident-looking `[]` while the legs are still loading or failed to load; posting a
    // confirm against that wrong balance is exactly the "posts, is refused, shows nothing" defect
    // this dialog exists to prevent, one layer up.
    //
    // ⚠️ #1239 -- THE RULE ITSELF LIVES IN `allocationView.confirmGate`, NOT HERE. It used to be an
    // inline OR-expression, which this repo has no way to test (no DOM environment, by deliberate
    // choice), and the sentences explaining it were derived separately further down the render. ONE
    // call now answers every part: `gate.reason` for the button's `disabled`, `gate.balanceReason` /
    // `gate.balanceMessage` for the bar, `gate.balanceReason` again for the label's completion
    // claim. **Do NOT re-derive any of them from `bar.over` / `legsUnknown` at a render site.**
    //
    // ⚠️ THE ONE THING THAT IS STILL ALLOWED TO READ `legsUnknown` RAW IS THE BAR'S VISIBILITY
    // (`canLinkPayment && (legsUnknown || ...)`, below). That is LAYOUT -- whether the bar is on the
    // screen at all -- and it is deliberately WIDER than the gate: the bar renders on any linkable
    // row, including one whose reviewer has opened a "create something new" card, where the balance
    // no longer governs the confirm. Reasons and visibility are different questions; only reasons
    // come from `gate`.
    //
    // ⚠️ #1242 -- THE OVER-TICK GATE IS NARROWED BY THE `endpoint`. The rule is PASSED, never
    // re-derived here: `chooseSettleEndpoint` is the one routing home, and `confirmGate` owns the
    // reasoning for why an inline boolean would be the untestable shape #1239 removed.
    //
    // ⚠️ AND IT IS FED THE READER `OutflowMasterPage` ROUTES WITH -- `decisionLinkKeys`, NOT the
    // `ticks` a few lines up. Those two counts diverge BY DESIGN (see REVIEW FIX 3 above): `ticks`
    // comes from `pickedRecords`, which drops a ticked key the pool has not resolved yet or no
    // longer holds, and it must keep doing so, or the button LABEL stops agreeing with the bar
    // beneath it. But a gate PREDICTING the endpoint has to read what the confirm will actually
    // read, or an unresolved key leaves it believing "nothing is picked" on a row the page is
    // about to send to `allocate_row` -- and the over-tick guard would then be skipped on exactly
    // the row that has already banked more than the transfer. It is also the SAME reader
    // `isConfirmable` uses, so a `null` endpoint can never outlive a confirmable decision.
    const routedTicks = decision ? decisionLinkKeys(decision).size : 0;
    const gate = confirmGate({
        busy,
        decisionConfirmable: isConfirmable(row, decision),
        balanceGoverns: isLinkDecision,
        endpoint: chooseSettleEndpoint({
            ticks: routedTicks,
            rowStatus: row.row_status,
            mode: settleMode,
        }),
        legsUnknown,
        over: bar.over,
    });
    // Named once so the bar's two over-allocated tells -- the red skin and the instruction that
    // follows the figures -- can never be given different conditions.
    const overAllocated = gate.balanceReason === "over-allocated";
    // ⚠️ REVIEW FIX 1, ROUND 2 -- THE LABEL MUST NOT CLAIM COMPLETION IT HAS NOT VERIFIED. `bar` is
    // computed from `allocatedLegs`, which reads as a confident `[]` while the balance is unknown
    // (still loading, or the fetch failed and persists until the row is re-opened). The gate already
    // refuses the CLICK in that state, but the button's TEXT was still able to say
    // "· completes this transfer" off a balance nobody has read yet -- the same false-confidence
    // defect FIX 1 fixed for the bar, one component further down. Short-circuiting HERE, at the
    // call site, rather than passing `complete: bar.complete && ...`, is deliberate: the intent
    // ("never claim completion on an unknown balance") is legible without having to also read what
    // `bar.complete` means.
    //
    // ⚠️ AND IT SAYS "Allocate" ONLY WHEN IT IS GOING TO ALLOCATE (issue #1241). The label used to
    // key on `ticks > 0` alone, so a single pick that `chooseSettleEndpoint` sends to `settle_row`
    // still read "Allocate 1 record". That was survivable while the routing was invisible; with an
    // explicit mode radio directly above it, a button reading "Allocate" one line under a chosen
    // "Normal" is a straight contradiction. Normal keeps the pre-fan-out wording, which is also the
    // wording that matches what the endpoint actually does.
    const confirmLabel =
        isLinkDecision && effectiveMode === "split" && ticks > 0
            ? gate.balanceReason === "balance-unknown"
                ? allocateButtonLabel({ ticks, complete: false })
                : allocateButtonLabel({ ticks, complete: bar.complete })
            : // ⚠️ #1299: a late line that only part-fills an expense leaves it Reconciliation
              // Pending, so the label must not promise Paid. `decideConfirmLabel` keeps today's
              // wording for everything that is not a part-linked expense.
              isLinkDecision && effectiveMode === "normal"
              ? decideConfirmLabel(picked, row.amount)
              : "Confirm → Paid";

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
                    {/* ⚠️ #1275: THE UNDO ROLES GET THE SHARED UNRECONCILE LIST (per-record Reverse,
                        one reason, Reverse all) -- the same surface as a Settled line's dialog. A
                        plain Accountant, whom the plan endpoint refuses, keeps the read-only list. */}
                    {isPartiallyAllocated &&
                        (canUndoOutflow(role, user_id) ? (
                            <div className="rounded-md border border-sky-600/30 bg-sky-50/40 px-3 py-2.5">
                                <UnreconcilePanel
                                    row={row.name}
                                    heading="Already allocated"
                                    disabled={busy}
                                    onDone={onUnreconciled}
                                />
                            </div>
                        ) : (
                            <AlreadyAllocatedSection
                                legs={allocatedLegs}
                                loading={legsLoading}
                                error={legsError ? describeFrappeError(legsError, "couldn't load") : null}
                            />
                        ))}

                    {/* ⚠️ ONE SECTION, ALWAYS OPEN. It replaced three cards -- one per ledger --
                        that made the reviewer say WHICH KIND of record this was before they were
                        shown any. That is a question the bank statement does not answer: a transfer
                        to a vendor may have been raised as a Project Payment or booked as a Project
                        Expense, and the only way to find out was to open each card in turn. With
                        one list there is nothing to choose first, so there is no card to click. */}
                    {/* ⚠️ THE MODE RADIO SITS DIRECTLY ABOVE THE PICKER IT GOVERNS, AND IS GATED
                        ON `canLinkPayment` (issue #1241). It is "the top of the settle dialog" in
                        the only sense that is true: on a CREDIT row there is no settle picker at
                        all -- the row is recorded as a project or non-project inflow -- so a "how is this
                        being settled?" question there would be offering a choice about a control
                        that is not on the screen. It sits BELOW `AlreadyAllocatedSection` for the
                        same reason that section sits above the picker: the money already written
                        against this transfer is the evidence for why the mode is locked. */}
                    {canLinkPayment && (
                        <SettleModeChoice
                            mode={effectiveMode}
                            locked={modeLocked}
                            onChange={onSettleModeChange}
                        />
                    )}

                    {canLinkPayment && (
                        <LinkPaymentSection
                            row={row}
                            decision={decision}
                            mode={effectiveMode}
                            onChange={onChange}
                            // ⚠️ DIMMED BY ANY "create something new" CHOICE, not just the expense
                            // one (B6, widened again at B7). The records stay legible so the
                            // reviewer can see what they are declining — hiding them would remove
                            // the evidence for the choice.
                            dimmed={isCreateTarget(decision?.target)}
                            onSelectedRecordsChange={handleSelectedRecordsChange}
                            matcherCandidates={matcherCandidates}
                            compareAmount={compareAmount}
                            // ⚠️ THE LOADING HALF OF `legsUnknown`, DELIBERATELY NOT ALL OF IT
                            // (review finding, issue #1243). `legsUnknown` is
                            // `legsLoading || legsError`, and the error half NEVER CLEARS while the
                            // dialog is open -- so passing it here withheld the record fetch
                            // permanently and left the picker reading "Loading records…" forever on
                            // a row whose pool had loaded fine before this change. That is strictly
                            // worse than the defect being fixed: the reviewer could not see or link
                            // ANY record.
                            //
                            // On a failed legs fetch the honest fallback is the ORDINARY list,
                            // ranked against the whole transfer -- which is what `compareAmount`
                            // already is in that state, since `allocatedLegs` is `[]`. The balance
                            // bar still says the balance is unknown and `confirmGate` still refuses
                            // the click, so nothing can be written off the wrong number.
                            compareUnknown={isPartiallyAllocated && legsLoading}
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
                        gate.balanceReason === "balance-unknown" ? (
                            // A WHOLE-BOX message: with no balance to print there is nothing for a
                            // figure to sit beside, so the sentence is the entire bar.
                            <div className="rounded-md border border-muted-foreground/20 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                                {gate.balanceMessage}
                            </div>
                        ) : (
                            // A TRAILING FRAGMENT: the figures are the point and the instruction
                            // follows them, so `balanceMessage` reads as a suffix here. The two
                            // shapes are why the caller still asks WHICH reason before rendering.
                            <div
                                className={`rounded-md border px-3 py-2 text-sm tabular-nums ${
                                    overAllocated
                                        ? "border-red-300 bg-red-50 text-red-600"
                                        : "border-muted-foreground/20 bg-muted/30 text-muted-foreground"
                                }`}
                            >
                                allocated {formatToRoundedIndianRupee(bar.allocated)} · left{" "}
                                {formatToRoundedIndianRupee(bar.remaining)}
                                {overAllocated && (
                                    <span className="ml-2 font-medium">
                                        {gate.balanceMessage}
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
                            against a payable. Choose one of the options below — a project
                            inflow, a non-project inflow, or a vendor refund.
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

                    {/* ⚠️ THE SECOND CREDIT CARD, UNDER THE SAME `isCreditRow` GATE (#1266) — and
                        deliberately BELOW the inflow one. The two divide on whether a project is
                        behind the money, and a client receipt against a project is the commoner
                        case; this is where the rest go. */}
                    {isCreditRow(row) && (
                        <TargetOption
                            target={CREATE_NON_PROJECT_INFLOW_TARGET}
                            decision={decision}
                            onChange={onChange}
                            seed={() => ({
                                target: "nonProjectInflow",
                                newNonProjectInflow: decision?.newNonProjectInflow ?? {
                                    description: nonProjectInflowDescriptionSeed(row),
                                },
                            })}
                        >
                            <NewNonProjectInflowForm
                                row={row}
                                decision={decision!}
                                onChange={onChange}
                            />
                        </TargetOption>
                    )}

                    {/* The third credit card, under the same `isCreditRow` gate: money a vendor
                        paid back. The vendor is suggested from the bank line's payer name. */}
                    {isCreditRow(row) && (
                        <TargetOption
                            target={CREATE_VENDOR_REFUND_TARGET}
                            decision={decision}
                            onChange={onChange}
                            seed={() => ({
                                target: "vendorRefund",
                                newVendorRefund: decision?.newVendorRefund ?? {},
                            })}
                        >
                            <NewVendorRefundForm row={row} decision={decision!} onChange={onChange} />
                        </TargetOption>
                    )}

                    {/* ⚠️ LAST IN THE BODY, UNDER A DIVIDER (#1273). Keyed on the line so a half-typed
                        reason never carries over to the next transfer opened. */}
                    {canSkipByHand(row, role, user_id) && (
                        <SkipTransferBox key={row.name} busy={busy} onSkip={onSkip} />
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
                    {/* ⚠️ GATED ON THE SAME `isConfirmable` THE BULK BAR COUNTS WITH, so
                        the two surfaces can never disagree about whether a row is ready.
                        It also closes a real hole: the ledger now arrives with the chosen
                        record rather than from a card clicked first, so a cleared selection
                        leaves no target at all -- and this button would have posted a
                        settle with an undefined doctype. */}
                    {/* ⚠️ #1239 -- `disabled` IS THE REASON, read as one. `confirmGate`
                        deliberately exposes no `disabled` boolean: taking a boolean and
                        never consulting the reason is the shape this ticket removed. */}
                    <Button size="sm" onClick={handleConfirmClick} disabled={gate.reason !== null}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {confirmLabel}
                    </Button>
                </footer>
            </DialogContent>

            <AmountOutsideWindowDialog
                block={blocked}
                // ⚠️ COMPUTED FROM THE PICKED RECORD, NOT FROM THE BLOCK. `SettleBlock` carries
                // amounts but not the LEDGER, and the gate needs it — reading it off the block
                // would offer to split an expense, which has nowhere for a balance to go.
                offer={partialShape}
                busy={busy}
                onClose={() => setBlocked(null)}
                onPartialSettle={async (intent) => {
                    if (!picked) return;
                    await onPartialSettle(picked, intent);
                    setBlocked(null);
                }}
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
    onClose,
    onPartialSettle,
    busy,
}: {
    block: SettleBlock | null;
    /** Non-null when this pick may be settled in parts. See `partialOffer`. */
    offer: PartialOffer | null;
    onClose: () => void;
    onPartialSettle: (intent: PartialIntent) => void;
    busy: boolean;
}) => {
    /**
     * ⚠️ THERE IS NO LONGER A CHOICE TO HOLD, AND THE RISK THE CHOICE MANAGED IS STILL REAL.
     *
     * A shortfall is either a part payment (the balance is still owed) or a deduction such as TDS
     * (nothing more is owed), and NOTHING IN THIS SYSTEM CAN TELL THEM APART. Slice TD let the
     * reviewer declare a deduction here; that is gone — SR tax is withheld at approval — so a split
     * is the only action, and taking it on a genuine withholding creates an approved payment that
     * will never be paid. `offer.tdsLike` is the whole guard against that now, which is why its
     * banner instructs rather than merely observes. It must stay a WARNING and never gate.
     */
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
                                <span className="font-mono">{block?.recordName}</span>{" "}
                                {/* #1299: a part-linked expense's figure is what is LEFT. */}
                                {block?.reason === "more_than_left" ? "has only" : "is for"}{" "}
                                <span className="font-medium tabular-nums">
                                    {formatToIndianRupee(block?.recordAmount ?? 0)}
                                </span>
                                {block?.reason === "more_than_left" ? " left to link" : ""}
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
                                    <p>This transfer pays PART of this payment.</p>
                                    {/* ⚠️ IT WARNS AND NOW ALSO INSTRUCTS, AND IT STILL MUST NOT
                                        GATE. While a deduction was recordable here (slice TD) a
                                        reviewer meeting a real withholding had somewhere to put
                                        it, so noting the coincidence was enough. Now a split is
                                        the only action on this screen, and taking it on a genuine
                                        withholding creates an approved payment nobody owes — so
                                        the banner has to say where the answer moved to. A part
                                        payment can still land on 2% by coincidence, which is why
                                        this may never default, pre-select or disable anything. */}
                                    {offer.tdsLike && (
                                        <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-amber-900">
                                            {formatToIndianRupee(offer.remainder)} is{" "}
                                            {offer.impliedPct.toFixed(2)}% of the payment — a common
                                            TDS rate. If tax was withheld rather than part of the
                                            money being unpaid, do not split this: record it in the
                                            payments screen. Splitting would create a balance nobody
                                            owes.
                                        </p>
                                    )}
                                    {/* The confirmation names what will be CREATED, because there
                                        is no undo from inside the import (ruling Q9). */}
                                    <p className="font-medium text-foreground">
                                        This settles {formatToIndianRupee(offer.keep)} and creates a
                                        new payment of{" "}
                                        {formatToIndianRupee(offer.remainder)} for the balance.
                                    </p>
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
                                    {/* ⚠️ THE REMEDY IS OWNED BY `settleBlockRemedy`, NOT TYPED
                                        HERE (browser walk #1245). This was one fixed sentence for
                                        every reason -- "Pick the record that matches this transfer
                                        instead." -- and on a transfer that pays SEVERAL records it
                                        cannot be followed: no single record matches, and the answer
                                        is Split mode, offered unnamed on a radio just above. The
                                        server already said so for this direction; the screen did
                                        not, because this dialog intercepts before the server runs. */}
                                    <p className="text-muted-foreground">{settleBlockRemedy(block)}</p>
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
                        // ⚠️ THE INTENT IS STILL SENT, THOUGH THERE IS ONLY ONE. The endpoint
                        // rejects a missing or unrecognised intent — that allowlist is the guard on
                        // a money-out door — and the value is what `_record_partial_provenance`
                        // writes onto both halves as the reviewer's declaration that the balance is
                        // owed. Clicking this button IS that declaration.
                        <AlertDialogAction
                            disabled={busy}
                            onClick={() => onPartialSettle(INTENT_PART_PAYMENT)}
                        >
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {`Settle ${formatToRoundedIndianRupee(
                                offer?.keep ?? 0
                            )} and carry the rest`}
                        </AlertDialogAction>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

/*
 * ⚠️ `PartialIntentChoice` WAS DELETED HERE (slice TD removal), and this note is what stops it
 * being rebuilt by someone reading `onPartialSettle`'s intent argument and wondering where the
 * second option went.
 *
 * It was a two-option radio group -- "A part payment" / "A deduction (TDS or similar)" -- with
 * the second greyed and reasoned when the payment's parent was not a Service Request or the gap
 * fell outside 0.95-2.05%. It existed because a reviewer offered only "part payment" on a real
 * withholding will take it, and that mints a balance nobody owes.
 *
 * THAT RISK DID NOT GO AWAY; ITS ANSWER MOVED. SR tax is now withheld at approval by
 * `services/payment_tds.py`, which nets `Project Payments.amount`, so an approved SR payment
 * matches its transfer outright and never reaches this dialog. What remains exposed is a real
 * withholding on a PO, which this module has never covered -- and the `offer.tdsLike` banner is
 * now the whole guard for it, which is why that banner tells the reviewer NOT to split and where
 * to go instead. Do not rebuild the radio; strengthen the banner.
 */

/**
 * How this transfer is going to be settled: one record, or several payments over several sittings.
 *
 * ⚠️ THE LABELS MUST NOT SAY "PARTIAL" OR "PART PAYMENT" (ADR-0020 B3, issue #1241). `PartialIntentChoice`
 * directly above renders a radio labelled *"A part payment"* belonging to the INVERSE feature -- one
 * approved payment split across several TRANSFERS, the exact opposite of this. Two radio groups in one
 * dialog with near-identical labels and opposite meanings is the worst available outcome, so the copy
 * lives in `allocationView.SETTLE_MODE_LABEL` where a test can ban the word mechanically.
 *
 * ⚠️ A REAL `<input type="radio">` IN A REAL RADIOGROUP, for the reason both record tables give:
 * arrow-key navigation, the roving tab stop and the announced group name come free from the platform,
 * and this control decides which ENDPOINT writes the money.
 *
 * ⚠️ LOCKED, NOT HIDDEN, ON A `Partially Allocated` ROW -- the same discipline `PartialIntentChoice`
 * holds for its disabled option. The reviewer has to be able to see WHY there is no choice; removing
 * the group would leave a split picker on screen with nothing saying how it got there.
 */
const SettleModeChoice = ({
    mode,
    locked,
    onChange,
}: {
    mode: SettleMode;
    locked: boolean;
    onChange: (next: SettleMode) => void;
}) => (
    <div className="rounded-md border border-muted-foreground/20">
        <div className="px-3 py-2.5">
            <p className="text-sm font-medium">How is this transfer being settled?</p>
            {locked && (
                <p className="mt-0.5 text-xs font-medium text-amber-700">
                    {/* The reason travels WITH the lock, never separately: a frozen control with no
                        explanation is the dead-button complaint this dialog exists to answer. */}
                    This transfer already has money allocated against it, so it can only be settled
                    by splitting. Reverse every allocation above to get the choice back.
                </p>
            )}
        </div>
        <div
            role="radiogroup"
            aria-label="How is this transfer being settled?"
            className="space-y-2 border-t px-3 py-3"
        >
            {(["normal", "split"] as const).map((option) => {
                // ⚠️ ONLY THE *OTHER* OPTION IS DISABLED WHILE LOCKED. Disabling the chosen one too
                // would grey out the very answer the reviewer needs to read.
                const disabled = locked && option !== mode;
                return (
                    <label
                        key={option}
                        className={`flex items-start gap-2 rounded-md border px-3 py-2 transition-colors ${
                            disabled
                                ? "cursor-not-allowed border-muted-foreground/20 opacity-60"
                                : mode === option
                                  ? "cursor-pointer border-primary bg-primary/5"
                                  : "cursor-pointer border-muted-foreground/20 hover:bg-muted/50"
                        }`}
                    >
                        <input
                            type="radio"
                            name="settle-mode"
                            className="mt-1 h-3.5 w-3.5 accent-primary disabled:cursor-not-allowed"
                            checked={mode === option}
                            disabled={disabled}
                            onChange={() => onChange(option)}
                        />
                        <span>
                            <span className="block text-sm font-medium text-foreground">
                                {SETTLE_MODE_LABEL[option]}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                                {SETTLE_MODE_HINT[option]}
                            </span>
                        </span>
                    </label>
                );
            })}
        </div>
    </div>
);

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
 * NOTHING SERVER-SIDE CHANGED. `outcome_note`, `related_records` (then `related_payments`) and `bank_reference_no` are all
 * still written, still returned, and still read elsewhere -- the Skipped tab and the row table use
 * them. Only this one rendering is gone.
 */

/**
 * "Nothing to link?" -- skip an open line with a typed reason (#1273, mockup scene 4).
 *
 * ⚠️ THE SERVER'S REFUSAL IS SHOWN HERE, IN THE BOX, not left to an unhandled rejection. The page's
 * `handleSkip` closes the dialog only on success, so a refusal -- someone settled the line a moment
 * ago, a role was changed -- would otherwise do nothing visible at all.
 */
const SkipTransferBox = ({
    busy,
    onSkip,
}: {
    busy: boolean;
    onSkip: (reason: string) => Promise<void> | void;
}) => {
    const [reason, setReason] = useState("");
    const [error, setError] = useState<string | null>(null);
    const trimmed = reason.trim();

    const submit = async () => {
        setError(null);
        try {
            await onSkip(trimmed);
        } catch (err) {
            setError(describeFrappeError(err, "The transfer was not skipped."));
        }
    };

    return (
        <div className="space-y-3 border-t border-dashed pt-4">
            <div className="space-y-3 rounded-md border p-3">
                <div>
                    <p className="text-sm font-medium">Nothing to link?</p>
                    <p className="text-xs text-muted-foreground">
                        Skip this transfer. It moves to the Skipped list, marked as skipped by hand, and can be unskipped from there.
                    </p>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="skip-transfer-reason" className="text-xs">
                        Reason (required)
                    </Label>
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            id="skip-transfer-reason"
                            value={reason}
                            placeholder="Why does this transfer have nothing to link?"
                            onChange={(e) => {
                                setReason(e.target.value);
                                setError(null);
                            }}
                            className="h-9 min-w-[12rem] flex-1"
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                            disabled={!trimmed || busy}
                            onClick={submit}
                        >
                            <SkipForward className="mr-1.5 h-4 w-4" />
                            Skip transfer
                        </Button>
                    </div>
                    {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
            </div>
        </div>
    );
};

/**
 * Settled legs already on this transfer (Task 7, ADR-0020 fan-out) -- rendered above
 * `LinkPaymentSection`, so the reviewer sees what is already settled before the picker offers what
 * is left.
 *
 * ⚠️ READ ONLY SINCE #1275. It is shown to a plain Accountant, who may not undo anything; the undo
 * roles get the shared `UnreconcilePanel` in its place, which reads the server's plan.
 */
const AlreadyAllocatedSection = ({
    legs,
    loading,
    error,
}: {
    legs: AllocatedLeg[];
    /** ⚠️ REVIEW FIX 1 -- an explicit loading state, so an empty `legs` array while this is still
     *  in flight never renders as "nothing to report" (a `Partially Allocated` row always has at
     *  least one leg). */
    loading: boolean;
    /** The fetch's own refusal, already worded via `describeFrappeError`, or `null`. */
    error: string | null;
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
                    </div>
                ))}
            </div>
        </div>
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
    mode,
    onChange,
    dimmed,
    onSelectedRecordsChange,
    matcherCandidates,
    compareAmount,
    compareUnknown,
}: {
    row: OutflowImportRow;
    decision: RowDecision | undefined;
    /** The EFFECTIVE settle mode, already resolved by the caller. See `RecordPicker`. */
    mode: SettleMode;
    onChange: (decision: RowDecision) => void;
    dimmed: boolean;
    // Passed straight through to `RecordPicker`, which is where the candidate list -- and so the
    // server's `suggested` flag -- actually lives.
    onSelectedRecordsChange: (records: SettleableRecord[]) => void;
    /** `recordKey`s the match run found for this transfer (slice N3). */
    matcherCandidates: ReadonlySet<string>;
    /** The balance remaining, or `null` for "measure against the whole transfer" (issue #1243). */
    compareAmount: number | null;
    /** Whether that balance is still unresolved. Passed straight through to `RecordPicker`. */
    compareUnknown: boolean;
}) => (
    <div className={`rounded-md border border-muted-foreground/20 ${dimmed ? "opacity-40" : ""}`}>
        <div className="px-3 py-2.5">
            <p className="text-sm font-medium">Link payment</p>
            <p className="text-xs text-muted-foreground">
                {/* ⚠️ THE SUBTITLE FOLLOWS THE MODE (issue #1241). "one or more … payment or
                    expense" is true of Split and false of Normal in both halves at once, and the
                    line sits directly above the control whose shape it is describing. */}
                {mode === "split"
                    ? "the Reconciliation Pending payments this transfer is being split across"
                    : "the one Reconciliation Pending record this transfer paid — payment or expense"}
            </p>
        </div>
        <div className="border-t px-3 py-3">
            <RecordPicker
                row={row}
                decision={decision ?? {}}
                mode={mode}
                onChange={onChange}
                onSelectedRecordsChange={onSelectedRecordsChange}
                matcherCandidates={matcherCandidates}
                compareAmount={compareAmount}
                compareUnknown={compareUnknown}
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
    mode,
    onChange,
    onSelectedRecordsChange,
    matcherCandidates,
    compareAmount,
    compareUnknown,
}: {
    row: OutflowImportRow;
    decision: RowDecision;
    /**
     * ⚠️ THE EFFECTIVE MODE, ALREADY RESOLVED (issue #1241). The caller applies
     * `effectiveSettleMode` so a `Partially Allocated` row arrives here as `"split"` -- this
     * component must never re-derive it, or the picker and the router could disagree about which
     * endpoint the tick it is collecting is going to reach.
     */
    mode: SettleMode;
    onChange: (decision: RowDecision) => void;
    onSelectedRecordsChange: (records: SettleableRecord[]) => void;
    matcherCandidates: ReadonlySet<string>;
    /**
     * ⚠️ THE BALANCE REMAINING, OR `null` FOR "the whole transfer" (issue #1243). RESOLVED BY THE
     * CALLER, never re-derived here -- the same discipline `mode` already carries. The dialog owns
     * the legs, so it owns the remainder; a picker that recomputed it from a second source could
     * rank against a number the balance bar above it disagrees with.
     */
    compareAmount: number | null;
    /**
     * Whether that balance is still unresolved (the legs are loading, or their fetch failed).
     *
     * ⚠️ ABSENT IS NOT UNKNOWN, and this is the one place that distinction reaches a FETCH. An
     * unresolved balance reads as a confident `[]`, which would make `compareAmount` `null` and send
     * the whole-transfer request -- ranking against exactly the number this change exists to stop
     * using, and then never re-ranking, because the reply would be cached under the key it was
     * fetched with.
     */
    compareUnknown: boolean;
}) => {
    const [filters, setFilters] = useState<RecordFilters>(EMPTY_FILTERS);
    const [sort, setSort] = useState<RecordSort | null>(null);

    // A different transfer is a different question -- carrying one row's filters onto the next
    // would hide records for a reason that is no longer on screen.
    //
    // ⚠️ AND A DIFFERENT MODE IS A DIFFERENT QUESTION FOR THE SAME REASON (issue #1241). Split
    // narrows the pool to payments BEFORE the facets are computed, so a vendor filter set in Normal
    // can survive into a Split facet list that no longer offers it: an active filter with no chip
    // on screen, which is exactly the "hidden for a reason that is no longer on screen" shape this
    // reset already exists to prevent.
    useEffect(() => {
        setFilters(EMPTY_FILTERS);
        setSort(null);
    }, [row.name, mode]);

    // ⚠️ NO `target_doctype`, WHICH IS WHAT MAKES THIS ONE LIST. A blank one means all three
    // ledgers, merged and RANKED server-side by how much each record looks like this transfer --
    // so the reviewer recognises a record instead of first classifying the transfer.
    //
    // ⚠️ NO `search` AND NO `limit` EITHER, AND THE SWR KEY IS THEREFORE STABLE PER ROW (slice N1).
    // It used to carry the search text, which minted a new key -- and so a new REQUEST -- on every
    // keystroke. The whole approved pool now arrives in one call and every narrowing below is
    // local, which is what makes filtering and sorting instant.
    // ⚠️ THE COMPARISON AMOUNT RIDES THE EXISTING CALL, AND AN UNTOUCHED ROW SENDS NEITHER THE
    // PARAMETER NOR A NEW KEY (issue #1243, AC4). The endpoint measures every candidate against
    // this figure at ONE derivation point, which moves the per-ledger ordering, the `suggested`
    // flag, the ranker's hard split and the amount score axis together -- so there stays exactly one
    // amount-opinion per record. A dedicated endpoint was rejected: it would add a serialised round
    // trip on this dialog's critical path to fetch a number already sitting in memory one component
    // up, and it would not even remove the direct `Outflow Row Match` read that appears to justify it.
    //
    // ⚠️ THE KEY CARRIES THE AMOUNT, AND IT HAS TO. SWR caches on the key alone, so a remainder that
    // arrives after the first render -- which is every partly-allocated row, because the legs are a
    // second fetch -- would otherwise never reach the server at all.
    //
    // ⚠️ AND THE KEY IS `null` WHILE THE BALANCE IS UNKNOWN, WHICH IS WHAT STOPS THAT BEING A RACE.
    // Fetching against a provisional whole-transfer figure would cache the wrong ranking under the
    // wrong key and leave the reviewer reading it. It re-ranks per DIALOG OPEN, never per tick: the
    // banked legs do not move when a box is ticked, so neither does this key (AC5).
    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: SettleableRecord[] }>(
        "nirmaan_stack.api.outflow_import.review.search_settleable_records",
        compareAmount === null
            ? { row: row.name }
            : { row: row.name, compare_amount: compareAmount },
        compareUnknown
            ? null
            : compareAmount === null
              ? `settleable-${row.name}`
              : `settleable-${row.name}-balance-${compareAmount}`
    );

    // ⚠️ THE SAME FIGURE THE SERVER RANKED BY, SO THE "off by" MARK AGREES WITH THE ORDER (AC3).
    // `AmountMark` renders the SERVER's `suggested` beside a CLIENT-computed difference; measuring
    // them against different amounts would print "off by ₹65,000" on the record the server has just
    // flagged as the one that fits.
    //
    // ⚠️ `??` IS ENOUGH ONLY BECAUSE A NON-`null` `compareAmount` IS ALWAYS POSITIVE. That guarantee
    // lives in `pickerComparisonAmount`, which mirrors the server's own `wanted <= 0` refusal -- see
    // its docstring. Do not "harden" this line with a second `> 0` test: two copies of one rule is
    // how the client and the server came to measure different things in the first place.
    const pickerBankAmount = compareAmount ?? row.amount;

    // ⚠️ THE SERVER'S ORDER IS THE RANKING, SO IT IS NOT RE-SORTED HERE. This used to call
    // `orderBySuggestion`, which re-sorted by amount and would now silently undo the similarity
    // ranking it arrives in.
    //
    // ⚠️ SPLIT MODE NARROWS THE POOL TO PROJECT PAYMENTS **BEFORE** ANY FILTER, FACET OR SORT RUNS
    // (issue #1241). `allocate_row` -- the only endpoint Split ever calls -- throws on the first
    // non-payment target, so listing the expense half would be offered-and-refused. Narrowing here
    // rather than at the table is what keeps the count line, the facets and the "Showing N of M"
    // arithmetic all describing the list the reviewer can actually act on.
    const wholePool = useMemo(() => data?.message ?? [], [data]);
    const pool = useMemo(
        () => (mode === "split" ? splitCandidates(wholePool) : wholePool),
        [mode, wholePool]
    );
    // ⚠️ LOADING, FAILED AND EMPTY ARE THREE ANSWERS, AND THE CHOICE IS `recordPoolState`'s, NOT A
    // TERNARY HERE (issue #1248). This read `data` and `isLoading` and never `error`, so a failed
    // search (no data, not loading) fell through to "there is nothing" on a row with a full pool.
    // An unknown balance still counts as loading: with a `null` key SWR never fires at all.
    const poolState = recordPoolState({
        balanceUnknown: compareUnknown,
        hasAnswer: data !== undefined,
        poolSize: pool.length,
        isLoading,
        failed: Boolean(error),
    });
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
    //
    // ⚠️ READ THROUGH `decisionLinkKeys`, NEVER OFF ONE FIELD (issue #1240/#1241). A decision
    // arriving here may name its record in `linkTo` (the Normal picker, and nothing else writes it)
    // or in `linkTargets` (the Split picker AND `seedDecisions`, which seeds a singleton set on a
    // row that then opens in NORMAL mode). Reading one field would leave a seeded suggestion
    // invisible in the Normal table while the footer still counted it as decided.
    const linkKeys = useMemo(() => decisionLinkKeys(decision), [decision]);
    const selectedRecords = useMemo(
        () => pool.filter((o) => linkKeys.has(recordKey(o))),
        [pool, linkKeys]
    );
    const hiddenSelectedCount = selectedRecords.filter((r) => !options.includes(r)).length;

    /**
     * ⚠️ REVIEW F7 -- ONE SOURCE FOR THE TICK SET, ALL THE WAY TO THE PAYLOAD.
     *
     * Review fix 3 unified the dialog's `ticks` on `pickedRecords`, but only INSIDE this dialog:
     * `OutflowMasterPage.settleOne` still builds the actual `targets` from `decision.linkTargets`
     * and calls `chooseSettleEndpoint` a SECOND time on that count. A record that leaves the
     * approved pool between tick and confirm therefore made the balance bar and the button label
     * under-count while the submission still carried it -- and could route the two calls to
     * DIFFERENT endpoints. It failed loudly at the server, so nothing corrupted; but "one source
     * for how many are ticked" was broken at exactly the seam where it matters.
     *
     * Pruning here rather than teaching the page a second source is what keeps it ONE source:
     * `linkTargets` becomes, by construction, the keys `selectedRecords` resolved to.
     *
     * ⚠️ IT WAITS FOR THE POOL. An unresolved key while the fetch is in flight is NOT an absent
     * record -- pruning then would silently discard every tick on open. Same distinction
     * `legsUnknown` draws one level up: absent is not the same as unknown.
     */
    useEffect(() => {
        if (isLoading || !data) return;
        if (linkKeys.size === selectedRecords.length) return;
        // ⚠️ `linkTo: null` HERE TOO, FOR THE SAME REASON `onToggle` CLEARS IT (issue #1240) -- and
        // this is the writer that is easy to forget, because it is not a picker. `decisionLinkKeys`
        // lets a non-empty `linkTargets` win, so a `linkTo` left behind is invisible WHILE ticks
        // exist; if this prune empties the set it would become the effective pick, with nothing on
        // screen showing it. The contract has to hold for every writer of the field, not just the
        // two the reviewer can see.
        onChange({
            ...decision,
            linkTo: null,
            linkTargets: new Set(selectedRecords.map(recordKey)),
        });
    }, [isLoading, data, linkKeys, selectedRecords, decision, onChange]);

    /**
     * ⚠️ REVIEW FIX 4 -- STATE THE RULE WHERE IT LIVES, BEFORE THE CLICK. `allocate_row` hard-
     * refuses any fan-out that contains a non-`Project Payments` record; `tickAllowedForFanOut`
     * mirrors that exactly. Computed over `options` (the VISIBLE rows), not the whole pool -- a
     * hidden row cannot be disabled on screen anyway.
     *
     * ⚠️ SINCE #1241 THIS IS BELT-AND-BRACES, AND IT IS KEPT ON PURPOSE. Split mode is the only
     * mode that reaches `allocate_row`, and its pool is already narrowed to payments by
     * `splitCandidates`, so nothing here can fire today. It stays because it is a mirror of a
     * SERVER refusal, not a decoration on the narrowing: if the pool is ever widened again, the
     * withholding has to already be in place rather than be remembered.
     */
    const alreadyTickedDoctypes = useMemo(
        () => selectedRecords.map((r) => r.target_doctype),
        [selectedRecords]
    );
    const disabledKeys = useMemo(() => {
        const disabled = new Set<string>();
        for (const record of options) {
            const key = recordKey(record);
            if (linkKeys.has(key)) continue; // never disable an already-ticked row
            if (!tickAllowedForFanOut(record.target_doctype, alreadyTickedDoctypes, row.row_status)) {
                disabled.add(key);
            }
        }
        return disabled;
    }, [options, linkKeys, alreadyTickedDoctypes, row.row_status]);

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

            {/* ⚠️ ALWAYS ON IN SPLIT MODE, NOT ONLY WHEN SOMETHING WAS DROPPED (issue #1241). A
                reviewer hunting an expense they can SEE in Normal mode needs the reason for its
                absence at the moment they look for it -- and on a pool that happens to be all
                payments the sentence still says what this mode can and cannot do, before they
                switch away from a row it would have handled. It sits ABOVE the search box because
                it governs what the search can possibly find. */}
            {mode === "split" && (
                <p className="rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-xs">
                    {SPLIT_PAYMENTS_ONLY_NOTE}
                </p>
            )}

            <div className="space-y-1.5">
                <Label className="text-xs">Find a record waiting for a bank line</Label>
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
            {poolState === "ready" && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                        {options.length === pool.length
                            ? `${pool.length} record${pool.length === 1 ? "" : "s"}`
                            : `Showing ${options.length} of ${pool.length} records`}
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

            {poolState === "loading" ? (
                <p className="text-sm text-muted-foreground">{recordPoolMessage("loading", mode)}</p>
            ) : poolState === "failed" ? (
                // ⚠️ A FAILED SEARCH KNOWS NOTHING ABOUT THE POOL, SO IT SAYS SO AND OFFERS A RETRY
                // (issue #1248). It must never borrow the empty sentence below: a reviewer who
                // believes "there is nothing" walks away from a transfer that can be settled.
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
                    <p className="flex items-start gap-2 text-destructive">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{recordPoolMessage("failed", mode)}</span>
                    </p>
                    <p className="pl-6 text-xs text-muted-foreground">
                        {describeFrappeError(error, "The request failed.")}
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        className="ml-6 h-7 text-xs"
                        onClick={() => void mutate()}
                    >
                        Try again
                    </Button>
                </div>
            ) : poolState === "empty" ? (
                // ⚠️ TWO DIFFERENT ABSENCES, AND CONFLATING THEM IS THE DEFECT (issue #1241). In
                // Split mode an empty pool usually does NOT mean there is nothing to link to -- it
                // means the payments-only narrowing emptied a pool that still holds expenses. A
                // silent empty list, or the Normal sentence, would both read as a broken screen.
                <p className="text-sm text-muted-foreground">{recordPoolMessage("empty", mode)}</p>
            ) : !options.length ? (
                // ⚠️ "NOTHING MATCHES" IS A DIFFERENT SENTENCE FROM "THERE IS NOTHING", and the
                // difference decides what the reviewer does next. This branch also has to offer the
                // way back, because the filters that emptied the table are in a header the table no
                // longer renders -- the control that caused this can hide itself.
                <div className="space-y-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    <p>No record matches the filters you have set.</p>
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
            ) : settlePickerFor(mode) === "radio" ? (
                /* ⚠️ THE **NORMAL** PICKER: ONE RECORD, ONE `settle_row`, ALL THREE LEDGERS (issue
                   #1241, restoring what Task 7 had converted away). It is a genuinely separate
                   component from `FanOutRecordTable` by owner ruling -- see either file's header
                   for why merging them behind a `multiple` flag is the wrong shape.

                   ⚠️ THE FORK GOES THROUGH `settlePickerFor`, NOT AN INLINE `mode === "normal"`,
                   AND THAT IS AC10's ANSWER (issue #1241). This picker carries no
                   `tickAllowedForFanOut` withholding, so it must never be shown a
                   `Partially Allocated` row -- and the ticket forbids answering "it can't happen"
                   without pinning it. Naming the fork is what lets `allocationView.test` pin the
                   COMPOSITION `settlePickerFor(effectiveSettleMode(chosen, status))`, which is the
                   join a ternary in this JSX would put beyond every test in a repo with no DOM
                   environment. Do not inline it back. */
                <SettleableRecordTable
                    records={options}
                    bankAmount={pickerBankAmount}
                    matcherCandidates={matcherCandidates}
                    sort={sort}
                    onSort={handleSort}
                    filters={filters}
                    facets={facets}
                    onFiltersChange={setFilters}
                    // ⚠️ A SINGLE-SELECT TABLE SHOWS AT MOST ONE KEY, AND THE MULTI-KEY CASE IS
                    // PREVENTED UPSTREAM RATHER THAN TRUNCATED HERE. Decisions OUTLIVE this dialog
                    // -- they live in the page's `decisions` map while the mode resets to Normal on
                    // every open -- so a Split tick-set can arrive at a Normal picker without any
                    // mode switch at all (tick two, close without confirming, reopen).
                    // `openDecisionRow` clears such a pick via `pickFitsSingleSelect`; taking the
                    // first key would have shown one record and settled two. This `[0]` is the
                    // defensive read left over from that guard, never the guard itself.
                    selected={[...linkKeys][0] ?? ""}
                    // ⚠️ WRITES `linkTo` AND CLEARS `linkTargets` -- THE OTHER HALF OF THE WRITER
                    // CONTRACT `onToggle` states below (issue #1240). `decisionLinkKeys` lets a
                    // non-empty `linkTargets` WIN, and a seeded decision arrives carrying exactly
                    // that, so a Normal pick that forgot to clear it would settle the machine's old
                    // record instead of the person's new one -- silently, and with the person's
                    // choice showing on screen.
                    onSelect={(value) => {
                        const parsed = parseRecordKey(value);
                        if (!parsed) return;
                        onChange({
                            ...decision,
                            target: parsed.target,
                            linkTo: parsed.name,
                            linkTargets: new Set(),
                        });
                    }}
                />
            ) : (
                <FanOutRecordTable
                    records={options}
                    bankAmount={pickerBankAmount}
                    matcherCandidates={matcherCandidates}
                    sort={sort}
                    onSort={handleSort}
                    filters={filters}
                    facets={facets}
                    onFiltersChange={setFilters}
                    // ⚠️ `linkKeys`, NOT `decision.linkTargets` -- one source with what
                    // `selectedRecords` resolved, so the ticked boxes and the balance bar can never
                    // count different things.
                    selected={linkKeys}
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
                    //
                    // ⚠️ `linkTo` IS CLEARED TOO, AND THAT IS THE WRITER CONTRACT, NOT TIDINESS
                    // (issue #1240). `RowDecision` now carries BOTH pick fields so that the mode-less
                    // bulk confirm path can read either; `decisionLinkKeys` lets a non-empty
                    // `linkTargets` win, so a `linkTo` left behind by the Normal picker would be
                    // invisible here but would speak again the moment the last tick came off.
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
                        onChange({ ...decision, target: undefined, linkTo: null, linkTargets: next });
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
                <RecordVerdict
                    key={recordKey(record)}
                    record={record}
                    row={row}
                    bankAmount={pickerBankAmount}
                    mode={mode}
                />
            ))}

            {/* ⚠️ CLEARS EVERY TICK, NOT JUST ONE (ADR-0020 fan-out) -- a reviewer who ticked the
                wrong set needs one way back to undecided rather than unticking each box in turn.
                Individual boxes stay reachable in the table above for a partial correction. */}
            {/* ⚠️ GATED ON `decisionLinkKeys`, NOT ON `linkTargets` (issue #1240). Byte-equivalent
                today -- nothing writes a non-null `linkTo` yet -- but once the Normal picker lands
                a pick of its own would leave `linkTargets` empty, this control would stop rendering,
                and a `<input type="radio">` cannot be un-ticked by clicking it: the reviewer would
                have NO way back to undecided, while the bulk bar still counted the row as ready
                against a record they had rejected. */}
            {decisionLinkKeys(decision).size > 0 && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                        onChange({
                            ...decision,
                            target: undefined,
                            // Both pick fields, for the reason `onToggle` above states.
                            linkTo: null,
                            linkTargets: new Set(),
                        })
                    }
                >
                    <X className="mr-1 h-3 w-3" />
                    Clear selection
                </Button>
            )}
        </div>
    );
};

/*
 * ⚠️ `EMPTY_LINK_TARGETS` WAS DELETED HERE (issue #1241), and this note is what stops it being
 * reintroduced by someone reaching for a `?? new Set()` fallback. It existed so the fan-out table's
 * `selected` prop never minted a fresh identity per render on a decision with no `linkTargets`.
 * That prop now reads `linkKeys` -- the memoised `decisionLinkKeys(decision)` -- which returns the
 * module-level empty set in `outflowTableModel` for a decision with no pick at all, so the same
 * stability is inherited from the one function that already had to have it. Do not add a second.
 */

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
    row,
    bankAmount,
    mode,
}: {
    record: SettleableRecord;
    /** The bank line, for the After linking bar on a part-linked expense (#1299). */
    row: OutflowImportRow;
    bankAmount: number;
    /**
     * ⚠️ THE GAP SENTENCE IS MODE-SPECIFIC, AND THIS LINE RENDERS IN BOTH MODES (walk #1245).
     * The two picker TABLES need no such prop -- each is already one mode by construction -- but
     * this verdict is rendered once, above them, for whichever picker is showing. Telling a Split
     * reviewer their deliberate first leg is "too far apart to settle" is the defect this carries
     * the mode to avoid. The EFFECTIVE mode, passed straight down from `RecordPicker`.
     */
    mode: SettleMode;
}) => {
    const verdict = amountVerdict(record.amount, bankAmount);
    const settleable = record.suggested;
    // `document_name` is the ORDER this payment is against -- the app's own route (slice E3).
    const link = settlementLink(record.target_doctype, record.name, false, record.document_name);
    // ⚠️ A PART-LINKED EXPENSE GETS THE AFTER LINKING BAR INSTEAD OF THE GAP SENTENCE (#1299). Its
    // gap against the whole amount is not what decides anything; what is left is, and the bar says
    // what the expense becomes. Built by `linkLinesView.afterLinking`, the link dialog's own words.
    const after = decideAfterLinking(record, row);
    if (after) {
        return (
            <div
                className={`flex flex-col gap-1 rounded-md border px-3 py-2 text-sm tabular-nums ${
                    after.tone === "over"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-muted-foreground/20 bg-muted/40"
                }`}
            >
                <span className="font-medium">{after.summary}</span>
                {after.detail && <span className="text-xs text-muted-foreground">{after.detail}</span>}
            </div>
        );
    }
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
                            {formatToIndianRupee(Math.abs(verdict.difference))} —{" "}
                            {amountGapHint(mode)}
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

    // ⚠️ ONE ENDPOINT, GATED BY THE IMPORT'S OWN ACCESS RULE, ANSWERING THE CUSTOMER QUESTION. It is
    // the SAME read the write path performs, so the screen cannot show a customer the server then
    // disagrees with.
    const { data: contextData, isLoading: contextLoading } = useFrappeGetCall<{
        message: {
            customer: string | null;
            customer_name: string;
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
                    // Changing the project changes who the money is from, so the customer is
                    // cleared rather than carried onto a project it does not belong to.
                    onValueChange={(value) => patch({ project: value, customer: null })}
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
 * The Non-Project Inflow form, in place (#1266). Money received that names no project.
 *
 * ⚠️ NO PROJECT FIELD, AND ITS ABSENCE IS THE WHOLE DISTINCTION. Money with a project behind it is
 * a Project Inflow and belongs in the card above.
 *
 * The type list is the Non-Project Inflows page's own `INFLOW_TYPES` (pinned to the doctype JSON by
 * that page's parity test), and the Others rule is its `descriptionRequired` — the same two the
 * confirm gate reads, so the form cannot offer a choice the gate refuses. The server's
 * `inflow_type_problem` is the real boundary.
 *
 * Amount, payment date and reference are READ-ONLY from the bank row; the record stores the
 * amount as a positive figure.
 */
const NewNonProjectInflowForm = ({
    row,
    decision,
    onChange,
}: {
    row: OutflowImportRow;
    decision: RowDecision;
    onChange: (decision: RowDecision) => void;
}) => {
    const form = decision.newNonProjectInflow ?? {};
    const inflowType = form.inflowType ?? "";
    const needsDescription = descriptionRequired(inflowType);
    const descriptionMissing = needsDescription && !(form.description ?? "").trim();

    const patch = (over: Partial<NonNullable<RowDecision["newNonProjectInflow"]>>) =>
        onChange({ ...decision, newNonProjectInflow: { ...form, ...over } });

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Inflow Type</Label>
                <Select value={inflowType} onValueChange={(value) => patch({ inflowType: value })}>
                    <SelectTrigger className="h-9">
                        <SelectValue placeholder="Choose a type…" />
                    </SelectTrigger>
                    <SelectContent>
                        {INFLOW_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                                {type}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">
                    Description{needsDescription ? " (required for Others)" : ""}
                </Label>
                <Input
                    className="h-9"
                    value={form.description ?? ""}
                    placeholder="What was this money for?"
                    onChange={(e) => patch({ description: e.target.value })}
                />
                {descriptionMissing && (
                    <p className="text-xs text-amber-700">
                        Describe what this is — a description is required when the type is Others.
                    </p>
                )}
            </div>

            {/* Read-only from the bank row -- the statement is the source of truth. */}
            <ReadOnlyField label="Amount received" value={formatToRoundedIndianRupee(row.amount)} />
            <ReadOnlyField
                label="Payment date"
                value={row.added_on ? formatDate(row.added_on.split(/[ T]/)[0]) : "—"}
            />
            {/* `referenceValue`, the table's own Reference cell: an ICICI closure line carries no
                `bank_reference_no`, so reading that field alone showed "—" beside a table showing
                the reference. */}
            <ReadOnlyField
                label="Payment reference"
                value={referenceValue(row) || "—"}
                className="sm:col-span-2"
            />
        </div>
    );
};

/** One row of a refund document list, as `inflows.get_vendor_refund_documents` sends it. */
interface RefundDocument {
    name: string;
    status?: string;
    paid: number;
    /** What earlier vendor refunds already took off it. */
    refunded: number;
    /** Paid less refunded -- the most a new refund part against it may be. */
    refundable: number;
    total_amount?: number;
    amount_paid?: number;
    amount_invoiced?: number;
    amount_due?: number;
    tax_amount?: number;
    po_amount_delivered?: number;
    latest_payment_date?: string;
    creation?: string;
    /** A PO's amount before tax. */
    amount?: number;
    project?: string;
    /** The project's name, for the vendor-wide list (no project chosen). */
    project_name?: string;
}

/**
 * The Vendor Refund form, in place: which vendor paid the money back, on which project, and how much
 * of it is against each of that vendor's PAID POs and Work Orders there -- with whatever they leave
 * going to a Misc. Expense, against no document.
 *
 * ⚠️ THE VENDOR IS SUGGESTED, NEVER FORCED. `suggestRefundVendor` reads the vendor the bank remarks
 * name and answers only when they name exactly one; the suggestion lands only in a vendor the reviewer
 * has never touched (`undefined`), so clearing it is not undone on the next render.
 *
 * ⚠️ THE LISTS ARE THE SERVER'S (`get_vendor_refund_documents`), filtered by the same rule the write
 * re-checks: paid documents only, no merged PO. "Refund against" is MULTI-select: each ticked PO / WO
 * kind shows its list (unticking one drops its ticks), and ticks on every list collect in the Selected
 * section, each with its own amount. A ticked Misc. Expense joins that section as one read-only line
 * holding the rest of the refund (`refundMiscAmount`).
 *
 * ⚠️ THE PROJECT IS OPTIONAL: with none chosen the lists cover the vendor's documents on EVERY project
 * (each row names its project), and the server records each PO / WO refund on its document's project.
 * Projects offered are those not Completed, among won projects -- a project still in tendering has
 * nothing paid to refund. The dialog header shows the date and reference; this form states the amount.
 */
const NewVendorRefundForm = ({
    row,
    decision,
    onChange,
}: {
    row: OutflowImportRow;
    decision: RowDecision;
    onChange: (decision: RowDecision) => void;
}) => {
    const form = decision.newVendorRefund ?? {};
    const allocations = form.allocations ?? [];
    const update = (next: VendorRefundForm) => onChange({ ...decision, newVendorRefund: next });

    const { data: vendors, isLoading: vendorsLoading } = useFrappeGetDocList<{
        name: string;
        vendor_name: string;
        vendor_city?: string;
    }>(
        "Vendors",
        {
            fields: ["name", "vendor_name", "vendor_city"],
            limit: 0,
            orderBy: { field: "vendor_name", order: "asc" },
        },
        "outflow-vendor-refund-vendors"
    );

    const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<{
        name: string;
        project_name: string;
        status?: string;
    }>(
        "Projects",
        {
            fields: ["name", "project_name", "status"],
            filters: [
                ["tendering_status", "=", "Won"],
                ["status", "!=", "Completed"],
            ],
            limit: 0,
            orderBy: { field: "project_name", order: "asc" },
        },
        "outflow-vendor-refund-projects"
    );

    // The vendor alone is enough: no project means the vendor's documents on every project.
    const ready = Boolean(form.vendor);
    const { data: documentsData, isLoading: documentsLoading } = useFrappeGetCall<{
        message: Record<RefundDocumentType, RefundDocument[]>;
    }>(
        "nirmaan_stack.api.outflow_import.inflows.get_vendor_refund_documents",
        { vendor: form.vendor, project: form.project || undefined },
        ready ? `vendor-refund-documents-${form.vendor}-${form.project || "all"}` : null
    );
    const documents = ready ? documentsData?.message : undefined;
    // The Selected section's icons need the whole list row, found by kind + name.
    const documentByKey = useMemo(() => {
        const map = new Map<string, RefundDocument>();
        for (const type of REFUND_DOCUMENT_TYPES) {
            for (const document of documents?.[type.doctype] ?? []) {
                map.set(`${type.doctype}|${document.name}`, document);
            }
        }
        return map;
    }, [documents]);

    const suggested = useMemo(() => suggestRefundVendor(row, vendors ?? []), [row, vendors]);

    useEffect(() => {
        if (form.vendor !== undefined || !suggested) return;
        update(withRefundPick(form, { vendor: suggested }));
        // Keyed on the two values that decide it, as `NewInflowForm`'s customer effect is.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [suggested, form.vendor]);

    const { allocated, remaining } = refundAllocationTotals(form, row.amount);
    const miscAmount = refundMiscAmount(form, row.amount);
    const problem =
        allocations.length || miscAmount !== null ? refundAllocationProblem(form, row.amount) : null;
    const tickedIn = (type: RefundDocumentType) =>
        allocations.filter((a) => a.documentType === type).length;

    return (
        <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label className="text-xs">Vendor</Label>
                    <SearchPicker
                        value={form.vendor}
                        onChange={(vendor) => update(withRefundPick(form, { vendor }))}
                        loading={vendorsLoading}
                        placeholder="Choose a vendor…"
                        searchPlaceholder="Search vendors…"
                        options={(vendors ?? []).map((vendor) => ({
                            value: vendor.name,
                            label: vendor.vendor_name,
                            hint: vendor.vendor_city,
                        }))}
                    />
                    {suggested && form.vendor === suggested && (
                        <p className="text-xs text-muted-foreground">
                            Taken from the bank remarks. Change it if it is wrong.
                        </p>
                    )}
                </div>
                <div className="space-y-1.5">
                    <Label className="text-xs">
                        Project <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <SearchPicker
                        value={form.project}
                        onChange={(project) => update(withRefundPick(form, { project }))}
                        loading={projectsLoading}
                        placeholder="All projects"
                        searchPlaceholder="Search projects…"
                        options={(projects ?? []).map((project) => ({
                            value: project.name,
                            label: project.project_name,
                            hint: project.status,
                        }))}
                    />
                </div>
            </div>

            <div className="space-y-1.5">
                <Label className="text-xs">Refund against</Label>
                <div role="group" aria-label="Refund against" className="flex flex-wrap gap-2">
                    {REFUND_AGAINST_OPTIONS.map((option) => {
                        const isMisc = option.value === REFUND_MISC_EXPENSE;
                        const count = isMisc
                            ? undefined
                            : documents?.[option.value as RefundDocumentType]?.length;
                        const ticked = isMisc ? 0 : tickedIn(option.value as RefundDocumentType);
                        const checked = isRefundAgainst(form, option.value);
                        return (
                            <label
                                key={option.value}
                                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                                    checked
                                        ? "border-primary bg-primary/5"
                                        : "border-muted-foreground/20 hover:bg-muted/50"
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5 accent-primary"
                                    checked={checked}
                                    onChange={() => update(toggleRefundAgainst(form, option.value))}
                                />
                                {option.label}
                                {count !== undefined && (
                                    <span className="text-xs text-muted-foreground">({count})</span>
                                )}
                                {ticked > 0 && (
                                    <span className="rounded bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                                        {ticked} ticked
                                    </span>
                                )}
                                {isMisc && checked && (
                                    <span className="text-xs text-muted-foreground">takes the rest</span>
                                )}
                            </label>
                        );
                    })}
                </div>
            </div>

            {REFUND_DOCUMENT_TYPES.filter((type) => isRefundAgainst(form, type.doctype)).map((type) => (
                <RefundDocumentList
                    key={type.doctype}
                    documentType={type.doctype}
                    documents={documents?.[type.doctype] ?? []}
                    loading={ready && documentsLoading}
                    ready={ready}
                    allProjects={!form.project}
                    isTicked={(name) =>
                        allocations.some((a) => a.documentType === type.doctype && a.documentName === name)
                    }
                    onToggle={(document) =>
                        update(
                            toggleRefundAllocation(
                                form,
                                {
                                    documentType: type.doctype,
                                    documentName: document.name,
                                    label: document.name,
                                    project: document.project ?? null,
                                    paid: document.paid,
                                    refundable: document.refundable,
                                },
                                row.amount
                            )
                        )
                    }
                />
            ))}

            <RefundSelection
                allocations={allocations}
                documentFor={(allocation) =>
                    documentByKey.get(`${allocation.documentType}|${allocation.documentName}`)
                }
                miscAmount={miscAmount}
                miscDescription={form.miscDescription ?? ""}
                onMiscDescription={(miscDescription) => update({ ...form, miscDescription })}
                onRemoveMisc={() => update(toggleRefundAgainst(form, REFUND_MISC_EXPENSE))}
                refundAmount={row.amount}
                allocated={allocated}
                remaining={remaining}
                problem={problem}
                onAmount={(allocation, amount) =>
                    update(
                        setRefundAllocationAmount(
                            form,
                            allocation.documentType,
                            allocation.documentName,
                            amount
                        )
                    )
                }
                onRemove={(allocation) => update(toggleRefundAllocation(form, allocation, row.amount))}
            />
        </div>
    );
};

/**
 * The records of one kind a refund may be recorded against, with a tick each.
 *
 * ⚠️ AN EMPTY LIST SAYS WHY, because an empty table under a chosen vendor and project otherwise reads
 * as a list that failed to load.
 */
const RefundDocumentList = ({
    documentType,
    documents,
    loading,
    ready,
    allProjects,
    isTicked,
    onToggle,
}: {
    documentType: RefundDocumentType;
    documents: RefundDocument[];
    loading: boolean;
    ready: boolean;
    /** No project chosen: the list spans the vendor's projects, so each row names its own. */
    allProjects: boolean;
    isTicked: (name: string) => boolean;
    onToggle: (document: RefundDocument) => void;
}) => {
    const label = REFUND_DOCUMENT_TYPES.find((type) => type.doctype === documentType)?.label;

    if (!ready) {
        return (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                Choose a vendor to see their paid {label} list.
            </p>
        );
    }
    if (loading) {
        return (
            <p className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </p>
        );
    }
    if (!documents.length) {
        return (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                This vendor has no paid {label}
                {allProjects ? "" : " on this project"}.
            </p>
        );
    }

    return (
        <div className="max-h-[200px] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                        <th className="w-8 px-2 py-1.5" />
                        <th className="px-2 py-1.5 text-left font-medium">{label}</th>
                        {allProjects && <th className="px-2 py-1.5 text-left font-medium">Project</th>}
                        <th className="px-2 py-1.5 text-left font-medium">Status</th>
                        <th className="px-2 py-1.5 text-right font-medium">Total</th>
                        <th className="px-2 py-1.5 text-right font-medium">Paid</th>
                    </tr>
                </thead>
                <tbody>
                    {documents.map((document) => {
                        const ticked = isTicked(document.name);
                        return (
                            <tr
                                key={document.name}
                                className={`cursor-pointer border-t ${
                                    ticked ? "bg-primary/5" : "hover:bg-muted/40"
                                }`}
                                onClick={() => onToggle(document)}
                            >
                                <td className="px-2 py-1.5 text-center">
                                    <input
                                        type="checkbox"
                                        className="h-3.5 w-3.5 accent-primary"
                                        checked={ticked}
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={() => onToggle(document)}
                                    />
                                </td>
                                <td className="max-w-[280px] px-2 py-1.5">
                                    <span className="flex items-center gap-1">
                                        <span className="truncate font-medium">{document.name}</span>
                                        <RefundDocumentIcons
                                            documentType={documentType}
                                            name={document.name}
                                            document={document}
                                        />
                                    </span>
                                </td>
                                {allProjects && (
                                    <td
                                        className="max-w-[160px] truncate px-2 py-1.5 text-xs"
                                        title={document.project_name || document.project}
                                    >
                                        {document.project_name || document.project || "—"}
                                    </td>
                                )}
                                <td className="px-2 py-1.5 text-xs text-muted-foreground">
                                    {document.status || "—"}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums">
                                    {formatToRoundedIndianRupee(document.total_amount)}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums">
                                    {formatToIndianRupee(document.paid)}
                                    {document.refunded > 0 && (
                                        <span className="block text-[11px] text-muted-foreground">
                                            refunded {formatToIndianRupee(document.refunded)}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

/**
 * A PO's or WO's two icons -- the items (book) and the details panel -- shared by its list row and its
 * Selected line. The details icon needs the list row's figures, so it waits for them.
 *
 * ⚠️ THE ICONS STOP THE CLICK, so opening the items or the details never ticks or unticks a list row.
 * React bubbles a portal's clicks through this span too.
 */
const RefundDocumentIcons = ({
    documentType,
    name,
    document,
}: {
    documentType: RefundDocumentType;
    name: string;
    document: RefundDocument | undefined;
}) => (
    <span className="flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
        {documentType === "Procurement Orders" ? (
            <ItemsHoverCard
                parentDoc={{ name } as any}
                parentDoctype="Procurement Orders"
                childTableName="items"
            />
        ) : (
            <ItemsHoverCard
                parentDoc={{ name } as any}
                parentDoctype="Service Requests"
                childTableName="work_order_items"
                isSR
            />
        )}
        {document && <RefundDocumentDetails documentType={documentType} document={document} />}
    </span>
);

/**
 * A PO's or WO's figures, one click from its row: what it is worth, what was delivered, invoiced and
 * paid on it, what vendor refunds already took off it, and a link to its payments page.
 *
 * Everything shown comes from the list row `get_vendor_refund_documents` already sent -- nothing is
 * fetched on open.
 */
const RefundDocumentDetails = ({
    documentType,
    document,
}: {
    documentType: RefundDocumentType;
    document: RefundDocument;
}) => {
    const isPO = documentType === "Procurement Orders";
    const money = (value?: number) =>
        value === undefined || value === null ? "—" : formatToIndianRupee(value);
    const date = (value?: string) => (value ? formatDate(value.split(/[ T]/)[0]) : "—");
    const lines: [string, string][] = [
        ["Status", document.status || "—"],
        ["Created", date(document.creation)],
        ...(isPO
            ? ([
                  ["Amount (excl. tax)", money(document.amount)],
                  ["Tax", money(document.tax_amount)],
              ] as [string, string][])
            : []),
        [isPO ? "Total (incl. tax)" : "Total", money(document.total_amount)],
        ...(isPO ? ([["Delivered", money(document.po_amount_delivered)]] as [string, string][]) : []),
        ["Invoiced", money(document.amount_invoiced)],
        ["Paid", money(document.paid)],
        ["Refunded (vendor refunds)", money(document.refunded)],
        ["Still refundable", money(document.refundable)],
        ["Due", money(document.amount_due)],
        ...(isPO ? ([["Last payment", date(document.latest_payment_date)]] as [string, string][]) : []),
    ];

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`${document.name} details`}
                    className="cursor-pointer rounded p-1 hover:bg-gray-100"
                >
                    <Info className="h-4 w-4 text-muted-foreground" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
                <div className="border-b px-3 py-2">
                    <p className="text-sm font-semibold">{document.name}</p>
                    <p className="text-xs text-muted-foreground">{isPO ? "Purchase order" : "Work order"}</p>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2 text-xs">
                    {lines.map(([label, value]) => (
                        <div key={label} className="contents">
                            <dt className="text-muted-foreground">{label}</dt>
                            <dd className="text-right tabular-nums">{value}</dd>
                        </div>
                    ))}
                </dl>
                <div className="border-t px-3 py-2">
                    <Link
                        to={orderPaymentsHref(document.name)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                        Open {isPO ? "PO" : "WO"} payments <ExternalLink className="h-3 w-3" />
                    </Link>
                </div>
            </PopoverContent>
        </Popover>
    );
};

/**
 * The ticked documents, each with the part of the refund against it, the Misc. Expense line when it is
 * ticked, and the running total.
 *
 * ⚠️ THE MISC. EXPENSE AMOUNT IS SHOWN, NEVER TYPED: it is whatever the ticked documents leave
 * (`refundMiscAmount`), so it follows every PO / WO amount change. A blank figure means nothing is left.
 *
 * The line under the total says what still stops Confirm -- `refundAllocationProblem`, the same rule
 * the confirm gate and the bulk bar read.
 */
const RefundSelection = ({
    allocations,
    documentFor,
    miscAmount,
    miscDescription,
    onMiscDescription,
    onRemoveMisc,
    refundAmount,
    allocated,
    remaining,
    problem,
    onAmount,
    onRemove,
}: {
    allocations: RefundAllocation[];
    /** The list row behind a tick, for its details panel; absent while the list is loading. */
    documentFor: (allocation: RefundAllocation) => RefundDocument | undefined;
    /** The Misc. Expense part, or `null` when Misc. Expense is not ticked. */
    miscAmount: number | null;
    miscDescription: string;
    onMiscDescription: (description: string) => void;
    onRemoveMisc: () => void;
    refundAmount: number;
    allocated: number;
    remaining: number;
    problem: string | null;
    onAmount: (allocation: RefundAllocation, amount: number | null) => void;
    onRemove: (allocation: RefundAllocation) => void;
}) => {
    const typeLabel = (type: RefundDocumentType) =>
        REFUND_DOCUMENT_TYPES.find((t) => t.doctype === type)?.label ?? type;
    const lineCount = allocations.length + (miscAmount !== null ? 1 : 0);

    return (
        <div className="rounded-md border">
            <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <span>Selected ({lineCount})</span>
                <span>Amount</span>
            </div>
            {lineCount === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                    Tick the POs or WOs this refund is against, or Misc. Expense for the rest.
                </p>
            ) : (
                <ul className="divide-y">
                    {allocations.map((allocation) => (
                        <li
                            key={`${allocation.documentType}|${allocation.documentName}`}
                            className="flex items-center gap-2 px-3 py-1.5"
                        >
                            <span className="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {typeLabel(allocation.documentType)}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1">
                                    <span className="truncate text-sm" title={allocation.label}>
                                        {allocation.label}
                                    </span>
                                    <RefundDocumentIcons
                                        documentType={allocation.documentType}
                                        name={allocation.documentName}
                                        document={documentFor(allocation)}
                                    />
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                    paid {formatToIndianRupee(allocation.paid)}
                                    {allocation.refundable < allocation.paid &&
                                        ` · refundable ${formatToIndianRupee(allocation.refundable)}`}
                                    {documentFor(allocation)?.project_name &&
                                        ` · ${documentFor(allocation)?.project_name}`}
                                </span>
                            </span>
                            <Input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step="0.01"
                                className="h-8 w-32 text-right tabular-nums"
                                value={allocation.amount ?? ""}
                                onChange={(event) =>
                                    onAmount(
                                        allocation,
                                        event.target.value === "" ? null : Number(event.target.value)
                                    )
                                }
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                aria-label={`Remove ${allocation.label}`}
                                onClick={() => onRemove(allocation)}
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        </li>
                    ))}
                    {miscAmount !== null && (
                        <li className="flex items-center gap-2 px-3 py-1.5">
                            <span className="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Misc. Expense
                            </span>
                            <span className="min-w-0 flex-1 space-y-1">
                                <span className="block text-xs text-muted-foreground">
                                    Rest of the refund is against a vendor Misc Expense
                                </span>
                                <Input
                                    className="h-8 text-sm"
                                    placeholder="Description — what was this misc. expense?"
                                    value={miscDescription}
                                    onChange={(event) => onMiscDescription(event.target.value)}
                                />
                            </span>
                            <span className="w-32 pr-3 text-right text-sm tabular-nums">
                                {miscAmount > 0 ? formatToIndianRupee(miscAmount) : "—"}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                aria-label="Remove Misc. Expense"
                                onClick={onRemoveMisc}
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        </li>
                    )}
                </ul>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-1.5 text-xs">
                <span className={problem ? "text-amber-700" : "text-muted-foreground"}>
                    {problem ?? (lineCount ? "Ready to confirm." : "")}
                </span>
                <span className="tabular-nums">
                    Allocated{" "}
                    <span className="font-medium">{formatToIndianRupee(allocated)}</span> of{" "}
                    <span className="font-medium">{formatToIndianRupee(refundAmount)}</span>
                    {remaining !== 0 && (
                        <span className="text-muted-foreground">
                            {" "}
                            · {remaining > 0 ? "left" : "over"} {formatToIndianRupee(Math.abs(remaining))}
                        </span>
                    )}
                </span>
            </div>
        </div>
    );
};

/**
 * A searchable single-select over a long list (vendors, projects), inside the dialog.
 *
 * The ✕ clears the pick with `null`. It sits BESIDE the trigger, not inside it -- a button nested in
 * the trigger button is invalid HTML and would also open the popover. `null`, not `undefined`, so a
 * cleared vendor is not re-filled by the refund form's bank-remarks suggestion.
 */
const SearchPicker = ({
    value,
    onChange,
    options,
    loading,
    placeholder,
    searchPlaceholder,
}: {
    value?: string | null;
    onChange: (value: string | null) => void;
    options: { value: string; label: string; hint?: string }[];
    loading?: boolean;
    placeholder: string;
    searchPlaceholder: string;
}) => {
    const [open, setOpen] = useState(false);
    const chosen = options.find((option) => option.value === value);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <div className="relative">
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="h-9 w-full justify-between px-3 font-normal"
                    >
                        <span className={`truncate ${chosen ? "pr-6" : "text-muted-foreground"}`}>
                            {chosen ? chosen.label : loading ? "Loading…" : placeholder}
                        </span>
                        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                {chosen && (
                    <button
                        type="button"
                        aria-label="Clear"
                        title="Clear"
                        onClick={() => onChange(null)}
                        className="absolute right-8 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                    <CommandInput placeholder={searchPlaceholder} />
                    <CommandList className="max-h-[260px]">
                        <CommandEmpty>Nothing matches that.</CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => (
                                <CommandItem
                                    key={option.value}
                                    value={option.value}
                                    keywords={[option.label, option.hint ?? ""]}
                                    onSelect={() => {
                                        onChange(option.value);
                                        setOpen(false);
                                    }}
                                >
                                    <Check
                                        className={`mr-2 h-4 w-4 shrink-0 ${
                                            option.value === value ? "opacity-100" : "opacity-0"
                                        }`}
                                    />
                                    <span className="truncate">{option.label}</span>
                                    {option.hint && (
                                        <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                                            {option.hint}
                                        </span>
                                    )}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
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
