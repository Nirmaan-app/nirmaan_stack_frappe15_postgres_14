import { useMemo } from "react";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";
import { PivotData, PivotRow, DNColumn, ADDITIONAL_CHARGES_CATEGORY } from "../components/pivot-table/types";

export function useDeliveryPivotData(
  po: ProcurementOrder | null,
  dnRecords: DeliveryNote[]
): PivotData {
  return useMemo(() => {
    if (!po) return { rows: [], dnColumns: [] };

    // 1. Build DN columns sorted by note_no ascending
    const dnColumns: DNColumn[] = [...dnRecords]
      .sort((a, b) => a.note_no - b.note_no)
      .map((dn) => ({
        dnName: dn.name,
        noteNo: dn.note_no,
        deliveryDate: dn.delivery_date,
        creationDate: dn.creation,
        updatedBy: dn.updated_by_user,
        hasAttachment: !!dn.nirmaan_attachment,
        isReturn: dn.is_return === 1,
      }));

    // 2. Build delivery map: item_id → { dn_name → delivered_quantity }
    const deliveryMap: Record<string, Record<string, number>> = {};
    for (const dn of dnRecords) {
      for (const item of dn.items) {
        if (!deliveryMap[item.item_id]) {
          deliveryMap[item.item_id] = {};
        }
        deliveryMap[item.item_id][dn.name] = item.delivered_quantity;
      }
    }

    // 3. Filter out Additional Charges items (cost add-ons, not physical materials)
    const regularItems = po.items.filter(
      (item) => item.category !== ADDITIONAL_CHARGES_CATEGORY
    );

    // For Partially Dispatched POs, only show items that have been dispatched
    const eligibleItems = po.status === "Partially Dispatched"
      ? regularItems.filter(item => item.is_dispatched === 1)
      : regularItems;

    // 4. Map PO items → PivotRow[]
    const rows: PivotRow[] = eligibleItems.map((item) => {
      const totalReceived = item.received_quantity ?? 0;
      const remainingQty = Math.max(0, item.quantity - totalReceived);

      return {
        itemId: item.name,
        itemItemId: item.item_id,
        itemName: item.item_name,
        unit: item.unit,
        orderedQty: item.quantity,
        dnQuantities: deliveryMap[item.item_id] || {},
        totalReceived,
        remainingQty,
        isFullyDelivered: totalReceived >= item.quantity,
        isOverDelivered: totalReceived > item.quantity,
        comment: item.comment,
        make: item.make,
      };
    });

    // 5. Detect orphaned DN items (in DNs but removed from PO after revision)
    // Use regularItems (not eligibleItems) so undispatched items aren't falsely flagged as orphaned
    const poItemIds = new Set(regularItems.map((item) => item.item_id));

    const orphanMap = new Map<string, {
      itemName: string;
      unit: string;
      make?: string;
      dnQuantities: Record<string, number>;
    }>();

    for (const dn of dnRecords) {
      for (const item of dn.items) {
        if (poItemIds.has(item.item_id)) continue;
        if (item.category === ADDITIONAL_CHARGES_CATEGORY) continue;

        let entry = orphanMap.get(item.item_id);
        if (!entry) {
          entry = {
            itemName: item.item_name,
            unit: item.unit,
            make: item.make,
            dnQuantities: {},
          };
          orphanMap.set(item.item_id, entry);
        }
        entry.dnQuantities[dn.name] = item.delivered_quantity;
      }
    }

    const orphanRows: PivotRow[] = Array.from(orphanMap.entries()).map(
      ([itemId, info]) => {
        const totalReceived = Object.values(info.dnQuantities).reduce(
          (sum, qty) => sum + qty, 0
        );
        return {
          itemId: `orphan-${itemId}`,
          itemItemId: itemId,
          itemName: info.itemName,
          unit: info.unit,
          orderedQty: 0,
          dnQuantities: info.dnQuantities,
          totalReceived,
          remainingQty: 0,
          isFullyDelivered: false,
          isOverDelivered: false,
          make: info.make,
          isOrphaned: true,
        };
      }
    );

    return { rows: [...rows, ...orphanRows], dnColumns };
  }, [po?.items, po?.status, dnRecords]);
}
