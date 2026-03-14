/**
 * Project with aggregated Critical PR Tag statistics
 * Returned from backend API: get_projects_with_critical_pr_stats
 */
export interface ProjectWithCriticalPRStats {
  project: string;               // Project ID (e.g., "PROJ-0001")
  project_name: string;          // Project display name
  total_tags: number;           // Total tags
  released_tags: number;        // Count of "Released" tags (those with associated PRs)
  status_counts: PRStatusCounts; // Breakdown by status
}

/**
 * Status count breakdown for Critical PR Tags
 */
export interface PRStatusCounts {
  "Not Released"?: number;
  "Released"?: number;
}

/**
 * Individual Critical PR Tag record
 */
export interface CriticalPRTag {
  name: string;
  project: string;
  projectname: string;
  header: string;
  package: string;
  associated_prs: string | { prs: string[] };
}
