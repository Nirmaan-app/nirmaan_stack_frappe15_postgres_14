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
    HR_APPROVAL_LIMIT,
    STATUSES,
    TAB_ALL,
    TYPES,
    TAB_APPROVED,
    TAB_MINE,
    TAB_PAID,
    TAB_PENDING,
    TAB_REJECTED,
    claimantName,
    decideProblem,
    defaultTab,
    deleteProblem,
    descriptionRequired,
    editProblem,
    isMergeable,
    paymentStage,
    resolveTab,
    reviewerFor,
    roleLabel,
    tabsFor,
} from "./rules";

// The server's twin reads the same file (services/reimbursements/test_rules.py).
const CASES = JSON.parse(
    readFileSync(
        resolve(__dirname, "../../../../nirmaan_stack/services/reimbursements/reimbursement_rules_cases.json"),
        "utf-8",
    ),
);

describe("shared cases with the server", () => {
    it("has the same limit and statuses", () => {
        expect(HR_APPROVAL_LIMIT).toBe(CASES.hr_approval_limit);
        expect(DESCRIPTION_REQUIRED_ABOVE).toBe(CASES.description_required_above);
        expect(STATUSES).toEqual(CASES.statuses);
        expect(TYPES).toEqual(CASES.types);
    });

    it.each(CASES.reviewer)("reviewer: $name", (c) => {
        expect(reviewerFor(c.amount, c.claimant_is_hr)).toBe(c.reviewer);
    });

    it.each(CASES.decide)("decide: $name", (c) => {
        const problem = decideProblem(c.status, c.amount, {
            claimantIsHr: c.claimant_is_hr, deciderIsAdmin: c.decider_is_admin, deciderIsHr: c.decider_is_hr,
        });
        expect(problem === null).toBe(c.allowed);
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
        expect(paymentStage("CEO Pending")).toBe("Waiting for CEO approval");
        expect(paymentStage("Approved")).toBe("Waiting to be paid");
        expect(paymentStage("Reconciliation Pending")).toBe("Paid, waiting for the bank statement");
        expect(paymentStage("Paid")).toBe("Paid");
        expect(paymentStage("Rejected")).toBe("Rejected in Payments");
        expect(paymentStage(undefined)).toBe("Not sent to Payments");
    });
});
