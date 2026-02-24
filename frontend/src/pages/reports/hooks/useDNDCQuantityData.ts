import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";
import { po_item_data_item } from "@/pages/projects/project";
import { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReconcileStatus = "matched" | "mismatch" | "no_dc_update";

export interface DNDCItemRow {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  orderedQty: number;
  dnQty: number; // from received_quantity
  dcQty: number; // sum of DC item quantities for this PO+item
  difference: number; // dnQty - dcQty
  status: ReconcileStatus;
}

export interface DNDCPORow {
  poNumber: string;
  vendorName: string;
  totalOrderedQty: number;
  totalDNQty: number;
  totalDCQty: number;
  totalDifference: number;
  itemsMatched: number;
  itemsTotal: number;
  reconcileStatus: ReconcileStatus;
  items: DNDCItemRow[];
}

export interface DNDCSummary {
  totalPOs: number;
  matchedPOs: number;
  mismatchPOs: number;
  noDCUpdatePOs: number;
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
      fields: ["name", "status"],
      filters: [
        ["project", "=", projectId],
        ["status", "in", ["Delivered", "Partially Delivered"]],
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

    // 2. Build valid PO set
    const validPOSet = new Set<string>(poList.map((po) => po.name));

    // 3. Merge po_items + custom_items
    const allItems = [
      ...(poItemData.message.po_items ?? []),
      ...(poItemData.message.custom_items ?? []),
    ];

    // 4. Filter to valid POs only
    const filteredItems = allItems.filter((item) => validPOSet.has(item.po_number));

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
      // Only for valid POs
      if (!validPOSet.has(doc.procurement_order)) continue;

      for (const dcItem of doc.items ?? []) {
        const category = dcItem.category ?? "";
        const compositeKey = `${doc.procurement_order}___${category}___${dcItem.item_id}`;
        dcQtyMap.set(compositeKey, (dcQtyMap.get(compositeKey) ?? 0) + dcItem.quantity);

        // Track for orphan detection
        let poItems = dcItemsByPO.get(doc.procurement_order);
        if (!poItems) {
          poItems = new Map();
          dcItemsByPO.set(doc.procurement_order, poItems);
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

        let status: ReconcileStatus;
        if (dnQty === dcQty && dnQty > 0) {
          status = "matched";
        } else if ((dnQty > 0 && dcQty === 0) || (dnQty === 0 && dcQty > 0)) {
          status = "no_dc_update";
        } else {
          status = "mismatch";
        }

        itemRows.push({
          itemId,
          itemName: itemData.itemName,
          category,
          unit: itemData.unit,
          orderedQty: itemData.orderedQty,
          dnQty,
          dcQty,
          difference,
          status,
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
            orderedQty: 0,
            dnQty: 0,
            dcQty: dcData.qty,
            difference: 0 - dcData.qty,
            status: "no_dc_update",
          });
        }
      }

      // 9. Filter zero-activity items
      const activeItems = itemRows.filter(
        (item) => !(item.dnQty === 0 && item.dcQty === 0)
      );

      if (activeItems.length === 0) continue;

      // 10. PO-level status
      const matchedItems = activeItems.filter((i) => i.status === "matched").length;
      const totalDNQty = activeItems.reduce((sum, i) => sum + i.dnQty, 0);
      const totalDCQty = activeItems.reduce((sum, i) => sum + i.dcQty, 0);

      let reconcileStatus: ReconcileStatus;
      if (matchedItems === activeItems.length) {
        reconcileStatus = "matched";
      } else if (totalDNQty > 0 && totalDCQty === 0) {
        reconcileStatus = "no_dc_update";
      } else {
        reconcileStatus = "mismatch";
      }

      resultRows.push({
        poNumber,
        vendorName: poEntry.vendorName,
        totalOrderedQty: activeItems.reduce((sum, i) => sum + i.orderedQty, 0),
        totalDNQty,
        totalDCQty,
        totalDifference: activeItems.reduce((sum, i) => sum + i.difference, 0),
        itemsMatched: matchedItems,
        itemsTotal: activeItems.length,
        reconcileStatus,
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
          orderedQty: 0,
          dnQty: 0,
          dcQty: dcData.qty,
          difference: 0 - dcData.qty,
          status: "no_dc_update",
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
        vendorName: dcDoc?.vendor ?? "",
        totalOrderedQty: 0,
        totalDNQty: 0,
        totalDCQty: activeItems.reduce((sum, i) => sum + i.dcQty, 0),
        totalDifference: activeItems.reduce((sum, i) => sum + i.difference, 0),
        itemsMatched: 0,
        itemsTotal: activeItems.length,
        reconcileStatus: "no_dc_update",
        items: activeItems,
      });
    }

    // 11. Summary
    const matchedPOs = resultRows.filter((r) => r.reconcileStatus === "matched").length;
    const mismatchPOs = resultRows.filter((r) => r.reconcileStatus === "mismatch").length;
    const noDCUpdatePOs = resultRows.filter((r) => r.reconcileStatus === "no_dc_update").length;

    return {
      poRows: resultRows,
      summary: {
        totalPOs: resultRows.length,
        matchedPOs,
        mismatchPOs,
        noDCUpdatePOs,
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
