// frontend/src/pages/DesignTracker/types/index.ts

import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers"; 
import { Projects } from "@/types/NirmaanStack/Projects"; 

// Re-export common types for convenience
export type Project = Projects;
export type User = NirmaanUsers;

// --- NEW: Interface for Designer Object stored in the JSON field ---
export interface AssignedDesignerDetail {
    userId: string;
    userName: string;
    userEmail: string;
}

// --- Child Table: Design Tracker Task (ALIGNED TO SERVER) ---
export interface DesignTrackerTask {
    name: string; // Child row DocName (e.g., 'sv2jh70g8v')
    
    // Core Links/Data (Server Names)
    design_category: string;
    task_name: string;
    task_type?: string;
    task_phase?: string; // "Onboarding" or "Handover"
    deadline?: string;
    
    // JSON/Multi-Select Field: Stores an array of AssignedDesignerDetail objects, 
    // but the field type is JSON/string on the wire.
    assigned_designers?: string; 
    
    // Status & Tracking (Server Names)
    task_status: 'Not Started' | 'Not Applicable' | 'Drawings Awaiting from Client' | 'In Progress' | 'Submitted' | 'Revision Pending' | 'Clarification Awaiting' | 'Approved' | 'Todo' | 'On Hold' | 'Done' | 'Blocked';
    task_sub_status?: string; 
    file_link?: string;
    approval_proof?: string;
    comments?: string;
    
    // Other fields to preserve
    sort_order: number;
    parent?: string;
    doctype?: string;
    [key: string]: any; 
}

// --- Zone Child Table ---
export interface TrackerZone {
    tracker_zone: string;
    name?: string;
}

// --- Parent DocType: Project Design Tracker ---
export interface ProjectDesignTracker {
    name: string;
    project: string;
    project_name: string;
    overall_deadline?: string;
    start_date?: string;
    status: 'Draft' | 'In Progress' | 'Completed' | 'On Hold' | 'Archived';
    creation: string;
    modified: string;
    owner: string;
    design_tracker_task: DesignTrackerTask[];
    zone?: TrackerZone[];
    hide_design_tracker?: 0 | 1;
    handover_generated?: 0 | 1;
}

export interface MasterDataResponse {
    projects: Project[];
    users: User[];
    categories: RawCategoryData[];
    // phases: DesignPhase[]; <-- REMOVED
}

// Task template from category master data
export interface TaskTemplate {
    task_name: string;
    deadline_offset?: number;
}

// Category with tasks from master data
export interface CategoryWithTasks {
    category_name: string;
    tasks: TaskTemplate[];
}

// Raw category data from API
export interface RawCategoryData {
    category_name: string;
    tasks: TaskTemplate[];
}

export const UNASSIGNED_SENTINEL = '__unassigned__';

// ==================== Team Summary Types ====================

// Status count map type
export type StatusCountMap = {
    'Not Started': number;
    'Drawings Awaiting from Client': number;
    'In Progress': number;
    'Submitted': number;
    'Revision Pending': number;
    'Clarification Awaiting': number;
    'Approved': number;
    total: number;
};

// Project-level breakdown
export interface ProjectTaskSummary {
    project_id: string;
    project_name: string;
    tracker_id: string;
    counts: StatusCountMap;
}

// User-level summary with project breakdown
export interface UserTaskSummary {
    user_id: string;
    user_name: string;
    user_email?: string;
    totals: StatusCountMap;
    projects: ProjectTaskSummary[];
}

// API response type
export interface TeamSummaryResponse {
    summary: UserTaskSummary[];
}

// Task preview filter state (extended with deadline context from summary filters)
export interface TaskPreviewFilter {
    user_id: string;
    user_name: string;
    status: string;
    project_id?: string;
    project_name?: string;
    // Inherit filters from summary to ensure inline tasks match summary counts
    projectIds?: string[];     // Multiple projects from filter bar (when no specific project clicked)
    deadlineFrom?: string;
    deadlineTo?: string;
    taskPhase?: string;        // "Onboarding" or "Handover" - phase filter from parent
}

// Inline task expansion state (for TeamPerformanceSummary inline display)
export interface InlineTaskExpansion {
    userId: string;
    userName: string;
    status: string;
    projectId?: string;
    projectName?: string;
}

// Project filter option (for multi-select)
export interface ProjectFilterOption {
    value: string;  // Project ID (e.g., "PROJ-001")
    label: string;  // Project display name
}

// Team Summary filter state
export interface TeamSummaryFilters {
    projects?: ProjectFilterOption[];  // Array of selected projects (multi-select)
    deadlineFrom?: string;             // ISO date string (YYYY-MM-DD)
    deadlineTo?: string;               // ISO date string (YYYY-MM-DD)
}

// Task preview item (for dialog)
export interface TaskPreviewItem {
    name: string;
    task_name: string;
    project_name: string;
    project_id: string;
    tracker_id: string;
    design_category: string;
    task_zone?: string;
    deadline?: string;
    last_submitted?: string;
    task_status: string;
    task_sub_status?: string;
    task_phase?: string; // "Onboarding" or "Handover"
    assigned_designers?: string; // JSON string containing designer IDs
    file_link?: string; // Design file URL (Figma, etc.)
    comments?: string;
    approval_proof?: string; // Approval proof screenshot URL
}