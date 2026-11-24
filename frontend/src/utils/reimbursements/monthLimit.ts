/**
 * What the approve screens say about a claimant's month total (owner, 2026-10-28, ADR-0040 Amendment B). The
 * total comes from the server (`api/reimbursements/month_totals.get_month_totals`); whether it has reached the
 * limit is `rules.overMonthlyLimit`. Pure, so the wording is tested without React (F4).
 */

import type { MonthTotal } from "@/types/NirmaanStack/Reimbursement";
import { initialStatusForRaiser, needsCEO, TIER_L2_ABOVE_EXPENSES, type RaiserLevel } from "@/utils/approvalTiers";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    MONTHLY_LIMIT,
    TAB_APPROVED,
    TAB_CEO,
    TAB_L1,
    TAB_LABELS,
    TAB_PENDING,
    overMonthlyLimit,
    type ReimbursementTab,
} from "./rules";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
    "November", "December"];

/** "2026-10-01" -> "October 2026" (or "Oct" when `short`). Read from the text, so no time zone moves the month. */
export function monthLabel(month: string, short = false): string {
    const [year, mm] = month.split("-");
    const name = MONTHS[Number(mm) - 1] ?? mm;
    return short ? name.slice(0, 3) : `${name} ${year}`;
}

const claimsWord = (n: number) => `${n} claim${n === 1 ? "" : "s"}`;

/** Where the approval is made: the Reimbursements page (`decide`) or Payments' approve of the claim's expense. */
export type NoticePlace = "decide" | "payments";

export interface MonthNotice {
    over: boolean;
    /** The first line: what the person has already claimed this month. */
    headline: string;
    /** The second line: the total with this claim, against the limit, and what approving does. */
    detail: string;
}

/**
 * The notice for one claim. `goesToL1`: approving now leaves the expense waiting for L1 (`rules.approvalNeedsL1`),
 * said only on the Reimbursements page.
 */
export function monthNotice(row: MonthTotal, place: NoticePlace, goesToL1 = false): MonthNotice {
    const month = monthLabel(row.month);
    const before = row.month_total - row.amount;
    const others = row.claims - 1;
    const total = formatToRoundedIndianRupee(row.month_total);
    const limit = formatToRoundedIndianRupee(MONTHLY_LIMIT);
    const headline = others > 0
        ? `${row.claimant_name} has already claimed ${formatToRoundedIndianRupee(before)} in ${month} (${claimsWord(others)}).`
        : `${row.claimant_name} has no other approved claims in ${month}.`;
    if (!overMonthlyLimit(row.month_total)) {
        return { over: false, headline, detail: `With this claim: ${total}, under the ${limit} monthly limit.` };
    }
    const next = place === "payments"
        ? " Approving it pays at or above the monthly limit."
        : goesToL1 ? " After you approve, it goes to Pending L1 Approval, where Admin or the CEO approves it." : "";
    return {
        over: true,
        headline,
        detail: `With this claim of ${formatToRoundedIndianRupee(row.amount)}, ${month}'s total is ${total}, at or above the ${limit} monthly limit.${next}`,
    };
}

/** The tick box beside a notice at or above the limit. */
export const ACKNOWLEDGE_LABEL = "I've seen this and still want to approve.";

/** The short tag on a reimbursement's row in bulk approve: "Limit reached · ₹4,100 in Oct". */
export function rowTag(row: MonthTotal): { over: boolean; text: string } {
    const over = overMonthlyLimit(row.month_total);
    return {
        over,
        text: `${over ? "Limit reached" : "Under limit"} · ${formatToRoundedIndianRupee(row.month_total)} in ${monthLabel(row.month, true)}`,
    };
}

/** One person at or above the limit in a bulk selection. */
export interface LimitPerson {
    key: string;
    claimantName: string;
    month: string;
    monthTotal: number;
    /** How many claims make up the month total. */
    claims: number;
    /** How many of them, and how much, this selection approves. */
    inSelection: number;
    inSelectionAmount: number;
}

/**
 * The people at or above the limit among a bulk selection's reimbursements, one per claimant and month, largest
 * total first. A person whose total is under the limit is left out: the box lists only what needs a second look.
 * A person's total is the highest of their rows (in Payments every row of one person carries the same total; in a
 * Reimbursements batch a later claim counts the earlier ones, `withBatchTotals`), and every one of their rows in the
 * selection is counted in it.
 */
export function peopleOverLimit(rows: readonly MonthTotal[]): LimitPerson[] {
    const byPerson = new Map<string, LimitPerson>();
    for (const row of rows) {
        const key = `${row.claimant}|${row.month}`;
        const person = byPerson.get(key) ?? {
            key, claimantName: row.claimant_name, month: row.month, monthTotal: 0, claims: 0,
            inSelection: 0, inSelectionAmount: 0,
        };
        person.monthTotal = Math.max(person.monthTotal, row.month_total);
        person.claims = Math.max(person.claims, row.claims);
        person.inSelection += 1;
        person.inSelectionAmount += row.amount;
        byPerson.set(key, person);
    }
    return [...byPerson.values()]
        .filter((p) => overMonthlyLimit(p.monthTotal))
        .sort((a, b) => b.monthTotal - a.monthTotal || a.claimantName.localeCompare(b.claimantName));
}

/**
 * Pending Approval's bulk approve decides claims in name order (`review.bulk_approve_reimbursements`), so a person's
 * later claim counts the earlier ones approved just before it. Each claim's month total (itself plus the person's
 * Approved and Paid claims) is raised by the person's earlier claims of the same month in this batch. `rows` are the
 * month totals of the batch's claims; the answer is keyed by claim.
 */
export function withBatchTotals(rows: readonly MonthTotal[]): Map<string, MonthTotal> {
    const out = new Map<string, MonthTotal>();
    const before = new Map<string, { amount: number; claims: number }>();
    for (const row of [...rows].sort((a, b) => a.claim.localeCompare(b.claim))) {
        const key = `${row.claimant}|${row.month}`;
        const earlier = before.get(key) ?? { amount: 0, claims: 0 };
        const monthTotal = row.month_total + earlier.amount;
        out.set(row.claim, {
            ...row, month_total: monthTotal, claims: row.claims + earlier.claims, over_limit: overMonthlyLimit(monthTotal),
        });
        before.set(key, { amount: earlier.amount + row.amount, claims: earlier.claims + 1 });
    }
    return out;
}

/** "Reimbursed in October 2026 across 4 claims. 2 of them are in this approval: ₹2,100." */
export function personLine(person: LimitPerson): string {
    const which = person.inSelection === person.claims
        ? person.claims === 1 ? "It is in this approval" : "All of them are in this approval"
        : `${person.inSelection} of them ${person.inSelection === 1 ? "is" : "are"} in this approval`;
    return `Claimed in ${monthLabel(person.month)} across ${claimsWord(person.claims)}. ${which}: ${formatToRoundedIndianRupee(person.inSelectionAmount)}.`;
}

/** The approval tabs a decision is made on. */
export type ApprovalStage = typeof TAB_PENDING | typeof TAB_L1 | typeof TAB_CEO;

/**
 * The tab approving a claim moves it to (ADR-0040 Amendment C), for the approve dialogs; the server decides and its
 * reply names the real one. `level` is the approver's (`approvalTiers.raiserLevelOf`): null for HR.
 *
 * * Pending Approval -- the claim's expense is born at `expense_decision.starting_status` with the approver as raiser:
 *   HR at or above the monthly limit → Pending L1 Approval (`monthTotal` null = not known yet: not guessed), else
 *   by amount; an Admin up to ₹50,000 → Payment need to be paid, above → Pending CEO Approval; the CEO → to be paid.
 * * Pending L1 Approval -- an Admin's L1 approval: above ₹50,000 → Pending CEO Approval, else to be paid. The CEO's
 *   approval always ends at Payment need to be paid (the screen sends the CEO step straight after).
 * * Pending CEO Approval → Payment need to be paid.
 */
export function landingTab(
    stage: ApprovalStage, amount: number, monthTotal: number | null, level: RaiserLevel | null,
): ReimbursementTab | null {
    if (stage === TAB_CEO || level === "ceo") return TAB_APPROVED;
    if (stage === TAB_L1) return needsCEO(amount, TIER_L2_ABOVE_EXPENSES) ? TAB_CEO : TAB_APPROVED;
    if (level === null && monthTotal === null) return null;
    const status = level === null && overMonthlyLimit(monthTotal ?? 0)
        ? "Requested"
        : initialStatusForRaiser(amount, TIER_L2_ABOVE_EXPENSES, level);
    return status === "Requested" ? TAB_L1 : status === "CEO Pending" ? TAB_CEO : TAB_APPROVED;
}

const WHO_ACTS: Partial<Record<ReimbursementTab, string>> = {
    [TAB_L1]: "where Admin or the CEO approves it",
    [TAB_CEO]: "where the CEO approves it",
    [TAB_APPROVED]: "where Accounts pays it",
};

/** The approve dialog's "Goes to" line, or null while it can't be told (HR, month total not read yet). */
export function approvalLanding(
    amount: number, monthTotal: number | null, level: RaiserLevel | null, stage: ApprovalStage = TAB_PENDING,
): string | null {
    const tab = landingTab(stage, amount, monthTotal, level);
    if (!tab) return null;
    const then = tab === TAB_L1 && needsCEO(amount, TIER_L2_ABOVE_EXPENSES) ? ", then the CEO" : "";
    return `Goes to "${TAB_LABELS[tab]}", ${WHO_ACTS[tab]}${then}.`;
}
