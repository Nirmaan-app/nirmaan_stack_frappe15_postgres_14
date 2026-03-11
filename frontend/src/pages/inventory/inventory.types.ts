export interface InventoryApiRow {
  project: string;
  project_name: string;
  report_date: string;
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  remaining_quantity: number;
  max_rate: number;
  tax: number;
  estimated_cost: number;
}

export interface ProjectItemDetail {
  project: string;
  project_name: string;
  report_date: string;
  remaining_quantity: number;
  max_rate: number;
  tax: number;
  estimated_cost: number;
}

export interface AggregatedItemRow {
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  totalRemainingQty: number;
  totalEstimatedCost: number;
  projectCount: number;
  projects: ProjectItemDetail[];
}
