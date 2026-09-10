import { describe, expect, it } from "vitest";

import {
    allocateButtonLabel,
    allocationBar,
    chooseSettleEndpoint,
    confirmGate,
    reversalNotice,
} from "./allocationView";

const leg = (amount: number) => ({ target_amount: amount, match_kind: "Settled" });

describe("allocationBar", () => {
    it("reports the whole transfer as remaining when nothing is allocated", () => {
        expect(allocationBar(213396, [], [])).toEqual({
            allocated: 0, remaining: 213396, over: false, complete: false,
        });
    });

    it("counts already-allocated legs and the current ticks together", () => {
        const bar = allocationBar(213396, [leg(55819), leg(5310)], [63720, 33268]);
        expect(bar.allocated).toBe(158117);
        expect(bar.remaining).toBe(55279);
        expect(bar.over).toBe(false);
    });

    it("ignores a reversed leg", () => {
        const legs = [leg(55819), { target_amount: 5310, match_kind: "Reversed" }];
        expect(allocationBar(213396, legs, []).allocated).toBe(55819);
    });

    it("flags an over-tick without refusing to compute it", () => {
        // ⚠️ Over-ticking is ALLOWED; the BUTTON is what disables. Disabling the rows instead
        // makes it a puzzle -- the reviewer may want to untick something else first.
        const bar = allocationBar(100, [], [60, 30, 20]);
        expect(bar.over).toBe(true);
        expect(bar.remaining).toBe(-10);
    });

    it("is complete inside the same +/- 5 window the server uses", () => {
        expect(allocationBar(100, [], [98]).complete).toBe(true);
        expect(allocationBar(100, [], [95]).complete).toBe(true);
        expect(allocationBar(100, [], [94]).complete).toBe(false);
    });

    // Review fix 6: `complete` is deliberately TWO-SIDED (`Math.abs(remaining) <= tolerance`),
    // unlike the server's `is_fully_allocated` (ONE-SIDED: `remaining <= tolerance`, which reads
    // an over-allocated remaining as "fully allocated" too and relies on the separate
    // `is_over_allocated` guard to catch that case before a write commits). Harmless here because
    // `over` already disables Confirm before an over-allocated tick-set can be submitted -- this
    // pins that the divergence is deliberate, so a later "fix" to either side has a test to trip.
    it("never calls an over-allocated tick-set complete, unlike the server's one-sided check", () => {
        const bar = allocationBar(100, [], [120]);
        expect(bar.over).toBe(true);
        expect(bar.remaining).toBe(-20);
        expect(bar.complete).toBe(false);
    });
});

describe("chooseSettleEndpoint", () => {
    it("uses settle_row for a single tick on an untouched row", () => {
        // ⚠️ THE SAFETY RULE. Every settle that worked before ADR-0020 keeps the identical path,
        // including its STRICTER amount guard.
        expect(chooseSettleEndpoint({ ticks: 1, rowStatus: "Matched" })).toBe("settle_row");
        expect(chooseSettleEndpoint({ ticks: 1, rowStatus: "Mismatched" })).toBe("settle_row");
    });

    it("uses allocate_row for two or more ticks", () => {
        expect(chooseSettleEndpoint({ ticks: 2, rowStatus: "Matched" })).toBe("allocate_row");
    });

    it("uses allocate_row for a single tick on an already-allocated row", () => {
        // settle_row would refuse it: _load_settleable_row does not admit this status.
        expect(
            chooseSettleEndpoint({ ticks: 1, rowStatus: "Partially Allocated" }),
        ).toBe("allocate_row");
    });

    it("chooses nothing when nothing is ticked", () => {
        expect(chooseSettleEndpoint({ ticks: 0, rowStatus: "Matched" })).toBeNull();
    });
});

describe("allocateButtonLabel", () => {
    it("names the count of records, not the money", () => {
        expect(allocateButtonLabel({ ticks: 2, complete: false })).toBe("Allocate 2 records");
        expect(allocateButtonLabel({ ticks: 1, complete: false })).toBe("Allocate 1 record");
    });

    it("says so when the tick-set finishes the transfer", () => {
        expect(allocateButtonLabel({ ticks: 2, complete: true })).toBe(
            "Allocate 2 records · completes this transfer",
        );
    });
});

describe("reversalNotice -- a successful reverse has to SAY it worked (review F9)", () => {
    // ⚠️ THE SILENCE WAS THE DEFECT. The dialog closed and the table refetched, which is
    // indistinguishable from a click that did nothing -- on the one action on this screen that
    // moves money BACKWARDS, and therefore the one a reviewer repeats when unsure. Repeating it is
    // REFUSED, so the silence trained a second click that then read as a failure.
    it("names the record, so the sentence can be quoted later", () => {
        const note = reversalNotice({
            targetName: "PAY-00105-034",
            reversedAmount: 60,
            allocated: 40,
            remaining: 60,
        });
        expect(note).toContain("PAY-00105-034");
        expect(note).toContain("back to Approved");
    });

    it("states the BALANCE while something is still allocated, never a leg count", () => {
        // ADR-0020's rule, mirrored from `allocation.allocation_note`: "2 of 3 legs" invites
        // "three according to whom?", which nothing in the data answers.
        const note = reversalNotice({
            targetName: "PAY-1",
            reversedAmount: 60,
            allocated: 40,
            remaining: 60,
        });
        expect(note).toContain("still unallocated");
        expect(note).not.toMatch(/\bleg/i);
    });

    it("says the transfer is back to nothing when the last leg goes", () => {
        const note = reversalNotice({
            targetName: "PAY-1",
            reversedAmount: 100,
            allocated: 0,
            remaining: 100,
        });
        expect(note).toContain("Nothing is allocated");
        expect(note).not.toContain("still unallocated");
    });
});

describe("confirmGate", () => {
    // The state a reviewer is in almost all of the time: a live decision, legs known, ticks fit.
    const open = {
        busy: false,
        decisionConfirmable: true,
        balanceGoverns: true,
        legsUnknown: false,
        over: false,
    };

    // ⚠️ A WHOLE-OBJECT ASSERT ON PURPOSE: it fails if a `disabled: boolean` is ever added back
    // beside `reason`. That projection is exactly what lets a caller take the boolean and never
    // consult the reason -- the "bare boolean" shape #1239 removed.
    it("is available, with nothing to say, when nothing blocks", () => {
        expect(confirmGate(open)).toEqual({
            reason: null,
            balanceReason: null,
            balanceMessage: null,
        });
    });

    it("reports a request in flight", () => {
        expect(confirmGate({ ...open, busy: true }).reason).toBe("busy");
    });

    it("reports a decision that is not yet a decision", () => {
        expect(confirmGate({ ...open, decisionConfirmable: false }).reason).toBe(
            "decision-incomplete"
        );
    });

    it("refuses a confirm against a balance nobody has read yet", () => {
        // Review fix 1, now pinned: `[]` legs on a Partially Allocated row is the SWR default and
        // is also what a failed fetch leaves behind. Neither means "nothing is settled".
        const gate = confirmGate({ ...open, legsUnknown: true });
        expect(gate.reason).toBe("balance-unknown");
        expect(gate.balanceMessage).toBe(
            "Balance not yet known — waiting on what this transfer has already settled."
        );
    });

    it("refuses an over-tick and says what to do about it", () => {
        const gate = confirmGate({ ...open, over: true });
        expect(gate.reason).toBe("over-allocated");
        expect(gate.balanceMessage).toBe("— untick something before confirming");
    });

    it("puts an unknown balance ahead of an over-tick measured against it", () => {
        // The bar short-circuits the same way. An over-tick computed from legs nobody has read is
        // not a fact worth reporting -- the honest answer is that the balance is unknown.
        const gate = confirmGate({ ...open, legsUnknown: true, over: true });
        expect(gate.reason).toBe("balance-unknown");
        expect(gate.balanceReason).toBe("balance-unknown");
    });

    // ⚠️ THE CASE THAT MADE THIS ONE VALUE INSTEAD OF TWO. The gate and the sentence are derived
    // together, so a future change cannot leave a disabled button explained by the wrong message.
    it("explains the disabled button with the same reason the balance is showing", () => {
        for (const balance of [{ legsUnknown: true }, { over: true }]) {
            const gate = confirmGate({ ...open, ...balance });
            expect(gate.reason).toBe(gate.balanceReason);
            expect(gate.balanceMessage).not.toBeNull();
        }
    });

    // ⚠️ ALSO LOAD-BEARING, AND THE OPPOSITE DIRECTION. On a "create a new expense" card the
    // allocation arithmetic does not govern the confirm -- but the row's legs are still unread, and
    // the bar must keep saying so rather than printing a confident zero.
    it("still reports the balance when the balance does not govern the confirm", () => {
        const gate = confirmGate({ ...open, balanceGoverns: false, legsUnknown: true });
        expect(gate.reason).toBeNull();
        expect(gate.balanceReason).toBe("balance-unknown");
        expect(gate.balanceMessage).toContain("Balance not yet known");
    });

    it("lets an over-tick through when the balance does not govern the confirm", () => {
        const gate = confirmGate({ ...open, balanceGoverns: false, over: true });
        expect(gate.reason).toBeNull();
        expect(gate.balanceReason).toBe("over-allocated");
    });

    it("names the outermost blocker when several apply at once", () => {
        const gate = confirmGate({
            busy: true,
            decisionConfirmable: false,
            balanceGoverns: true,
            legsUnknown: true,
            over: true,
        });
        expect(gate.reason).toBe("busy");
        // The balance still reports itself -- the bar is not silenced by a request being in flight.
        expect(gate.balanceReason).toBe("balance-unknown");
    });

    // ⚠️ THE THIRD READER. `DecisionDialog`'s button LABEL must not claim "· completes this
    // transfer" off a balance nobody has read, and it used to answer that from raw `legsUnknown`.
    // It now asks the gate, so this pins the equivalence the swap relied on: `balanceReason ===
    // "balance-unknown"` tracks `legsUnknown` exactly, on BOTH sides of `balanceGoverns`.
    it("reports an unknown balance whether or not the balance governs the confirm", () => {
        for (const balanceGoverns of [false, true])
            for (const legsUnknown of [false, true])
                expect(
                    confirmGate({ ...open, balanceGoverns, legsUnknown }).balanceReason ===
                        "balance-unknown"
                ).toBe(legsUnknown);
    });

    // A behaviour pin against the expression this replaced:
    //   busy || !isConfirmable(row, decision) || (isLinkDecision && (bar.over || legsUnknown))
    it("matches the inline expression it replaced, over every input combination", () => {
        const bools = [false, true];
        for (const busy of bools)
            for (const decisionConfirmable of bools)
                for (const balanceGoverns of bools)
                    for (const legsUnknown of bools)
                        for (const over of bools) {
                            const expected =
                                busy ||
                                !decisionConfirmable ||
                                (balanceGoverns && (over || legsUnknown));
                            expect(
                                confirmGate({
                                    busy,
                                    decisionConfirmable,
                                    balanceGoverns,
                                    legsUnknown,
                                    over,
                                }).reason !== null
                            ).toBe(expected);
                        }
    });
});
