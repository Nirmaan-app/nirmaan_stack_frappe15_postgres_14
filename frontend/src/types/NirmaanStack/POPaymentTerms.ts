export interface PoPaymentTermRow {
    name: string;         // The PO name (from parent)
    project_name: string;
    vendor_name: string;
    status: string;       // The payment term's status
    label: string;
    total_amount: number;
    amount: number;
    due_date: string;
    payment_type: string;
    // The useServerDataTable hook will fetch a child table row, which has a `parent` field
    // referencing the main document (the PO). We need this for the link.
    parent: string;
}