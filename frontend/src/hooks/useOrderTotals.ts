import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { getPOTotal, getSRTotal } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { useMemo } from "react";

export const useOrderTotals = () => {
  const { data: purchaseOrders, isLoading: poLoading, error: poError } = useFrappeGetDocList<ProcurementOrder>(
    'Procurement Orders',
    {
      fields: ['name', "amount", "total_amount", "tax_amount", "po_amount_delivered"],
      filters: [['status', 'not in', ['Cancelled', 'Merged']]],
      limit: 0,
      orderBy: { field: 'modified', order: 'desc' },
    },
    "All_POs_for_order_totals"
  );

  const { data: serviceOrders, isLoading: srLoading, error: srError } = useFrappeGetDocList<ServiceRequests>(
    'Service Requests',
    {
      fields: ['name', 'service_order_list', 'gst'],
      // filters: [['status', '=', 'Approved']],
      limit: 0,
      orderBy: { field: 'modified', order: 'desc' },
    },
    "All_SRs_for_order_totals"
  );

  const getTotalAmount = useMemo(
    () => memoize((orderId: string, type: string) => {
      if (['Procurement Orders', 'Purchase Order'].includes(type)) {
        const order = purchaseOrders?.find(i => i?.name === orderId);
        // --- (FIXED) Directly return the result of the corrected getPOTotal ---
        // The new getPOTotal already returns the object in the desired shape.
        // console.log("getPOTotal", orderId, type, order);
        return getPOTotal(order);
      }
      if (['Service Requests', 'Service Order'].includes(type)) {
        const order = serviceOrders?.find(i => i?.name === orderId);
        const total = getSRTotal(order);
        const totalWithTax = order?.gst === "true" ? total * 1.18 : total;
        return { total, totalWithTax, totalGst: totalWithTax - total };
      }
      return { total: 0, totalWithTax: 0, totalGst: 0 };
    },
      (orderId: string, type: string) => orderId + type), [purchaseOrders, serviceOrders]
  );

  // --- (THE FIX) Create a new memoized getter for the delivered amount ---
  const getDeliveredAmount = useMemo(
    () => memoize((orderId: string, type: string): number => {
      if (['Procurement Orders'].includes(type)) {
        const order = purchaseOrders?.find(i => i?.name === orderId);
        // console.log("getDeliveredAmount", orderId, type, order);
        // Directly return the pre-calculated value from the document
        return order?.po_amount_delivered
      }
      // Return 0 for other doctypes like Service Requests
      return 0;
    },
      (orderId: string, type: string) => `${orderId}-${type}`), // Unique cache key
    [purchaseOrders]
  );

  return {
    purchaseOrders,
    poLoading,
    poError,
    serviceOrders,
    srLoading,
    srError,
    getTotalAmount,
    getDeliveredAmount, // --- (THE FIX) Expose the new function ---
  };
};
