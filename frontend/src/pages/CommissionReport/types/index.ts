// frontend/src/pages/CommissionReport/types/index.ts

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

// --- Child Table: Commission Report Task (ALIGNED TO SERVER) ---
export interface CommissionReportTask {
    name: string; // Child row DocName (e.g., 'sv2jh70g8v')

    // Core Links/Data (Server Names)
    commission_category: string;
    task_name: string;
    task_type?: string;
    task_phase?: string; // "Handover"
    deadline?: string;

    // JSON/Multi-Select Field: Stores an array of AssignedDesignerDetail objects, 
    // but the field type is JSON/string on the wire.
    assigned_designers?: string;

    // Status & Tracking (Server Names)
    task_status: 'Not Applicable' | 'Pending' | 'In Progress' | 'Completed';
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

// --- Parent DocType: Project Commission Report ---
export interface ProjectCommissionReportType {
    name: string;
    project: string;
    project_name: string;
    overall_deadline?: string;
    start_date?: string;
    status: string;
    creation: string;
    modified: string;
    owner: string;
    commission_report_task: CommissionReportTask[];
    zone?: TrackerZone[];
    hide_commission_report?: 0 | 1;
    handover_generated?: 0 | 1;
}

export interface MasterDataResponse {
    projects: Project[];
    users: User[];
    categories: RawCategoryData[];
    facetProjects?: any[];
}

// Task template from category master data
export interface TaskTemplate {
    task_name: string;
    deadline_offset?: number;
}

// Raw category data from API
export interface RawCategoryData {
    category_name: string;
    tasks: TaskTemplate[];
}
