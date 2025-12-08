// frontend/src/pages/DesignTracker/hooks/useDesignMasters.ts

import { useFrappeGetCall } from "frappe-react-sdk";
import { useMemo } from "react";
// Removed DesignPhase import
import { User, Project, MasterDataResponse } from "../types"; 
import { useUsersList } from '@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList';

// Placeholder export (must remain for file compatibility)
export const DESIGN_CATEGORIES: { category_name: string; tasks: { task_name: string }[] }[] = []; 

// --- NEW CONSTANTS FOR STATUS/SUB-STATUS --- // 🎯 ADDED
export const TASK_STATUS_OPTIONS = [
    { label: "Not Applicable", value: "Not Applicable" },
    { label: "Not Started", value: "Not Started" },
    { label: "Drawings Awaiting", value: "Drawings Awaiting" },
    { label: "In Progress", value: "In Progress" },
    { label: "Completed", value: "Completed" },
    { label: "Submitted", value: "Submitted" },
    { label: "Revision Pending", value: "Revision Pending" },
    { label: "On Hold", value: "On Hold" },
    { label: "Approved", value: "Approved" },
];

// Define the hierarchy/list for sub-statuses
export const SUB_STATUS_OPTIONS = [
    //  { label: "-- None --", value: "" },
    { label: "Sub-Status 1", value: "Sub-Status 1" },
    { label: "Sub-Status 2", value: "Sub-Status 2" },
    { label: "Clarification from client", value: "Clarification from client" },
    { label: "Clarification from Shanu", value: "Clarification from Shanu" },
];

export const SUB_STATUS_MAP = {
    "Completed": [
        "Sub-Status 1", 
        "Sub-Status 2"
    ],
    "On Hold": [
        "Clarification from client", 
        "Clarification from Shanu"
    ],
};

export const useDesignMasters = () => {
    
    // --- Single API Call to Fetch All Master Data ---
        // NOTE: Changed app path to match the new structure in the Python file
            // NOTE: Changed app path to match the new structure in the Python file
        const {  data: response, 
        isLoading: masterLoading, 
        error: masterError  } = useFrappeGetCall<MasterDataResponse[]>(
            "nirmaan_stack.api.design_tracker.tracker_options.get_all_master_data",
            []
        );


    // const { 
    //     data: response, 
    //     isLoading: masterLoading, 
    //     error: masterError 
    // } = useFrappeGetCall<MasterDataResponse>({
    //     "nirmaan_stack.design_tracker.tracker_options.get_all_master_data", 
    //     freeze: true,
    // });
    
    // FrappeCall data is stored in 'message'
    const masterData = response?.message; 

    // --- 1. Projects (Transformation) ---
    const projects: Project[] = masterData?.projects || [];
    const projectOptions = useMemo(() => 
        projects.map(p => ({ label: p.project_name, value: p.name }))
    , [projects]);

    // --- 2. Users ---
    const usersList: User[] = masterData?.users || [];

    const FacetProjectsOptions:Projects[]=masterData?.facetProjects?.map(projectArray => {
    // Step 2: Destructure the inner array into meaningful variables
    const [id, name] = projectArray;

    // Step 3: Return a new object in the desired format
    return {
        value: id,
        label: name
    };
});
    
    // --- 3. Categories (Transformation) ---
    const rawCategories = masterData?.categories || [];
    
    const categoryData = useMemo(() => {
        // The API provides objects structured as { category_name, tasks: [...] }
        return rawCategories.map(cat => ({
            category_name: cat.category_name,
            tasks: cat.tasks.map(t => ({ 
                task_name: t.task_name 
            })) 
        }));
    }, [rawCategories]);


    const isLoading = masterLoading;
    const error = masterError;

    return {
        projectOptions,
        usersList,
        // phasesList, <-- REMOVED
        // phaseOptions, <-- REMOVED
        isLoading,
        error,
        categories: rawCategories.map(c => c.category_name), 
        categoryData: categoryData,
        // 🎯 RETURN NEW STATUS/SUB-STATUS OPTIONS
        statusOptions: TASK_STATUS_OPTIONS,
        subStatusOptions: SUB_STATUS_OPTIONS,
        FacetProjectsOptions:FacetProjectsOptions
    };
};

