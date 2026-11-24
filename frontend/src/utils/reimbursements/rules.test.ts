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

import { CEO_AUTHORIZED_USER } from "@/constants/ceoHold";

import {
    DESCRIPTION_REQUIRED_ABOVE,
    MONTHLY_LIMIT,
    PM_MONTHLY_CAP,
    STATUSES,
    TABS,
    TAB_ALL,
    TYPES,
    TAB_APPROVED,
    TAB_CEO,
    TAB_L1,
    TAB_MINE,
    TAB_PAID,
    TAB_PENDING,
    TAB_RECONCILIATION,
    TAB_GROUPS,
    TAB_LABELS,
    TAB_LINES,
    acknowledgementProblem,
    actsOn,
    badgeCounts,
    capLeft,
    capProblem,
    claimTab,
    approvalNeedsL1,
    claimantName,
    decideProblem,
    defaultTab,
    deleteProblem,
    descriptionRequired,
    editProblem,
    groupsTabs,
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
    delete: (Allowed & { status: string; is_claimant: boolean; is_admin?: boolean })[];
    description_required: (Named & { amount: number; required: boolean })[];
    mergeable: { file_name: string; mergeable: boolean }[];
    tabs: string[];
    claim_tab: (Named & { claim_status: string; tab: string | null })[];
    pm_monthly_cap: number;
    pm_cap: (Allowed & { month_used: number; amount: number; capped: boolean; left: number })[];
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
        expect(deleteProblem(c.status, c.is_claimant, c.is_admin ?? false) === null).toBe(c.allowed);
    });

    it.each(CASES.description_required)("description required: $name", (c) => {
        expect(descriptionRequired(c.amount)).toBe(c.required);
    });

    it.each(CASES.mergeable)("mergeable: $file_name", (c) => {
        expect(isMergeable(c.file_name)).toBe(c.mergeable);
    });

    it("has the same tabs, in the same order", () => {
        expect([...TABS]).toEqual(CASES.tabs);
    });

    it.each(CASES.claim_tab)("claim tab: $name", (c) => {
        expect(claimTab(c.claim_status)).toBe(c.tab);
    });

    it("has the same Project Manager cap", () => {
        expect(PM_MONTHLY_CAP).toBe(CASES.pm_monthly_cap);
    });

    it.each(CASES.pm_cap)("Project Manager cap: $name", (c) => {
        expect(capProblem(c.month_used, c.amount, c.capped) === null).toBe(c.allowed);
        if (c.capped) expect(capLeft(c.month_used)).toBe(c.left);
    });
});

describe("tabsFor", () => {
    const EVERY_TAB_BUT_THE_CEOS = [TAB_PENDING, TAB_L1, TAB_APPROVED, TAB_RECONCILIATION, TAB_PAID, TAB_MINE, TAB_ALL];

    it("gives everyone else only the claims they raised", () => {
        expect(tabsFor({ role: "Nirmaan Project Manager Profile" })).toEqual([TAB_MINE]);
        expect(tabsFor({ role: "Nirmaan PMO Executive Profile" })).toEqual([TAB_MINE]);
    });

    it("gives Admin (and Administrator) every tab but the CEO's, the CEO all eight", () => {
        expect(tabsFor({ role: ADMIN_PROFILE, userId: "admin@x.com" })).toEqual(EVERY_TAB_BUT_THE_CEOS);
        expect(tabsFor({ role: null, userId: "Administrator" })).toEqual(EVERY_TAB_BUT_THE_CEOS);
        expect(tabsFor({ role: ADMIN_PROFILE, userId: CEO_AUTHORIZED_USER })).toEqual([...TABS]);
    });

    it("gives HR only its own work: Pending Approval, Reconciliation Done / Paid, Raised By Me, All", () => {
        for (const role of [HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE]) {
            expect(tabsFor({ role })).toEqual([TAB_PENDING, TAB_PAID, TAB_MINE, TAB_ALL]);
        }
    });

    it("gives Accounts only paying: to be paid, Reconciliation Pending, Reconciliation Done / Paid, Raised By Me, All", () => {
        for (const role of [ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE]) {
            expect(tabsFor({ role })).toEqual([TAB_APPROVED, TAB_RECONCILIATION, TAB_PAID, TAB_MINE, TAB_ALL]);
        }
    });

    it("sends a bookmarked tab the person can't see back to their first tab", () => {
        expect(resolveTab(TAB_APPROVED, { role: "Nirmaan Project Manager Profile" })).toBe(TAB_MINE);
        expect(resolveTab(TAB_CEO, { role: ADMIN_PROFILE, userId: "admin@x.com" })).toBe(TAB_L1);
        expect(resolveTab(TAB_CEO, { role: ADMIN_PROFILE, userId: CEO_AUTHORIZED_USER })).toBe(TAB_CEO);
        expect(resolveTab(TAB_PENDING, { role: ACCOUNTANT_PROFILE })).toBe(TAB_APPROVED);
        expect(resolveTab(TAB_L1, { role: HR_EXECUTIVE_PROFILE })).toBe(TAB_PENDING);
        expect(resolveTab(TAB_APPROVED, { role: HR_EXECUTIVE_PROFILE })).toBe(TAB_PENDING);
        expect(resolveTab("nonsense", { role: ADMIN_PROFILE })).toBe(TAB_L1);
    });

    it("opens the retired Rejected tab as All", () => {
        expect(resolveTab("rejected", { role: ACCOUNTANT_PROFILE })).toBe(TAB_ALL);
        expect(resolveTab("rejected", { role: "Nirmaan Project Manager Profile" })).toBe(TAB_MINE);
    });

    it("opens each person where their step waits: CEO, Admin, HR, Accounts, everyone else", () => {
        expect(defaultTab({ role: ADMIN_PROFILE, userId: CEO_AUTHORIZED_USER })).toBe(TAB_CEO);
        expect(defaultTab({ role: ADMIN_PROFILE, userId: "admin@x.com" })).toBe(TAB_L1);
        expect(defaultTab({ role: null, userId: "Administrator" })).toBe(TAB_L1);
        for (const role of [HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE]) {
            expect(defaultTab({ role })).toBe(TAB_PENDING);
            expect(resolveTab(null, { role })).toBe(TAB_PENDING);
        }
        expect(defaultTab({ role: ACCOUNTANT_PROFILE })).toBe(TAB_APPROVED);
        expect(defaultTab({ role: "Nirmaan Project Manager Profile" })).toBe(TAB_MINE);
    });
});

describe("tab bar", () => {
    it("names Reconciliation Done / Paid, and every two-line label reads as the tab's name", () => {
        expect(TAB_LABELS[TAB_PAID]).toBe("Reconciliation Done / Paid");
        for (const tab of TABS) expect(TAB_LINES[tab].join(" ")).toBe(TAB_LABELS[tab]);
    });

    it("groups HR / Admin / Accounts, covering every work tab once", () => {
        expect(TAB_GROUPS.map((g) => g.label)).toEqual(["HR", "Admin", "Accounts"]);
        expect(TAB_GROUPS.flatMap((g) => g.tabs)).toEqual([TAB_PENDING, TAB_L1, TAB_CEO, TAB_APPROVED, TAB_RECONCILIATION, TAB_PAID]);
    });

    it("groups only for Admin and the CEO", () => {
        expect(groupsTabs({ role: ADMIN_PROFILE, userId: "admin@x.com" })).toBe(true);
        expect(groupsTabs({ role: ADMIN_PROFILE, userId: CEO_AUTHORIZED_USER })).toBe(true);
        expect(groupsTabs({ role: HR_EXECUTIVE_PROFILE })).toBe(false);
        expect(groupsTabs({ role: ACCOUNTANT_PROFILE })).toBe(false);
        expect(groupsTabs({ role: "Nirmaan Project Manager Profile" })).toBe(false);
    });
});

describe("actsOn", () => {
    const hr = { role: HR_EXECUTIVE_PROFILE };
    const admin = { role: ADMIN_PROFILE, userId: "admin@x.com" };
    const ceo = { role: ADMIN_PROFILE, userId: CEO_AUTHORIZED_USER };
    const accounts = { role: ACCOUNTANT_PROFILE };

    it("lets HR, Admin and the CEO decide new claims; Accounts never", () => {
        expect([hr, admin, ceo, accounts].map((v) => actsOn(TAB_PENDING, v))).toEqual([true, true, true, false]);
    });

    it("leaves L1 to Admin and the CEO, and the CEO's tab to the CEO", () => {
        expect([hr, admin, ceo, accounts].map((v) => actsOn(TAB_L1, v))).toEqual([false, true, true, false]);
        expect([hr, admin, ceo, accounts].map((v) => actsOn(TAB_CEO, v))).toEqual([false, false, true, false]);
    });

    it("lets Admin and Accounts pay and reconcile; HR only looks", () => {
        for (const tab of [TAB_APPROVED, TAB_RECONCILIATION] as const) {
            expect([hr, admin, accounts].map((v) => actsOn(tab, v))).toEqual([false, true, true]);
        }
        expect(actsOn(TAB_PAID, admin)).toBe(false);
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
        expect(paymentStage("Rejected")).toBe("Rejected after approval");
        expect(paymentStage(undefined)).toBe("No expense yet");
    });
});

describe("badgeCounts (a badge follows the open tab's filters; owner, 2026-11-24)", () => {
    const server = { [TAB_APPROVED]: 5, [TAB_ALL]: 40 };

    it("puts the open tab's list total in place of its server count", () => {
        // PR #1737 walk: Payment need to be paid on this month listed 3 while its badge said 5.
        expect(badgeCounts(server, TAB_APPROVED, { tab: TAB_APPROVED, count: 3 })).toEqual({ [TAB_APPROVED]: 3, [TAB_ALL]: 40 });
    });

    it("keeps every other tab's server count", () => {
        expect(badgeCounts(server, TAB_ALL, { tab: TAB_ALL, count: 7 })[TAB_APPROVED]).toBe(5);
    });

    it("ignores a total read for another tab, and shows the server's counts before the list has loaded", () => {
        expect(badgeCounts(server, TAB_ALL, { tab: TAB_APPROVED, count: 3 })).toBe(server);
        expect(badgeCounts(server, TAB_APPROVED, null)).toBe(server);
    });

    it("shows 0 when the filters leave nothing", () => {
        expect(badgeCounts(server, TAB_APPROVED, { tab: TAB_APPROVED, count: 0 })[TAB_APPROVED]).toBe(0);
    });
});
