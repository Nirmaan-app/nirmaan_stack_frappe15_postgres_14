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

// Helper function to determine overall PO status for an item
export function determineOverallItemPOStatus(
  poNumbersWithStatus?: { po: string; status: POStatus; }[]
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