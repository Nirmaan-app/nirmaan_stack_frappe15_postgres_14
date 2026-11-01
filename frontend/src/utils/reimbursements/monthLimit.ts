/**
 * What the approve screens say about a claimant's month total (owner, 2026-10-28, ADR-0040 Amendment B). The
 * total comes from the server (`api/reimbursements/month_totals.get_month_totals`); whether it has reached the
 * limit is `rules.overMonthlyLimit`. Pure, so the wording is tested without React (F4).
 */

import type { MonthTotal } from "@/types/NirmaanStack/Reimbursement";
import { initialStatusForRaiser, needsCEO, TIER_L2_ABOVE_EXPENSES, type RaiserLevel } from "@/utils/approvalTiers";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { MONTHLY_LIMIT, overMonthlyLimit } from "./rules";

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
        : goesToL1 ? " After you approve, it goes to L1 in Payments." : "";
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
 * total first. Rows under the limit are left out: the box lists only what needs a second look.
 */
export function peopleOverLimit(rows: readonly MonthTotal[]): LimitPerson[] {
    const byPerson = new Map<string, LimitPerson>();
    for (const row of rows) {
        if (!overMonthlyLimit(row.month_total)) continue;
        const key = `${row.claimant}|${row.month}`;
        const person = byPerson.get(key) ?? {
            key, claimantName: row.claimant_name, month: row.month, monthTotal: row.month_total, claims: row.claims,
            inSelection: 0, inSelectionAmount: 0,
        };
        person.inSelection += 1;
        person.inSelectionAmount += row.amount;
        byPerson.set(key, person);
    }
    return [...byPerson.values()].sort((a, b) => b.monthTotal - a.monthTotal || a.claimantName.localeCompare(b.claimantName));
}

/** "Reimbursed in October 2026 across 4 claims. 2 of them are in this approval: ₹2,100." */
export function personLine(person: LimitPerson): string {
    const which = person.inSelection === person.claims
        ? person.claims === 1 ? "It is in this approval" : "All of them are in this approval"
        : `${person.inSelection} of them ${person.inSelection === 1 ? "is" : "are"} in this approval`;
    return `Claimed in ${monthLabel(person.month)} across ${claimsWord(person.claims)}. ${which}: ${formatToRoundedIndianRupee(person.inSelectionAmount)}.`;
}

/** The Project Payments tabs an approved claim's expense can land in, by their labels on screen. */
export const PAYMENTS_TABS = {
    l1: "Payment Pending Approval",
    ceo: "Payment Pending CEO Approval",
    toPay: "Payment need to paid",
} as const;

/**
 * Where approving a claim puts its Non-Project Expense, for the approve dialog (the server decides:
 * `expense_decision.starting_status` with the approver as raiser, ADR-0040 and its Amendment B). `level` is the
 * approver's (`approvalTiers.raiserLevelOf`): null for HR, whose approval at or above the monthly limit waits for L1
 * even in the auto band. `monthTotal` null = not known yet; then an HR approval's landing is not guessed.
 */
export function approvalLanding(amount: number, monthTotal: number | null, level: RaiserLevel | null): string | null {
    if (level === null && monthTotal === null) return null;
    const status = level === null && overMonthlyLimit(monthTotal ?? 0)
        ? "Requested"
        : initialStatusForRaiser(amount, TIER_L2_ABOVE_EXPENSES, level);
    const lead = "Approving makes it a Non-Project Expense in Project Payments";
    if (status === "Requested") {
        const then = needsCEO(amount, TIER_L2_ABOVE_EXPENSES) ? ", then the CEO" : "";
        return `${lead}, under "${PAYMENTS_TABS.l1}", where L1 (Admin) approves it${then}.`;
    }
    if (status === "CEO Pending") return `${lead}, under "${PAYMENTS_TABS.ceo}", where the CEO approves it.`;
    return `${lead}, under "${PAYMENTS_TABS.toPay}", where Accounts pays it.`;
}
