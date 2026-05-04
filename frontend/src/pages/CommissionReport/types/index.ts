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

    // Wizard-filled report payload (added 2026-05). All four are nullable —
    // a row only has them set after the wizard is submitted at least once.
    response_data?: string;            // JSON string. Parse on read.
    response_snapshot_id?: string;     // SHA-256 docname → Commission Report Template Snapshot
    response_filled_at?: string;       // Datetime ISO
    response_filled_by?: string;       // User id

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
    work_package?: string;
    tasks: TaskTemplate[];
}

// --- NEW: Master Data Interfaces for Commission Packages ---
export interface CommissionCategoryMaster {
    name: string; // Frappe ID
    category_name: string;
    work_package?: string; // Link to Work Packages
    creation?: string;
    modified?: string;
}

export interface CommissionTaskMaster {
    name: string; // Frappe ID
    task_name: string;
    category_link: string; // Link to Commission Report Category
    deadline_offset?: number;
    creation?: string;
    modified?: string;

    // Template-driven wizard fields (added 2026-05)
    source_format?: string;  // JSON template (Long Text). Empty = no wizard.
    is_active?: 0 | 1;       // Soft-delete. Default 1.
}

export interface WorkPackage {
    name: string;
    work_package_name: string;
}
