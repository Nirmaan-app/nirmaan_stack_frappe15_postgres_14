// src/pages/ProjectExpenses/config/projectExpensesUrl.ts
//
// The Project Expenses list's URL keys, in one place: the list reads them, and a link that opens the list
// already filtered (Porter Create's "View the N expenses", #1561) writes them.

/** The route of the list across every project. */
export const PE_LIST_PATH = "/expense/project";

/**
 * URL param key for the active status workflow tab. Namespaced ("pe_status") so it never collides with the
 * project page's own ?tab=/?page= params when this list is embedded as a project tab.
 */
export const PE_STATUS_TAB_PARAM = "pe_status";

/** The list's `useServerDataTable` URL key: one per project scope and status tab. */
export const peListUrlSyncKey = (projectId: string | undefined, statusTab: string): string =>
    `project_expenses_list_${projectId || "all"}_${statusTab.toLowerCase()}`;
