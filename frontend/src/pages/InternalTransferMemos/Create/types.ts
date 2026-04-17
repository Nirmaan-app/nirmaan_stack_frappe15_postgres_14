/**
 * Local types for the Create ITM flow.
 *
 * Selection is organized by source_project → item_id → { qty + snapshot metadata }
 * so grouping by source_project in the preview dialog is a cheap Object.entries.
 */

export interface InventoryPickerSource {
  source_project: string;
  source_project_name: string;
  remaining_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  estimated_rate: number;
  estimated_cost: number;
  po_refs: string[];
  latest_rir: string;
}

export interface InventoryPickerItem {
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  projects_count: number;
  pos_count: number;
  total_remaining_qty: number;
  total_estimated_cost: number;
  sources: InventoryPickerSource[];
}

export interface ItemSelection {
  qty: number;
  estimated_rate: number;
  available_quantity: number;
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  source_project_name: string;
}

/** source_project -> item_id -> selection */
export type SelectionState = Record<string, Record<string, ItemSelection>>;

export interface CreateItmsPayloadSelection {
  item_id: string;
  source_project: string;
  transfer_quantity: number;
}
