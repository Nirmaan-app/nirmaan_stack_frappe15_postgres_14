import { lazy, Suspense } from "react";

const PurchaseOrder = lazy(() => import("@/pages/ProcurementOrders/purchase-order/PurchaseOrder"));

const POSummary = () => {
  return <Suspense fallback={null}><PurchaseOrder /></Suspense>
};

export const Component = POSummary;
