import { describe, expect, it } from "vitest";
import {
    EXPENSE_AUTO_APPROVE_LIMIT,
    EXPENSE_CREATED_TOASTS,
    EXPENSE_SUBMIT_LABELS,
    getExpenseCreatedToast,
    getExpenseSubmitLabel,
    isAutoApprovedExpenseAmount,
} from "./expenseApproval";

const { autoApproved, needsApproval } = EXPENSE_SUBMIT_LABELS;

describe("isAutoApprovedExpenseAmount", () => {
    it("auto-approves a positive amount below the limit", () => {
        expect(isAutoApprovedExpenseAmount(9999)).toBe(true);
        expect(isAutoApprovedExpenseAmount(1)).toBe(true);
        expect(isAutoApprovedExpenseAmount(9999.99)).toBe(true);
    });

    // The backend comparison is `<=`, so the limit itself IS auto-approved
    // (owner ruling 2026-09-04, reversing the original strict `<`).
    it("DOES auto-approve exactly the limit", () => {
        expect(isAutoApprovedExpenseAmount(EXPENSE_AUTO_APPROVE_LIMIT)).toBe(true);
    });

    it("does NOT auto-approve above the limit", () => {
        expect(isAutoApprovedExpenseAmount(10000.01)).toBe(false);
        expect(isAutoApprovedExpenseAmount(10001)).toBe(false);
        expect(isAutoApprovedExpenseAmount(150000)).toBe(false);
    });

    // Non-Project Expenses explicitly supports refunds as negative amounts.
    // A refund is "less than 10000" but takes the FULL approval path.
    it("does NOT auto-approve a refund, however small", () => {
        expect(isAutoApprovedExpenseAmount(-1)).toBe(false);
        expect(isAutoApprovedExpenseAmount(-2000)).toBe(false);
        expect(isAutoApprovedExpenseAmount(-6000)).toBe(false);
    });

    it("does NOT auto-approve zero", () => {
        expect(isAutoApprovedExpenseAmount(0)).toBe(false);
    });

    // The dialogs hold `amount` as a form STRING, so the string path is the
    // one that actually runs in the product.
    it("reads the string form state the dialogs actually hold", () => {
        expect(isAutoApprovedExpenseAmount("9999")).toBe(true);
        expect(isAutoApprovedExpenseAmount("10000")).toBe(true);
        expect(isAutoApprovedExpenseAmount("10001")).toBe(false);
        expect(isAutoApprovedExpenseAmount("-2000")).toBe(false);
    });

    // Safe default while the user is still typing: an unparseable amount is
    // not evidence of a small expense.
    it("treats blank / unparseable / nullish input as NOT auto-approved", () => {
        expect(isAutoApprovedExpenseAmount("")).toBe(false);
        expect(isAutoApprovedExpenseAmount("   ")).toBe(false);
        expect(isAutoApprovedExpenseAmount("abc")).toBe(false);
        expect(isAutoApprovedExpenseAmount(undefined)).toBe(false);
        expect(isAutoApprovedExpenseAmount(null)).toBe(false);
    });
});

describe("getExpenseSubmitLabel", () => {
    it("labels an auto-approved amount as a direct raise", () => {
        expect(getExpenseSubmitLabel(9999)).toBe(autoApproved);
        expect(getExpenseSubmitLabel(10000)).toBe(autoApproved);
    });

    it("labels every non-auto-approved path as an approval request", () => {
        expect(getExpenseSubmitLabel(10001)).toBe(needsApproval);
        expect(getExpenseSubmitLabel(11000)).toBe(needsApproval);
        expect(getExpenseSubmitLabel(-2000)).toBe(needsApproval);
        expect(getExpenseSubmitLabel("")).toBe(needsApproval);
    });

    it("uses the agreed copy verbatim", () => {
        expect(autoApproved).toBe("Raise Expense");
        expect(needsApproval).toBe("Send for Approval");
    });
});

describe("getExpenseCreatedToast", () => {
    // The SERVER decides; the toast reports. A status of "Approved" came back
    // from the doctype's own validate, so it is the authority here.
    it("announces the auto-approval when the server returned Approved", () => {
        expect(getExpenseCreatedToast("Approved", 500)).toBe(EXPENSE_CREATED_TOASTS.autoApproved);
        expect(EXPENSE_CREATED_TOASTS.autoApproved.title).toBe("Auto-approved");
    });

    it("announces the approval request when the server returned Requested", () => {
        expect(getExpenseCreatedToast("Requested", 50000)).toBe(EXPENSE_CREATED_TOASTS.needsApproval);
    });

    // The whole point of reading the status: if the client predicate ever drifts
    // from the backend, the toast must still report what actually happened.
    it("trusts the returned status OVER the amount when they disagree", () => {
        expect(getExpenseCreatedToast("Requested", 500)).toBe(EXPENSE_CREATED_TOASTS.needsApproval);
        expect(getExpenseCreatedToast("Approved", 50000)).toBe(EXPENSE_CREATED_TOASTS.autoApproved);
    });

    // Fallback only: a create call that returns no status at all.
    it("falls back to the amount when no status came back", () => {
        expect(getExpenseCreatedToast(undefined, 9999)).toBe(EXPENSE_CREATED_TOASTS.autoApproved);
        expect(getExpenseCreatedToast(undefined, EXPENSE_AUTO_APPROVE_LIMIT)).toBe(EXPENSE_CREATED_TOASTS.autoApproved);
        expect(getExpenseCreatedToast(null, 10001)).toBe(EXPENSE_CREATED_TOASTS.needsApproval);
        expect(getExpenseCreatedToast("", -2000)).toBe(EXPENSE_CREATED_TOASTS.needsApproval);
    });

    it("names the limit in the auto-approved copy", () => {
        expect(EXPENSE_CREATED_TOASTS.autoApproved.description).toContain("10,000");
    });
});
