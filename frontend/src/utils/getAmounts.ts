import { InvoiceDataType, PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { ServiceItemType, ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import memoize from "lodash/memoize";
import { parseNumber } from "./parseNumber";


export const getPOTotal = memoize(
  (
  order: any,
  loadingCharges = 0,
  freightCharges = 0
  ) => {
  if (!order) return { total: 0, totalGst: 0, totalAmt: 0 };

  let orderData: PurchaseOrderItem[] = [];
  if (typeof order.order_list === "string") {
    orderData = JSON.parse(order.order_list)?.list || [];
  } else {
    orderData = order.order_list?.list || [];
  }

  const { total, totalGst } = orderData.reduce(
    (acc, item) => {
      const price = parseNumber(item.quote);
      const quantity = item.quantity || 1;
      const gst = price * quantity * (item.tax / 100);
      return {
        total: acc.total + price * quantity,
        totalGst: acc.totalGst + parseNumber(gst)
      };
    },
    { total: 0, totalGst: 0 }
  );

  const additionalCharges = parseNumber(loadingCharges) + parseNumber(freightCharges);
  const additionalGst =
    parseNumber(loadingCharges) * 0.18 + parseNumber(freightCharges) * 0.18;

  return {
    total: total + additionalCharges,
    totalGst: totalGst + additionalGst,
    totalAmt: total + totalGst + additionalCharges + additionalGst
  };
}, (order : any, loadingCharges = 0, freightCharges = 0) => JSON.stringify(order) + loadingCharges + freightCharges);



export const getSRTotal = memoize(
  (order: any) => {
  let orderData: ServiceItemType[] = [];
  if (typeof order?.service_order_list === "string") {
    orderData = JSON.parse(order.service_order_list)?.list || [];
  } else {
    orderData = order?.service_order_list?.list || [];
  }

  return orderData.reduce((acc, item) => {
    const price = parseNumber(item?.rate);
    const quantity = parseNumber(item?.quantity) || 1;
    return acc + price * quantity;
  }, 0);
}, (order: any) => JSON.stringify(order));



interface SRTotalResult {
  withGST: number;
  withoutGST: number;
}

export const getAllSRsTotal = memoize(
  (orders: ServiceRequests[]): SRTotalResult => {
    if (!orders?.length) return { withGST: 0, withoutGST: 0 };

    return orders.reduce(
      (totals: SRTotalResult, item: ServiceRequests) => {
        const gstMultiplier = item?.gst === "true" ? 1.18 : 1;

        const itemTotal = item?.service_order_list?.list?.reduce(
          (srTotal, i) => {
            const srAmount = parseNumber(i.rate) * parseNumber(i.quantity);
            return srTotal + srAmount;
          },
          0
        ) || 0; // Ensure itemTotal is a number, default to 0 if undefined

        totals.withoutGST += itemTotal;

        if (item?.gst === "true") {
          totals.withGST += (itemTotal * gstMultiplier);
        } else {
          totals.withGST += itemTotal;
        }

        return totals;
      },
      { withGST: 0, withoutGST: 0 }
    );
  },
  (orders: ServiceRequests[]) => JSON.stringify(orders)
);



export const getTotalAmountPaid = memoize(
  (payments: ProjectPayments[]): number => {
    return payments.reduce((acc, payment) => acc + parseNumber(payment?.amount), 0);
  },
  (payments: ProjectPayments[]) => JSON.stringify(payments)
);



export const getTotalInflowAmount = memoize(
  (payments: ProjectInflows[]): number => {
    return payments.reduce((acc, item) => acc + parseNumber(item?.amount), 0);
  },
  (payments: ProjectInflows[]) => JSON.stringify(payments)
);


/**
 * Calculates the total invoice amount from a procurement order's invoice data
 * with currency-safe precision handling and error protection
 * 
 * @param order - The procurement order containing invoice data
 * @returns The total invoice amount formatted as a number with 2 decimal places
 * 
 * @example
 * const total = getTotalInvoiceAmount(procurementOrder);
 */
export const getTotalInvoiceAmount = memoize(
  (data: any): number => {
  if (!data) return 0;
  try {
    let invoiceData: InvoiceDataType
    if (typeof data === "string") {
      invoiceData = JSON.parse(data)?.data || {};
    } else {
      invoiceData = data?.data || {};
    }
    
    const invoiceItems = Object.values(invoiceData);
    if (!Array.isArray(invoiceItems)) return 0;

    // Calculate total with currency-safe operations
    const total = invoiceItems.reduce((acc: number, item) => {
      // Validate item structure
      if (!item || typeof item !== 'object' || item?.status !== "Approved") return acc; 

      const amount = item?.amount
      
      // Handle valid numbers only
      if (Number.isFinite(amount)) {
        // Use currency-safe arithmetic
        const amountInCents = Math.round(amount * 100);
        return acc + amountInCents;
      }
      return acc;
    }, 0);

    // Convert back to dollars with proper rounding
    return Number((total / 100).toFixed(2));
  } catch (error) {
    // Log error and return safe value
    console.error('Error calculating invoice total:', error);
    return 0;
  }
}, (order: any) => JSON.stringify(order));