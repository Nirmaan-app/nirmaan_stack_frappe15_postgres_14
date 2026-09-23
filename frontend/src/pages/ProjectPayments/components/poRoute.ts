// Where "Open PO" goes from the Payments tables (owner, 2026-09-21): the PO list tab its STATUS
// belongs to, so the PO opens with that tab's actions -- not always the read-only project summary.

import { PO_TABS } from "@/pages/ProcurementOrders/purchase-order/config/poTabs.constants";

/** A PO status -> the list tab that holds it. Mirrors `PO_COMMON_TAB_OPTIONS`' count keys. */
const PO_STATUS_TAB: Record<string, string> = {
  "PO Approved": PO_TABS.APPROVED_PO,
  "Partially Dispatched": PO_TABS.PARTIALLY_DISPATCHED_PO,
  "Dispatched": PO_TABS.DISPATCHED_PO,
  "Partially Delivered": PO_TABS.PARTIALLY_DELIVERED_PO,
  "Delivered": PO_TABS.DELIVERED_PO,
};

/** Frappe document names carry slashes; the app's routes encode them as `&=`. */
export const routeName = (docName: string) => docName.replace(/\//g, "&=");

/**
 * ⚠️ NEVER a bare `/purchase-orders/:id` with no `tab`: that falls back to "Approve PO", the PR
 * vendor-quote approval screen, which 404s looking the PO id up as a Procurement Request. A status
 * with no tab of its own (Merged, Cancelled, an amendment, or not loaded yet) opens under its
 * PROJECT, the summary view that renders for every status.
 */
export const poLinkFor = (docName: string, status?: string | null, projectId?: string | null): string => {
  const tab = status ? PO_STATUS_TAB[status] : undefined;
  if (tab) return `/purchase-orders/${routeName(docName)}?${new URLSearchParams({ tab })}`;
  return projectId
    ? `/projects/${projectId}/po/${routeName(docName)}`
    : `/purchase-orders/${routeName(docName)}?tab=Dispatched+PO`;
};
