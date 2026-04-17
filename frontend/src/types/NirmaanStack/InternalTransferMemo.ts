export type ITMStatus =
  | "Pending Approval"
  | "Approved"
  | "Rejected"
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
  status?: "Pending" | "Approved" | "Rejected";
  rejection_reason?: string;
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
  rejection_reason?: string | null;
  dispatched_by?: string | null;
  dispatched_on?: string | null;
  latest_delivery_date?: string | null;
  items: InternalTransferMemoItem[];
}
