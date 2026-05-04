/**
 * Vendor Invoices type definition.
 *
 * Represents an invoice for a Procurement Order or Service Request.
 * This replaces the previous Task-based invoice tracking system.
 */
export interface VendorInvoice {
  /** Unique identifier (e.g., "VI-2026-00001") */
  name: string;

  /** Standard Frappe document fields */
  creation?: string;
  modified?: string;
  owner?: string;

  /** Link to parent document */
  document_type: "Procurement Orders" | "Service Requests";
  document_name: string;

  /** Related entities */
  project?: string;
  vendor?: string;

  /** Invoice details */
  invoice_no: string;
  invoice_date: string;
  invoice_amount: number;
  invoice_attachment?: string;

  /** Approval workflow */
  status: "Pending" | "Approved" | "Rejected";
  uploaded_by?: string;
  approved_by?: string;
  approved_on?: string;
  rejection_reason?: string;

  /** Reconciliation (for approved invoices) */
  reconciliation_status?: "" | "partial" | "full" | "na";
  reconciled_date?: string;
  reconciled_by?: string;
  reconciled_amount?: number;
  reconciliation_proof?: string;

  /** Document AI autofill metadata (set when invoice was created via autofill) */
  autofill_used?: 0 | 1;
  autofill_processor_id?: string;
  autofill_extracted_invoice_no?: string;
  autofill_extracted_invoice_date?: string;
  autofill_extracted_amount?: number;
  /** JSON string of `{invoice_no, invoice_date, amount}` confidence scores */
  autofill_confidence_json?: string;
  /** JSON string of full Document AI entity list `[{type, value, confidence}, ...]` */
  autofill_all_entities_json?: string;
}

/**
 * Type alias for reconciliation status values.
 */
export type VendorInvoiceStatus = VendorInvoice["status"];
export type VendorInvoiceReconciliationStatus = NonNullable<VendorInvoice["reconciliation_status"]>;
