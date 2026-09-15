// The Unreconcile dialog's sentences, its Reverse all footer, the notice after an undo, and what the
// table's Outcome cell offers on a Settled line (#1275, parent #1270, ADR-0022).
//
// ⚠️ THE CASHBOOK SENTENCE AND THE VERDICT NAMES ARE READ AGAINST THE REAL PYTHON. The table shows the
// sentence the server refuses with; a rewording on one side would otherwise go unnoticed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
    REVERSE_ALL_BLOCKED_ONE,
    UNRECONCILE_CASHBOOK_SENTENCE,
    VERDICT_REFUSED,
    VERDICT_REVERT_PAYMENT,
    legOutcomeLine,
    recordsHeading,
    reverseAllBlockedSentence,
    reverseAllLabel,
    unreconcileAffordance,
    unreconcileNotice,
    type UnreconcilePlan,
    type UnreconcilePlanLeg,
    type UnreconcileResult,
} from "./unreconcileView";

const decisionSource = readFileSync(
    fileURLToPath(
        new URL("../../../../nirmaan_stack/services/outflow_import/unreconcile.py", import.meta.url),
    ),
    "utf8",
);

const leg = (over: Partial<UnreconcilePlanLeg> = {}): UnreconcilePlanLeg => ({
    match: "MATCH-1",
    target_doctype: "Project Payments",
    target_name: "PAY-01393-019",
    target_amount: 100000,
    matched_at: "2026-09-10 10:00:00",
    verdict: VERDICT_REVERT_PAYMENT,
    what_happens: "Goes back to Approved. Its UTR and payment date are cleared.",
    reason: null,
    title: null,
    fix_at: null,
    ...over,
});

const refusedLeg = (over: Partial<UnreconcilePlanLeg> = {}) =>
    leg({
        match: "MATCH-3",
        target_name: "PAY-01402-003",
        verdict: VERDICT_REFUSED,
        what_happens: null,
        reason: "PAY-01402-003 now reads 48000, but this allocation wrote 50000 against it.",
        title: "Changed elsewhere",
        fix_at: "the Payments screen",
        ...over,
    });

const plan = (legs: UnreconcilePlanLeg[]): UnreconcilePlan => ({
    row: "ROW-1",
    row_status: "Settled",
    amount: 240000,
    beneficiary_name: "Krishna Fabricators",
    reference: "HDFC00031190",
    added_on: "2026-09-10 09:00:00",
    allocated: 240000,
    refused_count: legs.filter((l) => l.verdict === VERDICT_REFUSED).length,
    legs,
});

describe("parity with the Python decision module", () => {
    it("shows the exact sentence the server refuses a Cashbook line with", () => {
        expect(decisionSource).toContain(`CASHBOOK_REFUSAL = "${UNRECONCILE_CASHBOOK_SENTENCE}"`);
        expect(UNRECONCILE_CASHBOOK_SENTENCE).toBe("Cashbook rows can't be unreconciled yet.");
    });

    it("names the verdicts the way the server does", () => {
        expect(decisionSource).toContain(`VERDICT_REVERT_PAYMENT = "${VERDICT_REVERT_PAYMENT}"`);
        expect(decisionSource).toContain(`VERDICT_REFUSED = "${VERDICT_REFUSED}"`);
    });
});

describe("legOutcomeLine -- the coloured 'what happens' line (mockup scene 2)", () => {
    it("a reverted payment is blue and says what the server says", () => {
        expect(legOutcomeLine(leg())).toEqual({
            tone: "back",
            lead: null,
            text: "Goes back to Approved. Its UTR and payment date are cleared.",
        });
    });

    it("a refused record is grey, leads with 'Can't be undone here.' and gives the reason", () => {
        expect(legOutcomeLine(refusedLeg())).toEqual({
            tone: "refused",
            lead: "Can't be undone here.",
            text: "PAY-01402-003 now reads 48000, but this allocation wrote 50000 against it. Fix it on the Payments screen.",
        });
    });

    it("names where to fix it only when the reason does not already say so", () => {
        const says = refusedLeg({ reason: "Reverse it on the payments screen, where both can be corrected." });
        expect(legOutcomeLine(says).text).toBe("Reverse it on the payments screen, where both can be corrected.");
        const nowhere = refusedLeg({ reason: "This allocation was already reversed.", fix_at: null });
        expect(legOutcomeLine(nowhere).text).toBe("This allocation was already reversed.");
    });

    it("a verdict this screen does not know yet still shows the server's sentence, never a blank", () => {
        expect(legOutcomeLine(leg({ verdict: "delete_created", what_happens: "Will be deleted." }))).toEqual({
            tone: "other",
            lead: null,
            text: "Will be deleted.",
        });
    });
});

describe("the list heading and Reverse all", () => {
    it("counts the records on the transfer", () => {
        expect(recordsHeading(plan([leg()]))).toBe("1 record on this transfer");
        expect(recordsHeading(plan([leg(), leg({ match: "M2" }), refusedLeg()]))).toBe(
            "3 records on this transfer",
        );
    });

    it("labels Reverse all with every record, refused ones included", () => {
        expect(reverseAllLabel(plan([leg(), leg({ match: "M2" }), refusedLeg()]))).toBe("Reverse all 3");
    });

    it("is silent when every record can be undone", () => {
        expect(reverseAllBlockedSentence(plan([leg(), leg({ match: "M2" })]))).toBeNull();
    });

    it("says why it is off when one record is refused, in the ticket's words", () => {
        expect(REVERSE_ALL_BLOCKED_ONE).toBe(
            "Reverse all is off because one record can't be undone. Nothing changes unless every record can be undone.",
        );
        expect(reverseAllBlockedSentence(plan([leg(), refusedLeg()]))).toBe(REVERSE_ALL_BLOCKED_ONE);
    });

    it("counts them when more than one is refused", () => {
        expect(reverseAllBlockedSentence(plan([refusedLeg(), refusedLeg({ match: "M4" })]))).toBe(
            "Reverse all is off because 2 records can't be undone. Nothing changes unless every record can be undone.",
        );
    });
});

describe("unreconcileNotice -- what came off, and a changed amount", () => {
    const result = (over: Partial<UnreconcileResult> = {}): UnreconcileResult => ({
        row: "ROW-1",
        row_status: "Mismatched",
        allocated: 0,
        remaining: 240000,
        batch_status: "In Review",
        reversed: [
            {
                match: "M1",
                target_doctype: "Project Payments",
                target_name: "PAY-1",
                verdict: VERDICT_REVERT_PAYMENT,
                reversed_amount: 100000,
                amount_after: 100000,
            },
            {
                match: "M2",
                target_doctype: "Project Payments",
                target_name: "PAY-2",
                verdict: VERDICT_REVERT_PAYMENT,
                reversed_amount: 90000,
                amount_after: 90000,
            },
        ],
        ...over,
    });

    it("an open line needs a record again (mockup scene 6)", () => {
        expect(unreconcileNotice(result())).toEqual({
            title: "Unreconciled.",
            body: "2 records came off this transfer and went back to Approved. It now needs a record.",
        });
    });

    it("a Matched line needs a record too -- its old pick is not a decision", () => {
        expect(unreconcileNotice(result({ row_status: "Matched" })).body).toBe(
            "2 records came off this transfer and went back to Approved. It now needs a record.",
        );
    });

    it("a line still partly allocated says what is unallocated, as the balance", () => {
        const one = result({
            row_status: "Partially Allocated",
            allocated: 140000,
            remaining: 100000,
            reversed: [result().reversed[0]],
        });
        expect(unreconcileNotice(one).body).toBe(
            "1 record came off this transfer and went back to Approved. ₹1,00,000 of it is unallocated again.",
        );
    });

    it("states a payment's new amount when the save changed it (the TDS-on-Approved rule)", () => {
        const netted = result({
            reversed: [{ ...result().reversed[0], reversed_amount: 1000, amount_after: 980 }],
        });
        expect(unreconcileNotice(netted).body).toBe(
            "1 record came off this transfer and went back to Approved. It now needs a record. " +
                "PAY-1 is now ₹980, not ₹1,000.",
        );
    });

    it("says nothing about an amount that did not change or could not be read", () => {
        const unread = result({ reversed: [{ ...result().reversed[0], amount_after: null }] });
        expect(unreconcileNotice(unread).body).not.toContain("is now");
    });
});

describe("unreconcileAffordance -- what a Settled line's Outcome cell offers", () => {
    const row = (row_status: string, source = "Cashfree") => ({ row_status, source });

    it("a Settled line gets the button, for the undo roles", () => {
        expect(unreconcileAffordance(row("Settled"), true)).toBe("button");
    });

    it("a Cashbook Settled line gets the sentence instead of a missing button", () => {
        expect(unreconcileAffordance(row("Settled", "Cashbook"), true)).toBe("cashbook");
    });

    it("a plain Accountant sees neither", () => {
        expect(unreconcileAffordance(row("Settled"), false)).toBeNull();
        expect(unreconcileAffordance(row("Settled", "Cashbook"), false)).toBeNull();
    });

    it("nothing on a line that is not Settled -- Partially Allocated undoes inside its decision dialog", () => {
        for (const status of ["Partially Allocated", "Matched", "Mismatched", "Skipped", "Pending match run"]) {
            expect(unreconcileAffordance(row(status), true)).toBeNull();
        }
    });
});
