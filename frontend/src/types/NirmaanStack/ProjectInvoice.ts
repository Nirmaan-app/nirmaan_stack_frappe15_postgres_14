/**
 * Describes the data structure for a Project Invoice document in Frappe.
 */
export interface ProjectInvoice {
  // --- Core Invoice Fields ---
  invoice_no: string;
  invoice_date: string; // A date string, e.g., "2025-06-16"
  amount: string;       // Monetary values are often strings to avoid float precision issues.

  // --- Linked Documents ---
  customer: string; // The `name` of the Customer document
  project: string;  // The `name` of the Project document

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
}