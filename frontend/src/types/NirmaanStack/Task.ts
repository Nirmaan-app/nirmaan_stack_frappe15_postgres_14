export interface InvoiceApprovalTask {
  name: string; // Task Doc Name
  creation: string;
  modified: string;
  owner: string;
  task_doctype: "Procurement Orders" | "Service Requests";
  task_docname: string;
  status: "Pending" | "Approved" | "Rejected"; // We filter by this

  /**
   * Reference name 1 for the task
   * for tast_type = "po_invoice_approval" (Invoice Reconciliation), this is filled with invoice_date_key
   */
  reference_name_1?: string;
  /**
   * Reference value 1 refering reference_name_1 for the task
   * for tast_type = "po_invoice_approval" (Invoice Reconciliation), this field contains the invoice date
   */
  reference_value_1?: string;
  /**
   * Reference name 2 for the task
   * for tast_type = "po_invoice_approval" (Invoice Reconciliation), this is filled with invoice_no
   */
  reference_name_2?: string;
  /**
   * Reference value 2 refering reference_name_2 for the task
   * for tast_type = "po_invoice_approval" (Invoice Reconciliation), this field contains the invoice number
   */
  reference_value_2?: string; 
   /**
   * Reference name 3 for the task
   * for tast_type = "po_invoice_approval" (Invoice Reconciliation), this is filled with invoice_amount
   */
  reference_name_3?: string;
  /**
   * Reference value 3 refering reference_name_3 for the task
   * for tast_type = "po_invoice_approval" (Invoice Reconciliation), this field contains the invoice amount
   */
  reference_value_3?: string; 
  /**
   * Reference name 4 for the task
   * for tast_type = "po_invoice_approval" (Invoice Reconciliation), this is filled with invoice_attachment_id
   */
  reference_name_4?: string;
  /**
   * Reference value 4 refering reference_name_4 for the task
   * for tast_type = "po_invoice_approval" (Invoice Reconciliation), this field contains the invoice attachment id (Nirmaan Attachments Docname)
   */
  reference_value_4?: string; 
  
  /**
   * Task Type
   * For Invoices related tasks, this is "po_invoice_approval"
   */
  task_type?: string; 
  assignee?: string;
  assignee_role?: string;
}