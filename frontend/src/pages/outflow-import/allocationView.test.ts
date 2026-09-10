import { describe, expect, it } from "vitest";

import {
    allocateButtonLabel,
    allocationBar,
    chooseSettleEndpoint,
    confirmGate,
    effectiveSettleMode,
    reversalNotice,
    settleModeLocked,
    settlePickerFor,
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

describe("effectiveSettleMode / settleModeLocked -- a partly-allocated row has no choice", () => {
    it("leaves an ordinary row on whichever mode the reviewer chose", () => {
        expect(effectiveSettleMode("normal", "Matched")).toBe("normal");
        expect(effectiveSettleMode("split", "Matched")).toBe("split");
        expect(effectiveSettleMode("normal", "Mismatched")).toBe("normal");
        expect(settleModeLocked("Matched")).toBe(false);
        expect(settleModeLocked("Mismatched")).toBe(false);
    });

    it("forces Split on a Partially Allocated row, whatever was chosen", () => {
        // `settle_row` does not admit that status at all, so offering Normal there is a lie.
        expect(effectiveSettleMode("normal", "Partially Allocated")).toBe("split");
        expect(effectiveSettleMode("split", "Partially Allocated")).toBe("split");
        expect(settleModeLocked("Partially Allocated")).toBe(true);
    });

    it("treats an absent mode as Normal -- the bulk path has no dialog and therefore no radio", () => {
        expect(effectiveSettleMode(undefined, "Matched")).toBe("normal");
    });
});

/**
 * ⚠️ THE AC10 PIN. Issue #1241 offers two ways to close the ledger-withholding gap and demands that
 * one be chosen deliberately and RECORDED: withhold non-payment rows in the radio picker too, or
 * prove the radio picker can never be shown a `Partially Allocated` row. **ANSWER 2 IS TAKEN**, and
 * the ticket's own warning is why this block exists at all: *"Do not answer 'it can't happen'
 * without pinning it."*
 *
 * `tickAllowedForFanOut` + `disabledKeys` are wired ONLY to `FanOutRecordTable`; the restored
 * `SettleableRecordTable` has no equivalent. So what has to hold is the COMPOSITION the dialog
 * runs -- status -> effective mode -> picker -- not either half on its own. That is the exact join
 * both halves being green cannot see, which is this repo's standing rule about boundaries.
 */
describe("settlePickerFor -- a Partially Allocated row can NEVER reach the radio picker (AC10)", () => {
    it("forces the checkbox picker on a Partially Allocated row, whatever the reviewer chose", () => {
        for (const chosen of ["normal", "split", undefined] as const) {
            expect(
                settlePickerFor(effectiveSettleMode(chosen, "Partially Allocated")),
            ).toBe("checkbox");
        }
    });

    it("still gives an ordinary row the radio picker on Normal and the checkbox one on Split", () => {
        // The negative half: without it the pin above would pass on a function that returned
        // "checkbox" for everything, which would prove nothing about the gap.
        expect(settlePickerFor(effectiveSettleMode("normal", "Matched"))).toBe("radio");
        expect(settlePickerFor(effectiveSettleMode(undefined, "Mismatched"))).toBe("radio");
        expect(settlePickerFor(effectiveSettleMode("split", "Matched"))).toBe("checkbox");
    });
});

/**
 * ⚠️ THIS BLOCK IS THE INVERSION OF THE TICK-COUNT RULE, NOT A DELETION OF IT (issue #1241,
 * ADR-0020 B3). It used to assert that ONE tick on an untouched row always meant `settle_row` and
 * that TWO ticks always meant `allocate_row` -- routing read the tick COUNT, so a reviewer could
 * not place a first leg smaller than the transfer and come back later for the second. Per this
 * repo's standing rule the old pins are retired BY INVERSION rather than removed: each case below
 * states the NEW truth about the very inputs the old rule got wrong, so a revert to counting ticks
 * fails here loudly instead of passing on a suite that no longer mentions the question.
 */
describe("chooseSettleEndpoint -- routing reads the MODE, not the tick count", () => {
    it("INVERTED: a single tick on an untouched row is allocate_row in Split mode", () => {
        // The old rule made this `settle_row`, whose guard demands the record equal the WHOLE
        // transfer -- which is precisely why the first-leg-then-second-leg workflow had no path.
        expect(
            chooseSettleEndpoint({ ticks: 1, rowStatus: "Matched", mode: "split" }),
        ).toBe("allocate_row");
        expect(
            chooseSettleEndpoint({ ticks: 1, rowStatus: "Mismatched", mode: "split" }),
        ).toBe("allocate_row");
    });

    it("INVERTED: Split routes a full-transfer single tick through allocate_row too", () => {
        // ⚠️ NO AMOUNT SHORTCUT, DELIBERATELY -- and the rule cannot see an amount at all, which
        // is what makes that impossible rather than merely unlikely. Reversal operates on LEGS and
        // `settle_row` writes none, so a shortcut would make two identical-looking actions behave
        // differently on undo, with nothing on screen saying which one you got.
        expect(
            chooseSettleEndpoint({ ticks: 1, rowStatus: "Matched", mode: "split" }),
        ).toBe("allocate_row");
    });

    it("keeps Normal on settle_row for a single pick -- every pre-ADR-0020 settle is unchanged", () => {
        expect(
            chooseSettleEndpoint({ ticks: 1, rowStatus: "Matched", mode: "normal" }),
        ).toBe("settle_row");
        expect(
            chooseSettleEndpoint({ ticks: 1, rowStatus: "Mismatched", mode: "normal" }),
        ).toBe("settle_row");
    });

    it("treats an absent mode as Normal, which is what keeps the BULK path unchanged", () => {
        // ⚠️ "Confirm all matched" has no dialog and therefore no mode, permanently (ADR-0020 B3).
        // It calls this with no `mode` at all and must keep taking `settle_row`'s stricter path.
        expect(chooseSettleEndpoint({ ticks: 1, rowStatus: "Matched" })).toBe("settle_row");
        expect(chooseSettleEndpoint({ ticks: 1, rowStatus: "Mismatched" })).toBe("settle_row");
    });

    it("uses allocate_row for a single tick on an already-allocated row, in EITHER mode", () => {
        // The mode is FORCED to Split there (`effectiveSettleMode`), so the old status clause
        // survives as a CONSEQUENCE of the mode rule rather than as a rule of its own --
        // `settle_row` would refuse it: `_load_settleable_row` does not admit this status.
        expect(
            chooseSettleEndpoint({ ticks: 1, rowStatus: "Partially Allocated", mode: "normal" }),
        ).toBe("allocate_row");
        expect(
            chooseSettleEndpoint({ ticks: 1, rowStatus: "Partially Allocated", mode: "split" }),
        ).toBe("allocate_row");
        // And the bulk path's no-mode call reaches the same place, for the same reason.
        expect(
            chooseSettleEndpoint({ ticks: 1, rowStatus: "Partially Allocated" }),
        ).toBe("allocate_row");
    });

    it("RETIRED AS AN INTENT RULE, KEPT AS A CAPACITY ONE: >1 pick can never be settle_row", () => {
        // ⚠️ DO NOT READ THIS AS THE OLD TICK-COUNT RULE SURVIVING. `settle_row` takes ONE target,
        // so routing a multi-pick there would settle the first record and silently DROP the rest --
        // a money bug. Normal mode is single-select by construction, so this shape is unreachable
        // from the product; it is pinned so that if some future writer ever produces it, the call
        // lands on the endpoint that can EXPRESS it and is refused loudly by the server, rather
        // than being half-written in silence.
        expect(
            chooseSettleEndpoint({ ticks: 2, rowStatus: "Matched", mode: "normal" }),
        ).toBe("allocate_row");
        expect(
            chooseSettleEndpoint({ ticks: 2, rowStatus: "Matched", mode: "split" }),
        ).toBe("allocate_row");
    });

    it("chooses nothing when nothing is ticked, in either mode", () => {
        expect(chooseSettleEndpoint({ ticks: 0, rowStatus: "Matched", mode: "normal" })).toBeNull();
        expect(chooseSettleEndpoint({ ticks: 0, rowStatus: "Matched", mode: "split" })).toBeNull();
        expect(
            chooseSettleEndpoint({ ticks: 0, rowStatus: "Partially Allocated", mode: "split" }),
        ).toBeNull();
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
