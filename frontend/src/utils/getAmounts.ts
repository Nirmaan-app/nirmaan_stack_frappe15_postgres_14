import { PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";

export const getPOTotal = (order : any, loadingCharges = 0, freightCharges = 0) => {
  let total: number = 0;
  let totalGst = 0;
  let orderData;
  if(typeof order?.order_list === "string") {
    orderData = JSON.parse(order?.order_list)?.list;
  } else {
    orderData = order?.order_list?.list;
  }
  orderData?.map((item : PurchaseOrderItem) => {
    const price = parseFloat(item.quote);
    const gst = price * parseFloat(item.quantity) * (parseFloat(item.tax) / 100);

    totalGst += (gst || 0);
    total += (price || 0) * parseFloat(item.quantity || "1");
  });

  total += loadingCharges + freightCharges;
  totalGst += loadingCharges * 0.18 + freightCharges * 0.18;

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
    const price = item?.rate;
    const quantity = item?.quantity;
    total += parseFloat(price || 0) * parseFloat(quantity || 1);
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
    total += parseFloat(payment?.amount || "0")
  }

  totalAmountCache.set(key, total);
  return total;
};
