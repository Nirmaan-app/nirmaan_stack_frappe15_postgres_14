/**
 * Project with aggregated Critical PO Task statistics
 * Returned from backend API: get_projects_with_critical_po_stats
 */
export interface ProjectWithCriticalPOStats {
  project: string;               // Project ID (e.g., "PROJ-0001")
  project_name: string;          // Project display name
  total_tasks: number;           // Total tasks excluding "Not Applicable"
  released_tasks: number;        // Count of "Released" status
  status_counts: StatusCounts;   // Breakdown by status
}

/**
 * Status count breakdown for Critical PO Tasks
 */
export interface StatusCounts {
  "Not Released"?: number;
  "Partially Released"?: number;
  "Released"?: number;
}

/**
 * Valid status values for Critical PO Tasks
 */
export type CriticalPOTaskStatus =
  | "Not Released"
  | "Partially Released"
  | "Released"
  | "Not Applicable";
