import { describe, expect, it } from "vitest";

import {
    allocateButtonLabel,
    allocationBar,
    chooseSettleEndpoint,
    confirmGate,
    effectiveSettleMode,
    matcherMarksVisible,
    pickerComparisonAmount,
    settleModeLocked,
    settlePickerFor,
    partlyAllocatedFigures,
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
        // is what makes that impossible rather than merely unlikely. Both endpoints write a leg, but
        // `settle_row` holds the whole-transfer guard and may rewrite the amount (slice X1), so a
        // shortcut would make two identical-looking actions behave differently, with nothing on
        // screen saying which one you got.
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

describe("confirmGate", () => {
    // The state a reviewer is in almost all of the time: a live decision, legs known, ticks fit.
    //
    // ⚠️ `endpoint` DEFAULTS TO THE ALLOCATION PATH HERE SO THE PRE-#1242 CASES BELOW KEEP ASSERTING
    // WHAT THEY ALWAYS ASSERTED. The narrowing only changes the OTHER endpoint, and its own block
    // ("the narrowing") states that difference explicitly rather than hiding it in a fixture.
    const open = {
        busy: false,
        decisionConfirmable: true,
        balanceGoverns: true,
        endpoint: "allocate_row" as const,
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
            endpoint: "allocate_row",
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

    // ⚠️ RETIRED BY INVERSION, NEVER DELETED (#1242, and the repo's standing rule -- a deleted pin
    // checks nothing). This block used to assert the algebra of the expression #1239 extracted:
    //
    //   busy || !isConfirmable(row, decision) || (isLinkDecision && (bar.over || legsUnknown))
    //
    // #1242 narrows exactly ONE term of it -- `over` -- to the allocation path. So the old formula
    // is still the whole truth on `allocate_row`, and is now provably WRONG on `settle_row`. Both
    // halves are asserted, which is what keeps this failing for anything but the intended change.
    it("keeps the expression it replaced, over every input combination, on the allocation path", () => {
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
                                    endpoint: "allocate_row",
                                    legsUnknown,
                                    over,
                                }).reason !== null
                            ).toBe(expected);
                        }
    });

    it("no longer matches that expression on the whole-transfer path -- an over-tick is let through", () => {
        const bools = [false, true];
        for (const busy of bools)
            for (const decisionConfirmable of bools)
                for (const balanceGoverns of bools)
                    for (const legsUnknown of bools)
                        for (const over of bools) {
                            // The SAME formula with `over` struck out of it -- the narrowing, stated
                            // as arithmetic rather than as prose.
                            const narrowed =
                                busy || !decisionConfirmable || (balanceGoverns && legsUnknown);
                            expect(
                                confirmGate({
                                    busy,
                                    decisionConfirmable,
                                    balanceGoverns,
                                    endpoint: "settle_row",
                                    legsUnknown,
                                    over,
                                }).reason !== null
                            ).toBe(narrowed);
                        }
    });
});

/**
 * ⚠️ THE POINT OF #1242, AND THE ONLY PLACE IT CAN BE PINNED. The gate disabled Confirm on exactly
 * the picks that needed a decision: `bar.over` on a fresh row reduces to "the ticked record exceeds
 * the transfer by more than the tolerance", which is ALGEBRAICALLY the condition that opens the
 * part-payment / TDS detour -- and that detour's only trigger lives inside the confirm HANDLER,
 * which a disabled button never fires. Both paths were live in source and unreachable from the
 * product (ADR-0020 Amendment B4).
 *
 * This repo has no DOM environment, by deliberate choice, so the dialog itself cannot be tested.
 * The predicate is the highest point the narrowing can be held at -- which is why #1239 extracted
 * it first.
 */
describe("confirmGate -- the narrowing (#1242): the gate follows the ENDPOINT, not the pick", () => {
    const over = {
        busy: false,
        decisionConfirmable: true,
        balanceGoverns: true,
        legsUnknown: false,
        over: true,
    };

    it("lets a single oversized whole-transfer pick through, so the amount-window dialog can open", () => {
        const gate = confirmGate({ ...over, endpoint: "settle_row" });
        expect(gate.reason).toBeNull();
    });

    it("still refuses an over-tick where the allocation arithmetic actually governs", () => {
        expect(confirmGate({ ...over, endpoint: "allocate_row" }).reason).toBe("over-allocated");
    });

    // ⚠️ `null` IS "NO RECORD PICKED", AND IT CANNOT REACH THE BUTTON ON ITS OWN.
    // `chooseSettleEndpoint` returns it when nothing is picked, and an over-allocation measured
    // against no pick is not a fact about anything. The bare input is still asserted, because a
    // predicate must be TOTAL -- but the case below is the only shape the screen can produce, since
    // the dialog feeds the endpoint the SAME `decisionLinkKeys` reader `isConfirmable` uses.
    it("cannot report an over-tick when no record is picked", () => {
        expect(confirmGate({ ...over, endpoint: null }).reason).toBeNull();
    });

    it("★ a null endpoint reaches the screen only beside an incomplete decision, which blocks first", () => {
        expect(confirmGate({ ...over, endpoint: null, decisionConfirmable: false }).reason).toBe(
            "decision-incomplete"
        );
    });

    // ⚠️ THE RED BAR SURVIVES THE NARROWING (ADR-0020 B4, and #1242's own acceptance criterion).
    // Only the INSTRUCTION changes: "untick something" is advice about a tick-set the gate is
    // refusing, and it is simply wrong beside a button the reviewer is now meant to press.
    it("keeps saying the ticks are over the transfer on BOTH paths, with different advice", () => {
        const gated = confirmGate({ ...over, endpoint: "allocate_row" });
        const narrowed = confirmGate({ ...over, endpoint: "settle_row" });

        expect(gated.balanceReason).toBe("over-allocated");
        expect(narrowed.balanceReason).toBe("over-allocated");

        expect(gated.balanceMessage).toBe("— untick something before confirming");
        expect(narrowed.balanceMessage).not.toBe(gated.balanceMessage);
        expect(narrowed.balanceMessage).toContain("Confirm");
        // It must not tell somebody to untick on a path where unticking is not the answer.
        expect(narrowed.balanceMessage).not.toContain("untick");
    });

    // ⚠️ `legsUnknown` IS INNOCENT AND IS NOT NARROWED (ADR-0020 B4, explicitly). It is already
    // scoped to `Partially Allocated` rows, so it is always false on a fresh row -- and ruling U,
    // "never draw a confident balance over an unknown leg set", has to survive on every endpoint.
    it("does not narrow the unknown-legs guard", () => {
        for (const endpoint of ["settle_row", "allocate_row", null] as const) {
            const gate = confirmGate({
                ...over,
                over: false,
                legsUnknown: true,
                endpoint,
            });
            expect(gate.reason).toBe("balance-unknown");
        }
    });

    // The narrowing must not resurrect a confirm on a decision that is not one.
    it("leaves the busy and incomplete-decision blockers alone", () => {
        expect(confirmGate({ ...over, endpoint: "settle_row", busy: true }).reason).toBe("busy");
        expect(
            confirmGate({ ...over, endpoint: "settle_row", decisionConfirmable: false }).reason
        ).toBe("decision-incomplete");
    });

    // ⚠️ THE COMPOSITION THAT MAKES THE NARROWING REAL. `chooseSettleEndpoint` is the ONE routing
    // rule; feeding it straight into the gate is what stops a second, drifting copy of "does
    // allocation govern here?" appearing inside the dialog -- the same reasoning `settlePickerFor`
    // carries. A single tick in Normal mode is the shape the whole ticket is about.
    it("composes with the routing rule: a single Normal tick is confirmable, a Split one is not", () => {
        const normal = chooseSettleEndpoint({ ticks: 1, rowStatus: "Matched", mode: "normal" });
        const split = chooseSettleEndpoint({ ticks: 1, rowStatus: "Matched", mode: "split" });

        expect(confirmGate({ ...over, endpoint: normal }).reason).toBeNull();
        expect(confirmGate({ ...over, endpoint: split }).reason).toBe("over-allocated");
    });

    // ⚠️ A `Partially Allocated` ROW IS FORCED TO SPLIT, so it stays inside the narrowed set and
    // loses nothing. This is the pin behind the ADR's "its target is inside the narrowed set".
    it("keeps the gate on a partly-allocated row, whatever mode was chosen", () => {
        for (const mode of ["normal", "split"] as const) {
            const endpoint = chooseSettleEndpoint({
                ticks: 1,
                rowStatus: "Partially Allocated",
                mode,
            });
            expect(endpoint).toBe("allocate_row");
            expect(confirmGate({ ...over, endpoint }).reason).toBe("over-allocated");
        }
    });
});

// ---------------------------------------------------------------------------------------------
// issue #1243 -- the picker measures the REMAINING BALANCE, not the full transfer
// ---------------------------------------------------------------------------------------------

describe("pickerComparisonAmount", () => {
    it("is null when the transfer has no legs, so the caller sends today's request unchanged", () => {
        // ⚠️ `null` IS NOT `rowAmount`, AND THE DIFFERENCE IS THE WHOLE POINT. An untouched row must
        // reach `search_settleable_records` with the SAME params and the SAME SWR key it always
        // did -- "a row with no legs behaves byte-identically to today" (AC4). Returning the row's
        // own amount would be arithmetically equal and would still mint a new parameter and a new
        // cache key on every open row in the system.
        expect(pickerComparisonAmount(213396, [])).toBeNull();
    });

    it("is what is left after the banked legs", () => {
        // The ticket's own shape: most of the transfer allocated, and the one payment that would
        // COMPLETE it is the 35,000 -- which scores zero against 1,00,000 and is flagged
        // unsettleable there, below every record that can no longer possibly fit.
        expect(pickerComparisonAmount(100000, [leg(40000), leg(25000)])).toBe(35000);
    });

    it("ignores a reversed leg, exactly as the balance bar does", () => {
        const legs = [leg(55819), { target_amount: 5310, match_kind: "Reversed" }];
        expect(pickerComparisonAmount(213396, legs)).toBe(213396 - 55819);
    });

    it("is null again once every leg has been reversed", () => {
        // Reversal reopens the row, and the picker has to go back to measuring the whole transfer
        // rather than keep a remainder derived from legs that no longer count.
        expect(pickerComparisonAmount(100000, [{ target_amount: 40000, match_kind: "Reversed" }]))
            .toBeNull();
    });

    it("takes no ticks at all, so the ordering cannot move while the reviewer ticks", () => {
        // ⚠️ AC5, ENFORCED BY THE SIGNATURE RATHER THAN BY A CALLER'S DISCIPLINE. `allocationBar`
        // takes ticked amounts because the BAR must move live; this must not, because a list that
        // re-ranks under the cursor mid-selection is worse than a static answer, and the bar
        // already shows the live figure. There is no third parameter for ticks to arrive through.
        expect(pickerComparisonAmount.length).toBe(2);
    });

    it("agrees with the balance bar's untouched remainder", () => {
        // One arithmetic, two readers: the bar the reviewer looks at and the amount the picker
        // ranks by must never be able to disagree about the same row.
        const legs = [leg(40000), leg(25000)];
        expect(pickerComparisonAmount(100000, legs)).toBe(allocationBar(100000, legs, []).remaining);
    });

    // ⚠️ RETIRED BY INVERSION, NEVER DELETED (review finding, issue #1243). This case used to read
    // "can go negative on an over-allocated row rather than pretending it is zero", and asserted
    // `-60`. The reasoning was that clamping would hide a real state -- true about the BALANCE BAR,
    // which does report it, and false about this function, whose only consumers cannot use a
    // negative for anything. `review._comparison_amount` refuses every `wanted <= 0` and ranks
    // against the transfer instead, so keeping the negative here made the two sides measure
    // DIFFERENT THINGS: an emerald "this can be settled" from the server beside a large client-side
    // "off by" on the same row. The new truth is asserted, and the old one is kept failing.
    it("is null on an over-allocated row, because no record can be within the window of a negative", () => {
        expect(pickerComparisonAmount(100, [leg(160)])).toBeNull();
        expect(pickerComparisonAmount(100, [leg(160)])).not.toBe(-60);
    });

    it("is null on an exactly-exhausted row rather than a zero nothing can match", () => {
        // `0 ?? row.amount` yields `0`, so a zero leaking out would make every record read
        // "off by <its own full amount>" -- confidently wrong, on every row at once.
        expect(pickerComparisonAmount(100, [leg(100)])).toBeNull();
    });

    it("★ never returns a non-positive number, which is what makes `?? row.amount` safe", () => {
        // The property the caller relies on, asserted as a property rather than case by case: it is
        // why `pickerBankAmount` needs no second guard, and a second guard is how one rule becomes
        // two copies free to drift.
        const shapes = [
            [100, [leg(160)]],
            [100, [leg(100)]],
            [100, [leg(60), leg(60)]],
            [0, [leg(5)]],
            [-50, [leg(10)]],
            [213396, [leg(55819)]],
        ] as const;
        for (const [amount, legs] of shapes) {
            const answer = pickerComparisonAmount(amount, [...legs]);
            if (answer !== null) expect(answer).toBeGreaterThan(0);
        }
    });
});

describe("matcherMarksVisible", () => {
    // ⚠️ AC6. `get_row_candidates` re-runs the match LIVE on every dialog open and has no
    // frozen-status guard, so on a partly-allocated row it marks records as matcher-found against
    // the FULL transfer -- including records already settled as legs of that very row. Suppressing
    // the marker client-side is the fix the ticket specifies; making the matcher remainder-aware is
    // explicitly rejected, because that would push ranking into the matcher.
    it("hides the match run's marks on a partly-allocated row", () => {
        expect(matcherMarksVisible("Partially Allocated")).toBe(false);
    });

    it("shows them on every status where the match run still describes the whole transfer", () => {
        for (const status of ["Pending match run", "Mismatched", "Matched", "Settled", "Error", ""]) {
            expect(matcherMarksVisible(status)).toBe(true);
        }
    });

    // The same composition guard `settlePickerFor` carries: this must key off the SAME status the
    // mode lock reads, or the marks and the mode could come to describe different rows.
    it("is suppressed exactly where the mode is locked to Split", () => {
        for (const status of ["Partially Allocated", "Matched", "Mismatched", ""]) {
            expect(matcherMarksVisible(status)).toBe(!settleModeLocked(status));
        }
    });
});

describe("partlyAllocatedFigures", () => {
    const leg = (target_amount: number, match_kind = "Settled") => ({ target_amount, match_kind });

    // The measured line: XINERGY INNOVATION, 1,47,913, two payments of 1,07,380 + 26,460.
    it("names what is reconciled and what is still pending on a part-used line", () => {
        expect(
            partlyAllocatedFigures({
                row_status: "Partially Allocated",
                amount: 147913,
                matches: [leg(107380), leg(26460)],
            }),
        ).toEqual({ reconciled: 133840, pending: 14073 });
    });

    it("says nothing about a row that is not part-used", () => {
        for (const row_status of ["Settled", "Matched", "Mismatched", "Pending match run", "Skipped"]) {
            expect(partlyAllocatedFigures({ row_status, amount: 1000, matches: [leg(1000)] })).toBeNull();
        }
    });

    it("counts only live legs, the rule the balance bar reads", () => {
        expect(
            partlyAllocatedFigures({
                row_status: "Partially Allocated",
                amount: 1000,
                matches: [leg(400), leg(300, "Reversed")],
            }),
        ).toEqual({ reconciled: 400, pending: 600 });
    });
});
