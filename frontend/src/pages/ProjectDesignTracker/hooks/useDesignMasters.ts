// frontend/src/pages/DesignTracker/hooks/useDesignMasters.ts

import { useFrappeGetCall } from "frappe-react-sdk";
import { useMemo } from "react";
// Removed DesignPhase import
import { User, Project, MasterDataResponse } from "../types"; 
import { useUsersList } from '@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList';

// Placeholder export (must remain for file compatibility)
export const DESIGN_CATEGORIES: { category_name: string; tasks: { task_name: string }[] }[] = []; 

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
    };
};


// import { useFrappeGetDocList } from "frappe-react-sdk";
// import { useMemo } from "react";
// import { User, Project, DesignPhase } from "../types";
// import { useUsersList } from '@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList';

// // --- STATIC CATEGORY DEFINITION (Per requirement) ---
// export const DESIGN_CATEGORIES = [
//     {
//         "category_name": "Electrical",
//         "tasks": [
//             { "task_name": "Ceiling Raceway Layout" },
//             { "task_name": "Floor Raceway Layout" },
//             { "task_name": "Lighting Layout" }
//         ]
//     },
//     {
//         "category_name": "HVAC",
//         "tasks": [
//             { "task_name": "HVAC Ducting" },
//             { "task_name": "HVAC VRF Layout" },
//             { "task_name": "HVAC Typical Installation" }
//         ]
//     },
//     {
//         "category_name": "Data & Networking",
//         "tasks": [
//             { "task_name": "Access Control Layout" },
//             { "task_name": "CCTV Layout" },
//             { "task_name": "Power & Data Layout" }
//         ]

//     },
//     // Include all categories shown in the "Select Task Categories" modal:
//     { "category_name": "Fire Alarm", "tasks": [] },
//     { "category_name": "CCTV", "tasks": [] },
//     { "category_name": "BMS", "tasks": [] },
// ];

// export const useDesignMasters = () => {
//     // 1. Fetch Projects (assuming you need all or a filtered list)
//     const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Project>(
//         "Projects", { fields: ["name", "project_name"], limit: 0 }
//     );

//     // 2. Fetch Users (re-use hook)
//     const { data: usersList, isLoading: usersLoading, error: usersError } = useUsersList();

//     // 3. Fetch Design Phases
//     // const { data: phasesList, isLoading: phasesLoading, error: phasesError } = useFrappeGetDocList<DesignPhase>(
//     //     "Design Phase", { fields: ["name", "phase_name", "sort_order"], orderBy: { field: "sort_order", order: "asc" }, limit: 0 }
//     // );

//     const projectOptions = useMemo(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
//     // const phaseOptions = useMemo(() => phasesList?.map(p => ({ label: p.phase_name, value: p.name })) || [], [phasesList]);

//     const isLoading = projectsLoading || usersLoading ;
//     const error = projectsError || usersError ;

//     return {
//         projectOptions,
//         usersList,
//         // phasesList,
//         // phaseOptions,
//         isLoading,
//         error,
//         categories: DESIGN_CATEGORIES.map(c => c.category_name),
//         categoryData: DESIGN_CATEGORIES,
//     };
// };