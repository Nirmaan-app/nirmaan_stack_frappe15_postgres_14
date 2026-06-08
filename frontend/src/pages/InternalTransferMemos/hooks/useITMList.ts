import { useMemo } from "react";
import type { TableMeta } from "@tanstack/react-table";

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
  statusFilter: ITMStatusFilter;
  urlSyncKey: string;
  meta?: TableMeta<ITMListRow>;
}

export function useITMList({ statusFilter, urlSyncKey, meta }: UseITMListOptions) {
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
    meta,
  });
}
