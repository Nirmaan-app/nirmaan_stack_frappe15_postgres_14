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
 */
export interface PODeliveryDocuments {
  name: string;
  creation: string;
  modified?: string;
  modified_by?: string;
  procurement_order: string;
  project: string;
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
