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
