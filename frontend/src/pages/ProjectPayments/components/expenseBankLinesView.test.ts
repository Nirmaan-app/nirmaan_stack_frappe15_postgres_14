// The Bank lines card's progress line and status tone (#1303, ADR-0027 R5).
//
// The figures are the measured example the mockups use: NPE toj650dsqd, ₹1,60,113, settled by the
// 18-Aug-2026 reimbursement run.

import { describe, expect, it } from "vitest";

import { LINK_TOLERANCE } from "@/pages/outflow-import/linkLinesView";

import {
    type LinkedFigures,
    STATUS_TONE,
    linkedProgress,
    statusTone,
} from "./expenseBankLinesView";

/** The server always sends `remaining`; these build it the way the endpoint computes it. */
const figures = (amount: number, linkedTotal: number, lineCount: number): LinkedFigures => ({
    amount,
    linked_total: linkedTotal,
    line_count: lineCount,
    remaining: amount - linkedTotal,
});

describe("linkedProgress", () => {
    it("reads fully linked when the lines cover the amount", () => {
        const p = linkedProgress(figures(160113, 160113, 30));
        expect(p.linked).toBe("₹1,60,113");
        expect(p.note).toBe("of ₹1,60,113 linked · 30 lines");
        expect(p.stillToLink).toBeNull();
        expect(p.complete).toBe(true);
        expect(p.percent).toBe(100);
    });

    it("names what is still to link while the expense is short", () => {
        const p = linkedProgress(figures(160113, 138633, 25));
        expect(p.linked).toBe("₹1,38,633");
        expect(p.note).toBe("of ₹1,60,113 linked · 25 lines");
        expect(p.stillToLink).toBe("₹21,480 still to link");
        expect(p.complete).toBe(false);
        expect(p.percent).toBeCloseTo(86.58, 1);
    });

    it("says line, not lines, for a single line", () => {
        expect(linkedProgress(figures(5000, 5000, 1)).note).toBe("of ₹5,000 linked · 1 line");
    });

    // The one-sided ₹5: the same window the server reads an expense Paid through, so the card can
    // never say "still to link" about an expense the settle guard thinks has no room.
    it("treats a shortfall within the tolerance as covered, and one past it as short", () => {
        expect(linkedProgress(figures(1000, 1000 - LINK_TOLERANCE, 2)).complete).toBe(true);
        expect(linkedProgress(figures(1000, 1000 - LINK_TOLERANCE, 2)).stillToLink).toBeNull();

        const short = linkedProgress(figures(1000, 1000 - LINK_TOLERANCE - 0.01, 2));
        expect(short.complete).toBe(false);
        expect(short.stillToLink).toBe("₹6 still to link");
    });

    // ⚠️ THE SERVER'S `remaining` GOVERNS, not `amount - linked_total` recomputed here. Proven by
    // handing it figures that disagree: a card that re-derived what is left would ignore this and
    // print the wrong one.
    it("reads what is left from the server, not from the amount", () => {
        const p = linkedProgress({
            amount: 160113,
            linked_total: 138633,
            line_count: 25,
            remaining: 21480.004,
        });
        expect(p.stillToLink).toBe("₹21,481 still to link");
    });

    // A linked total ABOVE the amount is not reachable through any write, but a stale card must not
    // render a bar longer than its track or a negative "still to link".
    it("clamps the bar and stays covered when the linked total is above the amount", () => {
        const p = linkedProgress(figures(1000, 1200, 3));
        expect(p.percent).toBe(100);
        expect(p.complete).toBe(true);
        expect(p.stillToLink).toBeNull();
    });

    // A blank or zero amount would divide by zero; CSS drops a `NaN%` width silently, so a fully
    // linked row would render an EMPTY bar that reads as "nothing linked".
    it("never renders NaN on a zero amount", () => {
        const p = linkedProgress(figures(0, 0, 1));
        expect(Number.isFinite(p.percent)).toBe(true);
        expect(p.percent).toBe(100);
        expect(p.complete).toBe(true);
    });
});

describe("statusTone", () => {
    it("gives the two statuses this card was designed around their own colour", () => {
        expect(statusTone("Paid")).toBe(STATUS_TONE.Paid);
        expect(statusTone("Reconciliation Pending")).toBe(STATUS_TONE["Reconciliation Pending"]);
        expect(statusTone("Paid")).not.toBe(statusTone("Reconciliation Pending"));
    });

    // An expense that still carries links can be saved in another status; borrowing one of the two
    // colours above would claim a meaning the card cannot vouch for.
    it("reads neutral for anything else, including a blank", () => {
        const neutral = statusTone("");
        expect(statusTone("Rejected")).toBe(neutral);
        expect(statusTone("Approved")).toBe(neutral);
        expect(neutral).not.toBe(STATUS_TONE.Paid);
        expect(neutral).not.toBe(STATUS_TONE["Reconciliation Pending"]);
    });
});
