import { describe, expect, it } from "vitest";

import { invoiceNotes, newExpenseFields, newExpenseSubmit, whatHappensNext, whoApprovesNext } from "./newExpenseForm";

const PROJECT_ONLY = { project_allowed: true, project_required: true, has_format: false };
const NON_PROJECT = { project_allowed: false, project_required: false, has_format: false };
const BOTH = { project_allowed: true, project_required: false, has_format: false };
const WITH_FORM = { ...NON_PROJECT, has_format: true };

const fields = (over: Partial<Parameters<typeof newExpenseFields>[0]> = {}) =>
    newExpenseFields({ type: undefined, projectChosen: false, formatLoading: false, formatReady: false, ...over });

describe("newExpenseFields", () => {
    it("asks nothing past the type until a type is picked", () => {
        expect(fields()).toEqual({ project: "hidden", vendor: false, details: "none" });
    });

    it("requires the project on a project-only type", () => {
        expect(fields({ type: PROJECT_ONLY }).project).toBe("required");
    });

    it("hides the project on a non-project type", () => {
        expect(fields({ type: NON_PROJECT }).project).toBe("hidden");
    });

    it("offers the project as optional on a type that allows both", () => {
        expect(fields({ type: BOTH }).project).toBe("optional");
    });

    it("offers the vendor only once a project is chosen", () => {
        expect(fields({ type: PROJECT_ONLY }).vendor).toBe(false);
        expect(fields({ type: PROJECT_ONLY, projectChosen: true }).vendor).toBe(true);
        expect(fields({ type: BOTH, projectChosen: true }).vendor).toBe(true);
    });

    it("never offers the vendor on a non-project type", () => {
        expect(fields({ type: NON_PROJECT, projectChosen: true }).vendor).toBe(false);
    });

    it("asks a type with no form for a description", () => {
        expect(fields({ type: NON_PROJECT }).details).toBe("description");
    });

    it("asks the type's own questions once its form has loaded", () => {
        expect(fields({ type: WITH_FORM, formatLoading: true }).details).toBe("loading");
        expect(fields({ type: WITH_FORM, formatReady: true }).details).toBe("form");
    });

    it("falls back to a description when a type's form cannot be read", () => {
        expect(fields({ type: WITH_FORM }).details).toBe("description");
    });
});

describe("newExpenseSubmit", () => {
    it("asks everyone not on Records without review to send it for review", () => {
        expect(newExpenseSubmit({ recordsWithoutReview: false, amount: 40000, level: null }))
            .toEqual({ label: "Send for review", nextApprover: null });
    });

    it("an Admin's Rs 40,000 expense is approved once recorded", () => {
        expect(newExpenseSubmit({ recordsWithoutReview: true, amount: 40000, level: "l1" }))
            .toEqual({ label: "Record expense", nextApprover: "No one else needs to approve it." });
    });

    it("an Admin's Rs 60,000 expense goes to the CEO next", () => {
        expect(newExpenseSubmit({ recordsWithoutReview: true, amount: 60000, level: "l1" }).nextApprover)
            .toBe("The CEO approves it next.");
    });

    it("an HR raiser's Rs 10,000 expense is approved once recorded", () => {
        expect(newExpenseSubmit({ recordsWithoutReview: true, amount: 10000, level: null }).nextApprover)
            .toBe("No one else needs to approve it.");
    });

    it("an HR raiser's Rs 40,000 expense waits for an Admin", () => {
        expect(newExpenseSubmit({ recordsWithoutReview: true, amount: 40000, level: null }).nextApprover)
            .toBe("An Admin approves it next.");
    });

    it("an HR raiser's Rs 60,000 expense waits for an Admin, then the CEO", () => {
        expect(newExpenseSubmit({ recordsWithoutReview: true, amount: 60000, level: null }).nextApprover)
            .toBe("An Admin approves it next, then the CEO.");
    });

    it("words who approves an Expense at each status", () => {
        expect(whoApprovesNext("Requested", 60000)).toBe("An Admin approves it next, then the CEO.");
        expect(whoApprovesNext("CEO Pending", 60000)).toBe("The CEO approves it next.");
        expect(whoApprovesNext("Approved", 10000)).toBe("No one else needs to approve it.");
    });

    it("says nothing about the next approver before an amount is typed", () => {
        expect(newExpenseSubmit({ recordsWithoutReview: true, amount: 0, level: null }))
            .toEqual({ label: "Record expense", nextApprover: null });
    });
});

// What `create.create_expense_request` returns, trimmed to what the message reads.
const approvedOnSubmit = (expense_status: string) => ({
    name: "EXR-0042", status: "Approved" as const,
    created_expense: "PE-0099", expense_status,
});

describe("whatHappensNext: the message after a new expense is submitted", () => {
    it("an Expense approved on submit needs no one else", () => {
        expect(whatHappensNext(approvedOnSubmit("Approved"), 10000)).toEqual({
            title: "Expense recorded.", next: "No one else needs to approve it.", requestPath: null,
        });
    });

    it("an HR raiser's Rs 60,000 record lands at Requested and waits for an Admin, then the CEO", () => {
        expect(whatHappensNext(approvedOnSubmit("Requested"), 60000)).toEqual({
            title: "Expense recorded.", next: "An Admin approves it next, then the CEO.", requestPath: null,
        });
    });

    it("an Expense that lands at Requested under Rs 50,000 waits for an Admin alone", () => {
        expect(whatHappensNext(approvedOnSubmit("Requested"), 40000).next).toBe("An Admin approves it next.");
    });

    it("an Expense that lands at CEO Pending waits for the CEO", () => {
        expect(whatHappensNext(approvedOnSubmit("CEO Pending"), 60000).next).toBe("The CEO approves it next.");
    });

    it("says after submit what the button said before it", () => {
        for (const [amount, born] of [[10000, "Approved"], [40000, "Requested"], [60000, "Requested"]] as const) {
            const before = newExpenseSubmit({ recordsWithoutReview: true, amount, level: null }).nextApprover;
            expect(whatHappensNext(approvedOnSubmit(born), amount).next).toBe(before);
        }
        const before = newExpenseSubmit({ recordsWithoutReview: true, amount: 60000, level: "l1" }).nextApprover;
        expect(whatHappensNext(approvedOnSubmit("CEO Pending"), 60000).next).toBe(before);
    });

    it("a request that needs review links to its own page", () => {
        expect(whatHappensNext({
            name: "EXR-0043", status: "Pending Approval", created_expense: null, expense_status: null,
        }, 40000)).toEqual({
            title: "Sent for review.", next: "A reviewer approves it next.",
            requestPath: "/expense/requests/EXR-0043",
        });
    });
});

const READ = { invoice_no: "GN/24/118", invoice_date: "2026-09-30", amount: "21500" };
const notes = (over: Partial<Parameters<typeof invoiceNotes>[0]> = {}) =>
    invoiceNotes({
        hasFile: true, read: READ, invoice_date: "2026-09-30", invoice_ref: "GN/24/118",
        typedAmount: 21500, ...over,
    });

describe("invoiceNotes", () => {
    it("says nothing before an invoice is attached", () => {
        expect(notes({ hasFile: false, read: null, invoice_date: "", invoice_ref: "" }))
            .toEqual({ date: null, number: null, amountMismatch: null, count: 0 });
    });

    it("marks the fields Gemini filled", () => {
        expect(notes()).toEqual({ date: "read", number: "read", amountMismatch: null, count: 0 });
    });

    it("asks the raiser to type a field Gemini could not read", () => {
        const n = notes({ read: { ...READ, invoice_no: "" }, invoice_ref: "" });
        expect(n.number).toBe("unread");
        expect(n.count).toBe(1);
    });

    it("drops the prompt once the raiser types the field", () => {
        expect(notes({ read: { ...READ, invoice_no: "" }, invoice_ref: "GN/1" }).number).toBeNull();
    });

    it("asks for both fields when the file could not be read at all", () => {
        const n = notes({ read: null, invoice_date: "", invoice_ref: "" });
        expect([n.date, n.number, n.count]).toEqual(["unread", "unread", 2]);
    });

    it("warns when the invoice amount differs from the typed amount", () => {
        const n = notes({ typedAmount: 22000 });
        expect(n.amountMismatch).toEqual({ invoice: 21500, typed: 22000 });
        expect(n.count).toBe(1);
    });

    it("ignores a difference of a rupee or less, and an amount Gemini did not read", () => {
        expect(notes({ typedAmount: 21501 }).amountMismatch).toBeNull();
        expect(notes({ read: { ...READ, amount: "" }, typedAmount: 9000 }).amountMismatch).toBeNull();
    });
});
