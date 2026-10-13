import { describe, expect, it } from "vitest";

import {
    addLineOptions,
    conversionHint,
    emptyLine,
    expenseLabel,
    hiddenExpensesText,
    hiddenPaymentsText,
    LINE_NEEDS,
    lineProjects,
    linesSummary,
    recordsInProject,
    saveLineArgs,
    withoutPoWoLines,
    type ChequeLineDraft,
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

    it("says nothing for a cheque with no lines (an Ad-hoc cheque)", () => {
        expect(linesSummary(5000, [])).toEqual({ total: 0, text: undefined, warning: undefined });
    });
});

describe("hiddenPaymentsText", () => {
    it("says what the picker hid and why", () => {
        expect(
            hiddenPaymentsText({
                on_cheque: [{ payment: "PAY-1", cheque: "CHQ-26-00001", cheque_no: "004530", status: "Issued" }],
                rejected: 1,
            })
        ).toBe("Not shown: 1 already on cheque 004530 (Issued), 1 Rejected.");
    });

    it("names every cheque and counts payments", () => {
        expect(
            hiddenPaymentsText({
                on_cheque: [
                    { payment: "PAY-1", cheque: "C1", cheque_no: "004530", status: "Issued" },
                    { payment: "PAY-2", cheque: "C2", cheque_no: "004531", status: "Cleared" },
                ],
                rejected: 0,
            })
        ).toBe("Not shown: 2 already on cheques 004530 (Issued), 004531 (Cleared).");
        expect(hiddenPaymentsText({ on_cheque: [], rejected: 3 })).toBe("Not shown: 3 Rejected.");
    });

    it("is empty when nothing was hidden", () => {
        expect(hiddenPaymentsText({ on_cheque: [], rejected: 0 })).toBe("");
        expect(hiddenPaymentsText(undefined)).toBe("");
    });
});

describe("conversionHint", () => {
    const pay = { name: "PAY-1", amount: 1000, mode_of_payment: "Online", on_hold: 0 };

    it("tells the user what saving does to an Online payment, per status", () => {
        expect(conversionHint({ ...pay, status: "Approved" })).toBe(
            "Switches to Cheque and moves to Reconciliation Pending now."
        );
        expect(conversionHint({ ...pay, status: "Requested" })).toBe(
            "Switches to Cheque; moves to Reconciliation Pending once approved."
        );
        expect(conversionHint({ ...pay, status: "CEO Pending" })).toBe(
            "Switches to Cheque; moves to Reconciliation Pending once approved."
        );
        expect(conversionHint({ ...pay, status: "Approved", on_hold: 1 })).toBe(
            "Switches to Cheque; stays Approved while on hold and moves to Reconciliation Pending once released."
        );
        expect(conversionHint({ ...pay, status: "Reconciliation Pending" })).toBe(
            "Switches to Cheque; stays Reconciliation Pending."
        );
        expect(conversionHint({ ...pay, status: "Paid" })).toBe("Switches to Cheque; stays Paid.");
    });

    it("does not promise a switch for a payment that is already a Cheque payment", () => {
        expect(conversionHint({ ...pay, mode_of_payment: "Cheque", status: "Approved" })).toBe(
            "Goes on this cheque and moves to Reconciliation Pending now."
        );
        expect(conversionHint({ ...pay, mode_of_payment: "Cheque", status: "Paid" })).toBe(
            "Goes on this cheque; stays Paid."
        );
    });
});

describe("the record pickers", () => {
    const records: VendorRecord[] = [
        { doctype: "Procurement Orders", name: "PO/001", project: "P1", project_name: "Tower A", status: "Delivered", total_amount: 1 },
        { doctype: "Service Requests", name: "SR-001", project: "P2", project_name: "Mall", status: "Approved", total_amount: 1 },
        { doctype: "Procurement Orders", name: "PO/002", project: "P1", project_name: "Tower A", status: "Delivered", total_amount: 1 },
    ];

    it("offers each project the Vendor has work in once, by name", () => {
        expect(lineProjects(records)).toEqual([
            { value: "P2", label: "Mall" },
            { value: "P1", label: "Tower A" },
        ]);
    });

    it("offers the Vendor's POs and Work Orders in the line's project", () => {
        expect(recordsInProject(records, "P1").map((r) => r.name)).toEqual(["PO/001", "PO/002"]);
        expect(recordsInProject(records, "")).toEqual([]);
    });
});

describe("saveLineArgs", () => {
    it("sends a picked payment, or the typed amount when there is none", () => {
        expect(
            saveLineArgs([line({ payment_name: "PAY-1", amount: 20000 }), line({ amount: "5000" })])
        ).toEqual([
            { line_type: "PO/WO Payment", project: "PROJ-1", record_doctype: "Procurement Orders", record_name: "PO/001", payment_name: "PAY-1", amount: 20000 },
            { line_type: "PO/WO Payment", project: "PROJ-1", record_doctype: "Procurement Orders", record_name: "PO/001", amount: 5000 },
        ]);
    });

    it("sends the expense as the line's payment, with a project only for a Project Expense", () => {
        expect(
            saveLineArgs([
                line({ line_type: "Project Expense", payment_name: "PE-1", amount: 4000 }),
                line({ line_type: "Non-project Expense", payment_name: "NPE-1", amount: "600" }),
            ])
        ).toEqual([
            { line_type: "Project Expense", project: "PROJ-1", payment_name: "PE-1", amount: 4000 },
            { line_type: "Non-project Expense", payment_name: "NPE-1", amount: 600 },
        ]);
    });
});

describe("the line kinds (#1411)", () => {
    it("asks each kind only for the boxes it needs", () => {
        expect(LINE_NEEDS["PO/WO Payment"]).toEqual({ project: true, record: true, expense: false });
        expect(LINE_NEEDS["Project Expense"]).toEqual({ project: true, record: false, expense: true });
        expect(LINE_NEEDS["Non-project Expense"]).toEqual({ project: false, record: false, expense: true });
    });

    it("offers all three kinds on a Vendor cheque", () => {
        expect(addLineOptions({ vendorPayee: true, vendor: "VEN-1" }).map((o) => [o.type, o.disabledReason])).toEqual([
            ["PO/WO Payment", undefined],
            ["Project Expense", undefined],
            ["Non-project Expense", undefined],
        ]);
    });

    it("shows the PO/WO kind disabled, with the reason, on a typed-payee cheque", () => {
        const [poWo, ...expenses] = addLineOptions({ vendorPayee: false, vendor: "" });
        expect(poWo.disabledReason).toBe("A PO or Work Order payment needs a cheque made out to a Vendor.");
        expect(expenses.every((o) => o.disabledReason === undefined)).toBe(true);
    });

    it("asks for the Vendor before a PO/WO line", () => {
        expect(addLineOptions({ vendorPayee: true, vendor: "" })[0].disabledReason).toBe(
            "Pick the Vendor first: its POs and Work Orders are offered."
        );
    });

    it("starts each kind empty", () => {
        expect(emptyLine("Non-project Expense")).toEqual({
            line_type: "Non-project Expense", project: "", record_doctype: "", record_name: "", payment_name: "", amount: "",
        });
    });

    it("keeps the expense lines and drops the PO/WO lines when the payee changes", () => {
        const kept = [line({ line_type: "Project Expense" }), line({ line_type: "Non-project Expense" })];
        expect(withoutPoWoLines([line(), ...kept])).toEqual(kept);
    });
});

describe("the expense picker", () => {
    it("says how many expenses it hid for being on a live cheque", () => {
        expect(
            hiddenExpensesText({
                on_cheque: [
                    { payment: "NPE-1", cheque: "C1", cheque_no: "004530", status: "Issued" },
                    { payment: "NPE-2", cheque: "C1", cheque_no: "004530", status: "Issued" },
                ],
            })
        ).toBe("Not shown: 2 already on cheque 004530 (Issued).");
        expect(hiddenExpensesText({ on_cheque: [] })).toBe("");
        expect(hiddenExpensesText(undefined)).toBe("");
    });

    it("labels an expense by its name, amount, type and description", () => {
        expect(
            expenseLabel({ name: "NPE-1", amount: 6000, status: "Paid", type: "Electricity", description: "Office power, Sept", payment_date: null })
        ).toBe("NPE-1 · ₹6,000.00 · Electricity · Office power, Sept");
        expect(
            expenseLabel({ name: "NPE-2", amount: 50, status: "Approved", type: null, description: null, payment_date: null })
        ).toBe("NPE-2 · ₹50.00");
    });
});
