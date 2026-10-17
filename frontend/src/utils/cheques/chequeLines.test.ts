import { describe, expect, it } from "vitest";

import {
    chequeSaveNote,
    conversionHint,
    emptyLine,
    hiddenPaymentsText,
    isPoLine,
    LINE_NEEDS,
    lineProjects,
    linesSummary,
    otherLinePayments,
    recordsInProject,
    saveLineArgs,
    withoutPoWoLines,
    type ChequeLineDraft,
    type HiddenPayments,
    type VendorRecord,
} from "./chequeLines";

const line = (overrides: Partial<ChequeLineDraft> = {}): ChequeLineDraft => ({
    line_type: "PO/WO Payment",
    project: "PROJ-1",
    record_doctype: "Procurement Orders",
    record_name: "PO/001",
    payment_name: "",
    amount: 0,
    ...overrides,
});

const nothingHidden: HiddenPayments = { on_cheque: [], rejected: 0, other_step: 0, on_hold: 0, moved_on: {} };

describe("linesSummary", () => {
    it("reads 'Lines total ₹X of ₹Y' and stays quiet within ₹2", () => {
        const s = linesSummary(100000, [line({ amount: 70000 }), line({ amount: "29999" })]);
        expect(s.text).toBe("Lines total ₹99,999.00 of ₹1,00,000.00");
        expect(s.warning).toBeUndefined();
    });

    it("warns softly when the lines differ from the cheque by more than ₹2", () => {
        const s = linesSummary(100000, [line({ amount: 70000 })]);
        expect(s.warning).toBe("The lines are ₹30,000.00 short of the cheque amount.");
        expect(linesSummary(100, [line({ amount: 103 })]).warning).toBe(
            "The lines are ₹3.00 more than the cheque amount."
        );
    });

    it("says nothing while there are no lines", () => {
        expect(linesSummary(5000, [])).toEqual({ total: 0, text: undefined, warning: undefined });
    });
});

describe("hiddenPaymentsText", () => {
    it("says what the picker hid and why", () => {
        expect(
            hiddenPaymentsText({
                ...nothingHidden,
                on_cheque: [{ payment: "PAY-1", cheque: "CHQ-26-00001", cheque_no: "004530", status: "Pending" }],
                rejected: 1,
                moved_on: { "Reconciliation Pending": 1, Paid: 2 },
                on_hold: 1,
            })
        ).toBe("Not shown: 1 already on cheque 004530 (Pending), 1 Rejected, 1 Reconciliation Pending, 2 Paid, 1 on hold.");
    });

    it("names every cheque and counts payments", () => {
        expect(
            hiddenPaymentsText({
                ...nothingHidden,
                on_cheque: [
                    { payment: "PAY-1", cheque: "C1", cheque_no: "004530", status: "Issued" },
                    { payment: "PAY-2", cheque: "C2", cheque_no: "004531", status: "Cleared" },
                ],
            })
        ).toBe("Not shown: 2 already on cheques 004530 (Issued), 004531 (Cleared).");
    });

    it("says which step the cheque's other payments set", () => {
        expect(hiddenPaymentsText({ ...nothingHidden, other_step: 2 }, "Requested")).toBe(
            "Not shown: 2 at another step (this cheque's payments are Requested; all must be at one step)."
        );
    });

    it("is empty when nothing was hidden", () => {
        expect(hiddenPaymentsText(nothingHidden)).toBe("");
        expect(hiddenPaymentsText(undefined)).toBe("");
    });
});

describe("conversionHint", () => {
    const pay = { mode_of_payment: "Online" };

    it("tells the user what saving does to a picked payment, per step", () => {
        expect(conversionHint({ ...pay, status: "Approved" })).toBe(
            "Switches to Cheque and moves to Reconciliation Pending on save."
        );
        expect(conversionHint({ ...pay, status: "Requested" })).toBe(
            "Switches to Cheque; approved together with the cheque's other payments."
        );
        expect(conversionHint({ ...pay, status: "CEO Pending" })).toBe(
            "Switches to Cheque; approved together with the cheque's other payments."
        );
    });

    it("does not promise a switch for a payment that is already a Cheque payment", () => {
        expect(conversionHint({ mode_of_payment: "Cheque", status: "Approved" })).toBe(
            "Goes on this cheque and moves to Reconciliation Pending on save."
        );
    });
});

describe("chequeSaveNote", () => {
    const paid = (name: string, status: string) => line({ payment_name: name, payment_status: status });

    it("says a cheque waiting for approval starts Pending, and who approves it by the cheque amount", () => {
        expect(chequeSaveNote(68400, [paid("P1", "Requested"), paid("P2", "Requested"), paid("P3", "Requested")])).toBe(
            "This cheque is Pending. Its 3 payments switch to Cheque and are approved together. The cheque total ₹68,400.00 is over ₹50,000, so the CEO approves them too. Once approved it becomes Issued and waits in Cheque Issued – Reconciliation Pending."
        );
        expect(chequeSaveNote(20000, [paid("P1", "CEO Pending")])).toBe(
            "This cheque is Pending. Its 1 payment switches to Cheque. Once approved it becomes Issued and waits in Cheque Issued – Reconciliation Pending."
        );
    });

    it("says a cheque of approved payments is Issued on save", () => {
        expect(chequeSaveNote(40000, [paid("P1", "Approved"), paid("P2", "Approved")])).toBe(
            "Its 2 payments are already approved: they move to Reconciliation Pending and the cheque is Issued on save."
        );
    });

    it("says a line with no payment yet keeps it Pending", () => {
        expect(chequeSaveNote(20000, [line({ amount: 20000 })])).toBe(
            "This cheque stays Pending until every line names its payment."
        );
        expect(chequeSaveNote(40000, [paid("P1", "Approved"), line({ amount: 1 })])).toBe(
            "This cheque stays Pending until every line names its payment."
        );
    });

    it("says nothing before a line is added", () => {
        expect(chequeSaveNote(20000, [])).toBeUndefined();
    });
});

describe("the lines a picker leaves out", () => {
    it("names the payments the cheque's other lines hold", () => {
        const lines = [line({ payment_name: "P1" }), line(), line({ payment_name: "P3" })];
        expect(otherLinePayments(lines, 0)).toEqual(["P3"]);
        expect(otherLinePayments(lines, 1)).toEqual(["P1", "P3"]);
    });

    it("tells a PO line from one recorded before (a Work Order or expense line)", () => {
        expect(isPoLine(line())).toBe(true);
        expect(isPoLine(line({ record_doctype: "" }))).toBe(true); // a new line, its PO not picked yet
        expect(isPoLine(line({ record_doctype: "Service Requests" }))).toBe(false);
        expect(isPoLine(line({ line_type: "Non-project Expense", record_doctype: "" }))).toBe(false);
    });
});

describe("the record pickers", () => {
    const records: VendorRecord[] = [
        { doctype: "Procurement Orders", name: "PO/001", project: "P1", project_name: "Tower A", status: "Delivered", total_amount: 1 },
        { doctype: "Procurement Orders", name: "PO/003", project: "P2", project_name: "Mall", status: "Delivered", total_amount: 1 },
        { doctype: "Procurement Orders", name: "PO/002", project: "P1", project_name: "Tower A", status: "Delivered", total_amount: 1 },
    ];

    it("offers each project the Vendor has POs in once, by name", () => {
        expect(lineProjects(records)).toEqual([
            { value: "P2", label: "Mall" },
            { value: "P1", label: "Tower A" },
        ]);
    });

    it("offers the Vendor's POs in the line's project", () => {
        expect(recordsInProject(records, "P1").map((r) => r.name)).toEqual(["PO/001", "PO/002"]);
        expect(recordsInProject(records, "")).toEqual([]);
    });
});

describe("saveLineArgs", () => {
    it("sends a picked payment, or the typed amount when there is none", () => {
        expect(
            saveLineArgs([line({ payment_name: "PAY-1", payment_status: "Requested", amount: 20000 }), line({ amount: "5000" })])
        ).toEqual([
            { line_type: "PO/WO Payment", project: "PROJ-1", record_doctype: "Procurement Orders", record_name: "PO/001", payment_name: "PAY-1", amount: 20000 },
            { line_type: "PO/WO Payment", project: "PROJ-1", record_doctype: "Procurement Orders", record_name: "PO/001", amount: 5000 },
        ]);
    });

    it("sends an Old-type cheque's expense line back as recorded", () => {
        expect(
            saveLineArgs([line({ line_type: "Non-project Expense", payment_name: "NPE-1", amount: "600" })])
        ).toEqual([{ line_type: "Non-project Expense", payment_name: "NPE-1", amount: 600 }]);
    });
});

describe("the line kinds", () => {
    it("asks each kind only for the boxes it needs", () => {
        expect(LINE_NEEDS["PO/WO Payment"]).toEqual({ project: true, record: true, expense: false });
        expect(LINE_NEEDS["Project Expense"]).toEqual({ project: true, record: false, expense: true });
        expect(LINE_NEEDS["Non-project Expense"]).toEqual({ project: false, record: false, expense: true });
    });

    it("starts a PO line empty", () => {
        expect(emptyLine()).toEqual({
            line_type: "PO/WO Payment", project: "", record_doctype: "", record_name: "", payment_name: "", amount: "",
        });
    });

    it("drops the PO lines when the Vendor changes", () => {
        const kept = [line({ line_type: "Non-project Expense" })];
        expect(withoutPoWoLines([line(), ...kept])).toEqual(kept);
    });
});
