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
  autofill_extracted_supplier_gstin?: string;
  autofill_extracted_receiver_gstin?: string;
  /** JSON string of `{invoice_no, invoice_date, amount}` confidence scores */
  autofill_confidence_json?: string;
  /** JSON string of full Document AI entity list `[{type, value, confidence}, ...]` */
  autofill_all_entities_json?: string;
  /** JSON string of the line items the extractor read (audit snapshot). */
  autofill_line_items_json?: string;
  /** JSON string of the AI's original proposed line→PO mapping (audit snapshot). */
  autofill_line_match_json?: string;
  /** Verified invoice-line → PO-item mapping (queryable child rows). */
  line_mappings?: VendorInvoiceLine[];

  /** Auto-approve audit fields (set when the system auto-approved this invoice). */
  auto_approved?: 0 | 1;
  /** Comma-separated reason tokens for invoices that did NOT auto-approve. */
  auto_approve_skip_reasons?: string;
}

/**
 * One verified invoice line ↔ PO item mapping (child of Vendor Invoices).
 * The source of truth for item-level billing aggregation and recon display.
 */
export interface VendorInvoiceLine {
  name?: string;
  /** Line as read from the invoice */
  description?: string;
  uom?: string;
  quantity?: number;
  rate?: number;
  amount?: number;
  tax_rate?: number;
  /** Mapping outcome */
  match_status: "Matched" | "Unmatched" | "Non-Item";
  match_source?: "" | "Fuzzy" | "AI" | "Manual";
  match_score?: number;
  /** Mapped PO item (set when Matched) */
  po_item_id?: string;
  po_item_row?: string;
  po_item_name?: string;
  /** This line alone exceeds the mapped PO item (snapshot at save time). */
  is_over_billed?: 0 | 1;
}

/**
 * Type alias for reconciliation status values.
 */
export type VendorInvoiceStatus = VendorInvoice["status"];
export type VendorInvoiceReconciliationStatus = NonNullable<VendorInvoice["reconciliation_status"]>;
