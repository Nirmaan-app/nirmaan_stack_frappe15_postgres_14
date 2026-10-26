// src/pages/NonProjectExpenses/config/nonProjectExpensesUrl.ts
//
// The Non-Project Expenses list's URL keys, in one place: the page reads them, and a link that opens the
// list already filtered (Porter Create's "View the N expenses", #1561) writes them.

/** The route of the standalone page. */
export const NPE_LIST_PATH = "/expense/non-project";

/** URL param key for the active status workflow tab (namespaced against the page's date-range params). */
export const NPE_STATUS_TAB_PARAM = "npe_status";

/** The standalone page's `urlContext`; the report embeds it under its own. */
export const NPE_DEFAULT_URL_CONTEXT = "npe_default";

/** The page's `useServerDataTable` URL key for a `urlContext`. */
export const npeListUrlSyncKey = (urlContext: string): string => `npe_${urlContext}`;
