import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
    ACCOUNTANT_LEAD_PROFILE,
    ACCOUNTANT_PROFILE,
    ADMIN_PROFILE,
    HR_EXECUTIVE_PROFILE,
    HR_LEAD_PROFILE,
} from "@/constants/roles";

import {
    DESCRIPTION_REQUIRED_ABOVE,
    MONTHLY_LIMIT,
    STATUSES,
    TAB_ALL,
    TYPES,
    TAB_APPROVED,
    TAB_MINE,
    TAB_PAID,
    TAB_PENDING,
    TAB_REJECTED,
    acknowledgementProblem,
    approvalNeedsL1,
    claimantName,
    decideProblem,
    defaultTab,
    deleteProblem,
    descriptionRequired,
    editProblem,
    isMergeable,
    overMonthlyLimit,
    paymentStage,
    resolveTab,
    reviewerFor,
    roleLabel,
    tabsFor,
} from "./rules";

interface Named { name: string }
interface Allowed extends Named { allowed: boolean }

/** The shape of `reimbursement_rules_cases.json`, so each `it.each` row is typed (an untyped parse is refused). */
interface RuleCases {
    monthly_limit: number;
    description_required_above: number;
    statuses: string[];
    types: string[];
    reviewer: (Named & { claimant_is_hr: boolean; reviewer: string })[];
    decide: (Allowed & { status: string; claimant_is_hr: boolean; decider_is_admin: boolean; decider_is_hr: boolean })[];
    over_monthly_limit: (Named & { month_total: number; over: boolean })[];
    approval_needs_l1: (Named & { month_total: number; decider_is_l1: boolean; needs_l1: boolean })[];
    acknowledgement: (Allowed & { month_total: number; acknowledged: boolean })[];
    edit: (Allowed & { status: string; is_claimant: boolean })[];
    delete: (Allowed & { status: string; is_claimant: boolean })[];
    description_required: (Named & { amount: number; required: boolean })[];
    mergeable: { file_name: string; mergeable: boolean }[];
}

// The server's twin reads the same file (services/reimbursements/test_rules.py).
const CASES: RuleCases = JSON.parse(
    readFileSync(
        resolve(__dirname, "../../../../nirmaan_stack/services/reimbursements/reimbursement_rules_cases.json"),
        "utf-8",
    ),
);

describe("shared cases with the server", () => {
    it("has the same limit and statuses", () => {
        expect(MONTHLY_LIMIT).toBe(CASES.monthly_limit);
        expect(DESCRIPTION_REQUIRED_ABOVE).toBe(CASES.description_required_above);
        expect(STATUSES).toEqual(CASES.statuses);
        expect(TYPES).toEqual(CASES.types);
    });

    it.each(CASES.reviewer)("reviewer: $name", (c) => {
        expect(reviewerFor(c.claimant_is_hr)).toBe(c.reviewer);
    });

    it.each(CASES.decide)("decide: $name", (c) => {
        const problem = decideProblem(c.status, {
            claimantIsHr: c.claimant_is_hr, deciderIsAdmin: c.decider_is_admin, deciderIsHr: c.decider_is_hr,
        });
        expect(problem === null).toBe(c.allowed);
    });

    it.each(CASES.over_monthly_limit)("over the monthly limit: $name", (c) => {
        expect(overMonthlyLimit(c.month_total)).toBe(c.over);
    });

    it.each(CASES.approval_needs_l1)("approval needs L1: $name", (c) => {
        expect(approvalNeedsL1(c.month_total, c.decider_is_l1)).toBe(c.needs_l1);
    });

    it.each(CASES.acknowledgement)("acknowledgement: $name", (c) => {
        expect(acknowledgementProblem(c.month_total, c.acknowledged) === null).toBe(c.allowed);
    });

    it.each(CASES.edit)("edit: $name", (c) => {
        expect(editProblem(c.status, c.is_claimant) === null).toBe(c.allowed);
    });

    it.each(CASES.delete)("delete: $name", (c) => {
        expect(deleteProblem(c.status, c.is_claimant) === null).toBe(c.allowed);
    });

    it.each(CASES.description_required)("description required: $name", (c) => {
        expect(descriptionRequired(c.amount)).toBe(c.required);
    });

    it.each(CASES.mergeable)("mergeable: $file_name", (c) => {
        expect(isMergeable(c.file_name)).toBe(c.mergeable);
    });
});

describe("tabsFor", () => {
    it("gives everyone else only the claims they raised", () => {
        expect(tabsFor({ role: "Nirmaan Project Manager Profile" })).toEqual([TAB_MINE]);
        expect(tabsFor({ role: "Nirmaan PMO Executive Profile" })).toEqual([TAB_MINE]);
    });

    it("gives HR and Admin every tab, in the owner's order", () => {
        const all = [TAB_PENDING, TAB_APPROVED, TAB_PAID, TAB_ALL, TAB_MINE, TAB_REJECTED];
        for (const role of [HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE, ADMIN_PROFILE]) {
            expect(tabsFor({ role })).toEqual(all);
        }
        expect(tabsFor({ role: null, userId: "Administrator" })).toEqual(all);
    });

    it("gives Accounts All and the decided tabs, but no approval queue", () => {
        for (const role of [ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE]) {
            expect(tabsFor({ role })).toEqual([TAB_APPROVED, TAB_PAID, TAB_ALL, TAB_MINE, TAB_REJECTED]);
        }
        expect(resolveTab(TAB_ALL, { role: ACCOUNTANT_PROFILE })).toBe(TAB_ALL);
    });

    it("sends a bookmarked tab the person can't see back to their first tab", () => {
        expect(resolveTab(TAB_APPROVED, { role: "Nirmaan Project Manager Profile" })).toBe(TAB_MINE);
        expect(resolveTab(TAB_PAID, { role: "Nirmaan Project Manager Profile" })).toBe(TAB_MINE);
        expect(resolveTab(TAB_PENDING, { role: ACCOUNTANT_PROFILE })).toBe(TAB_APPROVED);
        expect(resolveTab(TAB_APPROVED, { role: ACCOUNTANT_PROFILE })).toBe(TAB_APPROVED);
        expect(resolveTab("nonsense", { role: ADMIN_PROFILE })).toBe(TAB_PENDING);
    });

    it("opens HR and Admin on Pending Approval, Accounts on Payment need to be paid, everyone else on their own", () => {
        for (const role of [HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE, ADMIN_PROFILE]) {
            expect(defaultTab({ role })).toBe(TAB_PENDING);
            expect(resolveTab(null, { role })).toBe(TAB_PENDING);
        }
        expect(defaultTab({ role: ACCOUNTANT_PROFILE })).toBe(TAB_APPROVED);
        expect(defaultTab({ role: "Nirmaan Project Manager Profile" })).toBe(TAB_MINE);
    });
});

describe("claimant details saved on the claim", () => {
    it("uses the saved name, and looks it up only for an older claim", () => {
        const lookup = (id?: string | null) => `live:${id}`;
        expect(claimantName({ owner: "a@x.com", claimant_name: "Shahbaj Khan" }, lookup)).toBe("Shahbaj Khan");
        expect(claimantName({ owner: "a@x.com", claimant_name: null }, lookup)).toBe("live:a@x.com");
    });

    it("shows a role profile as its short name", () => {
        expect(roleLabel("Nirmaan Project Manager Profile")).toBe("Project Manager");
        expect(roleLabel("Nirmaan HR Executive Profile")).toBe("HR Executive");
        expect(roleLabel(null)).toBe("");
    });
});

describe("paymentStage", () => {
    it("says where a claim's payment is, from its expense's status", () => {
        expect(paymentStage("Requested")).toBe("Waiting for L1 approval");
        expect(paymentStage("CEO Pending")).toBe("Waiting for CEO approval");
        expect(paymentStage("Approved")).toBe("Waiting to be paid");
        expect(paymentStage("Reconciliation Pending")).toBe("Paid, waiting for the bank statement");
        expect(paymentStage("Paid")).toBe("Paid");
        expect(paymentStage("Rejected")).toBe("Rejected in Payments");
        expect(paymentStage(undefined)).toBe("Not sent to Payments");
    });
});
