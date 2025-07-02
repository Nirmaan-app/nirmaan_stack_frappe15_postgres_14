// src/types/NirmaanStack/ProjectExpenses.ts

export interface ProjectExpenses {
    name: string
    creation: string
    modified: string
    owner: string
    modified_by: string
    docstatus: 0 | 1 | 2
    parent?: string
    parentfield?: string
    parenttype?: string
    idx?: number

    projects: string; // This is the link to the Projects doctype
    vendor?: string; // Optional link to Vendors
    type?: string; // --- (Indicator) NEW: Link to Expense Type DocType ---
    expense_type_name?: string; // For easier display of the linked field's name
    description?: string;
    comment?: string;
    amount?: number; // Should be a number in frontend logic
    payment_date?: string; // YYYY-MM-DD format
    payment_by?: string; // Link to User
}