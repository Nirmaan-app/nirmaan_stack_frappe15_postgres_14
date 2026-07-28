import { describe, expect, it } from "vitest";
import {
    EXPENSE_AUTO_APPROVE_LIMIT,
    EXPENSE_SUBMIT_LABELS,
    getExpenseSubmitLabel,
    isAutoApprovedExpenseAmount,
} from "./expenseApproval";

const { autoApproved, needsApproval } = EXPENSE_SUBMIT_LABELS;

describe("isAutoApprovedExpenseAmount", () => {
    it("auto-approves a positive amount below the limit", () => {
        expect(isAutoApprovedExpenseAmount(4999)).toBe(true);
        expect(isAutoApprovedExpenseAmount(1)).toBe(true);
        expect(isAutoApprovedExpenseAmount(4999.99)).toBe(true);
    });

    // The backend comparison is a strict `<`, so the limit itself is NOT
    // auto-approved. "under 5000" in conversation quietly excludes this row.
    it("does NOT auto-approve exactly the limit", () => {
        expect(isAutoApprovedExpenseAmount(EXPENSE_AUTO_APPROVE_LIMIT)).toBe(false);
    });

    it("does NOT auto-approve above the limit", () => {
        expect(isAutoApprovedExpenseAmount(5001)).toBe(false);
        expect(isAutoApprovedExpenseAmount(150000)).toBe(false);
    });

    // Non-Project Expenses explicitly supports refunds as negative amounts.
    // A refund is "less than 5000" but takes the FULL approval path.
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
        expect(isAutoApprovedExpenseAmount("4999")).toBe(true);
        expect(isAutoApprovedExpenseAmount("5000")).toBe(false);
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
        expect(getExpenseSubmitLabel(4999)).toBe(autoApproved);
    });

    it("labels every non-auto-approved path as an approval request", () => {
        expect(getExpenseSubmitLabel(5000)).toBe(needsApproval);
        expect(getExpenseSubmitLabel(6000)).toBe(needsApproval);
        expect(getExpenseSubmitLabel(-2000)).toBe(needsApproval);
        expect(getExpenseSubmitLabel("")).toBe(needsApproval);
    });

    it("uses the agreed copy verbatim", () => {
        expect(autoApproved).toBe("Raise Expense");
        expect(needsApproval).toBe("Send for Approval");
    });
});
