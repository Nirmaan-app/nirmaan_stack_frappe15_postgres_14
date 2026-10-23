// src/types/NirmaanStack/NonProjectExpenses.ts

export interface NonProjectExpenses {
    name: string
    creation: string
    modified: string
    owner: string
    modified_by: string
    type: string; // Link to Expense Type
    expense_type_name?: string; // Denormalized field for easier display
    description?: string;
    comment?: string
    amount: number;

    status?: "Requested" | "Approved" | "Paid"; // Approval workflow status (default "Requested")

    // Payment Details (conditionally entered)
    payment_date?: string; // YYYY-MM-DD
    payment_ref?: string;
    payment_attachment?: string; // URL of the payment attachment

    // Invoice Details (conditionally entered)
    invoice_date?: string; // YYYY-MM-DD
    invoice_ref?: string;
    invoice_attachment?: string; // URL of the invoice attachment

    // Set only by the Porter Statement import (#1445): the Porter Order this expense pays for.
    porter_order?: string | null;
    /** The Reimbursement claim this expense pays (ADR-0040); set only when the claim is approved. Deleting the
     *  expense deletes that claim too. */
    reimbursement?: string | null;

    // The Expense Request this expense was created from, written by its approval; blank on a Direct Expense.
    request_id?: string | null;

    // Standard Frappe fields like name, creation, modified, owner are implicitly available
}