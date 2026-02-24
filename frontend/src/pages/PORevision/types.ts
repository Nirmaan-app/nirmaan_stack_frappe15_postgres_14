import { ProcurementOrder, PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
export { ProcurementOrder };

export type RevisionItemType = "Original" | "New" | "Revised" | "Replace" | "Deleted";

export interface RevisionItem extends Partial<PurchaseOrderItem> {
  item_type: RevisionItemType;
  original_row_id?: string;
}

export interface PaymentTerm {
  id: string;
  term: string;
  amount: number;
}

export type AdjustmentMethodType = "Another PO" | "Refunded" | "Adhoc";

export interface RefundAdjustment {
  id: string;
  type: AdjustmentMethodType;
  amount: number;
  po_id?: string;
  bank_account?: string;
  transaction_ref?: string;
  description?: string;
  adhoc_type?: string;
  comment?: string;
  date?: string;
  refund_attachment?: string;
  refund_attachment_file?: File | null;
}

export interface SummaryData {
  totalExclGst: number;
  totalInclGst: number;
}

export interface DifferenceData {
  exclGst: number;
  inclGst: number;
}
