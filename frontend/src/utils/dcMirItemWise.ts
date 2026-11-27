/**
 * Item-wise view of a PO's or ITM's Delivery Challans & MIRs: one row per item with its
 * DC and MIR quantities added up across every uploaded document.
 *
 * Pure logic for `DCMIRItemWiseTable` on the PO and ITM pages. Items and DC rows are
 * matched on category + item ID, the same key the project DN > DC reports use. Each
 * parent keeps its own report's status rule: PO → `dnDcItemStatus`, ITM → `itmDnDcItemStatus`.
 */
import type { InternalTransferMemoItem } from "@/types/NirmaanStack/InternalTransferMemo";
import type { PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import type { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";
import { dnDcItemStatus, type DNDCStatus } from "@/utils/dnDcStatus";
import { itmDnDcItemStatus } from "@/utils/itmDnDcStatus";

/**
 * A billable item's DN vs DC status; `not_billable` for a Non-Billable PO item (no DC can
 * be filed for it); `no_activity` for an ITM item with nothing received and no DC (the ITM
 * rule would call it Matched — owner 2026-11-26: show "–" instead; the ITM report hides it).
 */
export type ItemWiseStatus = DNDCStatus | "not_billable" | "no_activity";

/** The label the app shows for each status, in the order the Status filter lists them. */
export const ITEM_WISE_STATUS_LABEL: Record<ItemWiseStatus, string> = {
  no_dc_update: "No DC Update",
  mismatch: "Mismatch",
  pending_dn: "Pending DN",
  partially_delivered: "Partially Delivered",
  matched: "Matched",
  not_billable: "Not Billable",
  no_activity: "–",
};

/** One DC or MIR that covers an item, with the quantity it records for that item. */
export interface ItemWiseDocRef {
  name: string;
  type: "Delivery Challan" | "Material Inspection Report";
  referenceNumber: string;
  /** `dc_date`, else the upload date. */
  date: string;
  quantity: number;
  attachmentUrl?: string;
}

/** One PO item's row in the Item-wise view. */
export interface ItemWiseRow {
  /** `category___item_id`, unique within the PO. */
  key: string;
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  /** PO: the ordered quantity. ITM: the Transfer Qty. */
  orderedQty: number;
  receivedQty: number;
  dcQty: number;
  mirQty: number;
  /** Received − DC Qty. Negative when the DCs cover more than was received. */
  dcPending: number;
  billable: boolean;
  status: ItemWiseStatus;
  /** DCs first, then MIRs, each in upload order. */
  docs: ItemWiseDocRef[];
}

export interface ItemWiseResult {
  rows: ItemWiseRow[];
  /** Old records (`is_stub`) or documents saved with no items; counted in no row. */
  uncountedDocs: PODeliveryDocuments[];
}

const itemKey = (category: string | undefined, itemId: string) => `${category ?? ""}___${itemId}`;

/**
 * How to name a DC/MIR so the user can find it in the DC-wise list: its Ref No., else its
 * S.No. there (the DC-wise list shows a missing Ref No. as "-" and never shows the
 * document's id). `docs` is the list in the order the DC-wise table shows it.
 */
export function docLabel(doc: PODeliveryDocuments, docs: PODeliveryDocuments[]): string {
  if (doc.reference_number) return doc.reference_number;
  const type = doc.type === "Delivery Challan" ? "DC" : "MIR";
  const sNo = docs.indexOf(doc) + 1;
  return sNo > 0 ? `S.No. ${sNo} (${type}, no Ref No.)` : `${type} with no Ref No.`;
}

/** One parent item in the shape both PO and ITM items map to. */
interface SourceItem {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  orderedQty: number;
  receivedQty: number;
  billable: boolean;
}

/**
 * Build the Item-wise rows for one PO (PO status rule, `dnDcItemStatus`).
 *
 * - A PO item listed twice (same category + item ID) is one row, quantities added.
 * - Each DC/MIR adds its quantity to the matching item; a document listing the same
 *   item twice counts both lines.
 * - Stub documents and documents with no items are returned in `uncountedDocs`.
 * - DC rows naming an item the PO does not have are ignored.
 * - A Non-Billable item reads `not_billable`.
 */
export function buildItemWiseRows(
  items: PurchaseOrderItem[],
  docs: PODeliveryDocuments[]
): ItemWiseResult {
  const sources = items.map((item) => ({
    itemId: item.item_id,
    itemName: item.item_name,
    category: item.category ?? "",
    unit: item.unit,
    orderedQty: item.quantity ?? 0,
    receivedQty: item.received_quantity ?? 0,
    billable: item.billing_status !== "Non-Billable",
  }));
  return build(sources, docs, (row) => dnDcItemStatus(row.orderedQty, row.receivedQty, row.dcQty));
}

/**
 * Build the Item-wise rows for one ITM (ITM status rule, `itmDnDcItemStatus`).
 *
 * Same counting as `buildItemWiseRows`; `orderedQty` is the Transfer Qty, and every item
 * is billable (ITM items carry no billing status). An item with nothing received and no
 * DC reads `no_activity` ("–"), not the rule's Matched.
 */
export function buildItmItemWiseRows(
  items: InternalTransferMemoItem[],
  docs: PODeliveryDocuments[]
): ItemWiseResult {
  const sources = items.map((item) => ({
    itemId: item.item_id,
    itemName: item.item_name || item.item_id,
    category: item.category ?? "",
    unit: item.unit ?? "",
    orderedQty: item.transfer_quantity ?? 0,
    receivedQty: item.received_quantity ?? 0,
    billable: true,
  }));
  return build(sources, docs, (row) =>
    row.receivedQty === 0 && row.dcQty === 0 ? "no_activity" : itmDnDcItemStatus(row.receivedQty, row.dcQty)
  );
}

function build(
  items: SourceItem[],
  docs: PODeliveryDocuments[],
  statusOf: (row: ItemWiseRow) => Exclude<ItemWiseStatus, "not_billable">
): ItemWiseResult {
  const byKey = new Map<string, ItemWiseRow>();
  for (const item of items) {
    const key = itemKey(item.category, item.itemId);
    const existing = byKey.get(key);
    if (existing) {
      existing.orderedQty += item.orderedQty;
      existing.receivedQty += item.receivedQty;
      continue;
    }
    byKey.set(key, {
      key,
      itemId: item.itemId,
      itemName: item.itemName,
      category: item.category,
      unit: item.unit,
      orderedQty: item.orderedQty,
      receivedQty: item.receivedQty,
      dcQty: 0,
      mirQty: 0,
      dcPending: 0,
      billable: item.billable,
      status: "matched",
      docs: [],
    });
  }

  const uncountedDocs: PODeliveryDocuments[] = [];
  const ordered = [
    ...docs.filter((d) => d.type === "Delivery Challan"),
    ...docs.filter((d) => d.type === "Material Inspection Report"),
  ];
  for (const doc of ordered) {
    if (doc.is_stub === 1 || !doc.items?.length) {
      uncountedDocs.push(doc);
      continue;
    }
    const qtyByKey = new Map<string, number>();
    for (const line of doc.items) {
      const key = itemKey(line.category, line.item_id);
      if (!byKey.has(key)) continue;
      qtyByKey.set(key, (qtyByKey.get(key) ?? 0) + (line.quantity ?? 0));
    }
    for (const [key, quantity] of qtyByKey) {
      const row = byKey.get(key);
      if (!row) continue;
      if (doc.type === "Delivery Challan") row.dcQty += quantity;
      else row.mirQty += quantity;
      row.docs.push({
        name: doc.name,
        type: doc.type,
        referenceNumber: docLabel(doc, docs),
        date: doc.dc_date || doc.creation,
        quantity,
        attachmentUrl: doc.attachment_url,
      });
    }
  }

  const rows = [...byKey.values()];
  for (const row of rows) {
    row.dcPending = row.receivedQty - row.dcQty;
    row.status = row.billable ? statusOf(row) : "not_billable";
  }
  // `uncountedDocs` keeps the order the documents were given in.
  uncountedDocs.sort((a, b) => docs.indexOf(a) - docs.indexOf(b));
  return { rows, uncountedDocs };
}

/** How many rows carry each status, for the Status filter's counts. */
export function countByStatus(rows: ItemWiseRow[]): Partial<Record<ItemWiseStatus, number>> {
  const counts: Partial<Record<ItemWiseStatus, number>> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}
