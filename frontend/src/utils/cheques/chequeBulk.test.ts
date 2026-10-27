import { describe, expect, it } from "vitest";

import type { ChequeApproval } from "./chequeApproval";
import {
    bulkChequeGroups,
    bulkDecisionTotals,
    chequeGroupNote,
    chequeGroupProblem,
    withChequeSiblings,
} from "./chequeBulk";

const onCheque = (name: string, cheque: string, amount = 10000) => ({
    name,
    doctype: "Project Payments",
    cheque,
    cheque_status: "Approval Pending",
    amount,
});
const online = (name: string, amount = 10000) => ({ name, doctype: "Project Payments", cheque: "", cheque_status: "", amount });

const page = [
    { id: "0", original: onCheque("PAY-1", "CHQ-A") },
    { id: "1", original: onCheque("PAY-2", "CHQ-A") },
    { id: "2", original: online("PAY-3") },
    { id: "3", original: onCheque("PAY-4", "CHQ-B") },
    { id: "4", original: { ...onCheque("PAY-5", "CHQ-C"), cheque_status: "Issued" } },
];

describe("withChequeSiblings", () => {
    it("ticking one payment on a cheque ticks its siblings on the page", () => {
        expect(withChequeSiblings({}, { "1": true }, page)).toEqual({ "0": true, "1": true });
    });

    it("unticking one unticks the whole cheque", () => {
        expect(withChequeSiblings({ "0": true, "1": true, "2": true }, { "1": true, "2": true }, page)).toEqual({
            "2": true,
        });
    });

    it("leaves rows decided alone as they were ticked", () => {
        expect(withChequeSiblings({}, { "2": true, "3": true, "4": true }, page)).toEqual({
            "2": true,
            "3": true,
            "4": true,
        });
    });
});

const line = (payment: string | null, amount: number) => ({
    payment,
    record: "PO/1",
    project: "PROJ-1",
    project_name: "Whitefield",
    amount,
    status: payment ? "Requested" : null,
});
const approval = (cheque: string, lines: ChequeApproval["lines"], over: Partial<ChequeApproval> = {}): ChequeApproval => ({
    cheque,
    cheque_no: "000751",
    bank: "ICICI Bank",
    status: "Approval Pending",
    amount: lines.reduce((s, l) => s + l.amount, 0),
    vendor: "VEN-1",
    vendor_name: "Suman Electric",
    status_after_l1: "CEO Pending",
    problem: null,
    lines,
    ...over,
});

describe("bulkChequeGroups", () => {
    const chqA = approval("CHQ-A", [line("PAY-1", 28400), line("PAY-9", 22000), line("PAY-2", 18000)]);

    it("groups a cheque's payments, ticked or not, and keeps the rest apart", () => {
        const rows = [onCheque("PAY-1", "CHQ-A"), online("PAY-3", 15000), onCheque("PAY-2", "CHQ-A")];
        const { groups, others } = bulkChequeGroups(rows, [chqA]);

        expect(others.map((r) => r.name)).toEqual(["PAY-3"]);
        expect(groups).toHaveLength(1);
        expect(groups[0].lines.map((l) => [l.payment, l.ticked])).toEqual([
            ["PAY-1", true],
            ["PAY-9", false],
            ["PAY-2", true],
        ]);
        expect(bulkDecisionTotals(groups, others)).toEqual({ count: 4, amount: 83400 });
    });

    it("keeps a cheque row apart until its group has loaded", () => {
        const { groups, others } = bulkChequeGroups([onCheque("PAY-4", "CHQ-B")], [chqA]);
        expect(groups).toEqual([]);
        expect(others.map((r) => r.name)).toEqual(["PAY-4"]);
    });
});

describe("chequeGroupNote", () => {
    const group = bulkChequeGroups([onCheque("PAY-1", "CHQ-A")], [
        approval("CHQ-A", [line("PAY-1", 28400), line("PAY-9", 22000), line("PAY-2", 18000)]),
    ]).groups[0];

    it("says the payments are approved together and where the cheque total sends them", () => {
        expect(chequeGroupNote(group, "approve", "lead")).toBe(
            "3 payments are approved together. Cheque total ₹68,400: goes on to the CEO."
        );
        expect(chequeGroupNote(group, "approve", "ceo")).toBe("3 payments are approved together. Cheque total ₹68,400.");
    });

    it("says a reject cancels the cheque", () => {
        expect(chequeGroupNote(group, "reject", "lead")).toBe("3 payments are rejected together and cheque 000751 is cancelled.");
    });

    it("names why an approve will fail, never a reject", () => {
        const waits = { ...group, approval: { ...group.approval, problem: "Line 2 has no payment yet." } };
        expect(chequeGroupProblem(waits, "approve")).toBe("Line 2 has no payment yet.");
        expect(chequeGroupProblem(waits, "reject")).toBeNull();
    });
});
