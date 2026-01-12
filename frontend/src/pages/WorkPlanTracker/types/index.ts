/**
 * Status counts for work plan activities
 */
export interface WorkPlanStatusCounts {
  Pending?: number;
  "In Progress"?: number;
  Completed?: number;
  [key: string]: number | undefined;
}

/**
 * Project with work plan statistics from the API
 */
export interface ProjectWithWorkPlanStats {
  /** Project document name (e.g., "PROJ-0001") */
  project: string;
  /** Human-readable project name */
  project_name: string;
  /** Total number of work plan activities */
  total_activities: number;
  /** Counts by status */
  status_counts: WorkPlanStatusCounts;
  /** Overall progress percentage (0-100) */
  overall_progress: number;
}
