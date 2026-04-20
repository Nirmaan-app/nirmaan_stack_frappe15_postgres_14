import { useMemo } from "react";

import { useServerDataTable } from "@/hooks/useServerDataTable";

import {
  ITM_FETCH_FIELDS,
  ITM_LIST_API_ENDPOINT,
  ITR_LIST_API_ENDPOINT,
  ITM_SEARCHABLE_FIELDS,
  ITR_SEARCHABLE_FIELDS,
  itmListColumns,
  getItrListColumns,
  type ITMListRow,
} from "../config/itmList.config";

export type ITMStatusFilter =
  | ["=", string]
  | ["in", string[]]
  | null;

export interface UseITMListOptions {
  statusFilter: ITMStatusFilter;
  urlSyncKey: string;
  doctype?: "Internal Transfer Request" | "Internal Transfer Memo";
  tabValue?: string;
}

export function useITMList({ statusFilter, urlSyncKey, doctype = "Internal Transfer Memo", tabValue = "" }: UseITMListOptions) {
  const additionalFilters = useMemo(() => {
    if (!statusFilter) return [];
    const [op, value] = statusFilter;
    // Special filters like has_pending_items/has_rejected_items use the op as the field name
    if (op === "has_pending_items" || op === "has_rejected_items") {
      return [[op, "=", value]];
    }
    return [["status", op, value]];
  }, [statusFilter]);

  const isITR = doctype === "Internal Transfer Request";

  return useServerDataTable<ITMListRow>({
    doctype,
    apiEndpoint: isITR ? ITR_LIST_API_ENDPOINT : ITM_LIST_API_ENDPOINT,
    columns: isITR ? getItrListColumns(tabValue) : itmListColumns,
    fetchFields: isITR
      ? ["name", "creation", "status", "target_project", "target_project_name", "requested_by", "requested_by_full_name", "memo_count", "total_items", "pending_count", "approved_count", "rejected_count", "total_quantity", "estimated_value"]
      : (ITM_FETCH_FIELDS as string[]),
    searchableFields: isITR ? ITR_SEARCHABLE_FIELDS : ITM_SEARCHABLE_FIELDS,
    urlSyncKey,
    defaultSort: "creation desc",
    additionalFilters,
  });
}
