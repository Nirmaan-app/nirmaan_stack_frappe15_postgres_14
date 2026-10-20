/**
 * The tax an expense withholds: rent -> TDS -> what the landlord gets (spec #1522, #1524).
 *
 * ⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE (section 194-I, rent), not a Technical Data Sheet.
 *
 * Only an **Office Rent** expense withholds tax: always 10% of the full rent the raiser types, whatever
 * its size (GLOSSARY "TDS withheld (on an Office Rent expense)"). Every other type withholds nothing.
 * The New Expense form previews the split before submit; the approval screens and the Expense page
 * show it too (#1527), so they all read this one module.
 *
 * ⚠️ A FORECAST, NEVER AN INSTRUCTION. The server withholds the real figure when the Expense is
 * approved (#1525), from its own copy of this rule, `services/expense_tds.OFFICE_RENT_TDS`; the
 * parity test in `expenseTds.test.ts` reads that file. Change both or neither. Nothing here is sent
 * to the server.
 */

import { parseNumber } from "@/utils/parseNumber";

/** The one expense type that withholds tax, its rate and its section. */
export const OFFICE_RENT_TDS = { expenseType: "Office Rent", ratePct: 10, section: "194-I" } as const;

export interface ExpenseTdsSplit {
    /** The full amount typed: the rent. */
    gross: number;
    /** The rate withheld, as a percentage; 0 when nothing is. */
    ratePct: number;
    /** The tax withheld. */
    tds: number;
    /** What the landlord gets, and what the Expense's amount becomes once approved. */
    net: number;
}

/** Round the way the server's `flt(gross * rate / 100, 2)` does, so the preview matches to the paisa. */
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * The split for one expense type and amount. Any type but Office Rent, and a zero or a refund,
 * withholds nothing: `tds` 0 and `net` = `gross`.
 */
export const expenseTdsSplit = (
    expenseType: string | null | undefined,
    amount: number | string | null | undefined
): ExpenseTdsSplit => {
    const gross = parseNumber(amount);
    const ratePct = expenseType === OFFICE_RENT_TDS.expenseType && gross > 0 ? OFFICE_RENT_TDS.ratePct : 0;
    const tds = round2((gross * ratePct) / 100);
    return { gross, ratePct, tds, net: round2(gross - tds) };
};

/** "₹1,00,000", or "₹1,234.50" when there are paise. */
const rupees = (value: number): string =>
    `₹${value.toLocaleString("en-IN", {
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
        maximumFractionDigits: 2,
    })}`;

/** "Rent ₹1,00,000 − TDS 10% ₹10,000 = Landlord gets ₹90,000", or null when no tax is withheld. */
export const tdsPreviewLine = (split: ExpenseTdsSplit): string | null =>
    split.tds > 0
        ? `Rent ${rupees(split.gross)} − TDS ${split.ratePct}% ${rupees(split.tds)} = Landlord gets ${rupees(split.net)}`
        : null;

// ── What an expense screen shows (#1527) ────────────────────────────────────────────────────────

/** A tax record as the expense APIs serve it, `withheld_tds` (`services/expense_tds.withheld_tds_of`):
 *  read past the record's own permission, so Admin, the CEO and HR see it. Null before approval. */
export interface WithheldTds {
    /** The full rent, as approved. */
    gross_amount: number;
    tds_percentage: number;
    tds_amount: number;
    tds_section: string;
}

/**
 * The statuses before approval, when an Expense's amount is still the full rent: an Expense at
 * Requested or CEO Pending, or a request still Pending Approval that has no Expense yet. Only these
 * are forecast; at any later status the amount is the net (or nothing was withheld), so a forecast on
 * it would take the tax off twice.
 */
export const BEFORE_APPROVAL_STATUSES: ReadonlySet<string> = new Set(["Requested", "CEO Pending", "Pending Approval"]);

export interface ShownExpenseTds extends ExpenseTdsSplit {
    /** True: the stored record's figures (the tax WAS withheld). False: a forecast (it WILL be). */
    withheld: boolean;
}

/**
 * Rent / TDS / Net for one expense, or null when it shows its amount as today.
 *
 * - A stored record wins: its gross, rate and tax, and the net they leave. Never the Expense's
 *   amount, which Bulk Import's few-rupee correction may have moved (#1526).
 * - With none, an expense before approval is forecast from its amount, which is still the full rent.
 * - Anything else shows nothing: any type but Office Rent, a zero or a refund, and an Office Rent
 *   approved before the tax existed (no record, so nothing was withheld).
 */
export const shownExpenseTds = ({
    type,
    amount,
    status,
    withheld,
}: {
    type: string | null | undefined;
    amount: number | string | null | undefined;
    /** The Expense's status, or the request's while it has no Expense. */
    status: string | null | undefined;
    withheld: WithheldTds | null | undefined;
}): ShownExpenseTds | null => {
    if (withheld) {
        const gross = parseNumber(withheld.gross_amount);
        const tds = parseNumber(withheld.tds_amount);
        return { gross, ratePct: parseNumber(withheld.tds_percentage), tds, net: round2(gross - tds), withheld: true };
    }
    if (!BEFORE_APPROVAL_STATUSES.has(status ?? "")) return null;
    const split = expenseTdsSplit(type, amount);
    return split.tds > 0 ? { ...split, withheld: false } : null;
};

/** The three lines a screen draws: Rent, TDS at its rate, Net. */
export const tdsSplitLines = (shown: ShownExpenseTds): { label: string; value: string }[] => [
    { label: "Rent", value: rupees(shown.gross) },
    { label: `TDS ${shown.ratePct}%`, value: rupees(shown.tds) },
    { label: "Net", value: rupees(shown.net) },
];

/** Whether the tax will be or was withheld, in one line. */
export const tdsSplitCaption = (shown: ShownExpenseTds): string =>
    shown.withheld
        ? `${shown.ratePct}% TDS (${OFFICE_RENT_TDS.section}) withheld; the landlord is paid the net`
        : `${shown.ratePct}% TDS (${OFFICE_RENT_TDS.section}) will be withheld on approval`;
