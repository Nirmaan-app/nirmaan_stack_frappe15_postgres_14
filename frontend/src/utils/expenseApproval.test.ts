import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    EXPENSE_CREATED_TOASTS,
    EXPENSE_SUBMIT_LABELS,
    getExpenseCreatedToast,
    getExpenseSubmitLabel,
    isAutoApprovedExpenseAmount,
} from "./expenseApproval";
import { TIER_AUTO_APPROVE_BELOW, isAutoApproved } from "./approvalTiers";

const { autoApproved, needsApproval } = EXPENSE_SUBMIT_LABELS;

// ⚠️ THIS SUITE WAS REWRITTEN WHEN THE MODULE STOPPED OWNING A RULE.
//
// It used to pin `EXPENSE_AUTO_APPROVE_LIMIT === 10000` and an INCLUSIVE edge. Every one of
// those assertions passed for the whole time the module disagreed with the backend, because
// they pinned the module against ITSELF — the header claimed parity with the Python source
// and nothing ever read it. The tests below pin the two properties that actually matter:
// that this module DELEGATES, and that it cannot quietly grow a number of its own again.

const MODULE_SOURCE = readFileSync(resolve(__dirname, "./expenseApproval.ts"), "utf-8");

describe("the module owns copy, not a rule", () => {
    it("declares no threshold constant of its own", () => {
        // The old `EXPENSE_AUTO_APPROVE_LIMIT` is gone and must not come back under any
        // name. A `const X = <number>` here is the exact shape of the drift this rewrite
        // ended. (Comments are stripped first so the header's prose may keep explaining it.)
        const code = MODULE_SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
        expect(code).not.toMatch(/const\s+[A-Z_]*LIMIT[A-Z_]*\s*=/);
        expect(code).not.toMatch(/\b1[05]000\b/);
    });

    it("imports the predicate from the centralized tiers module", () => {
        expect(MODULE_SOURCE).toMatch(
            /import\s*\{[^}]*isAutoApproved[^}]*\}\s*from\s*"\.\/approvalTiers"/
        );
    });
});

describe("isAutoApprovedExpenseAmount", () => {
    // The point of the delegation: these two can never disagree, at any value.
    it("agrees with `isAutoApproved` across the whole range", () => {
        for (const v of [
            -60000, -15000, -500, -1, 0, 1, 500, 9999, 10000, 10001,
            14999, 14999.99, 15000, 15000.01, 29999, 30000, 50000, 150000,
        ]) {
            expect(isAutoApprovedExpenseAmount(v), `at ${v}`).toBe(isAutoApproved(v));
        }
    });

    it("auto-approves a positive amount strictly BELOW the threshold", () => {
        expect(isAutoApprovedExpenseAmount(1)).toBe(true);
        expect(isAutoApprovedExpenseAmount(9999)).toBe(true);
        expect(isAutoApprovedExpenseAmount(TIER_AUTO_APPROVE_BELOW - 1)).toBe(true);
        expect(isAutoApprovedExpenseAmount(TIER_AUTO_APPROVE_BELOW - 0.01)).toBe(true);
    });

    // ⚠️ THE EDGE FLIPPED. Under the retired ₹10,000 rule the limit itself auto-approved;
    // under the centralized rule the threshold needs L1. A test asserting the old inclusive
    // edge is stale, not broken — do not "restore" it.
    it("does NOT auto-approve exactly the threshold (EXCLUSIVE)", () => {
        expect(isAutoApprovedExpenseAmount(TIER_AUTO_APPROVE_BELOW)).toBe(false);
    });

    // The band that was actively wrong before this rewrite: the server approved these on
    // save while the button said they were being sent for approval.
    it("auto-approves the band the old ₹10,000 rule sent for approval", () => {
        expect(isAutoApprovedExpenseAmount(10001)).toBe(true);
        expect(isAutoApprovedExpenseAmount(12000)).toBe(true);
        expect(isAutoApprovedExpenseAmount(14999)).toBe(true);
    });

    it("does not auto-approve above the threshold", () => {
        expect(isAutoApprovedExpenseAmount(15000.01)).toBe(false);
        expect(isAutoApprovedExpenseAmount(150000)).toBe(false);
    });

    // A refund must never skip review, however small. The sign blocks auto-approval; it
    // does not by itself decide which approvals are needed.
    it("never auto-approves a refund or zero", () => {
        expect(isAutoApprovedExpenseAmount(-1)).toBe(false);
        expect(isAutoApprovedExpenseAmount(-2000)).toBe(false);
        expect(isAutoApprovedExpenseAmount(-60000)).toBe(false);
        expect(isAutoApprovedExpenseAmount(0)).toBe(false);
    });

    // `Project Expenses.amount` is a Data / varchar column, so a string is the normal case.
    it("handles string amounts", () => {
        expect(isAutoApprovedExpenseAmount("9999")).toBe(true);
        expect(isAutoApprovedExpenseAmount("12000")).toBe(true);
        expect(isAutoApprovedExpenseAmount("15000")).toBe(false);
        expect(isAutoApprovedExpenseAmount("-2000")).toBe(false);
    });

    it("treats unreadable input as needing approval", () => {
        expect(isAutoApprovedExpenseAmount("")).toBe(false);
        expect(isAutoApprovedExpenseAmount("   ")).toBe(false);
        expect(isAutoApprovedExpenseAmount("abc")).toBe(false);
        expect(isAutoApprovedExpenseAmount(undefined)).toBe(false);
        expect(isAutoApprovedExpenseAmount(null)).toBe(false);
    });
});

describe("getExpenseSubmitLabel", () => {
    it('says "Raise Expense" for an auto-approved amount', () => {
        expect(getExpenseSubmitLabel(9999)).toBe(autoApproved);
        expect(getExpenseSubmitLabel(12000)).toBe(autoApproved);
        expect(getExpenseSubmitLabel(TIER_AUTO_APPROVE_BELOW - 1)).toBe(autoApproved);
    });

    it('says "Send for Approval" from the threshold upward, and for refunds', () => {
        expect(getExpenseSubmitLabel(TIER_AUTO_APPROVE_BELOW)).toBe(needsApproval);
        expect(getExpenseSubmitLabel(50000)).toBe(needsApproval);
        expect(getExpenseSubmitLabel(-2000)).toBe(needsApproval);
        expect(getExpenseSubmitLabel("")).toBe(needsApproval);
    });

    // Both tiers SEND; only auto SAVES. The label answers what the click does, so L1 and
    // L1+L2 deliberately read the same.
    it("does not distinguish L1 from L1+L2", () => {
        expect(getExpenseSubmitLabel(20000)).toBe(getExpenseSubmitLabel(200000));
    });
});

describe("EXPENSE_CREATED_TOASTS", () => {
    // The copy has to match the EXCLUSIVE edge. "or less" would describe the retired rule
    // and would be wrong at exactly the threshold.
    it('describes the threshold as "below", never "or less"', () => {
        expect(EXPENSE_CREATED_TOASTS.autoApproved.description).toContain("below");
        expect(EXPENSE_CREATED_TOASTS.autoApproved.description).not.toContain("or less");
    });

    it("names the centralized threshold, not a retyped number", () => {
        expect(EXPENSE_CREATED_TOASTS.autoApproved.description).toContain("15,000");
        expect(EXPENSE_CREATED_TOASTS.autoApproved.description).not.toContain("10,000");
    });
});

describe("getExpenseCreatedToast", () => {
    it("uses the server status when it has one", () => {
        expect(getExpenseCreatedToast("Approved", 500)).toBe(EXPENSE_CREATED_TOASTS.autoApproved);
        expect(getExpenseCreatedToast("Requested", 50000)).toBe(EXPENSE_CREATED_TOASTS.needsApproval);
    });

    // The server is the rule. If the two ever disagree again, the toast must report what
    // actually happened — not what the client predicted.
    it("believes the server over the amount", () => {
        expect(getExpenseCreatedToast("Requested", 500)).toBe(EXPENSE_CREATED_TOASTS.needsApproval);
        expect(getExpenseCreatedToast("Approved", 50000)).toBe(EXPENSE_CREATED_TOASTS.autoApproved);
    });

    it("falls back to the amount only when no status came back", () => {
        expect(getExpenseCreatedToast(undefined, 9999)).toBe(EXPENSE_CREATED_TOASTS.autoApproved);
        expect(getExpenseCreatedToast(undefined, 12000)).toBe(EXPENSE_CREATED_TOASTS.autoApproved);
        expect(getExpenseCreatedToast(null, TIER_AUTO_APPROVE_BELOW)).toBe(EXPENSE_CREATED_TOASTS.needsApproval);
        expect(getExpenseCreatedToast("", -2000)).toBe(EXPENSE_CREATED_TOASTS.needsApproval);
    });
});
