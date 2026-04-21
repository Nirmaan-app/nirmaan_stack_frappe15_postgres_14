// ---- ITR (Transfer Request) — approval document ----

export type ITRStatus = "Pending" | "Completed" | "Rejected";

export interface InternalTransferRequestItem {
  name?: string;
  item_id: string;
  item_name?: string;
  unit?: string;
  category?: string;
  make?: string;
  transfer_quantity: number;
  estimated_rate: number;
  status: "Pending" | "Approved" | "Rejected";
  rejection_reason?: string;
  linked_itm?: string;
}

export interface InternalTransferRequest {
  name: string;
  creation: string;
  modified: string;
  owner?: string;
  source_project: string;
  target_project: string;
  source_rir?: string;
  status: ITRStatus;
  requested_by?: string;
  memo_count?: number;
  items: InternalTransferRequestItem[];
}

// ---- ITM (Transfer Memo) — dispatch/delivery document ----

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
  transfer_request?: string;
  source_project: string;
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
