// Where "Open PO" goes from the Payments tables (owner, 2026-09-21): the PO list tab its STATUS
// belongs to, so the PO opens with that tab's actions -- not always the read-only project summary.

import { PO_STATUS_TAB } from "@/pages/ProcurementOrders/purchase-order/config/poTabs.constants";

/** Frappe document names carry slashes; the app's routes encode them as `&=`. */
export const routeName = (docName: string) => docName.replace(/\//g, "&=");

/**
 * A bare `/purchase-orders/:id` now opens the PO too (only the two "Approve …" tabs render the
 * PR / Sent Back approval screens); the status tab is still passed, unchanged. A status with no
 * tab of its own (Merged, Cancelled, an amendment, or not loaded yet) opens under its PROJECT,
 * the summary view that renders for every status.
 */
export const poLinkFor = (docName: string, status?: string | null, projectId?: string | null): string => {
  const tab = status ? PO_STATUS_TAB[status] : undefined;
  if (tab) return `/purchase-orders/${routeName(docName)}?${new URLSearchParams({ tab })}`;
  return projectId
    ? `/projects/${projectId}/po/${routeName(docName)}`
    : `/purchase-orders/${routeName(docName)}?tab=Dispatched+PO`;
};

/**
 * Where a PO / WO name in a shared REPORT table links to (owner, 2026-09-28): the section the user
 * is standing in. The same tables render on the Reports page, inside a project (DC & MIR tab) and
 * on payment screens, so the page's own path decides:
 *   - under `/reports`               -> `/reports/po/<PO>`
 *   - under `/projects/<projectId>`  -> `/projects/<projectId>/po/<PO>`
 *   - anywhere else                  -> `/project-payments/<id>` (the payment screens, unchanged)
 * A WO has no report / project route of its own, so there it opens the approved-WO view, as the
 * other WO reports already do.
 */
export const orderDetailPath = (
  docName: string,
  pathname: string,
  projectId?: string | null,
): string => {
  const id = routeName(docName);
  const inReports = pathname === "/reports" || pathname.startsWith("/reports/");
  const inProject = !!projectId && pathname.startsWith(`/projects/${projectId}`);
  if (!inReports && !inProject) return `/project-payments/${id}`;
  if (docName.startsWith("SR-")) return `/service-requests/${id}?tab=approved-sr`;
  return inReports ? `/reports/po/${id}` : `/projects/${projectId}/po/${id}`;
};
