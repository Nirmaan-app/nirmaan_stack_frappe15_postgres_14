import { useFrappeGetCall } from "frappe-react-sdk";

import type { WarehouseStockRow } from "../config/warehouseStockTable.config";

interface StockApiResponse {
  message: {
    data: WarehouseStockRow[];
    total_count: number;
    aggregates: Record<string, unknown>;
    group_by_result: unknown[];
  };
}

/**
 * Legacy convenience hook — fetches up to 1000 warehouse stock rows for
 * non-paginated consumers (e.g. the RequestFromWarehouse picker).
 *
 * Preserves the existing `{ message: WarehouseStockRow[] }` shape that
 * its callers expect by unwrapping the server envelope. For the paginated
 * DataTable use `useWarehouseStockList` from ./useWarehouseStockList.
 */
export function useWarehouseStock(search: string = "") {
  const response = useFrappeGetCall<StockApiResponse>(
    "nirmaan_stack.api.warehouse.get_warehouse_stock.get_warehouse_stock",
    {
      limit_page_length: 1000,
      search_term: search || undefined,
    },
    `warehouse_stock_all_${search}`
  );

  return {
    ...response,
    data: response.data
      ? { message: response.data.message.data }
      : undefined,
  };
}

export type { WarehouseStockRow };
