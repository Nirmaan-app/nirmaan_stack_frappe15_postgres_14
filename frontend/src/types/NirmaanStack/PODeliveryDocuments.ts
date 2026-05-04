/**
 * DC Item - child table row representing an item in a delivery challan or MIR.
 */
export interface DCItem {
  name?: string;
  item_id: string;
  item_name: string;
  unit: string;
  category?: string;
  quantity: number;
  make?: string;
}

/**
 * PO Delivery Documents - tracks delivery challans and material inspection reports
 * with item-level quantity tracking and client signature capture.
 *
 * Polymorphic: parent can be "Procurement Orders" (PO) or "Internal Transfer Memo" (ITM).
 */
export type PDDParentDoctype = "Procurement Orders" | "Internal Transfer Memo";

export interface PODeliveryDocuments {
  name: string;
  creation: string;
  modified?: string;
  modified_by?: string;
  parent_doctype?: PDDParentDoctype;
  parent_docname?: string;
  /**
   * @deprecated Always use `parent_docname` (and `parent_doctype` to gate). This
   * field is preserved on legacy rows for back-compat reads but is no longer
   * populated by `create_po_delivery_documents` and is hidden in the doctype form.
   */
  procurement_order?: string;
  project: string;
  /** For ITM-parented rows: the source project (transferred from). Populated by the backend enricher. */
  source_project?: string | null;
  vendor?: string;
  type: "Delivery Challan" | "Material Inspection Report";
  nirmaan_attachment?: string;
  reference_number?: string;
  dc_reference?: string;
  dc_date?: string;
  is_signed_by_client: 0 | 1;
  client_representative_name?: string;
  items: DCItem[];
  is_stub: 0 | 1;
  /** Enriched by API - the file URL from the linked Nirmaan Attachment */
  attachment_url?: string;
}
