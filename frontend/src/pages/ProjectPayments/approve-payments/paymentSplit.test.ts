import { describe, expect, it } from "vitest";

import {
    MIN_SPLIT_AMOUNT,
    computeSplit,
    isAmountKeystroke,
    isSplittable,
} from "./paymentSplit";

const ORIGINAL = 100000;

describe("computeSplit", () => {
    it("splits an ordinary partial approval", () => {
        const r = computeSplit(ORIGINAL, "60000");
        expect(r).toEqual({ approved: 60000, remainder: 40000, isPartial: true, valid: true });
    });

    it("treats the exact full amount as a full approval, not a split", () => {
        // The boundary that matters most: a 100% approval must never mint a zero-value
        // remainder payment and a zero-value PO term row.
        const r = computeSplit(ORIGINAL, "100000");
        expect(r.valid).toBe(true);
        expect(r.isPartial).toBe(false);
        expect(r.remainder).toBe(0);
    });

    it("keeps the two halves summing to the original", () => {
        // The PO's terms must keep adding up to the PO total, so neither half may be
        // independently rounded.
        for (const typed of ["1", "33333.33", "99999", "0.5e5"]) {
            const r = computeSplit(ORIGINAL, typed);
            if (!r.valid) continue;
            expect(r.approved + r.remainder).toBeCloseTo(ORIGINAL, 6);
        }
    });

    it("refuses more than the requested amount", () => {
        const r = computeSplit(ORIGINAL, "100001");
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/more than the requested/i);
    });

    it("refuses zero and negatives, pointing at the reject button", () => {
        for (const typed of ["0", "0.99", "-5000"]) {
            const r = computeSplit(ORIGINAL, typed);
            expect(r.valid).toBe(false);
            expect(r.reason).toMatch(/reject/i);
        }
    });

    it("refuses a balance under the minimum", () => {
        const r = computeSplit(ORIGINAL, String(ORIGINAL - 0.5));
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/balance would be under/i);
    });

    it("accepts a balance of exactly the minimum", () => {
        const r = computeSplit(ORIGINAL, String(ORIGINAL - MIN_SPLIT_AMOUNT));
        expect(r.valid).toBe(true);
        expect(r.isPartial).toBe(true);
        expect(r.remainder).toBe(MIN_SPLIT_AMOUNT);
    });

    it("accepts approving exactly the minimum", () => {
        const r = computeSplit(ORIGINAL, String(MIN_SPLIT_AMOUNT));
        expect(r.valid).toBe(true);
        expect(r.approved).toBe(MIN_SPLIT_AMOUNT);
    });

    it("tells an empty box apart from a zero", () => {
        // Different states with different messages — collapsing them would tell someone who has
        // typed nothing yet that they are trying to reject the payment.
        expect(computeSplit(ORIGINAL, "").reason).toMatch(/enter the amount/i);
        expect(computeSplit(ORIGINAL, "   ").reason).toMatch(/enter the amount/i);
        expect(computeSplit(ORIGINAL, "0").reason).toMatch(/reject/i);
    });

    it("refuses junk", () => {
        for (const typed of ["abc", "1,000", "--5"]) {
            expect(computeSplit(ORIGINAL, typed).valid).toBe(false);
        }
    });

    it("never reports valid without a positive approved amount", () => {
        for (const typed of ["", "0", "-1", "abc", "100001"]) {
            const r = computeSplit(ORIGINAL, typed);
            expect(r.valid && r.approved > 0).toBe(r.valid);
        }
    });
});

describe("isSplittable", () => {
    it("refuses REFUNDS — the regression this predicate exists for", () => {
        // A negative payment is a credit raised after a negative-rate amendment. It can never
        // auto-approve, so it ALWAYS reaches the CEO queue — 127 exist on the live database.
        // Without this predicate the dialog shows an amount box the CEO cannot satisfy, and the
        // Confirm button goes dead: a refund becomes unapprovable.
        for (const amount of [-102660, -3130, -1, -0.5]) {
            expect(isSplittable(amount)).toBe(false);
        }
    });

    it("refuses amounts too small to leave two valid halves", () => {
        for (const amount of [0, 0.5, 1, 1.99]) {
            expect(isSplittable(amount)).toBe(false);
        }
    });

    it("allows anything from twice the minimum upward", () => {
        for (const amount of [2, 100, 30239.27, 242206.8]) {
            expect(isSplittable(amount)).toBe(true);
        }
    });

    it("refuses non-finite amounts", () => {
        for (const amount of [NaN, Infinity, -Infinity]) {
            expect(isSplittable(amount)).toBe(false);
        }
    });

    it("agrees with computeSplit: anything it allows has at least one valid split", () => {
        // The two must not disagree — a payment offered an amount box must have a reachable
        // answer, or the box is a dead end.
        for (const amount of [2, 3, 10, 30239.27]) {
            expect(isSplittable(amount)).toBe(true);
            expect(computeSplit(amount, String(MIN_SPLIT_AMOUNT)).valid).toBe(true);
        }
    });
});

describe("isAmountKeystroke", () => {
    it("allows digits, one decimal point, and an empty box", () => {
        for (const v of ["", "1", "100", "100.", "100.50", ".5"]) {
            expect(isAmountKeystroke(v)).toBe(true);
        }
    });

    it("blocks anything that is not a plain number", () => {
        for (const v of ["1.2.3", "1a", "-1", "1,000", " 1"]) {
            expect(isAmountKeystroke(v)).toBe(false);
        }
    });

    it("stays permissive about range — out-of-range gets a message, not a dead key", () => {
        expect(isAmountKeystroke("99999999")).toBe(true);
    });
});
