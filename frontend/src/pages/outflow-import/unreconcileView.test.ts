// The Unreconcile dialog's sentences, its Reverse all footer, the notice after an undo, and what the
// table's Outcome cell offers on a Settled line (#1275, parent #1270, ADR-0022).
//
// ⚠️ THE CASHBOOK SENTENCE AND THE VERDICT NAMES ARE READ AGAINST THE REAL PYTHON. The table shows the
// sentence the server refuses with; a rewording on one side would otherwise go unnoticed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
    CONFIRM_BY_HAND_CHIP,
    CONFIRM_BY_HAND_REFUSAL,
    REVERSE_ALL_BLOCKED_ONE,
    UNRECONCILE_CASHBOOK_SENTENCE,
    VERDICT_DELETE_CREATED,
    VERDICT_REFUSED,
    VERDICT_REVERT_EXPENSE,
    LEFTOVER_PAID_TITLE,
    VERDICT_REVERT_PAYMENT,
    VERDICT_UNSPLIT_PAYMENT,
    WHAT_HAPPENS_UNSPLIT,
    confirmByHandNote,
    legOutcomeLine,
    recordsHeading,
    reverseAllBlockedSentence,
    reverseAllLabel,
    splitNeedsYou,
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

const unsplitSource = readFileSync(
    fileURLToPath(
        new URL("../../../../nirmaan_stack/services/outflow_import/unsplit.py", import.meta.url),
    ),
    "utf8",
);

const expensesSource = readFileSync(
    fileURLToPath(new URL("../../../../nirmaan_stack/api/outflow_import/expenses.py", import.meta.url)),
    "utf8",
);

const leg = (over: Partial<UnreconcilePlanLeg> = {}): UnreconcilePlanLeg => ({
    match: "MATCH-1",
    target_doctype: "Project Payments",
    target_name: "PAY-01393-019",
    target_amount: 100000,
    matched_at: "2026-09-10 10:00:00",
    verdict: VERDICT_REVERT_PAYMENT,
    what_happens: "Goes back to Reconciliation Pending. Its UTR and payment date are cleared.",
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
        expect(decisionSource).toContain(`VERDICT_REVERT_EXPENSE = "${VERDICT_REVERT_EXPENSE}"`);
        expect(decisionSource).toContain(`VERDICT_DELETE_CREATED = "${VERDICT_DELETE_CREATED}"`);
        expect(decisionSource).toContain(`VERDICT_REFUSED = "${VERDICT_REFUSED}"`);
        expect(decisionSource).toContain(`VERDICT_UNSPLIT_PAYMENT = "${VERDICT_UNSPLIT_PAYMENT}"`);
    });

    it("leads the amber line with the server's sentence", () => {
        expect(decisionSource).toContain(`WHAT_HAPPENS_UNSPLIT = "${WHAT_HAPPENS_UNSPLIT}"`);
        expect(WHAT_HAPPENS_UNSPLIT).toBe("The split is undone:");
    });
});

describe("a part payment (#1279)", () => {
    const unsplitLeg = (over: Partial<UnreconcilePlanLeg> = {}) =>
        leg({
            target_name: "PAY-01388-011",
            target_amount: 60000,
            verdict: VERDICT_UNSPLIT_PAYMENT,
            what_happens: "The split is undone:",
            leftover: "PAY-01388-012",
            leftover_amount: 40000,
            restored_amount: 100000,
            joins_terms: true,
            ...over,
        });

    it("is amber and lists the three consequences (mockup scene 3)", () => {
        expect(legOutcomeLine(unsplitLeg())).toEqual({
            tone: "split",
            lead: null,
            text: "The split is undone:",
            items: [
                "PAY-01388-011 goes back to ₹1,00,000, Reconciliation Pending",
                "the leftover PAY-01388-012 (₹40,000) is deleted",
                "the PO's two payment terms join back into one",
            ],
        });
    });

    it("a payment with no PO terms promises no terms", () => {
        expect(legOutcomeLine(unsplitLeg({ joins_terms: false })).items).toEqual([
            "PAY-01388-011 goes back to ₹1,00,000, Reconciliation Pending",
            "the leftover PAY-01388-012 (₹40,000) is deleted",
        ]);
    });

    it("a leftover paid by another transfer is grey, 'not yet', and names no screen", () => {
        const refused = refusedLeg({
            reason: "Its leftover PAY-01391-005 was paid by another transfer on 14-Sep-2026. Unreconcile that transfer first.",
            title: "Leftover paid",
            fix_at: null,
        });
        expect(unsplitSource).toContain(`LEFTOVER_PAID_TITLE = "${LEFTOVER_PAID_TITLE}"`);
        expect(legOutcomeLine(refused)).toEqual({
            tone: "refused",
            lead: "Can't be undone yet.",
            text: "Its leftover PAY-01391-005 was paid by another transfer on 14-Sep-2026. Unreconcile that transfer first.",
        });
    });

    it("a taxed leftover does not repeat the screen its sentence already names", () => {
        const refused = refusedLeg({
            reason: "Its leftover PAY-01391-005 has TDS on it. Fix the tax on the Payments screen first.",
            title: "Leftover taxed",
        });
        expect(legOutcomeLine(refused)).toMatchObject({
            lead: "Can't be undone here.",
            text: "Its leftover PAY-01391-005 has TDS on it. Fix the tax on the Payments screen first.",
        });
    });

    const unsplitResult = (amountAfter: number): UnreconcileResult => ({
        row: "ROW-1",
        row_status: "Mismatched",
        allocated: 0,
        remaining: 60000,
        reversed: [
            {
                match: "M1",
                target_doctype: "Project Payments",
                target_name: "PAY-01388-011",
                verdict: VERDICT_UNSPLIT_PAYMENT,
                reversed_amount: 60000,
                amount_after: amountAfter,
                leftover: "PAY-01388-012",
                restored_amount: 100000,
            },
        ],
    });

    it("the notice says the split was undone, and the restored amount is no surprise", () => {
        expect(unreconcileNotice(unsplitResult(100000)).body).toBe(
            "1 record came off this transfer and went back to Reconciliation Pending. It now needs a record. " +
                "The split on PAY-01388-011 was undone and its leftover PAY-01388-012 deleted.",
        );
    });

    it("a restored amount off only by float noise is not news", () => {
        expect(unreconcileNotice(unsplitResult(100000.000000001)).body).not.toContain("is now");
    });

    it("a restored amount the save then changed is still stated", () => {
        expect(unreconcileNotice(unsplitResult(98000)).body).toContain(
            "PAY-01388-011 is now ₹98,000, not ₹1,00,000.",
        );
    });
});

describe("a record the import created (#1278)", () => {
    const createdLeg = leg({
        target_doctype: "Project Inflows",
        target_name: "PI-1",
        verdict: VERDICT_DELETE_CREATED,
        what_happens: "Will be deleted. The project's cash position updates straight away.",
    });

    it("is red and says what the server says", () => {
        expect(legOutcomeLine(createdLeg)).toEqual({
            tone: "deleted",
            lead: null,
            text: "Will be deleted. The project's cash position updates straight away.",
        });
    });

    it("the edited-since refusal is grey and adds no 'Fix it on' -- the sentence says where", () => {
        const edited = refusedLeg({
            reason: "Someone edited it on 17-Sep-2026, after the import made it. Delete or fix it on its own screen.",
            title: "Edited since",
            fix_at: null,
        });
        expect(legOutcomeLine(edited)).toEqual({
            tone: "refused",
            lead: "Can't be undone here.",
            text: "Someone edited it on 17-Sep-2026, after the import made it. Delete or fix it on its own screen.",
        });
    });
});

describe("an existing expense (#1277)", () => {
    const expenseLeg = leg({
        target_doctype: "Project Expenses",
        target_name: "EXP-1",
        verdict: VERDICT_REVERT_EXPENSE,
        what_happens: "Goes back to Reconciliation Pending. Payment date, reference and 'paid by' are cleared.",
    });

    it("is blue like a payment and says what the server says", () => {
        expect(legOutcomeLine(expenseLeg)).toEqual({
            tone: "back",
            lead: null,
            text: "Goes back to Reconciliation Pending. Payment date, reference and 'paid by' are cleared.",
        });
    });

    it("shows the server's sentences verbatim", () => {
        expect(decisionSource).toContain(
            `"Goes back to Reconciliation Pending. Payment date, reference and 'paid by' are cleared."`,
        );
        expect(decisionSource).toContain(`"Goes back to Reconciliation Pending. Payment date and reference are cleared."`);
    });

    it("an expense changed elsewhere names the Expenses screen", () => {
        const refused = leg({
            target_name: "EXP-1",
            verdict: VERDICT_REFUSED,
            what_happens: null,
            reason: "EXP-1 is 'Approved', not Paid. Somebody has already changed it.",
            title: "Changed elsewhere",
            fix_at: "the Expenses screen",
        });
        expect(legOutcomeLine(refused).text).toBe(
            "EXP-1 is 'Approved', not Paid. Somebody has already changed it. Fix it on the Expenses screen.",
        );
    });

    it("an expense that can't be undone yet names no screen to fix it on", () => {
        const refused = leg({
            target_name: "EXP-1",
            verdict: VERDICT_REFUSED,
            what_happens: null,
            reason: "EXP-1 may have been recorded by this import, and a record the import created can't be undone yet.",
            title: "Can't be undone yet",
            fix_at: null,
        });
        expect(legOutcomeLine(refused).text).toBe(
            "EXP-1 may have been recorded by this import, and a record the import created can't be undone yet.",
        );
    });

    it("the notice says it went back to Reconciliation Pending", () => {
        const result: UnreconcileResult = {
            row: "ROW-1",
            row_status: "Mismatched",
            allocated: 0,
            remaining: 500,
            reversed: [
                {
                    match: "M1",
                    target_doctype: "Project Expenses",
                    target_name: "EXP-1",
                    verdict: VERDICT_REVERT_EXPENSE,
                    reversed_amount: 500,
                    amount_after: 500,
                },
            ],
        };
        expect(unreconcileNotice(result).body).toBe(
            "1 record came off this transfer and went back to Reconciliation Pending. It now needs a record.",
        );
    });
});

describe("legOutcomeLine -- the coloured 'what happens' line (mockup scene 2)", () => {
    it("a reverted payment is blue and says what the server says", () => {
        expect(legOutcomeLine(leg())).toEqual({
            tone: "back",
            lead: null,
            text: "Goes back to Reconciliation Pending. Its UTR and payment date are cleared.",
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
        // ⚠️ `delete_created` was the example until #1278 gave it a colour, `unsplit_payment` until #1279.
        expect(
            legOutcomeLine(leg({ verdict: "a_later_verdict", what_happens: "Something else happens." })),
        ).toEqual({
            tone: "other",
            lead: null,
            text: "Something else happens.",
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
            body: "2 records came off this transfer and went back to Reconciliation Pending. It now needs a record.",
        });
    });

    it("a Matched line needs a record too -- its old pick is not a decision", () => {
        expect(unreconcileNotice(result({ row_status: "Matched" })).body).toBe(
            "2 records came off this transfer and went back to Reconciliation Pending. It now needs a record.",
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
            "1 record came off this transfer and went back to Reconciliation Pending. ₹1,00,000 of it is unallocated again.",
        );
    });

    it("says nothing about the amount when the undo left it alone (#1288)", () => {
        // ⚠️ THE INVERTED "TDS-on-Approved" PIN. This case used to assert the OPPOSITE: an undo
        // withheld TDS on a Work Order payment and netted it 1,000 -> 980, and this sentence was
        // the only place the screen said so. Tax is now withheld only on an approval from an
        // earlier step, so the ordinary undo reports the amount unchanged and stays quiet.
        const untouched = result({
            reversed: [{ ...result().reversed[0], reversed_amount: 1000, amount_after: 1000 }],
        });
        expect(unreconcileNotice(untouched).body).toBe(
            "1 record came off this transfer and went back to Reconciliation Pending. It now needs a record.",
        );
    });

    it("still states a new amount if the server ever writes one -- the backstop", () => {
        // Kept, not deleted: the sentence reports what the server actually wrote, whatever wrote
        // it. A silent amount change is the one thing a reviewer must not have to discover alone.
        const netted = result({
            reversed: [{ ...result().reversed[0], reversed_amount: 1000, amount_after: 980 }],
        });
        expect(unreconcileNotice(netted).body).toBe(
            "1 record came off this transfer and went back to Reconciliation Pending. It now needs a record. " +
                "PAY-1 is now ₹980, not ₹1,000.",
        );
    });

    it("a deleted record says it was deleted, never that it went back to Reconciliation Pending", () => {
        const deleted = {
            match: "M9",
            target_doctype: "Non Project Inflows",
            target_name: "NPI-1",
            verdict: VERDICT_DELETE_CREATED,
            reversed_amount: 500,
            amount_after: null,
        };
        expect(unreconcileNotice(result({ reversed: [deleted] })).body).toBe(
            "1 record came off this transfer and was deleted. It now needs a record.",
        );
    });

    it("a mix says how many of each", () => {
        const deleted = {
            match: "M9",
            target_doctype: "Project Expenses",
            target_name: "EXP-9",
            verdict: VERDICT_DELETE_CREATED,
            reversed_amount: 500,
            amount_after: null,
        };
        expect(unreconcileNotice(result({ reversed: [result().reversed[0], deleted] })).body).toBe(
            "2 records came off this transfer: 1 went back to Reconciliation Pending and 1 was deleted. It now needs a record.",
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

describe("confirmByHandNote -- the Outcome note on an unreconciled open line (#1280)", () => {
    const marked = (over: Record<string, unknown> = {}) => ({
        row_status: "Matched",
        confirm_by_hand: true,
        unreconciled_at: "2026-09-15 11:42:07.123456",
        unreconciled_targets: ["PAY-01388-007"],
        suggested_name: "PAY-01388-007",
        ...over,
    });

    it("names the date and the same pick, as the mockup does", () => {
        expect(confirmByHandNote(marked())).toEqual({
            lead: "Unreconciled on 15-Sep-2026.",
            pickLabel: "Same pick as before:",
            pick: "PAY-01388-007",
            text: "Unreconciled on 15-Sep-2026. Same pick as before: PAY-01388-007",
        });
    });

    it("never calls a pick the same when a re-run changed it", () => {
        const note = confirmByHandNote(marked({ suggested_name: "PAY-01400-001" }));
        expect(note?.pickLabel).toBe("Now matched:");
        expect(note?.pick).toBe("PAY-01400-001");
        expect(note?.text).not.toContain("Same pick");
    });

    it("says only the date when the line has no pick left", () => {
        const note = confirmByHandNote(marked({ row_status: "Mismatched", suggested_name: null }));
        expect(note).toEqual({
            lead: "Unreconciled on 15-Sep-2026.",
            pickLabel: null,
            pick: null,
            text: "Unreconciled on 15-Sep-2026.",
        });
    });

    it("still says it was unreconciled when the date is missing", () => {
        expect(confirmByHandNote(marked({ unreconciled_at: null }))?.lead).toBe("Unreconciled.");
    });

    it("nothing on an unmarked line", () => {
        expect(confirmByHandNote(marked({ confirm_by_hand: false }))).toBeNull();
        expect(confirmByHandNote({ row_status: "Matched", suggested_name: "PAY-1" })).toBeNull();
    });

    it("nothing on a marked line that is not open -- a Partially Allocated line keeps its own note", () => {
        for (const status of ["Partially Allocated", "Settled", "Skipped"]) {
            expect(confirmByHandNote(marked({ row_status: status }))).toBeNull();
        }
    });

    it("the chip reads Confirm by hand", () => {
        expect(CONFIRM_BY_HAND_CHIP).toBe("Confirm by hand");
    });
});

describe("splitNeedsYou -- the confirm dialog never files an unreconciled line under 'matched more than one' (#1280)", () => {
    it("separates marked lines from lines with several candidates, keeping order", () => {
        const rows = [
            { name: "A", amount: 1, confirm_by_hand: false },
            { name: "B", amount: 2, confirm_by_hand: true },
            { name: "C", amount: 3 },
            { name: "D", amount: 4, confirm_by_hand: true },
        ];
        const { several, byHand } = splitNeedsYou(rows);
        expect(several.map((r) => r.name)).toEqual(["A", "C"]);
        expect(byHand.map((r) => r.name)).toEqual(["B", "D"]);
    });
});

describe("the bulk refusal sentence is the server's", () => {
    it("matches expenses.CONFIRM_BY_HAND_REFUSAL", () => {
        const joined = [...expensesSource.matchAll(/CONFIRM_BY_HAND_REFUSAL = \(([\s\S]*?)\)/g)][0][1]
            .split("\n")
            .map((line) => line.trim().replace(/^"|"$/g, ""))
            .join("");
        expect(joined).toBe(CONFIRM_BY_HAND_REFUSAL);
    });
});
