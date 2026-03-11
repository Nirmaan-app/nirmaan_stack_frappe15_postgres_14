import { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import type {
  InventoryApiRow,
  AggregatedItemRow,
  ProjectItemDetail,
} from "../inventory.types";

export function useInventoryItemWise() {
  const { data, isLoading, error } = useFrappeGetCall<{
    message: InventoryApiRow[];
  }>(
    "nirmaan_stack.api.inventory_item_wise.get_inventory_item_wise_summary"
  );

  const aggregated = useMemo<AggregatedItemRow[]>(() => {
    const rows = data?.message;
    if (!rows?.length) return [];

    const map = new Map<string, AggregatedItemRow>();

    for (const row of rows) {
      let agg = map.get(row.item_id);
      if (!agg) {
        agg = {
          item_id: row.item_id,
          item_name: row.item_name,
          unit: row.unit,
          category: row.category,
          totalRemainingQty: 0,
          totalEstimatedCost: 0,
          projectCount: 0,
          projects: [],
        };
        map.set(row.item_id, agg);
      }

      const detail: ProjectItemDetail = {
        project: row.project,
        project_name: row.project_name,
        report_date: row.report_date,
        remaining_quantity: row.remaining_quantity,
        max_rate: row.max_rate,
        tax: row.tax,
        estimated_cost: row.estimated_cost,
      };

      agg.totalRemainingQty += row.remaining_quantity;
      agg.totalEstimatedCost += row.estimated_cost;
      agg.projectCount += 1;
      agg.projects.push(detail);
    }

    return Array.from(map.values());
  }, [data]);

  return { data: aggregated, isLoading, error };
}
