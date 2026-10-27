/**
 * Project with aggregated PR package statistics.
 * Returned from backend API: get_projects_with_critical_pr_stats (computed live from the PRs'
 * package rows; PR headers were retired in 2026-10).
 */
export interface ProjectWithCriticalPRStats {
  project: string;               // Project ID (e.g., "PROJ-0001")
  project_name: string;          // Project display name
  status_of_project?: string;    // Project lifecycle status (WIP / Completed / Halted / CEO Hold / Handover)
  total_tags: number;            // Packages that have at least one PR
  released_tags: number;         // Same as total_tags: a package shows only once a PR carries it
  status_counts: PRStatusCounts; // Breakdown by status
  total_enabled_packages: number; // The project's enabled packages, plus any used one not enabled
  used_packages_count: number;
  total_prs: number;
}

/**
 * Status count breakdown
 */
export interface PRStatusCounts {
  "Not Released"?: number;
  "Released"?: number;
}

/**
 * One procurement package of a project and the PRs that carry it.
 * Returned from backend API: get_project_pr_packages.
 */
export interface PRPackageRow {
  package: string;
  prs: string[];
}
