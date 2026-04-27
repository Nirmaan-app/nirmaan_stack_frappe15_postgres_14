/**
 * Local types for the Create ITM flow.
 *
 * Selection is organized by source_project → item_id → { qty + snapshot metadata }
 * so grouping by source_project in the preview dialog is a cheap Object.entries.
 */

export interface InventoryPickerSource {
  source_project: string;
  source_project_name: string;
  /**
   * Make stamped on the source's RIR row (auto-derived from the latest PO at
   * RIR submit time). NULL when no PO exists yet for this (project, item).
   */
  make: string | null;
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
  /**
   * One entry per `(source_project, make)` bucket. Distinct makes for the
   * same item are kept as separate sources here; the parent row in the UI
   * clubs them and shows a badge indicating how many makes are inside.
   */
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
  /** Make of the (project, item) bucket the user picked from. */
  make: string | null;
  source_project_name: string;
}

/**
 * Selection state keyed by source -> "${item_id}|${make ?? ""}" so that
 * distinct makes of the same item under the same source remain independent
 * selections. With one-make-per-(project, item) on RIR today this collapses
 * to one entry per item, but the key shape is forward-compatible if a project
 * ever ends up with multiple makes for the same item.
 */
export type SelectionState = Record<string, Record<string, ItemSelection>>;

export interface CreateItmsPayloadSelection {
  item_id: string;
  source_project: string;
  source_type?: "Project" | "Warehouse";
  transfer_quantity: number;
  /**
   * Make of the (item, source) bucket being transferred. For warehouse sources
   * it identifies the (item, make) WSI row; for project sources it identifies
   * the RIR row's make.
   */
  make?: string | null;
}

export type TargetType = "Project" | "Warehouse";
