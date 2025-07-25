import { InvoiceDataType, PurchaseOrderItem, POTotals, ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { ServiceItemType, ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import memoize from "lodash/memoize";
import { parseNumber } from "./parseNumber";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";

export const getPOTotal = (order: ProcurementOrder): { total: number, totalGst: number, totalWithTax: number } => {

  // console.log("orders",orders)
  // 1. Guard Clause: If the input is not a valid array, or is empty, return zeros.
  if (!order) {
    return { total: 0, totalGst: 0, totalWithTax: 0 };
  }


  // 2. Directly access the pre-calculated fields from the document, using parseNumber for safety.
  const total = parseNumber(order.amount);
  const totalGst = parseNumber(order.tax_amount);
  const totalWithTax = parseNumber(order.total_amount);

  // 3. Return the extracted totals.
  return { total, totalGst, totalWithTax };
};

export const getPOSTotals = (order: ProcurementOrder): { total: number, totalGst: number, totalWithTax: number } => {

  // console.log("orders",orders)
  // 1. Guard Clause: If the input is not a valid array, or is empty, return zeros.
  if (!order) {
    return { total: 0, totalGst: 0, totalWithTax: 0 };
  }

  const totals = order?.reduce(
    (acc, item) => {
     

      const itemBaseAmount = parseNumber(item.amount);
      const itemTaxAmount = parseNumber(item.tax_amount);
      const totalAmount = parseNumber(item.total_amount);

      acc.total += itemBaseAmount;
      acc.totalGst += itemTaxAmount;
      acc.totalWithTax+= totalAmount;

      return acc;
    },
    { total: 0, totalGst: 0,totalWithTax:0 }
  );


  // 2. Directly access the pre-calculated fields from the document, using parseNumber for safety.
  

  // 3. Return the extracted totals.
   return {
    totalWithTax: totals.totalWithTax,
    total: totals.totalBase,
    totalGst: totals.totalTax,
  };
};



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

export const getTotalExpensePaid = memoize(
  (payments: ProjectExpenses[]): number => {
    return payments.reduce((acc, payment) => acc + parseNumber(payment?.amount), 0);
  },
  (payments: ProjectExpenses[]) => JSON.stringify(payments)
);



export const getTotalInflowAmount = memoize(
  (payments: ProjectInflows[]): number => {
    return payments.reduce((acc, item) => acc + parseNumber(item?.amount), 0);
  },
  (payments: ProjectInflows[]) => JSON.stringify(payments)
);

export const getTotalProjectInvoiceAmount = memoize(
  (payments: ProjectInvoice[]): number => {
    return payments.reduce((acc, item) => acc + parseNumber(item?.amount), 0);
  },
  (payments: ProjectInvoice[]) => JSON.stringify(payments)
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


// --- THIS IS THE NEW, SIMPLIFIED FUNCTION --- its specially for frontend caculation to 
// items [array of cal]
export const getPreviewTotal = (orderData: PurchaseOrderItem[]): POTotals => {
  // If there's no order, return zeroed values
  if (!orderData) {
    return { grandTotal: 0, totalBase: 0, totalTax: 0 };
  }

  // Determine the correct list of items to use

  // Calculate totals from the items list
  const totals = orderData?.reduce(
    (acc, item) => {
      const rate = parseNumber(item.quote);
      const quantity = parseNumber(item.quantity);
      const taxPercent = parseNumber(item.tax);

      const itemBaseAmount = rate * quantity;
      const itemTaxAmount = itemBaseAmount * (taxPercent / 100);

      acc.totalBase += itemBaseAmount;
      acc.totalTax += itemTaxAmount;

      return acc;
    },
    { totalBase: 0, totalTax: 0 }
  );

  // Return the new, clean object. No additional charges are included.
  return {
    grandTotal: totals.totalBase + totals.totalTax,
    totalBase: totals.totalBase,
    totalTax: totals.totalTax,
  };
};