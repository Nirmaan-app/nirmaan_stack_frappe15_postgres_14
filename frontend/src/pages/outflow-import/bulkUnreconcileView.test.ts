import { describe, expect, it } from "vitest";

import {
    bulkCheckSummary,
    bulkUnreconcileTitle,
    LINE_GONE,
    NOT_SETTLED_ANY_MORE,
    NOTHING_SETTLED,
    unreconcileButtonState,
} from "./bulkUnreconcileView";
import { ROW_MATCHED, ROW_SETTLED } from "./outflowImportStatus";
import {
    VERDICT_DELETE_CREATED,
    VERDICT_REFUSED,
    VERDICT_REVERT_PAYMENT,
    type UnreconcilePlan,
    type UnreconcilePlanLeg,
} from "./unreconcileView";

const leg = (over: Partial<UnreconcilePlanLeg> = {}): UnreconcilePlanLeg => ({
    match: "M1",
    target_doctype: "Project Payments",
    target_name: "PAY-1",
    target_amount: 100,
    verdict: VERDICT_REVERT_PAYMENT,
    what_happens: "Goes back to Reconciliation Pending.",
    reason: null,
    title: null,
    fix_at: null,
    ...over,
});

const plan = (over: Partial<UnreconcilePlan> = {}): UnreconcilePlan => ({
    row: "R1",
    row_status: ROW_SETTLED,
    amount: 100,
    allocated: 100,
    refused_count: 0,
    legs: [leg()],
    ...over,
});

describe("unreconcileButtonState", () => {
    const rows = [{ name: "a" }, { name: "b" }];
    it("is off with nothing ticked", () => {
        expect(unreconcileButtonState(rows, new Set(), new Map(), 0)).toEqual({
            enabled: false,
            count: 0,
            note: null,
            offPage: null,
        });
    });
    it("is on when every tick is on this page", () => {
        expect(unreconcileButtonState(rows, new Set(["a", "b"]), new Map(), 0)).toEqual({
            enabled: true,
            count: 2,
            note: null,
            offPage: null,
        });
    });
    it("is off, and names the page, when a tick is on another page", () => {
        expect(unreconcileButtonState(rows, new Set(["a", "x"]), new Map([["x", 2]]), 0)).toEqual({
            enabled: false,
            count: 2,
            note: "1 ticked line is on page 3. Unreconcile works on one page at a time: go back to page 3, or untick it.",
            offPage: "1 on page 3",
        });
    });
});

describe("bulkUnreconcileTitle", () => {
    it("counts transfers", () => {
        expect(bulkUnreconcileTitle(1)).toBe("Unreconcile 1 transfer?");
        expect(bulkUnreconcileTitle(4)).toBe("Unreconcile 4 transfers?");
    });
});

describe("bulkCheckSummary", () => {
    it("counts what will be undone and its money", () => {
        const s = bulkCheckSummary([
            plan({ row: "R1", amount: 100 }),
            plan({ row: "R2", amount: 640, legs: [leg({ verdict: VERDICT_DELETE_CREATED })] }),
        ]);
        expect(s.undoCount).toBe(2);
        expect(s.blockedCount).toBe(0);
        expect(s.undoAmount).toBe(740);
        expect(s.pills).toEqual([{ tone: "go", text: "2 will be undone · ₹740" }]);
        expect(s.lines.map((l) => l.blocked)).toEqual([false, false]);
    });

    it("greys a line with a refused record, uses the one-line sentence, and lists it after the others", () => {
        const refused = plan({
            row: "R1",
            refused_count: 1,
            legs: [
                leg({ match: "M1" }),
                leg({
                    match: "M2",
                    verdict: VERDICT_REFUSED,
                    what_happens: null,
                    reason: "Someone changed its amount.",
                    title: "Changed",
                }),
            ],
        });
        const s = bulkCheckSummary([refused, plan({ row: "R2", amount: 50 })]);
        expect(s.lines.map((l) => l.plan.row)).toEqual(["R2", "R1"]);
        const blocked = s.lines[1];
        expect(blocked.blocked).toBe(true);
        expect(blocked.reason).toBeNull();
        expect(blocked.records[1].outcome).toEqual({
            tone: "refused",
            lead: "Can't be undone here.",
            text: "Someone changed its amount.",
        });
        expect(s.undoCount).toBe(1);
        expect(s.blockedCount).toBe(1);
        expect(s.undoAmount).toBe(50);
        expect(s.pills).toEqual([
            { tone: "go", text: "1 will be undone · ₹50" },
            { tone: "stop", text: "1 can't be undone · left out" },
        ]);
    });

    it("blocks a line that is no longer Settled, or has nothing settled", () => {
        const s = bulkCheckSummary([
            plan({ row: "R1", row_status: ROW_MATCHED, legs: [] }),
            plan({ row: "R2", legs: [] }),
            plan({ row: "R3", row_status: null, not_found: true, legs: [] }),
        ]);
        expect(s.lines.map((l) => [l.blocked, l.reason])).toEqual([
            [true, NOT_SETTLED_ANY_MORE],
            [true, NOTHING_SETTLED],
            [true, LINE_GONE],
        ]);
        expect(s.undoCount).toBe(0);
        expect(s.pills).toEqual([
            { tone: "go", text: "0 will be undone" },
            { tone: "stop", text: "3 can't be undone · left out" },
        ]);
    });
});
