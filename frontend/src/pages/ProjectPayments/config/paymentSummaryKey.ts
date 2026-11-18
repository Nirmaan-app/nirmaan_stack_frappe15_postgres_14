/**
 * The Payment Summary cards' read (`get_payment_dashboard_stats`) and its SWR key.
 *
 * Kept in its own file so a page can refresh the summary after an action without importing the lazy-loaded
 * `PaymentSummaryCards`. A bare `mutate(PAYMENT_SUMMARY_SWR_KEY)` is NOT enough: SWR re-reads only the hooks on
 * screen, and the cards are not on screen in GST Requests, so they reopened with the figures from before the
 * approval and caught up a second later (browser walk-through, 2026-11-18). The page reads the summary itself and
 * puts it in the cache (`mutate(key, read, { revalidate: false })`, with `useSWRConfig` from "frappe-react-sdk",
 * whose SWR cache is not the app's).
 */
export const PAYMENT_SUMMARY_API = "nirmaan_stack.api.payments.get_project_payment_summary.get_payment_dashboard_stats";
export const PAYMENT_SUMMARY_SWR_KEY = "payment_dashboard_stats_summary";
