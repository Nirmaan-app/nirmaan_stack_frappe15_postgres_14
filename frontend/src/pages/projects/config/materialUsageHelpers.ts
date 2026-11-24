import { DeliveryStatus, POStatus } from "../components/ProjectMaterialUsageTab";

// Helper function to determine delivery status
export function determineDeliveryStatus(deliveredQuantity: number, orderedQuantity: number) : { deliveryStatusVariant: "success" | "warning" | "destructive" | "default", deliveryStatusText: DeliveryStatus } {
  const deliveryPercentage = orderedQuantity > 0
    ? (deliveredQuantity / orderedQuantity) * 100
    : deliveredQuantity > 0 ? 100 : 0;

  const deliveryStatusVariant: "success" | "warning" | "destructive" | "default" =
    deliveredQuantity >= orderedQuantity && orderedQuantity > 0 ? "success"
    : deliveryPercentage > 0 ? "warning"
    : orderedQuantity > 0 ? "destructive"
    : "default";
    
  const deliveryStatusText =
    deliveryStatusVariant === "success" ? "Fully Delivered"
    : deliveryStatusVariant === "warning" ? "Partially Delivered"
    : deliveryStatusVariant === "destructive" ? "Pending Delivery"
    : "Not Ordered";

  return { deliveryStatusVariant, deliveryStatusText };
}

// Helper function to determine overall paid status for an item, across its POs and incoming ITMs
export function determineOverallItemPOStatus(
  poNumbersWithStatus?: { status: POStatus; }[]
): "Fully Paid" | "Partially Paid" | "Unpaid" | "N/A" {
  if (!poNumbersWithStatus || poNumbersWithStatus.length === 0) {
    return "N/A";
  }

  const totalPOs = poNumbersWithStatus.length;
  let fullyPaidCount = 0;
  let partiallyPaidCount = 0;
  let notPaidCount = 0;

  for (const po of poNumbersWithStatus) {
    if (po.status === "Fully Paid") {
      fullyPaidCount++;
    } else if (po.status === "Partially Paid") {
      partiallyPaidCount++;
    } else {
      notPaidCount++;
    }
  }

  if (fullyPaidCount === totalPOs) {
    return "Fully Paid";
  }
  if (notPaidCount === totalPOs) {
    return "Unpaid";
  }
  
  if (fullyPaidCount > 0 || partiallyPaidCount > 0) {
    return "Partially Paid";
  }
  
  return "Unpaid";
}
/** The per-ITM fields of `get_transfer_summary`'s `itms` that say where an ITM came from and what arrived. */
export interface ItmSourceLine {
  itm: string;
  /** "Project" or "Warehouse"; a Warehouse ITM has no source project. */
  source_type?: string | null;
  source_project_name?: string | null;
  received_qty?: number | null;
}

/** Where an ITM's material comes from, shown as "From <source>": its source project, or "Warehouse". */
export const itmSourceName = (i: ItmSourceLine): string =>
  i.source_project_name || (i.source_type === "Warehouse" ? "Warehouse" : "");

/**
 * Lookups for listing ITM-filed DCs / MIRs beside the PO ones (DC Wise / MIR Wise), from the transfer summary
 * keyed by item id:
 * - `receivedQty`: "<itm>_<itemId>" -> what that ITM delivered of that item (its DN Qty, as a PO row shows
 *   the PO's received quantity);
 * - `fromLabel`: itm -> "From <source project>" / "From Warehouse" (its Vendor cell); "" when unknown.
 */
export function itmDeliveryLookups(summary: Record<string, { itms?: ItmSourceLine[] }>): {
  receivedQty: Map<string, number>;
  fromLabel: Map<string, string>;
} {
  const receivedQty = new Map<string, number>();
  const fromLabel = new Map<string, string>();
  for (const [itemId, itemData] of Object.entries(summary)) {
    for (const line of itemData.itms || []) {
      const key = `${line.itm}_${itemId}`;
      receivedQty.set(key, (receivedQty.get(key) || 0) + (line.received_qty || 0));
      if (!fromLabel.has(line.itm)) {
        const source = itmSourceName(line);
        fromLabel.set(line.itm, source ? `From ${source}` : "");
      }
    }
  }
  return { receivedQty, fromLabel };
}
