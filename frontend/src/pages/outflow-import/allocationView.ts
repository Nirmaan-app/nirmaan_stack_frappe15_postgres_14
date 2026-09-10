// src/pages/outflow-import/allocationView.ts
//
// PURE MODULE -- no React, no fetching. The screen's half of the allocation arithmetic
// (ADR-0020), and the rule for which endpoint a confirm should call.
//
// ⚠️ THE SERVER IS THE AUTHORITY. It re-reads every leg under a row lock and re-asserts the fit.
// This exists so the balance bar can move as the reviewer ticks, without a round trip.
//
// ⚠️ IT MIRRORS `services/outflow_import/allocation.py` AND MUST NOT BE STRICTER THAN IT. The
// same rule the TDS band mirror already carries: erring toward OFFERING is safe, because the
// server re-asserts; erring the other way hides a choice the server would have accepted.

import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ROW_PARTIALLY_ALLOCATED } from "./outflowImportStatus";

/**
 * Mirrors `amounts.AMOUNT_TOLERANCE`.
 *
 * ⚠️ REGISTERED IN `services/outflow_import/amounts.py`'s CALL-SITE LIST, where the rule lives:
 * "if you add an amount comparison anywhere in this feature, add it to this list -- and say WHICH
 * window it uses." This mirror, and the three `allocation.py` comparisons it mirrors, were added to
 * that list at the whole-branch review (F6). Do not add a comparison on this side without going
 * back to it: the file records the production defect an unlisted fifth site already caused.
 *
 * ⚠️ THE ONLY NUMERIC LITERAL `= 5` ON THIS SIDE (review fix 2) -- do not inline it again, and do
 * not add a second `export const ... = 5` anywhere else in this feature. `outflowTableModel.ts`'s
 * `SETTLE_WINDOW` used to be exactly that second copy (both mirror the SAME server constant,
 * `services/outflow_import/amounts.AMOUNT_TOLERANCE` -- there are not two windows here); it now
 * imports this one instead of re-declaring it. This is the pure leaf, so it owns the literal and
 * the 3,000-line table model imports it -- not the other way round, and there is no cycle to check
 * both ways: this file imports nothing from `outflowTableModel.ts`.
 */
export const AMOUNT_TOLERANCE = 5;

export interface AllocationLeg {
    target_amount: number;
    match_kind: string;
}

export interface AllocationBar {
    allocated: number;
    remaining: number;
    over: boolean;
    complete: boolean;
}

/** What is allocated once these ticks are added to what is already banked. */
export function allocationBar(
    rowAmount: number,
    legs: readonly AllocationLeg[],
    tickedAmounts: readonly number[],
): AllocationBar {
    const banked = legs
        .filter((leg) => leg.match_kind === "Settled")
        .reduce((sum, leg) => sum + (leg.target_amount || 0), 0);
    const ticked = tickedAmounts.reduce((sum, amount) => sum + (amount || 0), 0);
    const allocated = banked + ticked;
    const remaining = rowAmount - allocated;
    return {
        allocated,
        remaining,
        over: remaining < -AMOUNT_TOLERANCE,
        // ⚠️ DELIBERATELY TWO-SIDED, UNLIKE THE SERVER'S `is_fully_allocated` (review fix 6,
        // PINNED by `allocationBar.test`'s "two-sided vs the server's one-sided" case). The
        // server's own check is ONE-SIDED (`remaining <= AMOUNT_TOLERANCE`), so an OVER-allocated
        // remaining (a large negative number) still reads `True` there -- it relies on
        // `is_over_allocated` as a SEPARATE guard to catch that case before a write commits. This
        // `complete` folds both into one boolean for the button label, so it must not call an
        // over-tick "complete" -- `Math.abs` is what keeps a large negative `remaining` from
        // reading as finished. Harmless in practice: `over` (above) already disables Confirm
        // before an over-allocated tick-set can be submitted, so the two sides never actually
        // disagree about what gets written -- but nothing else states that this is on purpose,
        // so a later "fix" to either side would have no test to trip.
        complete: Math.abs(remaining) <= AMOUNT_TOLERANCE,
    };
}

/**
 * How the reviewer intends to settle this transfer (ADR-0020 B3, issue #1241).
 *
 * ⚠️ THE LABELS THE SCREEN USES ARE NOT THESE IDS, AND THE WORD "PARTIAL" IS BANNED FROM THEM. The
 * same dialog already renders a radio labelled *"A part payment"*, belonging to the INVERSE feature
 * (one approved payment split across several TRANSFERS). Two radio groups in one dialog with
 * near-identical labels and opposite meanings is the worst available outcome, so the visible copy
 * lives in `SETTLE_MODE_LABEL` below and says "Split across several payments".
 */
export type SettleMode = "normal" | "split";

/** What a row opens on. ⚠️ Mode is NOT remembered between rows -- a sticky one splits by accident. */
export const DEFAULT_SETTLE_MODE: SettleMode = "normal";

/**
 * The visible copy, in one place so the ban above is checkable and the radio and any sentence that
 * names a mode can never drift apart.
 */
export const SETTLE_MODE_LABEL: Record<SettleMode, string> = {
    normal: "Normal",
    split: "Split across several payments",
};

export const SETTLE_MODE_HINT: Record<SettleMode, string> = {
    normal: "One approved record settles this whole transfer.",
    split: "Allocate this transfer across several approved payments, over as many sittings as you need.",
};

/**
 * Whether the reviewer gets a choice of mode at all.
 *
 * ⚠️ A `Partially Allocated` ROW HAS NO CHOICE, AND OFFERING ONE WOULD BE A LIE. `settle_row`'s
 * `_load_settleable_row` does not admit that status, so the Normal path is refused server-side
 * before it can write anything.
 */
export function settleModeLocked(rowStatus: string): boolean {
    // ⚠️ BOUND, NOT SPELLED (review fix 5) -- `ROW_PARTIALLY_ALLOCATED` is a pure leaf constant
    // (`outflowImportStatus.ts`), so importing it here adds no cycle.
    return rowStatus === ROW_PARTIALLY_ALLOCATED;
}

/**
 * The mode that actually governs, after the row's own status has had its say.
 *
 * ⚠️ AN ABSENT MODE IS NORMAL, AND THAT IS LOAD-BEARING, NOT A CONVENIENCE DEFAULT. The BULK
 * "confirm all matched" path has no dialog and therefore no radio; it calls the router with no mode
 * at all and must keep taking `settle_row`'s stricter, byte-unchanged path. Splitting a transfer is
 * a judgement call and does not belong in a fifty-row action (ADR-0020 B3, permanently).
 */
export function effectiveSettleMode(
    chosen: SettleMode | undefined,
    rowStatus: string,
): SettleMode {
    if (settleModeLocked(rowStatus)) return "split";
    return chosen ?? DEFAULT_SETTLE_MODE;
}

/**
 * Which endpoint a confirm should call.
 *
 * ⚠️ ROUTING READS INTENT, NOT TICK COUNT (issue #1241, ADR-0020 B3 -- REPLACING the original rule).
 * It used to send a single tick on an untouched row to `settle_row` whatever the reviewer meant,
 * and `settle_row`'s guard demands the record equal the WHOLE transfer -- so the remainder-bounded
 * guard was reachable only with two ticks or on an already-allocated row, and there was no way at
 * all to place a first leg smaller than the transfer and come back for the second. That was the
 * owner's actual blocker. The MODE now decides.
 *
 * ⚠️ SPLIT ALWAYS ROUTES THROUGH `allocate_row`, INCLUDING A SINGLE TICK THAT HAPPENS TO EQUAL THE
 * WHOLE TRANSFER -- and this function cannot see an amount, which is what makes an amount-based
 * shortcut impossible rather than merely discouraged. Reversal operates on LEGS and `settle_row`
 * writes none, so a shortcut would make two identical-looking actions behave differently on undo,
 * with nothing on screen saying which one you got.
 *
 * ⚠️ THE SAFETY RULE SURVIVES INTACT ON THE NORMAL SIDE: a single Normal pick keeps taking
 * `settle_row`, byte-unchanged, with its stricter whole-transfer guard. Every settle that worked
 * before ADR-0020 -- including every bulk one, which passes no mode -- takes the identical path.
 */
export function chooseSettleEndpoint({
    ticks,
    rowStatus,
    mode,
}: {
    ticks: number;
    rowStatus: string;
    /** Absent means Normal. See `effectiveSettleMode` for why that default is load-bearing. */
    mode?: SettleMode;
}): "settle_row" | "allocate_row" | null {
    if (ticks <= 0) return null;
    if (effectiveSettleMode(mode, rowStatus) === "split") return "allocate_row";
    // ⚠️ THIS IS A CAPACITY RULE, NOT THE OLD TICK-COUNT RULE SURVIVING. `settle_row` takes ONE
    // target, so routing a multi-pick there would settle the first record and silently DROP the
    // rest -- a money bug. Normal mode's picker is single-select by construction, so this branch is
    // unreachable from the product; it exists so that a writer that ever produced the shape lands
    // on the endpoint that can EXPRESS it and is refused loudly, rather than half-written in
    // silence. Do not fold it back into an intent rule.
    if (ticks > 1) return "allocate_row";
    return "settle_row";
}

export function allocateButtonLabel({
    ticks,
    complete,
}: {
    ticks: number;
    complete: boolean;
}): string {
    const noun = ticks === 1 ? "record" : "records";
    const base = `Allocate ${ticks} ${noun}`;
    return complete ? `${base} · completes this transfer` : base;
}

/**
 * What the screen says after a leg is successfully reversed.
 *
 * ⚠️ IT EXISTS BECAUSE A SUCCESSFUL REVERSE SAID NOTHING AT ALL (whole-branch review, F9). The
 * dialog closed and the table refetched, which is indistinguishable from a click that did nothing.
 * This is the ONE action on this screen that moves money BACKWARDS, and therefore the one a
 * reviewer is most likely to repeat when unsure -- and repeating it is REFUSED ("This allocation
 * was already reversed"), so the silence trains a second click that then reads as a failure.
 *
 * ⚠️ INLINE, NEVER A TOAST -- this screen's standing convention, stated at `exportError`. A
 * reversal is a fact somebody may need to quote to whoever asks why a payment went back to
 * Approved, and a toast that has faded cannot be quoted. It is rendered on the PAGE rather than in
 * the dialog because the dialog closes on success.
 *
 * PURE, so the wording of both shapes is testable without a round trip -- the same reason
 * `allocation.allocation_note` is pure on the server side.
 */
export function reversalNotice({
    targetName,
    reversedAmount,
    allocated,
    remaining,
}: {
    targetName: string;
    reversedAmount: number;
    allocated: number;
    remaining: number;
}): string {
    const head = `Reversed ${formatToRoundedIndianRupee(reversedAmount)} from ${targetName}. It is back to Approved.`;
    // ⚠️ THE BALANCE, NEVER A LEG COUNT -- ADR-0020's rule, and the same one `allocation_note`
    // states server-side. "2 of 3 legs left" invites "three according to whom?", which nothing in
    // the data answers; the remaining amount is checkable against the statement line by eye.
    return allocated > 0
        ? `${head} ${formatToRoundedIndianRupee(remaining)} of this transfer is still unallocated.`
        : `${head} Nothing is allocated against this transfer now.`;
}

/**
 * Why Confirm is unavailable.
 *
 * ⚠️ A REASON, NOT A BOOLEAN, AND THAT IS THE POINT OF EXTRACTING THIS (#1239). The button's
 * `disabled` and the sentence the reviewer reads beside it used to be derived at two different
 * places inside `DecisionDialog` -- the gate as one OR-expression in the footer, the wording as two
 * separate JSX conditions in the balance bar. Nothing tied them together, so a change to one could
 * silently stop describing the other: a dead control with the wrong explanation, or with none.
 */
export type ConfirmGateReason =
    | "busy"
    | "decision-incomplete"
    | "balance-unknown"
    | "over-allocated";

/** The subset of reasons the allocation arithmetic produces -- the two the balance bar speaks. */
export type BalanceGateReason = Extract<
    ConfirmGateReason,
    "balance-unknown" | "over-allocated"
>;

export interface ConfirmGate {
    /**
     * Why Confirm is unavailable, or `null` when it is available -- so the button's `disabled` IS
     * `reason !== null`, read that way at the call site.
     *
     * ⚠️ THERE IS DELIBERATELY NO `disabled: boolean` BESIDE THIS. A convenience projection is
     * exactly what lets a caller take the boolean and never consult the reason, which is the
     * "bare boolean" shape #1239 exists to remove -- the ticket's requirement is that the dialog
     * render the disabled state FROM the reason, and a second field would quietly excuse it from
     * doing so. Do not add one back.
     *
     * ⚠️ IT IS TOTAL, WHICH IS WHY `busy` AND `decision-incomplete` ARE MEMBERS even though nothing
     * on screen says either out loud today (neither had a message before this change, and #1239 is
     * a prefactor with no user-visible change). Without them `reason` would read `null` -- "Confirm
     * is available" -- on a row where the button is plainly dead, and the narrowing ticket needs to
     * know WHICH blocker won in order to narrow the right one.
     */
    reason: ConfirmGateReason | null;
    /**
     * What the balance itself has to say, whichever decision card is chosen.
     *
     * ⚠️ DELIBERATELY NOT GATED ON `balanceGoverns`. A `Partially Allocated` row whose reviewer has
     * opened the "create a new expense" card still has legs nobody has read yet, and the bar must
     * keep saying so -- printing a confident `allocated ₹0 · left ₹<the whole transfer>` there is
     * the false-confidence defect review fix 1 removed. So `disabled` respects which path is being
     * confirmed and this does not; both still come out of ONE call, which is what stops the gate
     * and the message disagreeing.
     */
    balanceReason: BalanceGateReason | null;
    /** The sentence for `balanceReason`, ready to render. `null` when the balance is fine. */
    balanceMessage: string | null;
}

/**
 * ⚠️ THE EXACT STRINGS THE DIALOG USED TO CARRY INLINE. Moved here so the message and the gate are
 * one value; the wording is unchanged.
 */
const BALANCE_MESSAGES: Record<BalanceGateReason, string> = {
    "balance-unknown":
        "Balance not yet known — waiting on what this transfer has already settled.",
    "over-allocated": "— untick something before confirming",
};

/**
 * Whether Confirm is available, and why not.
 *
 * ⚠️ PURE, AND THAT IS THE REASON IT EXISTS. This repo has no DOM test environment, by deliberate
 * choice (`frontend/CLAUDE.md`), so an expression living inside the dialog component is untestable
 * where it sits -- which is how this gate survived four review passes while making the part-payment
 * and TDS-deduction detours unreachable from the product. The narrowing that fixes that is a
 * separate ticket; this one only moves the rule somewhere a test can see it.
 *
 * ⚠️ `balanceGoverns` IS AN INPUT, NOT A CONSTANT. Today the dialog passes "this is a link
 * decision"; the narrowing ticket will pass "the allocation endpoint is the one being called",
 * reusing `chooseSettleEndpoint`. Behaviour is byte-identical either way at this ticket.
 *
 * ⚠️ `balance-unknown` OUTRANKS `over-allocated`, matching the bar's own short-circuit -- an
 * over-tick measured against a balance nobody has read is not a fact worth reporting.
 */
export function confirmGate({
    busy,
    decisionConfirmable,
    balanceGoverns,
    legsUnknown,
    over,
}: {
    busy: boolean;
    decisionConfirmable: boolean;
    balanceGoverns: boolean;
    legsUnknown: boolean;
    over: boolean;
}): ConfirmGate {
    const balanceReason: BalanceGateReason | null = legsUnknown
        ? "balance-unknown"
        : over
          ? "over-allocated"
          : null;

    // ⚠️ ORDER IS PRECEDENCE, AND ONLY THE REPORTED REASON DEPENDS ON IT -- every branch produces
    // the same `reason !== null`, because the expression this replaced was a plain OR. So a
    // re-ordering can never change whether Confirm is available, only which blocker gets named.
    const reason: ConfirmGateReason | null = busy
        ? "busy"
        : !decisionConfirmable
          ? "decision-incomplete"
          : balanceGoverns
            ? balanceReason
            : null;

    return {
        reason,
        balanceReason,
        balanceMessage: balanceReason ? BALANCE_MESSAGES[balanceReason] : null,
    };
}
