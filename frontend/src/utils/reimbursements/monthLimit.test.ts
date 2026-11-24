import { describe, expect, it } from "vitest";

import type { MonthTotal } from "@/types/NirmaanStack/Reimbursement";

import { approvalLanding, monthLabel, monthNotice, peopleOverLimit, personLine, rowTag, withBatchTotals } from "./monthLimit";

const row = (over: Partial<MonthTotal> = {}): MonthTotal => ({
    claim: "REIMB-26-00001", expense: null, claimant: "a@x.com", claimant_name: "Asha", month: "2026-10-01",
    amount: 1200, month_total: 3200, claims: 3, over_limit: true, ...over,
});

describe("monthLabel", () => {
    it("names the month from the text, in full or short", () => {
        expect(monthLabel("2026-10-01")).toBe("October 2026");
        expect(monthLabel("2026-01-01", true)).toBe("Jan");
    });
});

describe("monthNotice", () => {
    it("above the limit names what was already claimed, the total and the limit", () => {
        const notice = monthNotice(row(), "decide", true);
        expect(notice.over).toBe(true);
        expect(notice.headline).toBe("Asha has already claimed ₹2,000 in October 2026 (2 claims).");
        expect(notice.detail).toBe(
            "With this claim of ₹1,200, October 2026's total is ₹3,200, at or above the ₹2,000 monthly limit. "
            + "After you approve, it goes to Pending L1 Approval, where Admin or the CEO approves it.",
        );
    });

    it("says L1 is next only when it is, and what approving means in Payments", () => {
        expect(monthNotice(row(), "decide", false).detail).not.toContain("L1");
        expect(monthNotice(row(), "payments").detail).toContain("Approving it pays at or above the monthly limit.");
    });

    it("under the limit is within it, and a first claim has nothing before it", () => {
        const notice = monthNotice(row({ amount: 1999, month_total: 1999, claims: 1 }), "decide");
        expect(notice.over).toBe(false);
        expect(notice.headline).toBe("Asha has no other approved claims in October 2026.");
        expect(notice.detail).toBe("With this claim: ₹1,999, under the ₹2,000 monthly limit.");
    });

    it("exactly ₹2,000 reaches the limit (owner, 2026-10-28)", () => {
        const notice = monthNotice(row({ amount: 2000, month_total: 2000, claims: 1 }), "decide", true);
        expect(notice.over).toBe(true);
        expect(notice.detail).toContain("total is ₹2,000, at or above the ₹2,000 monthly limit.");
    });
});

describe("bulk approve", () => {
    it("tags each row at or under the limit", () => {
        expect(rowTag(row({ month_total: 4100 }))).toEqual({ over: true, text: "Limit reached · ₹4,100 in Oct" });
        expect(rowTag(row({ month_total: 2000 }))).toEqual({ over: true, text: "Limit reached · ₹2,000 in Oct" });
        expect(rowTag(row({ month_total: 1700 }))).toEqual({ over: false, text: "Under limit · ₹1,700 in Oct" });
    });

    it("lists each person above the limit once, with what this selection pays, largest first", () => {
        const people = peopleOverLimit([
            row({ claim: "R1", amount: 1200, month_total: 4100, claims: 4 }),
            row({ claim: "R2", amount: 900, month_total: 4100, claims: 4 }),
            row({ claim: "R3", claimant: "m@x.com", claimant_name: "Meena", amount: 2400, month_total: 2400, claims: 1 }),
            row({ claim: "R4", claimant: "s@x.com", claimant_name: "Suresh", amount: 700, month_total: 1700, claims: 2 }),
        ]);
        expect(people.map((p) => [p.claimantName, p.monthTotal, p.inSelection, p.inSelectionAmount])).toEqual([
            ["Asha", 4100, 2, 2100],
            ["Meena", 2400, 1, 2400],
        ]);
        expect(personLine(people[0])).toBe("Claimed in October 2026 across 4 claims. 2 of them are in this approval: ₹2,100.");
        expect(personLine(people[1])).toBe("Claimed in October 2026 across 1 claim. It is in this approval: ₹2,400.");
    });

    it("keeps one person's two months apart", () => {
        const people = peopleOverLimit([
            row({ claim: "R1", month: "2026-09-01" }),
            row({ claim: "R2", month: "2026-10-01" }),
        ]);
        expect(people).toHaveLength(2);
    });
});

describe("approvalLanding", () => {
    it("HR under the limit: straight to the payers; at exactly ₹2,000, L1 first", () => {
        expect(approvalLanding(1500, 1999, null)).toBe('Goes to "Payment need to be paid", where Accounts pays it.');
        expect(approvalLanding(500, 2000, null)).toContain('"Pending L1 Approval"');
    });

    it("HR above the limit: L1 first, even under ₹15,000, and the CEO above ₹50,000", () => {
        expect(approvalLanding(1200, 3200, null)).toBe('Goes to "Pending L1 Approval", where Admin or the CEO approves it.');
        expect(approvalLanding(60000, 63200, null)).toContain("where Admin or the CEO approves it, then the CEO.");
    });

    it("an Admin is L1: to the payers up to ₹50,000, to the CEO above it, whatever the month", () => {
        expect(approvalLanding(4000, 4000, "l1")).toContain('"Payment need to be paid"');
        expect(approvalLanding(50000, 90000, "l1")).toContain('"Payment need to be paid"');
        expect(approvalLanding(80000, 80000, "l1")).toBe('Goes to "Pending CEO Approval", where the CEO approves it.');
        expect(approvalLanding(80000, 80000, "ceo")).toContain('"Payment need to be paid"');
    });

    it("on Pending L1 Approval: an Admin sends above ₹50,000 to the CEO; the CEO always to the payers", () => {
        expect(approvalLanding(3000, null, "l1", "l1")).toContain('"Payment need to be paid"');
        expect(approvalLanding(60000, null, "l1", "l1")).toContain('"Pending CEO Approval"');
        expect(approvalLanding(60000, null, "ceo", "l1")).toContain('"Payment need to be paid"');
        expect(approvalLanding(90000, null, "ceo", "ceo")).toContain('"Payment need to be paid"');
    });

    it("says nothing for HR until the month total is known", () => {
        expect(approvalLanding(1200, null, null)).toBeNull();
        expect(approvalLanding(4000, null, "l1")).toContain('"Payment need to be paid"');
    });
});

describe("withBatchTotals (Pending Approval bulk approve, browser walk 2026-11-19)", () => {
    const claim = (name: string, amount: number, claimant = "pm@x.com", monthTotal = amount) => row({
        claim: name, claimant, claimant_name: claimant, amount, month_total: monthTotal, claims: 1,
    });

    it("counts a person's earlier claims in the batch, in name order, as the server approves them", () => {
        const totals = withBatchTotals([claim("REIMB-2", 800), claim("REIMB-1", 1200)]);
        expect(totals.get("REIMB-1")?.month_total).toBe(1200);
        expect(totals.get("REIMB-2")?.month_total).toBe(2000);
        expect(totals.get("REIMB-2")?.over_limit).toBe(true);
        expect(totals.get("REIMB-2")?.claims).toBe(2);
    });

    it("keeps other people and other months apart", () => {
        const totals = withBatchTotals([claim("REIMB-1", 1500), claim("REIMB-2", 1500, "hr@x.com")]);
        expect(totals.get("REIMB-2")?.month_total).toBe(1500);
    });

    it("feeds the limit box: the person shows once, with both claims in the approval", () => {
        const totals = withBatchTotals([claim("REIMB-1", 1200), claim("REIMB-2", 800)]);
        const people = peopleOverLimit([...totals.values()]);
        expect(people).toHaveLength(1);
        expect(people[0]).toMatchObject({ monthTotal: 2000, inSelection: 2, inSelectionAmount: 2000 });
    });
});
