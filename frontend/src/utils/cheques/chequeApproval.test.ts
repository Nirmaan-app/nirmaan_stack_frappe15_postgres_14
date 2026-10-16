import { describe, expect, it } from "vitest";

import {
    approveAllLabel,
    approvesThroughCheque,
    ceoNote,
    chequeApprovalRows,
    otherPaymentsText,
    type ChequeApproval,
} from "./chequeApproval";

const line = (payment: string | null, amount: number, status: string | null = "Requested") => ({
    payment,
    record: `PO/267/${payment ?? "00115"}/26-27`,
    project: "PROJ-1",
    project_name: "Whitefield Tech Park",
    amount,
    status: payment ? status : null,
});

const approval = (lines: ChequeApproval["lines"], over: Partial<ChequeApproval> = {}): ChequeApproval => ({
    cheque: "CHQ-26-00007",
    cheque_no: "000751",
    bank: "ICICI Bank",
    status: "Pending",
    amount: lines.reduce((sum, l) => sum + l.amount, 0),
    vendor: "VEN-1",
    vendor_name: "Suman Electric",
    status_after_l1: "Approved",
    problem: null,
    lines,
    ...over,
});

describe("approvesThroughCheque", () => {
    it("sends a payment on a Pending cheque through its cheque", () => {
        expect(approvesThroughCheque({ doctype: "Project Payments", cheque: "CHQ-1", cheque_status: "Pending" })).toBe(true);
    });

    it("approves an Online payment, an expense or an older cheque payment alone, as before", () => {
        expect(approvesThroughCheque({ doctype: "Project Payments", cheque: "", cheque_status: "" })).toBe(false);
        expect(approvesThroughCheque({ doctype: "Project Expenses", cheque: "", cheque_status: "" })).toBe(false);
        expect(approvesThroughCheque({ doctype: "Project Payments", cheque: "CHQ-1", cheque_status: "Cancelled" })).toBe(false);
        expect(approvesThroughCheque(null)).toBe(false);
    });
});

describe("chequeApprovalRows", () => {
    it("lists every line, marks the payment the dialog was opened on, and labels a line with no payment", () => {
        const rows = chequeApprovalRows(approval([line("PAY-1", 28400), line("PAY-2", 22000), line(null, 18000)]), "PAY-2");
        expect(rows.map((r) => [r.paymentLabel, r.isOpened, r.statusLabel])).toEqual([
            ["PAY-1", false, "Requested"],
            ["PAY-2", true, "Requested"],
            ["No payment yet", false, "—"],
        ]);
    });
});

describe("otherPaymentsText", () => {
    it("counts the other lines on the cheque", () => {
        expect(otherPaymentsText(approval([line("PAY-1", 1), line("PAY-2", 1), line("PAY-3", 1)]))).toBe("with 2 other payments");
        expect(otherPaymentsText(approval([line("PAY-1", 1), line("PAY-2", 1)]))).toBe("with 1 other payment");
        expect(otherPaymentsText(approval([line("PAY-1", 1)]))).toBe("");
    });
});

describe("approveAllLabel", () => {
    it("names how many payments and the cheque total", () => {
        expect(approveAllLabel(approval([line("PAY-1", 28400), line("PAY-2", 22000), line("PAY-3", 18000)]))).toBe(
            "Approve all 3 · ₹68,400"
        );
    });

    it("drops 'all' for a cheque with one payment", () => {
        expect(approveAllLabel(approval([line("PAY-1", 20000)]))).toBe("Approve · ₹20,000");
    });
});

describe("ceoNote", () => {
    it("tells L1 that small payments on a big cheque go to the CEO together", () => {
        const a = approval([line("PAY-1", 28400), line("PAY-2", 22000), line("PAY-3", 18000)], {
            status_after_l1: "CEO Pending",
        });
        expect(ceoNote(a, "lead")).toBe(
            "The cheque total ₹68,400 is over ₹50,000, so all 3 payments go to CEO Pending after your approval, even though each one is under ₹50,000."
        );
    });

    it("says nothing about each payment when one is already over the line", () => {
        const a = approval([line("PAY-1", 60000), line("PAY-2", 5000)], { status_after_l1: "CEO Pending" });
        expect(ceoNote(a, "lead")).toBe(
            "The cheque total ₹65,000 is over ₹50,000, so all 2 payments go to CEO Pending after your approval."
        );
    });

    it("is silent when L1 finishes it, and at the CEO's own step", () => {
        expect(ceoNote(approval([line("PAY-1", 20000)]), "lead")).toBeNull();
        expect(ceoNote(approval([line("PAY-1", 60000)], { status_after_l1: "CEO Pending" }), "ceo")).toBeNull();
    });
});
