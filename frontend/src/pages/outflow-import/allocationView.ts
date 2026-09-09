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

/** Mirrors `amounts.AMOUNT_TOLERANCE`. ⚠️ The ONLY copy on this side -- do not inline it again. */
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
    return rowStatus === "Partially Allocated" ? "allocate_row" : "settle_row";
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
