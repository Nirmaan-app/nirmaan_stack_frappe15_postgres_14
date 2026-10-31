export interface PoPaymentTermRow {
    name: string;           // The PO name (from parent)
    project_name: string;
    project: string;
    vendor_name: string;
    vendor: string;
    postatus: string;       // The PO's overall status (from parent)
    term_status: string;    // The individual payment term's status (Created, Requested, Approved, Paid)
    display_status: string; // Computed status for UI: "Due" for Created+past due_date, else term_status
    label: string;
    total_amount: number;
    amount: number;
    due_date: string;
    payment_type: string;
    parent: string;
    ptname: string;
    /** The term's payment, when there is one: Online or Cheque. */
    mode_of_payment?: string | null;
    /** The Cheque that pays it, for a cheque payment. */
    cheque?: string | null;
    cheque_no?: string | null;
    cheque_date?: string | null;
    cheque_status?: string | null;
}