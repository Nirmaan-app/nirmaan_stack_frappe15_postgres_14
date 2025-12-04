// frontend/src/pages/DesignTracker/hooks/useDesignMasters.ts

import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";
import { User, Project, DesignPhase } from "../types";
import { useUsersList } from '@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList';

// --- STATIC CATEGORY DEFINITION (Per requirement) ---
export const DESIGN_CATEGORIES = [
    {
        "category_name": "Electrical",
        "tasks": [
            { "task_name": "Ceiling Raceway Layout" },
            { "task_name": "Floor Raceway Layout" },
            { "task_name": "Lighting Layout" }
        ]
    },
    {
        "category_name": "HVAC",
        "tasks": [
            { "task_name": "HVAC Ducting" },
            { "task_name": "HVAC VRF Layout" },
            { "task_name": "HVAC Typical Installation" }
        ]
    },
    {
        "category_name": "Data & Networking",
        "tasks": [
            { "task_name": "Access Control Layout" },
            { "task_name": "CCTV Layout" },
            { "task_name": "Power & Data Layout" }
        ]
        
    },
    // Include all categories shown in the "Select Task Categories" modal:
    { "category_name": "Fire Alarm", "tasks": [] },
    { "category_name": "CCTV", "tasks": [] },
    { "category_name": "BMS", "tasks": [] },
];

export const useDesignMasters = () => {
    // 1. Fetch Projects (assuming you need all or a filtered list)
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Project>(
        "Projects", { fields: ["name", "project_name"], limit: 0 }
    );

    // 2. Fetch Users (re-use hook)
    const { data: usersList, isLoading: usersLoading, error: usersError } = useUsersList();

    // 3. Fetch Design Phases
    // const { data: phasesList, isLoading: phasesLoading, error: phasesError } = useFrappeGetDocList<DesignPhase>(
    //     "Design Phase", { fields: ["name", "phase_name", "sort_order"], orderBy: { field: "sort_order", order: "asc" }, limit: 0 }
    // );

    const projectOptions = useMemo(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
    // const phaseOptions = useMemo(() => phasesList?.map(p => ({ label: p.phase_name, value: p.name })) || [], [phasesList]);

    const isLoading = projectsLoading || usersLoading ;
    const error = projectsError || usersError ;

    return {
        projectOptions,
        usersList,
        // phasesList,
        // phaseOptions,
        isLoading,
        error,
        categories: DESIGN_CATEGORIES.map(c => c.category_name),
        categoryData: DESIGN_CATEGORIES,
    };
};