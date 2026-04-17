import { useMemo } from "react";

import { useServerDataTable } from "@/hooks/useServerDataTable";

import {
  ITM_FETCH_FIELDS,
  ITM_LIST_API_ENDPOINT,
  ITM_SEARCHABLE_FIELDS,
  itmListColumns,
  type ITMListRow,
} from "../config/itmList.config";

export type ITMStatusFilter =
  | ["=", string]
  | ["in", string[]]
  | null;

export interface UseITMListOptions {
  /**
   * Pre-applied `[operator, value]` tuple expanded into a Frappe filter
   * against `status` on every request. `null` loads the full list.
   */
  statusFilter: ITMStatusFilter;
  /**
   * Unique URL state namespace — must differ across the 6 sidebar tabs so
   * each tab retains its own pagination / sort / search in the querystring.
   */
  urlSyncKey: string;
}

/**
 * Thin wrapper that wires `useServerDataTable` to the ITM list endpoint.
 *
 * Callers pass the per-tab status filter; the hook injects it as an
 * `additionalFilters` entry so backend WHERE clauses stay consistent with
 * every other list page in the app. All other state (search, sort,
 * pagination, column filters, export) is delegated to `useServerDataTable`
 * verbatim — see `frontend/.claude/context/data-tables.md` for the contract.
 */
export function useITMList({ statusFilter, urlSyncKey }: UseITMListOptions) {
  const additionalFilters = useMemo(() => {
    if (!statusFilter) return [];
    const [op, value] = statusFilter;
    return [["status", op, value]];
  }, [statusFilter]);

  return useServerDataTable<ITMListRow>({
    doctype: "Internal Transfer Memo",
    apiEndpoint: ITM_LIST_API_ENDPOINT,
    columns: itmListColumns,
    fetchFields: ITM_FETCH_FIELDS as string[],
    searchableFields: ITM_SEARCHABLE_FIELDS,
    urlSyncKey,
    defaultSort: "creation desc",
    additionalFilters,
  });
}
