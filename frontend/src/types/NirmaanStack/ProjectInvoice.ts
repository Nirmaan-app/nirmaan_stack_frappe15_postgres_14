/**
 * Describes the data structure for a Project Invoice document in Frappe.
 */
export interface ProjectInvoice {
  // --- Core Invoice Fields ---
  invoice_no: string;
  invoice_date: string; // A date string, e.g., "2025-06-16"
  amount: number;       // Total amount Incl. GST. Currency field returns numeric values.
  amount_excl_gst?: number; // Net amount Excl. GST (pre-tax subtotal). Optional in v1.

  // --- Linked Documents ---
  customer: string; // The `name` of the Customer document
  project: string;  // The `name` of the Project document
  project_gst?: string; // Link to Project GST

  // --- Attachments ---
  // This field might be null or not present if there's no attachment.
  // The `?` makes it optional.
  attachment?: string | null;

  // --- Standard Frappe Fields (for reference, but often handled by a generic type) ---
  name: string;
  owner: string;
  creation: string;
  modified: string;
  modified_by: string;
  idx: number;

  /**
   * The status of the document.
   * 0 = Draft
   * 1 = Submitted
   * 2 = Cancelled
   */
  docstatus: 0 | 1 | 2;

  // --- Document AI autofill metadata (set when this invoice was created via autofill) ---
  autofill_used?: 0 | 1;
  autofill_processor_id?: string;
  autofill_extracted_invoice_no?: string;
  autofill_extracted_invoice_date?: string;
  autofill_extracted_amount?: number;
  /** AI-extracted net amount (Excl. GST) — captured at autofill time. */
  autofill_extracted_net_amount?: number;
  /** JSON: `{invoice_no, invoice_date, amount, net_amount}` confidence scores. */
  autofill_confidence_json?: string;
  /** JSON: full Document AI entity list `[{type, value, confidence}, ...]`. */
  autofill_all_entities_json?: string;
}