export const getPOTotal = (order : any, loadingCharges = 0, freightCharges = 0) => {
  let total: number = 0;
  let totalGst = 0;
  let orderData;
  if(typeof order?.order_list === "string") {
    orderData = JSON.parse(order?.order_list)?.list;
  } else {
    orderData = order?.order_list?.list;
  }
  orderData?.map((item) => {
    const price = item.quote;
    const gst = price * item.quantity * (item.tax / 100);

    totalGst += parseFloat(gst || 0);
    total += parseFloat(price || 0) * parseFloat(item.quantity || 1);
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

  orderData?.map((item) => {
    const price = item?.rate;
    const quantity = item?.quantity;
    total += parseFloat(price || 0) * parseFloat(quantity || 1);
  });

  return total;
}

type Payment = { amount: number };

const totalAmountCache = new Map<string, number>();

export const getTotalAmountPaid = (payments: Payment[]): number => {
  if(!payments) {
    return 0;
  }
  const key = JSON.stringify(payments);

  if (totalAmountCache.has(key)) {
    return totalAmountCache.get(key)!;
  }

  let total = 0;
  for (const payment of payments) {
    total += parseFloat(payment?.amount || 0) + parseFloat(payment?.tds || 0);
  }

  totalAmountCache.set(key, total);
  return total;
};
