import { useMemo } from "react";
import { useFrappeGetCall } from "@/lib/frappe";
import type { AuditRow, AuditTab, AuditTableRow, AuditView, AuditViewSummary } from "../utils/auditView";

const API = "nirmaan_stack.api.reports.audit_view";

interface AuditDateParams {
  from_date?: string;
  to_date?: string;
}

/** Only the set sides of the range: an omitted date is unbounded on the server. */
const dateParams = (fromDate?: string, toDate?: string): AuditDateParams => ({
  ...(fromDate ? { from_date: fromDate } : {}),
  ...(toDate ? { to_date: toDate } : {}),
});

/**
 * The Audit View's data: the three tab cards' figures (`get_audit_view_summary`) and the rows of the
 * open tab (`get_audit_view_rows`). Dates are "YYYY-MM-DD"; leave one out for no bound (the ALL preset
 * leaves out both). View, tab and dates are in each SWR key, so a change refetches. Both endpoints
 * refuse anyone outside `role_profiles.AUDIT_VIEW_PROFILES`.
 *
 * Nothing is fetched until the user has picked a date range (`enabled`), and no rows until they have
 * picked a tab (`tab` null = none yet). The open tab is fetched first; once it has arrived the view's
 * OTHER tabs are fetched in the background, so switching tabs reads SWR's cache instead of waiting on
 * the server. Orders in Non Project View is never fetched (it has no table).
 */
export const useAuditViewData = (
  view: AuditView,
  tab: AuditTab | null,
  fromDate?: string,
  toDate?: string,
  enabled = true,
) => {
  const params = useMemo(() => dateParams(fromDate, toDate), [fromDate, toDate]);
  const range = `${fromDate ?? "all"}-${toDate ?? "all"}`;

  const summary = useFrappeGetCall<{ message: AuditViewSummary }>(
    `${API}.get_audit_view_summary`,
    { view, ...params },
    enabled ? `audit-view-summary-${view}-${range}` : null,
    { revalidateOnFocus: false },
  );

  // One fetch per tab, always in the same order (hooks); a null key fetches nothing.
  const keyFor = (t: AuditTab, on: boolean) =>
    on && !(view === "nonproject" && t === "orders") ? `audit-view-rows-${view}-${t}-${range}` : null;
  const useTabRows = (t: AuditTab, on: boolean) =>
    useFrappeGetCall<{ message: AuditRow[] }>(`${API}.get_audit_view_rows`, { view, tab: t, ...params }, keyFor(t, enabled && on), {
      revalidateOnFocus: false,
    });

  // With no tab picked, `active` has a null key and fetches nothing (hooks keep their fixed order).
  const active = useTabRows(tab ?? "orders", tab !== null);
  const preload = tab !== null && !!active.data;
  const orders = useTabRows("orders", tab === "orders" || preload);
  const invoices = useTabRows("invoices", tab === "invoices" || preload);
  const payments = useTabRows("payments", tab === "payments" || preload);
  const rows = tab ? { orders, invoices, payments }[tab] : active;

  // The one place the rows are read: each gets its client-side `name` key.
  const tableRows = useMemo<AuditTableRow[] | undefined>(
    () => (tab ? rows.data?.message?.map((r, i) => ({ ...r, name: `${r.against}:${r.id}:${i}` })) : undefined),
    [rows.data, tab],
  );

  return {
    summary: summary.data?.message ?? null,
    isSummaryLoading: summary.isLoading,
    summaryError: summary.error ?? null,
    rows: tableRows,
    isRowsLoading: active.isLoading,
    rowsError: active.error ?? null,
  };
};
