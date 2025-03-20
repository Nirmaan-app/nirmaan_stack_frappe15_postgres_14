import { PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { ServiceItemType } from "@/types/NirmaanStack/ServiceRequests";
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