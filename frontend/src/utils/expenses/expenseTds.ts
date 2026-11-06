/**
 * The tax an expense withholds: bill = rent + GST − TDS → what the landlord gets (spec #1522, #1524, #1613).
 *
 * ⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE (section 194-I, rent), not a Technical Data Sheet.
 *
 * Only an **Office Rent** expense withholds tax. Its amount is the landlord's **bill incl. 18% GST**
 * (GLOSSARY "Office Rent bill", ADR-0043): the base rent is bill ÷ 1.18, the GST bill − base, the tax 10%
 * of the base rent (never of the GST), and the landlord gets bill − TDS. Every other type withholds
 * nothing. The New Expense form previews the split before submit; the approval screens and the Expense
 * page show it too (#1527), so they all read this one module.
 *
 * ⚠️ A FORECAST, NEVER AN INSTRUCTION. The server splits the real figures when the Expense is approved
 * (#1525), from its own copy of this rule, `services/expense_tds.OFFICE_RENT_TDS` / `tds_split`; the
 * parity test in `expenseTds.test.ts` reads that file and both copies' tests read one table of cases
 * (`services/office_rent_split_cases.json`). Change both or neither. Nothing here is sent to the server.
 */

import { PAYMENT_STATUS } from "@/constants/paymentStatus";
import type { ExpenseRequestStatus } from "@/types/NirmaanStack/ExpenseRequest";
import { parseNumber } from "@/utils/parseNumber";

/** The one expense type that withholds tax, its TDS rate, the GST its bill carries, and its section. */
export const OFFICE_RENT_TDS = { expenseType: "Office Rent", ratePct: 10, gstPct: 18, section: "194-I" } as const;

export interface ExpenseTdsSplit {
    /** The amount typed: the landlord's bill, incl. GST. */
    bill: number;
    /** The base rent, bill ÷ 1.18: the tax record's gross. */
    base: number;
    /** The GST rate on the base rent; 0 when there is no split, or on a rent withheld before GST existed. */
    gstPct: number;
    /** bill − base. */
    gst: number;
    /** The TDS rate on the base rent, as a percentage; 0 when nothing is withheld. */
    ratePct: number;
    /** The tax withheld. */
    tds: number;
    /** bill − TDS: what the landlord gets, and what the Expense's amount becomes once approved. */
    landlordGets: number;
}

/**
 * Round to the paisa as the server's split does: Frappe's `flt(x, 2)` under "Banker's Rounding"
 * (`services/expense_tds.SPLIT_ROUNDING`, `frappe.utils.data._bankers_rounding`), a tie going to the even
 * paisa. A TDS of a base ending in 5 paise falls on a half paisa (₹10,010 → 848.305 → 848.30), where
 * rounding half up would differ by a paisa.
 */
const round2 = (value: number): number => {
    if (value === 0) return 0;
    const sign = value < 0 ? -1 : 1;
    const num = Number((Math.abs(value) * 100).toFixed(12));
    if (num === 0) return 0;
    const floor = Math.floor(num);
    const epsilon = 2 ** (Math.log2(num) - 52);
    const rounded =
        epsilon < 0.5 && Math.abs(num - floor - 0.5) < epsilon ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(num);
    return (sign * rounded) / 100;
};

/** No split: a type that withholds nothing, a zero or a refund. The landlord (or payee) gets the amount. */
const noSplit = (bill: number): ExpenseTdsSplit => ({ bill, base: bill, gstPct: 0, gst: 0, ratePct: 0, tds: 0, landlordGets: bill });

/**
 * The split for one expense type and bill: the server's `tds_split`. Any type but Office Rent, and a
 * zero or a refund, splits nothing (`tds` 0, `landlordGets` = the bill).
 */
export const expenseTdsSplit = (
    expenseType: string | null | undefined,
    amount: number | string | null | undefined
): ExpenseTdsSplit => {
    const bill = round2(parseNumber(amount));
    if (expenseType !== OFFICE_RENT_TDS.expenseType || bill <= 0) return noSplit(bill);
    const base = round2(bill / (1 + OFFICE_RENT_TDS.gstPct / 100));
    const tds = round2((base * OFFICE_RENT_TDS.ratePct) / 100);
    if (tds <= 0 || tds >= base) return noSplit(bill);
    return {
        bill,
        base,
        gstPct: OFFICE_RENT_TDS.gstPct,
        gst: round2(bill - base),
        ratePct: OFFICE_RENT_TDS.ratePct,
        tds,
        landlordGets: round2(bill - tds),
    };
};

/** "₹1,00,000", or "₹1,234.50" when there are paise. */
const rupees = (value: number): string =>
    `₹${value.toLocaleString("en-IN", {
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
        maximumFractionDigits: 2,
    })}`;

/** "Bill ₹1,18,000 = Rent ₹1,00,000 + GST 18% ₹18,000 − TDS 10% ₹10,000 → Landlord gets ₹1,08,000",
 *  or null when no tax is withheld. */
export const tdsPreviewLine = (split: ExpenseTdsSplit): string | null =>
    split.tds > 0
        ? `Bill ${rupees(split.bill)} = Rent ${rupees(split.base)} + GST ${split.gstPct}% ${rupees(split.gst)} − ` +
          `TDS ${split.ratePct}% ${rupees(split.tds)} → Landlord gets ${rupees(split.landlordGets)}`
        : null;

// ── What an expense screen shows (#1527, #1613) ─────────────────────────────────────────────────

/**
 * A withheld Office Rent's bill, from what is stored once it is split: the base rent its tax record keeps
 * as its gross, plus the GST its Expense keeps (0 on a rent withheld before GST existed). The server's
 * twin is `services/payment_tds.withheld_expense_bill_sql`; the expense screens and the TDS register both
 * read this one.
 */
export const withheldBill = (base: number | string | null | undefined, gst: number | string | null | undefined): number =>
    round2(parseNumber(base) + parseNumber(gst));

/** A tax record as the expense APIs serve it, `withheld_tds` (`services/expense_tds.withheld_tds_of`):
 *  read past the record's own permission, so Admin, the CEO and HR see it. Null before approval. */
export interface WithheldTds {
    /** The base rent, as approved (the record's gross). */
    gross_amount: number;
    /** The Expense's GST: 0 on a rent withheld before GST existed (spec #1613). */
    gst_amount: number;
    tds_percentage: number;
    tds_amount: number;
    tds_section: string;
}

/**
 * The statuses before approval, when an Expense's amount is still the bill: an Expense at Requested or
 * CEO Pending, or a request still Pending Approval that has no Expense yet. Only these are forecast; at
 * any later status the amount is what the landlord gets (or nothing was withheld), so a forecast on it
 * would take the tax off twice.
 */
const REQUEST_PENDING: ExpenseRequestStatus = "Pending Approval";
export const BEFORE_APPROVAL_STATUSES: ReadonlySet<string> = new Set([
    PAYMENT_STATUS.REQUESTED,
    PAYMENT_STATUS.CEO_PENDING,
    REQUEST_PENDING,
]);

export interface ShownExpenseTds extends ExpenseTdsSplit {
    /** True: the stored figures (the tax WAS withheld). False: a forecast (it WILL be). */
    withheld: boolean;
    /** The tax section: the stored record's `tds_section`, or the rule's (`OFFICE_RENT_TDS`) for a forecast. */
    section: string;
}

/**
 * Bill / Rent / GST / TDS / Landlord gets for one expense, or null when it shows its amount as today.
 *
 * - A stored record wins: its base rent, rate and tax and the Expense's GST, and the bill and what the
 *   landlord gets they make. Never the Expense's amount, which Bulk Import's few-rupee correction may
 *   have moved (#1526). A rent withheld before GST existed has a GST of 0: its bill is its rent.
 * - With none, an expense before approval is forecast from its amount, which is still the bill.
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
        const base = parseNumber(withheld.gross_amount);
        const gst = parseNumber(withheld.gst_amount);
        const tds = parseNumber(withheld.tds_amount);
        const bill = withheldBill(base, gst);
        return {
            bill,
            base,
            gstPct: gst > 0 ? OFFICE_RENT_TDS.gstPct : 0,
            gst,
            ratePct: parseNumber(withheld.tds_percentage),
            tds,
            landlordGets: round2(bill - tds),
            withheld: true,
            section: withheld.tds_section,
        };
    }
    if (!BEFORE_APPROVAL_STATUSES.has(status ?? "")) return null;
    const split = expenseTdsSplit(type, amount);
    return split.tds > 0 ? { ...split, withheld: false, section: OFFICE_RENT_TDS.section } : null;
};

/** The label of the line a screen emphasises: what leaves the bank. */
export const LANDLORD_GETS = "Landlord gets";

/** The lines a screen draws: Bill, Rent, GST at its rate (left out when there is none), TDS at its rate,
 *  Landlord gets. */
export const tdsSplitLines = (shown: ShownExpenseTds): { label: string; value: string }[] => [
    { label: "Bill", value: rupees(shown.bill) },
    { label: "Rent", value: rupees(shown.base) },
    ...(shown.gst > 0 ? [{ label: `GST ${shown.gstPct}%`, value: rupees(shown.gst) }] : []),
    { label: `TDS ${shown.ratePct}%`, value: rupees(shown.tds) },
    { label: LANDLORD_GETS, value: rupees(shown.landlordGets) },
];

/** The approve dialog's warning on an Office Rent expense whose request does not name the landlord with a
 *  valid PAN (`api/approvals/expense_detail`'s `deductee_missing`): the server refuses its approval
 *  (`services/expense_tds.refuse_without_deductee`), so Confirm is disabled (spec #1522 review batch 2). */
export const LANDLORD_MISSING = "Landlord's name and PAN are missing — this can't be approved";

/** Whether the tax will be or was withheld, in one line, under the section it is (or will be) filed in.
 *  A forecast whose landlord is missing says so instead (`LANDLORD_MISSING`): nothing will be withheld,
 *  because it can't be approved. */
export const tdsSplitCaption = (shown: ShownExpenseTds, deducteeMissing = false): string =>
    shown.withheld
        ? `${shown.ratePct}% TDS (${shown.section}) on the rent withheld; the landlord is paid the bill less TDS`
        : deducteeMissing
        ? LANDLORD_MISSING
        : `${shown.ratePct}% TDS (${shown.section}) on the rent will be withheld on approval`;

/**
 * The request's own amount, shown as "Raised for ₹…" under its Expense's amount when the two differ,
 * else null. A withheld Office Rent included: the Expense carries what the landlord gets, and the
 * request page still says what was asked for, the bill (spec #1522 story 27, #1613 story 25), beside
 * the breakdown.
 */
export const raisedForAmount = (expenseAmount: number, requestAmount: number | string | null | undefined): number | null => {
    // An absent amount says nothing: `parseNumber` would read it as 0, and "Raised for ₹0" is false.
    if (requestAmount === null || requestAmount === undefined || `${requestAmount}`.trim() === "") return null;
    const asked = parseNumber(requestAmount);
    return asked !== expenseAmount ? asked : null;
};

// ── The type, once approved (spec #1522 review batch 2) ─────────────────────────────────────────

/** The statuses in which an Expense's type may still change to or from Office Rent: the server's
 *  `services/expense_tds.TYPE_CHANGE_STATUSES`, before the approval that decides the tax. */
const TYPE_CHANGE_STATUSES: ReadonlySet<string> = new Set([PAYMENT_STATUS.REQUESTED, PAYMENT_STATUS.CEO_PENDING]);

export interface TdsTypeLock {
    /** The type select is disabled: an Office Rent expense past CEO Pending. */
    selectLocked: boolean;
    /** The one option disabled for another type's expense past CEO Pending: Office Rent. */
    blockedType: string | null;
    /** One line saying why, under the select (or beside the disabled option); null when nothing is locked. */
    reason: string | null;
}

/**
 * What the edit dialog's type select may offer an Expense at its stored `status`: the screen half of
 * `services/expense_tds.guard_tds_type_change`, which refuses the save anyway. Before approval the type
 * changes freely, because the approval reads the type it finds.
 */
export const tdsTypeLock = (status: string | null | undefined, type: string | null | undefined): TdsTypeLock => {
    const stored = status ?? "";
    if (!stored || TYPE_CHANGE_STATUSES.has(stored)) return { selectLocked: false, blockedType: null, reason: null };
    const rule = OFFICE_RENT_TDS;
    if (type === rule.expenseType) {
        return {
            selectLocked: true,
            blockedType: null,
            reason: `${stored}: the type stays ${rule.expenseType}, because its ${rule.ratePct}% TDS is decided at approval.`,
        };
    }
    return {
        selectLocked: false,
        blockedType: rule.expenseType,
        reason: `${stored}: it can't become ${rule.expenseType}, because its ${rule.ratePct}% TDS is decided at approval.`,
    };
};
