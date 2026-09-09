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
 * Which endpoint a confirm should call.
 *
 * ⚠️ THE SAFETY RULE OF THE WHOLE SLICE. A single tick on an untouched row keeps going to
 * `settle_row`, which is byte-unchanged and carries the STRICTER guard (the record must equal the
 * whole transfer). So every settle that worked before ADR-0020 takes the identical code path, and
 * the weaker remainder-bounded guard is reachable only on the new shape.
 */
export function chooseSettleEndpoint({
    ticks,
    rowStatus,
}: {
    ticks: number;
    rowStatus: string;
}): "settle_row" | "allocate_row" | null {
    if (ticks <= 0) return null;
    if (ticks > 1) return "allocate_row";
    // ⚠️ BOUND, NOT SPELLED (review fix 5) -- `ROW_PARTIALLY_ALLOCATED` is a pure leaf constant
    // (`outflowImportStatus.ts`), so importing it here adds no cycle.
    return rowStatus === ROW_PARTIALLY_ALLOCATED ? "allocate_row" : "settle_row";
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
