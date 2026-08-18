import { describe, expect, it } from "vitest";

import {
    expenseDetailLines,
    expenseRequestNamesIn,
    isExpenseNotification,
    ledgerLabelFor,
} from "./expenseNotificationDetails";

const NAMES: Record<string, string> = {
    "acc@x.com": "Asha Accountant",
    "pm@x.com": "Priya Manager",
};
const resolve = (id: string) => NAMES[id];

const paid = { document: "Expense Request", docname: "EXR-26-00601", sender: "acc@x.com", event_id: "expense_request:paid" };
const rejected = { document: "Expense Request", docname: "EXR-26-00602", sender: "pm@x.com", event_id: "expense_request:rejected" };
const req = { name: "EXR-26-00601", type: "Staff Accommodation Rent", projects: "GURGAON-PROJ-00085", reviewed_by: "pm@x.com" };

describe("isExpenseNotification", () => {
    it("keys on the doctype it was raised against, not the wording", () => {
        expect(isExpenseNotification(paid)).toBe(true);
        expect(isExpenseNotification({ document: "Procurement Orders" })).toBe(false);
        expect(isExpenseNotification({})).toBe(false);
    });
});

describe("ledgerLabelFor", () => {
    it("mirrors the backend rule: the PRESENCE of a project decides the ledger", () => {
        expect(ledgerLabelFor("GURGAON-PROJ-00085")).toBe("Project Expenses");
        expect(ledgerLabelFor(null)).toBe("Non Project Expenses");
        expect(ledgerLabelFor("")).toBe("Non Project Expenses");
    });
});

describe("expenseDetailLines", () => {
    it("gives a paid notification all four lines, names resolved", () => {
        expect(expenseDetailLines(paid, req, resolve)).toEqual([
            { label: "Request", value: "EXR-26-00601" },
            { label: "Expense", value: "Project Expenses" },
            { label: "Expense Type", value: "Staff Accommodation Rent" },
            { label: "Paid By", value: "Asha Accountant" },
            { label: "Approved By", value: "Priya Manager" },
        ]);
    });

    it("labels a non-project expense by the same rule", () => {
        const lines = expenseDetailLines(paid, { ...req, projects: null }, resolve);
        expect(lines).toContainEqual({ label: "Expense", value: "Non Project Expenses" });
    });

    it("omits ledger and approver on a rejection -- neither exists", () => {
        const labels = expenseDetailLines(rejected, undefined, resolve).map((l) => l.label);
        expect(labels).toEqual(["Request", "Rejected By"]);
        expect(labels).not.toContain("Expense");
        expect(labels).not.toContain("Approved By");
    });

    it("falls back to the user id rather than rendering a labelled blank", () => {
        const lines = expenseDetailLines({ ...paid, sender: "ghost@x.com" }, req, resolve);
        expect(lines).toContainEqual({ label: "Paid By", value: "ghost@x.com" });
    });

    it("still answers what it can when the request has not loaded", () => {
        const lines = expenseDetailLines(paid, undefined, resolve);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines).toContainEqual({ label: "Request", value: "EXR-26-00601" });
    });
});

describe("expenseRequestNamesIn", () => {
    it("dedupes, and ignores non-expense notifications", () => {
        expect(expenseRequestNamesIn([paid, paid, rejected, { document: "Procurement Orders", docname: "PO-1" }]))
            .toEqual(["EXR-26-00601", "EXR-26-00602"]);
    });

    it("returns nothing when there is no expense notification, so the fetch is skipped", () => {
        expect(expenseRequestNamesIn([{ document: "Procurement Orders", docname: "PO-1" }])).toEqual([]);
        expect(expenseRequestNamesIn([])).toEqual([]);
    });
});
