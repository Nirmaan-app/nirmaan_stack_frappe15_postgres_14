import { useServerDataTable } from "@/hooks/useServerDataTable";

import {
  WAREHOUSE_LEDGER_API_ENDPOINT,
  WAREHOUSE_LEDGER_FETCH_FIELDS,
  WAREHOUSE_LEDGER_SEARCHABLE_FIELDS,
  warehouseLedgerColumns,
  type WarehouseLedgerRow,
} from "../config/warehouseLedgerTable.config";

interface UseWarehouseLedgerListOptions {
  urlSyncKey?: string;
}

export function useWarehouseLedgerList({
  urlSyncKey = "warehouse_ledger",
}: UseWarehouseLedgerListOptions = {}) {
  return useServerDataTable<WarehouseLedgerRow>({
    doctype: "Warehouse Stock Item",
    apiEndpoint: WAREHOUSE_LEDGER_API_ENDPOINT,
    columns: warehouseLedgerColumns,
    fetchFields: WAREHOUSE_LEDGER_FETCH_FIELDS as string[],
    searchableFields: WAREHOUSE_LEDGER_SEARCHABLE_FIELDS,
    urlSyncKey,
    defaultSort: "creation desc",
  });
}
