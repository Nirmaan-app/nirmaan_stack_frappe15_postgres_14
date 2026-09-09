import { describe, expect, it } from "vitest";

import {
    allocateButtonLabel,
    allocationBar,
    chooseSettleEndpoint,
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
