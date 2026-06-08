// ---- ITM (Transfer Memo) — dispatch/delivery document ----
//
// After the ITR collapse, ITMs are born `Approved` directly from the picker
// via `create_itms`. There is no separate Transfer Request layer; this type
// is the single source of truth for the doctype shape on the frontend.

export type ITMStatus =
  | "Approved"
  | "Dispatched"
  | "Partially Delivered"
  | "Delivered";

export interface InternalTransferMemoItem {
  name?: string;
  item_id: string;
  item_name?: string;
  unit?: string;
  category?: string;
  make?: string;
  transfer_quantity: number;
  estimated_rate: number;
  received_quantity?: number;
}

export interface InternalTransferMemo {
  name: string;
  creation: string;
  modified: string;
  modified_by?: string;
  owner?: string;
  docstatus?: 0 | 1 | 2;
  source_type?: "Project" | "Warehouse";
  source_project: string;
  target_type?: "Project" | "Warehouse";
  target_project: string;
  source_rir: string;
  status: ITMStatus;
  estimated_value?: number;
  total_items?: number;
  total_quantity?: number;
  requested_by?: string;
  approved_by?: string | null;
  approved_on?: string | null;
  dispatched_by?: string | null;
  dispatched_on?: string | null;
  latest_delivery_date?: string | null;
  items: InternalTransferMemoItem[];
}
