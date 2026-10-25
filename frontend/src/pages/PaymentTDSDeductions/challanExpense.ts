/**
 * A TDS challan and the non-project *TDS Payment* expense that records it (#1544).
 *
 * ⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet doctypes.
 *
 * Every challan is a deposit already made, so every challan should have its expense. The link is made
 * by hand; nothing creates either side. The server owns which expense may be linked
 * (`TDSChallanAttachment._validate_tds_payment_expense`: TDS Payment type, not Rejected, on no other
 * challan); these helpers only shape the screen to match.
 */

/** Expense Type a deposit of tax is booked under (`fixtures/expense_type.json`). */
export const TDS_PAYMENT_EXPENSE_TYPE = "TDS Payment";

interface ChallanLink {
    name: string;
    tds_payment_expense?: string | null;
}

/** The challan's warning: shown while it has no expense, cleared by linking one. */
export const lacksExpense = (challan: ChallanLink): boolean => !challan.tds_payment_expense;

/** The expenses the picker offers for `challan`: all but those already on another challan. */
export function linkableExpenses<E extends { name: string }>(
    expenses: E[],
    challans: ChallanLink[],
    challan: string
): E[] {
    const taken = new Set(
        challans
            .filter((other) => other.name !== challan && other.tds_payment_expense)
            .map((other) => other.tds_payment_expense)
    );
    return expenses.filter((expense) => !taken.has(expense.name));
}
