import { PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { parseNumber } from "./parseNumber";

export const getPOTotal = (order : any, loadingCharges = 0, freightCharges = 0) => {
  if(!order) return {total : 0, totalGst: 0, totalAmt: 0};
  let total: number = 0;
  let totalGst = 0;
  let orderData;
  if(typeof order?.order_list === "string") {
    orderData = JSON.parse(order?.order_list)?.list;
  } else {
    orderData = order?.order_list?.list;
  }
  orderData?.map((item : PurchaseOrderItem) => {
    const price = item.quote;
    const gst = price * item.quantity * (item.tax / 100);

    totalGst += parseNumber(gst);
    total += parseNumber(price) * (item.quantity || 1);
  });

  total += parseNumber(loadingCharges) + parseNumber(freightCharges);
  totalGst += parseNumber(loadingCharges * 0.18) + parseNumber(freightCharges * 0.18);

  return { total, totalGst: totalGst, totalAmt: total + totalGst };
};

export const getSRTotal = (order: any) => {
  let total = 0;
  let orderData;
  if(typeof order?.service_order_list === "string") {
    orderData = JSON.parse(order?.service_order_list)?.list;
  } else {
    orderData = order?.service_order_list?.list;
  }

  orderData?.map((item : any) => {
    const price = parseNumber(item?.rate);
    const quantity = parseNumber(item?.quantity);
    total += price * (quantity || 1);
  });

  return total;
}

const totalAmountCache = new Map<string, number>();

export const getTotalAmountPaid = (payments: ProjectPayments[]): number => {
  if(!payments) {
    return 0;
  }
  const key = JSON.stringify(payments);

  if (totalAmountCache.has(key)) {
    return totalAmountCache.get(key)!;
  }

  let total = 0;
  for (const payment of payments) {
    total += parseNumber(payment?.amount)
  }

  totalAmountCache.set(key, total);
  return total;
};
