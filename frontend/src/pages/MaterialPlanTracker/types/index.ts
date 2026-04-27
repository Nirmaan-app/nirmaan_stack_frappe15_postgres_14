/**
 * Status counts for material plan - Delivered vs Not Delivered
 */
export interface MaterialPlanStatusCounts {
  "Delivered"?: number;
  "Not Delivered"?: number;
  [key: string]: number | undefined;
}

/**
 * Project with material plan statistics from the API
 */
export interface ProjectWithMaterialPlanStats {
  /** Project document name (e.g., "PROJ-0001") */
  project: string;
  /** Human-readable project name */
  project_name: string;
  /** Project lifecycle status (WIP / Completed / Halted / CEO Hold / Handover / Created) */
  status_of_project?: string;
  /** Total number of material plans */
  total_plans: number;
  /** Counts by status (Delivered / Not Delivered) */
  status_counts: MaterialPlanStatusCounts;
  /** Overall progress percentage (0-100) - based on delivered % */
  overall_progress: number;
  /** Total POs involved */
  total_pos?: number;
  /** Total items planned */
  total_items?: number;
}
