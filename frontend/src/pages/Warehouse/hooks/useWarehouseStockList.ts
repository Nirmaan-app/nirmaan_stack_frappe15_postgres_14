import { useServerDataTable } from "@/hooks/useServerDataTable";

import {
  WAREHOUSE_STOCK_API_ENDPOINT,
  WAREHOUSE_STOCK_FETCH_FIELDS,
  WAREHOUSE_STOCK_SEARCHABLE_FIELDS,
  warehouseStockColumns,
  type WarehouseStockRow,
} from "../config/warehouseStockTable.config";

interface UseWarehouseStockListOptions {
  urlSyncKey?: string;
}

export function useWarehouseStockList({
  urlSyncKey = "warehouse_stock",
}: UseWarehouseStockListOptions = {}) {
  return useServerDataTable<WarehouseStockRow>({
    doctype: "Warehouse Stock Item",
    apiEndpoint: WAREHOUSE_STOCK_API_ENDPOINT,
    columns: warehouseStockColumns,
    fetchFields: WAREHOUSE_STOCK_FETCH_FIELDS as string[],
    searchableFields: WAREHOUSE_STOCK_SEARCHABLE_FIELDS,
    urlSyncKey,
    defaultSort: "item_name asc",
  });
}
