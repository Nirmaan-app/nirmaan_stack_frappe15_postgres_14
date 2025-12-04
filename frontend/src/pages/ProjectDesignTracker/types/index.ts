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
    deadline?: string; 
    
    // JSON/Multi-Select Field: Stores an array of AssignedDesignerDetail objects, 
    // but the field type is JSON/string on the wire.
    assigned_designers?: string; 
    
    // Status & Tracking (Server Names)
    task_status: 'Todo' | 'In Progress' | 'On Hold' | 'Done' | 'Blocked'; 
    task_sub_status?: string; 
    file_link?: string;
    comments?: string;
    
    // Other fields to preserve
    sort_order: number;
    parent?: string;
    doctype?: string;
    [key: string]: any; 
}

// --- Parent DocType: Project Design Tracker ---
export interface ProjectDesignTracker {
    name: string; 
    project: string; 
    project_name: string; 
    overall_deadline?: string; 
    status: 'Draft' | 'In Progress' | 'Completed' | 'On Hold' | 'Archived';
    creation: string;
    modified: string;
    owner: string;
    design_tracker_task: DesignTrackerTask[];
}

export interface MasterDataResponse {
    projects: Project[];
    users: User[];
    categories: RawCategoryData[];
    // phases: DesignPhase[]; <-- REMOVED
}