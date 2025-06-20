import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { getPOTotal, getSRTotal } from "@/utils/getAmounts";
import { useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { useMemo } from "react";

export const useOrderTotals = () => {
  const { data: purchaseOrders, isLoading: poLoading, error: poError } = useFrappeGetDocList<ProcurementOrder>(
    'Procurement Orders',
    {
      fields: ['name', "order_list", 'loading_charges', 'freight_charges'],
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
        const { total, totalGst } = getPOTotal(order, order?.loading_charges, order?.freight_charges);
        return { total, totalWithTax: totalGst + total, totalGst };
      }
      if (['Service Requests', 'Service Order'].includes(type)) {
        const order = serviceOrders?.find(i => i?.name === orderId);
        const total = getSRTotal(order);
        const totalWithTax = order?.gst === "true" ? total * 1.18 : total;
        return { total, totalWithTax, totalGst: totalWithTax -  total };
      }
      return { total: 0, totalWithTax: 0, totalGst: 0  };
    },
    (orderId: string, type: string) => orderId + type),[purchaseOrders, serviceOrders]
  );

  return {
    purchaseOrders,
    poLoading,
    poError,
    serviceOrders,
    srLoading,
    srError,
    getTotalAmount,
  };
};
