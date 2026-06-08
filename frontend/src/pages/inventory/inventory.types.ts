export interface InventoryApiRow {
  project: string;
  project_name: string;
  report_date: string;
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  make: string | null;
  remaining_quantity: number;
  max_rate: number;
  tax: number;
  estimated_cost: number;
  po_numbers: string[];
}

export interface ProjectItemDetail {
  project: string;
  project_name: string;
  report_date: string;
  /** Make stamped on this project's RIR row for the item (auto-derived from latest PO). */
  make: string | null;
  remaining_quantity: number;
  max_rate: number;
  tax: number;
  estimated_cost: number;
  po_numbers: string[];
}

export interface AggregatedItemRow {
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  billingCategory: string;
  /** Distinct non-empty makes seen across this item's projects — drives the
   * Make badge on the parent row. Empty array means no make set anywhere. */
  distinctMakes: string[];
  totalRemainingQty: number;
  totalEstimatedCost: number;
  projectCount: number;
  allPONumbers: string[];
  projects: ProjectItemDetail[];
}

/** Per-item breakdown inside a project-wise row — mirror of ProjectItemDetail
 * but keyed from the item side so each entry carries its item identity. */
export interface ItemInProjectDetail {
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  billingCategory: string;
  make: string | null;
  remaining_quantity: number;
  max_rate: number;
  tax: number;
  estimated_cost: number;
  po_numbers: string[];
}

export interface AggregatedProjectRow {
  project: string;
  project_name: string;
  itemCount: number;
  totalRemainingQty: number;
  totalEstimatedCost: number;
  /** Distinct non-empty makes across this project's items. */
  distinctMakes: string[];
  /** Distinct non-empty categories across this project's items. */
  distinctCategories: string[];
  allPONumbers: string[];
  items: ItemInProjectDetail[];
}
