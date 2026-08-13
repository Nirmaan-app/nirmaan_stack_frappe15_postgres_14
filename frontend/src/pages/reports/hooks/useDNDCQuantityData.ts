import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";
import { po_item_data_item } from "@/pages/projects/project";
import { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReconcileStatus = "matched" | "mismatch" | "no_dc_update" | "pending_dn";

export interface DNDCItemRow {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  billingStatus: "Billable" | "Non-Billable" | "";
  orderedQty: number;
  dnQty: number; // from received_quantity
  dcQty: number; // sum of DC item quantities for this PO+item
  difference: number; // dnQty - dcQty
  status: ReconcileStatus;
  /** Ordered quantity not yet received, on a PO that is not already Delivered.
   *  SEPARATE from `status` on purpose — an item can be delivery-pending AND missing a
   *  challan, and the single-status model cannot hold both. Drives the Pending DN card. */
  deliveryPending: boolean;
}

export interface DNDCPORow {
  poNumber: string;
  vendorName: string;
  billingStatus: "Billable" | "Non-Billable" | "";
  totalOrderedQty: number;
  totalDNQty: number;
  totalDCQty: number;
  totalDifference: number;
  itemsMatched: number;
  itemsTotal: number;
  reconcileStatus: ReconcileStatus;
  /** ANY billable item on this PO is delivery-pending. Separate from `reconcileStatus`
   *  because a PO can be both — PO/218 owes a delivery AND a challan, and the rollup can
   *  only report one. This is what the Pending DN card counts, and what the table's
   *  status filter and badge must ALSO read, or a PO the card counts is unfindable. */
  hasDeliveryPending: boolean;
  items: DNDCItemRow[];
}

export interface DNDCSummary {
  totalPOs: number;
  matchedPOs: number;
  mismatchPOs: number;
  noDCUpdatePOs: number;
  pendingDNPOs: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDNDCQuantityData(projectId: string | null) {
  // 1. PO items from generate_po_summary
  const {
    data: poItemData,
    isLoading: poItemsLoading,
    error: poItemsError,
  } = useFrappeGetCall<{
    message: {
      po_items: po_item_data_item[];
      custom_items: po_item_data_item[];
    };
  }>(
    "nirmaan_stack.api.procurement_orders.generate_po_summary",
    { project_id: projectId },
    projectId ? `dndc_po_items_${projectId}` : undefined
  );

  // 2. PO Delivery Documents (DC docs)
  const {
    data: poDeliveryDocsData,
    isLoading: dcDocsLoading,
    error: dcDocsError,
  } = useFrappeGetCall<{
    message: PODeliveryDocuments[];
  }>(
    "nirmaan_stack.api.po_delivery_documentss.get_project_po_delivery_documents",
    { project_id: projectId },
    projectId ? `dndc_delivery_docs_${projectId}` : undefined
  );

  // 3. PO list with Delivered / Partially Delivered status
  const {
    data: poList,
    isLoading: poListLoading,
    error: poListError,
  } = useFrappeGetDocList(
    "Procurement Orders",
    {
      fields: ["name", "status", "billing_status"],
      filters: [
        ["project", "=", projectId],
        ["status", "in", ["Dispatched", "Partially Dispatched", "Delivered", "Partially Delivered"]],
        // ["total_amount", ">=", 5000],
      ],
      limit: 10000,
    },
    projectId ? `dndc_po_list_${projectId}` : undefined
  );

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const isLoading = poItemsLoading || dcDocsLoading || poListLoading;

  const error: Error | null =
    poItemsError instanceof Error
      ? poItemsError
      : dcDocsError instanceof Error
        ? dcDocsError
        : poListError instanceof Error
          ? poListError
          : null;

  const { poRows, summary } = useMemo<{
    poRows: DNDCPORow[] | null;
    summary: DNDCSummary | null;
  }>(() => {
    // Guard: data not ready
    if (isLoading || !poItemData?.message || !poDeliveryDocsData?.message || !poList) {
      return { poRows: null, summary: null };
    }

    // 2. Build valid PO set and status map
    const validPOSet = new Set<string>(poList.map((po) => po.name));
    const poStatusMap = new Map<string, string>(poList.map((po) => [po.name, po.status]));
    const poBillingMap = new Map<string, "Billable" | "Non-Billable" | "">(
      poList.map((po) => [po.name, (po.billing_status as "Billable" | "Non-Billable" | "") || ""])
    );

    // 3. Merge po_items + custom_items
    const allItems = [
      ...(poItemData.message.po_items ?? []),
      ...(poItemData.message.custom_items ?? []),
    ];

    // 4. Filter to valid POs, exclude Additional Charges, and apply dispatch filter
    const filteredItems = allItems.filter((item) => {
      if (!validPOSet.has(item.po_number)) return false;
      if (item.category === "Additional Charges") return false;
      if (poStatusMap.get(item.po_number) === "Partially Dispatched" && item.is_dispatched !== 1) return false;
      return true;
    });

    // 5. Group by PO
    const poMap = new Map<
      string,
      {
        vendorName: string;
        items: Map<
          string,
          {
            orderedQty: number;
            dnQty: number;
            itemName: string;
            category: string;
            unit: string;
            billingStatus: "Billable" | "Non-Billable" | "";
          }
        >;
      }
    >();

    for (const item of filteredItems) {
      let poEntry = poMap.get(item.po_number);
      if (!poEntry) {
        poEntry = { vendorName: item.vendor_name, items: new Map() };
        poMap.set(item.po_number, poEntry);
      }

      const itemKey = `${item.category}___${item.item_id}`;
      const existing = poEntry.items.get(itemKey);
      if (existing) {
        // Accumulate in case of duplicate rows for same item in same PO
        existing.orderedQty += item.quantity;
        existing.dnQty += item.received_quantity;
      } else {
        poEntry.items.set(itemKey, {
          orderedQty: item.quantity,
          dnQty: item.received_quantity,
          itemName: item.item_name,
          category: item.category,
          unit: item.unit,
          billingStatus: (item.billing_status as "Billable" | "Non-Billable" | "") || "",
        });
      }
    }

    // 6. Build DC quantity map: key = `${po}___${category}___${item_id}` -> total qty
    const dcQtyMap = new Map<string, number>();
    // Also track which PO+category+item combos exist in DC for orphan detection
    const dcItemsByPO = new Map<
      string,
      Map<
        string,
        { itemName: string; category: string; unit: string; qty: number }
      >
    >();

    for (const doc of poDeliveryDocsData.message) {
      // Only Delivery Challans, not stubs
      if (doc.type !== "Delivery Challan" || doc.is_stub === 1) continue;
      // Resolve PO id from polymorphic parent_docname (preferred) with
      // back-compat fallback to the deprecated procurement_order field.
      const poId = doc.parent_docname || doc.procurement_order;
      if (!poId) continue;
      // Only for valid POs
      if (!validPOSet.has(poId)) continue;

      for (const dcItem of doc.items ?? []) {
        const category = dcItem.category ?? "";
        const compositeKey = `${poId}___${category}___${dcItem.item_id}`;
        dcQtyMap.set(compositeKey, (dcQtyMap.get(compositeKey) ?? 0) + dcItem.quantity);

        // Track for orphan detection
        let poItems = dcItemsByPO.get(poId);
        if (!poItems) {
          poItems = new Map();
          dcItemsByPO.set(poId, poItems);
        }
        const itemKey = `${category}___${dcItem.item_id}`;
        const existing = poItems.get(itemKey);
        if (existing) {
          existing.qty += dcItem.quantity;
        } else {
          poItems.set(itemKey, {
            itemName: dcItem.item_name,
            category,
            unit: dcItem.unit,
            qty: dcItem.quantity,
          });
        }
      }
    }

    // 7 & 8. Merge DN and DC data, handle orphan DC items
    const resultRows: DNDCPORow[] = [];

    // Process all POs from the PO items
    for (const [poNumber, poEntry] of poMap) {
      const itemRows: DNDCItemRow[] = [];
      const processedDCKeys = new Set<string>();

      for (const [itemKey, itemData] of poEntry.items) {
        const [category, itemId] = itemKey.split("___");
        const dcKey = `${poNumber}___${category}___${itemId}`;
        const dcQty = dcQtyMap.get(dcKey) ?? 0;
        processedDCKeys.add(itemKey);

        const dnQty = itemData.dnQty;
        const difference = dnQty - dcQty;

        // "Pending DN" — ordered quantity not yet received. It is carried as its OWN
        // FLAG, not as a status, and that is load-bearing: an item can be short on
        // delivery AND missing a challan at the same time (PO/218 on Nagarjuna Olive
        // is), so making it a status let it STEAL the item from `no_dc_update` and drop
        // that PO off the red card — 77 became 76 and stopped agreeing with the
        // project's DC Pending tile. As a flag it adds a signal without removing one.
        //
        // The `Delivered` exclusion mirrors `predicates.is_dn_pending`: a fully
        // delivered PO has no outstanding delivery obligation by definition. Without it
        // this project reads 4 against the Overview tile's 2, and 28 vs 5 system-wide.
        //
        // Still simpler than that predicate, which also requires `is_dispatched = 1`
        // and allows a 2.5% tolerance on fractional quantities. Measured on live data
        // those two make no difference here; if this card ever disagrees with the tile,
        // they are the first place to look.
        const deliveryPending =
          poStatusMap.get(poNumber) !== "Delivered" && itemData.orderedQty > dnQty;

        // The three quantity verdicts are UNTOUCHED — every item keeps exactly the
        // status it had before this flag existed.
        let status: ReconcileStatus;
        if (dcQty >= dnQty) {
          status = "matched";
        } else if (dnQty > 0 && dcQty === 0) {
          status = "no_dc_update";
        } else {
          status = "mismatch";
        }

        // ...with ONE exception. An item with nothing on either side has no meaningful
        // DC verdict — "matched" at 0 vs 0 is vacuous — and it is exactly the shape the
        // zero-activity filter used to discard, which is why a PO dispatched with
        // nothing received appeared nowhere in this report. Label it for what it is.
        if (deliveryPending && dnQty === 0 && dcQty === 0) {
          status = "pending_dn";
        }

        itemRows.push({
          itemId,
          itemName: itemData.itemName,
          category,
          unit: itemData.unit,
          billingStatus: itemData.billingStatus,
          orderedQty: itemData.orderedQty,
          dnQty,
          dcQty,
          difference,
          status,
          deliveryPending,
        });
      }

      // 8. Orphan DC items: items in DC for this PO but NOT in PO items
      const dcPOItems = dcItemsByPO.get(poNumber);
      if (dcPOItems) {
        for (const [itemKey, dcData] of dcPOItems) {
          if (processedDCKeys.has(itemKey)) continue;

          const [, itemId] = itemKey.split("___");
          itemRows.push({
            itemId,
            itemName: dcData.itemName,
            category: dcData.category,
            unit: dcData.unit,
            billingStatus: "Billable",
            orderedQty: 0,
            dnQty: 0,
            dcQty: dcData.qty,
            difference: 0 - dcData.qty,
            status: "matched",
            deliveryPending: false,
          });
        }
      }

      // 9. Filter zero-activity items. A pending_dn line is EXEMPT: it has ordered
      // quantity outstanding, so "nothing has happened here" is false even though both
      // the DN and DC columns read 0. Without the exemption a PO dispatched with
      // nothing received is discarded before any verdict runs and appears nowhere in
      // the report at all — which is what used to happen.
      const activeItems = itemRows.filter(
        (item) => !(item.dnQty === 0 && item.dcQty === 0) || item.deliveryPending
      );

      if (activeItems.length === 0) continue;

      // 10. PO-level rollup — Non-Billable items are out of scope for DN/DC
      // reconciliation (a DC/MIR cannot be filed against them, and they show a
      // disabled "Non-Billable" badge instead of a reconcile status). They stay
      // visible as child rows but are EXCLUDED from the PO-level totals, item
      // counts, and reconcile status — only billable items drive the rollup.
      const billableItems = activeItems.filter(
        (i) => i.billingStatus !== "Non-Billable"
      );

      const matchedItems = billableItems.filter((i) => i.status === "matched").length;
      const totalDNQty = billableItems.reduce((sum, i) => sum + i.dnQty, 0);
      const totalDCQty = billableItems.reduce((sum, i) => sum + i.dcQty, 0);

      const hasMismatch = billableItems.some((i) => i.status === "mismatch");
      const hasNoDCUpdate = billableItems.some((i) => i.status === "no_dc_update");
      const hasDeliveryPending = billableItems.some((i) => i.deliveryPending);
      // The FLAG, not the status. A PO whose delivery gap sits on an item that IS
      // challaned carries no `pending_dn` STATUS anywhere (its items read "matched"
      // against the DC), so a status-based test badged it Fully Matched while the
      // Pending DN card counted it — the card and the badge disagreeing about the same
      // row. PO/218 on Nagarjuna Olive is exactly that: 36 ordered, 12 received, the 12
      // fully challaned. Ranked BELOW mismatch and no_dc_update, so it can only override
      // "matched" — it never takes a PO off the No DC Update card.

      let reconcileStatus: ReconcileStatus;
      if (hasMismatch) {
        reconcileStatus = "mismatch";
      } else if (hasNoDCUpdate) {
        reconcileStatus = "no_dc_update";
      } else if (hasDeliveryPending) {
        reconcileStatus = "pending_dn";
      } else {
        reconcileStatus = "matched";
      }


      resultRows.push({
        poNumber,
        vendorName: poEntry.vendorName,
        billingStatus: poBillingMap.get(poNumber) ?? "",
        totalOrderedQty: billableItems.reduce((sum, i) => sum + i.orderedQty, 0),
        totalDNQty,
        totalDCQty,
        totalDifference: billableItems.reduce((sum, i) => sum + i.difference, 0),
        itemsMatched: matchedItems,
        itemsTotal: billableItems.length,
        reconcileStatus,
        hasDeliveryPending,
        items: activeItems,
      });
    }

    // Handle POs that exist only in DC data (no PO items at all)
    for (const [poNumber, dcPOItems] of dcItemsByPO) {
      if (poMap.has(poNumber)) continue; // already processed

      const itemRows: DNDCItemRow[] = [];
      for (const [itemKey, dcData] of dcPOItems) {
        const [, itemId] = itemKey.split("___");
        itemRows.push({
          itemId,
          itemName: dcData.itemName,
          category: dcData.category,
          unit: dcData.unit,
          // Pre-existing omission, surfaced once the summary began reading this field:
          // DNDCItemRow requires billingStatus and this DC-only branch never set it.
          // "Billable" matches the sibling orphan-item branch above.
          billingStatus: "Billable",
          orderedQty: 0,
          dnQty: 0,
          dcQty: dcData.qty,
          difference: 0 - dcData.qty,
          status: "matched",
          deliveryPending: false,
        });
      }

      const activeItems = itemRows.filter(
        (item) => !(item.dnQty === 0 && item.dcQty === 0)
      );
      if (activeItems.length === 0) continue;

      // Find vendor name from DC docs
      const dcDoc = poDeliveryDocsData.message.find(
        (d) => d.procurement_order === poNumber
      );

      resultRows.push({
        poNumber,
        // A DC-only PO has no PO items at all, so nothing can be delivery-pending.
        hasDeliveryPending: false,
        vendorName: dcDoc?.vendor ?? "",
        billingStatus: poBillingMap.get(poNumber) ?? "",
        totalOrderedQty: 0,
        totalDNQty: 0,
        totalDCQty: activeItems.reduce((sum, i) => sum + i.dcQty, 0),
        totalDifference: activeItems.reduce((sum, i) => sum + i.difference, 0),
        itemsMatched: 0,
        itemsTotal: activeItems.length,
        reconcileStatus: "matched",
        items: activeItems,
      });
    }

    // 11. Summary — Billable POs only. A DC/MIR cannot be filed against a
    // Non-Billable PO, so including them would inflate "No DC Update" with rows
    // that can never be reconciled. The cards therefore count the actionable
    // (Billable) universe, matching the table's default Billing filter.
    const billableRows = resultRows.filter((r) => r.billingStatus !== "Non-Billable");
    const matchedPOs = billableRows.filter((r) => r.reconcileStatus === "matched").length;
    const mismatchPOs = billableRows.filter((r) => r.reconcileStatus === "mismatch").length;
    const noDCUpdatePOs = billableRows.filter((r) => r.reconcileStatus === "no_dc_update").length;
    // Counted from the ITEMS, not from `reconcileStatus`. A PO can owe both a delivery
    // and a challan — PO/218 on Nagarjuna Olive does — and the rollup gives each PO one
    // verdict, so counting by rollup would drop such a PO off this card (it ranks below
    // no_dc_update). Ranking pending_dn higher instead would move it OFF "No DC Update",
    // breaking that card's agreement with the project's DC Pending tile. So this card
    // OVERLAPS the other three rather than partitioning with them, exactly as the
    // Overview page shows DC Pending and DN Pending as two independent tiles.
    // Consequence: the four cards no longer sum to the PO total.
    const pendingDNPOs = billableRows.filter((r) => r.hasDeliveryPending).length;

    return {
      poRows: resultRows,
      summary: {
        totalPOs: billableRows.length,
        matchedPOs,
        mismatchPOs,
        noDCUpdatePOs,
        pendingDNPOs,
      },
    };
  }, [isLoading, poItemData, poDeliveryDocsData, poList]);

  return {
    poRows,
    isLoading,
    error,
    summary,
  };
}
