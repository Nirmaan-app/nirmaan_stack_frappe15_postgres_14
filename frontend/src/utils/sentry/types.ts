// Sentry Workflow Types
// Defines the workflow types for consistent error tracking across the application

/**
 * Available workflow types in the application
 * - new-pr: Procurement Request creation/editing/resolution
 * - project-progress-report: Project Progress Report submission
 */
export type WorkflowType = 'new-pr' | 'project-progress-report';

/**
 * Breadcrumb levels for Sentry
 */
export type BreadcrumbLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

/**
 * Workflow error context - additional data to attach to errors
 */
export interface WorkflowErrorContext {
  [key: string]: any;
}

/**
 * Workflow tags - key-value pairs for categorizing errors
 */
export interface WorkflowTags {
  workflow: WorkflowType;
  [key: string]: string;
}

/**
 * Common context fields for PR workflow
 */
export interface PRWorkflowContext {
  project_id?: string;
  pr_id?: string;
  work_package?: string;
  mode?: 'create' | 'edit' | 'resolve';
  item_count?: number;
  category_count?: number;
}

/**
 * Common context fields for Progress Report workflow
 */
export interface ProgressReportWorkflowContext {
  project_id?: string;
  report_id?: string;
  report_date?: string;
  report_status?: 'Draft' | 'Completed';
  active_tab?: string;
  photo_count?: number;
  milestone_count?: number;
}
