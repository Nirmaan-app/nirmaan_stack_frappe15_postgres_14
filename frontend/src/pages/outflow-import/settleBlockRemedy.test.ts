// The two copy defects found by the #1245 browser walk, pinned.
//
// Both were the same shape: the remainder/direction LOGIC was updated by #1242 and #1243, and the
// SENTENCES beside it were not. Neither is visible to any other test in this repo -- there is no DOM
// environment (`frontend/CLAUDE.md`), so the rendered dialog and the rendered picker row cannot be
// asserted. What CAN be pinned is the pure copy these surfaces read, which is why both sentences
// were given one owner each in `outflowTableModel` rather than left inline in the JSX.
//
// ⚠️ THIS FILE IS A SIBLING OF `settleModeLabelParity.test.ts`, ON PURPOSE. That one pins the SERVER
// against `SETTLE_MODE_LABEL.split`; this one pins the CLIENT against the same constant. Between
// them the radio, the dialog and `settle.py` cannot drift apart -- which matters because the dialog
// path never reaches the server sentence at all (see below).
import { describe, expect, it } from "vitest";

import { SETTLE_MODE_LABEL } from "./allocationView";
import {
    AMOUNT_GAP_HINT,
    AMOUNT_GAP_HINT_SPLIT,
    amountGapHint,
    settleBlockRemedy,
    settleBlocker,
} from "./outflowTableModel";

/** A blocked pick. `suggested: false` is the one thing that makes `settleBlocker` return. */
const blocked = (over: Record<string, unknown>, bank: number) =>
    settleBlocker({ name: "P", amount: 100, suggested: false, ...over }, bank)!;

/** The sentence every non-Split case keeps. Unchanged from before the walk. */
const GENERIC = "Pick the record that matches this transfer instead.";

describe("settleBlockRemedy — what to DO about a blocked pick (#1245, finding 2)", () => {
    it("★ names Split when the bank moved MORE than the record is for", () => {
        // The commonest arrival, and the one the old fixed sentence answered wrongly: on a transfer
        // that pays several records, "pick the record that matches" cannot be followed.
        const remedy = settleBlockRemedy(
            blocked({ amount: 30000, target_doctype: "Project Payments" }, 50000)
        );
        expect(remedy).toContain(SETTLE_MODE_LABEL.split);
        expect(remedy).toBe(
            `To settle it as one part of this transfer, choose '${SETTLE_MODE_LABEL.split}' on the row.`
        );
    });

    it("★ quotes the label by BINDING, so it cannot drift from the radio or the server", () => {
        // If someone rewords the mode, this assertion follows it automatically -- which is the
        // whole point of importing the constant instead of typing the words.
        const remedy = settleBlockRemedy(blocked({ amount: 30000 }, 50000));
        expect(remedy).toContain(SETTLE_MODE_LABEL.split);
        // ...and never the INVERSE feature's near-identical label (ADR-0020 B3).
        expect(remedy.toLowerCase()).not.toContain("part payment");
        expect(remedy.toLowerCase()).not.toContain("partial");
    });

    it("⚠️ an ABSENT target_doctype still gets the Split route (the fail-open)", () => {
        // Matches `settleBlockReason`'s own rule: an older payload is never READ as an expense.
        // Erring toward offering is safe -- the server re-asserts; erring the other way hides the
        // one route that works.
        expect(settleBlockRemedy(blocked({ amount: 30000 }, 50000))).toContain(
            SETTLE_MODE_LABEL.split
        );
        expect(
            settleBlockRemedy(blocked({ amount: 30000, target_doctype: undefined }, 50000))
        ).toContain(SETTLE_MODE_LABEL.split);
    });

    it("★ does NOT send an EXPENSE to Split, even though it shares the reason", () => {
        // THE SUBTLETY THIS GATE EXISTS FOR. `bank_paid_more` is returned for an expense too
        // (pinned in outflowTableModel.test.ts), but splitting works on approved Project Payments
        // only -- so naming Split here would send a reviewer to a mode that would never list their
        // record. The reason stays ledger-blind; only the remedy reads the ledger.
        for (const target_doctype of ["Project Expenses", "Non Project Expenses"]) {
            const remedy = settleBlockRemedy(blocked({ amount: 30000, target_doctype }, 50000));
            expect(remedy).not.toContain(SETTLE_MODE_LABEL.split);
            expect(remedy).toBe(GENERIC);
        }
    });

    it("leaves every other reason's remedy exactly as it was", () => {
        // record_larger, expense_exact_only and not_positive are untouched by this change.
        expect(
            settleBlockRemedy(blocked({ amount: 500000, target_doctype: "Project Payments" }, 200000))
        ).toBe(GENERIC);
        expect(
            settleBlockRemedy(blocked({ amount: 500000, target_doctype: "Project Expenses" }, 200000))
        ).toBe(GENERIC);
        expect(settleBlockRemedy(blocked({ amount: 0 }, 200000))).toBe(GENERIC);
    });

    it("is empty for no block at all, like its sibling", () => {
        expect(settleBlockRemedy(null)).toBe("");
        expect(settleBlockRemedy(undefined)).toBe("");
    });

    it("⚠️ never resurrects the retired TDS advice, on any branch", () => {
        // The sentence #1242 removed from the server must not reappear on the client instead.
        const remedies = [
            settleBlockRemedy(blocked({ amount: 30000 }, 50000)),
            settleBlockRemedy(blocked({ amount: 500000 }, 200000)),
            settleBlockRemedy(blocked({ amount: 30000, target_doctype: "Project Expenses" }, 50000)),
            settleBlockRemedy(blocked({ amount: 0 }, 200000)),
        ];
        for (const remedy of remedies) {
            expect(remedy).not.toMatch(/TDS/i);
            expect(remedy).not.toMatch(/payments screen/i);
        }
    });
});

describe("amountGapHint — the gap sentence follows the MODE (#1245, finding 1)", () => {
    it("★ Split mode does not call a deliberate first leg a mistake", () => {
        expect(amountGapHint("split")).toBe(AMOUNT_GAP_HINT_SPLIT);
        // ⚠️ RETIRED BY INVERSION, not deletion. The Normal sentence promised "options" that never
        // appear in Split -- confirming ALLOCATES the leg, with no dialog. Asserting its ABSENCE is
        // what stops a revert quietly restoring it.
        expect(amountGapHint("split")).not.toContain("too far apart");
        expect(amountGapHint("split")).not.toContain("confirm to see the options");
    });

    it("★ Normal mode is BYTE-IDENTICAL to before the change", () => {
        // The whole safety of this fix: the mode that was already correct did not move.
        expect(amountGapHint("normal")).toBe(AMOUNT_GAP_HINT);
        expect(amountGapHint("normal")).toBe(
            "too far apart to settle at this amount — pick it and confirm to see the options"
        );
    });

    it("the two sentences are genuinely different, and neither carries an amount", () => {
        // Same discipline as `settleBlockText`: the figure is printed once, beside the sentence,
        // so a number in here would be a second copy free to drift.
        expect(AMOUNT_GAP_HINT).not.toBe(AMOUNT_GAP_HINT_SPLIT);
        expect(AMOUNT_GAP_HINT_SPLIT).not.toMatch(/\d/);
        expect(AMOUNT_GAP_HINT).not.toMatch(/\d/);
    });

    it("the Split sentence speaks of the BALANCE, which is what the figure beside it measures", () => {
        // #1243 made that figure the remaining balance on a partly-allocated row. The words now
        // agree with the arithmetic instead of contradicting it.
        expect(AMOUNT_GAP_HINT_SPLIT).toContain("balance left");
    });
});
