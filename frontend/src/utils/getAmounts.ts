import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import memoize from "lodash/memoize";
import { parseNumber } from "./parseNumber";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";

// Backend keeps `sr.total_amount` always fresh (computed in validate, includes
// GST when sr.gst === "true"). Frontend should derive both totals from there
// — no client-side reduce over child rows needed.
//
// Item-level functions (standard_rate, est-for-std) still iterate child rows
// because that data isn't denormalized on the parent.

export const getSRTotal = (order: any): number => {
  const totalWithGst = parseNumber(order?.total_amount);
  if (totalWithGst === 0) return 0;
  return order?.gst === "true" ? totalWithGst / 1.18 : totalWithGst;
};

// Sum of standard_rate * qty across SR items. Falls back to rate-card lookup
// (item_name -> rate) when standard_rate is missing on older SR documents.
// Caller must supply work_order_items via `order.work_order_items`.
export const getSRStandardTotal = (
  order: any,
  rateCardByName?: Record<string, number>
): number => {
  const rows: any[] = Array.isArray(order?.work_order_items) ? order.work_order_items : [];
  return rows.reduce((acc, row) => {
    let stdRate = parseNumber(row?.standard_rate);
    if (stdRate <= 0 && rateCardByName) {
      stdRate = parseNumber(rateCardByName[row?.item_name as string]);
    }
    if (stdRate <= 0) return acc;
    const quantity = parseNumber(row?.quantity) || 1;
    return acc + stdRate * quantity;
  }, 0);
};

// Est total (excl. GST) computed ONLY over items that have a std rate — so
// the Diff % is apples-to-apples (custom items with no std are excluded).
export const getSREstForStdItems = (
  order: any,
  rateCardByName?: Record<string, number>
): number => {
  const rows: any[] = Array.isArray(order?.work_order_items) ? order.work_order_items : [];
  return rows.reduce((acc, row) => {
    let stdRate = parseNumber(row?.standard_rate);
    if (stdRate <= 0 && rateCardByName) {
      stdRate = parseNumber(rateCardByName[row?.item_name as string]);
    }
    if (stdRate <= 0) return acc;
    const price = parseNumber(row?.rate);
    const quantity = parseNumber(row?.quantity) || 1;
    return acc + price * quantity;
  }, 0);
};



interface SRTotalResult {
  withGST: number;
  withoutGST: number;
}

// Sums the pre-computed `total_amount` from each SR. `total_amount` already
// includes GST when sr.gst === "true", so withoutGST is derived by removing
// the 18% from those rows only.
export const getAllSRsTotal = memoize(
  (orders: ServiceRequests[]): SRTotalResult => {
    if (!orders?.length) return { withGST: 0, withoutGST: 0 };

    return orders.reduce(
      (totals: SRTotalResult, sr: ServiceRequests) => {
        const totalWithGst = parseNumber(sr?.total_amount);
        const totalWithoutGst = sr?.gst === "true" ? totalWithGst / 1.18 : totalWithGst;
        totals.withGST += totalWithGst;
        totals.withoutGST += totalWithoutGst;
        return totals;
      },
      { withGST: 0, withoutGST: 0 }
    );
  },
  (orders: ServiceRequests[]) => JSON.stringify(orders?.map(s => [s.name, s.total_amount, s.gst]))
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
 * Calculate total approved invoice amount from Vendor Invoices array.
 * This replaces getTotalInvoiceAmount() for the new Vendor Invoices doctype.
 *
 * @param invoices - Array of VendorInvoice documents
 * @returns The total approved invoice amount formatted as a number with 2 decimal places
 *
 * @example
 * const total = getTotalVendorInvoiceAmount(vendorInvoices);
 */
export const getTotalVendorInvoiceAmount = memoize(
  (invoices: VendorInvoice[] | undefined): number => {
    if (!invoices || !Array.isArray(invoices)) return 0;

    // Calculate total with currency-safe operations
    const total = invoices.reduce((acc, invoice) => {
      // Only count approved invoices
      if (invoice?.status !== "Approved") return acc;

      const amount = invoice?.invoice_amount;

      // Handle valid numbers only
      if (Number.isFinite(amount)) {
        // Use currency-safe arithmetic (cents)
        return acc + Math.round(amount * 100);
      }
      return acc;
    }, 0);

    // Convert back to rupees with proper rounding
    return Number((total / 100).toFixed(2));
  },
  (invoices: VendorInvoice[] | undefined) => JSON.stringify(invoices)
);


// --- THIS IS THE NEW, SIMPLIFIED FUNCTION --- its specially for frontend caculation to 
// items [array of cal]
// export const getPreviewTotal = (orderData: PurchaseOrderItem[]): POTotals => {
//   // If there's no order, return zeroed values
//   if (!orderData) {
//     return { grandTotal: 0, totalBase: 0, totalTax: 0 };
//   }

//   // Determine the correct list of items to use

//   // Calculate totals from the items list
//   const totals = orderData?.reduce(
//     (acc, item) => {
//       const rate = parseNumber(item.quote);
//       const quantity = parseNumber(item.quantity);
//       const taxPercent = parseNumber(item.tax);

//       const itemBaseAmount = rate * quantity;
//       const itemTaxAmount = itemBaseAmount * (taxPercent / 100);

//       acc.totalBase += itemBaseAmount;
//       acc.totalTax += itemTaxAmount;

//       return acc;
//     },
//     { totalBase: 0, totalTax: 0 }
//   );

//   // Return the new, clean object. No additional charges are included.
//   return {
//     grandTotal: totals.totalBase + totals.totalTax,
//     totalBase: totals.totalBase,
//     totalTax: totals.totalTax,
//   };
// };

// export const getPOTotal = (order: ProcurementOrder): { total: number, totalGst: number, totalWithTax: number } => {

//   // console.log("orders",orders)
//   // 1. Guard Clause: If the input is not a valid array, or is empty, return zeros.
//   if (!order) {
//     return { total: 0, totalGst: 0, totalWithTax: 0 };
//   }


//   // 2. Directly access the pre-calculated fields from the document, using parseNumber for safety.
//   const total = parseNumber(order.amount);
//   const totalGst = parseNumber(order.tax_amount);
//   const totalWithTax = parseNumber(order.total_amount);

//   // 3. Return the extracted totals.
//   return { total, totalGst, totalWithTax };
// };

// export const getPOSTotals = (order: ProcurementOrder): { total: number, totalGst: number, totalWithTax: number } => {

//   console.log("orders",order)
//   // 1. Guard Clause: If the input is not a valid array, or is empty, return zeros.
//   if (!order) {
//     return { total: 0, totalGst: 0, totalWithTax: 0 };
//   }

//   const totals = order?.reduce(
//     (acc, item) => {
     

//       const itemBaseAmount = parseNumber(item.amount);
//       const itemTaxAmount = parseNumber(item.tax_amount);
//       const totalAmount = parseNumber(item.total_amount);

//       acc.total += itemBaseAmount;
//       acc.totalGst += itemTaxAmount;
//       acc.totalWithTax+= totalAmount;

//       return acc;
//     },
//     { total: 0, totalGst: 0,totalWithTax:0 }
//   );


//   // 2. Directly access the pre-calculated fields from the document, using parseNumber for safety.
  

//   // 3. Return the extracted totals.
//    return {
//     totalWithTax: totals.totalWithTax,
//     total: totals.totalBase,
//     totalGst: totals.totalTax,
//   };
// };

