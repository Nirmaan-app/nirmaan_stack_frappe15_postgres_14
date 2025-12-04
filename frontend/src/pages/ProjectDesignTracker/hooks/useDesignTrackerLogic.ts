// // frontend/src/pages/DesignTracker/hooks/useDesignTrackerLogic.ts
// import { useState, useEffect, useCallback, useMemo } from 'react';
// import { useFrappeGetDoc, useFrappeUpdateDoc } from 'frappe-react-sdk'; 
// import { toast } from '@/components/ui/use-toast';
// import {
//     ProjectDesignTracker,
//     DesignTrackerTask,
//     User,
// } from '../types';
// import { useDesignMasters } from './useDesignMasters'; 

// const DOCTYPE = 'Project Design Tracker';

// interface UseDesignTrackerLogicProps {
//     trackerId: string;
// }

// interface GroupedTasks {
//     [categoryName: string]: DesignTrackerTask[];
// }

// export interface UseDesignTrackerLogicReturn {
//     // Data
//     trackerDoc: ProjectDesignTracker | undefined;
//     groupedTasks: GroupedTasks;
    
//     // Status/Loading
//     isLoading: boolean;
//     error: Error | null;
    
//     // Master Data Lookups
//     getDesignerName: (userId?: string) => string;
    
//     // Actions
//     handleTaskSave: (taskId: string, updatedFields: Partial<DesignTrackerTask>) => Promise<void>;
//     handleParentDocSave: (updatedFields: Partial<ProjectDesignTracker>) => Promise<void>; // <-- NEW PARENT SAVE ACTION
    
//     // Edit State (used by the component to trigger the modal)
//     editingTask: DesignTrackerTask | null;
//     setEditingTask: (task: DesignTrackerTask | null) => void;
    
//     // Master Data for Modals
//     usersList: User[];
// }

// export const useDesignTrackerLogic = ({ trackerId }: UseDesignTrackerLogicProps): UseDesignTrackerLogicReturn => {
    
//     const [editingTask, setEditingTask] = useState<DesignTrackerTask | null>(null);

//     // --- Data Fetching ---
//     const { data: trackerDoc, isLoading: docLoading, error: docError, mutate: refetchTracker } = useFrappeGetDoc<ProjectDesignTracker>(
//         DOCTYPE, trackerId, trackerId ? undefined : null
//     );

//     // Fetch Master Data (Users)
//     const { usersList: rawUsersList, isLoading: mastersLoading, error: mastersError } = useDesignMasters();
//     const usersList = rawUsersList || [];
    
//     // Hook for updating the parent document
//     const { updateDoc } = useFrappeUpdateDoc(); 

//     // --- Derived Data & Lookups ---
    
//     // 1. Group tasks by Category name
//     const groupedTasks: GroupedTasks = useMemo(() => {
//         if (!trackerDoc?.design_tracker_task) return {};

//         return trackerDoc.design_tracker_task.reduce((acc, task) => {
//             const categoryName = task.design_category || 'Uncategorized';
//             if (!acc[categoryName]) {
//                 acc[categoryName] = [];
//             }
//             acc[categoryName].push(task);
//             return acc;
//         }, {} as GroupedTasks);
//     }, [trackerDoc?.design_tracker_task]);


//     // 2. Lookup function to get full name
//     const getDesignerName = useCallback((userId?: string): string => {
//         if (!userId) return '--';
//         return usersList.find(u => u.name === userId)?.full_name || userId;
//     }, [usersList]);


//     // --- Actions: Parent Document Save ---
//     const handleParentDocSave = useCallback(async (
//         updatedFields: Partial<ProjectDesignTracker>
//     ): Promise<void> => {
//         if (!trackerDoc) {
//             toast({ title: "Error", description: "Tracker document not loaded.", variant: "destructive" });
//             throw new Error("Tracker document not loaded.");
//         }

//         try {
//             // Update the main document fields
//             await updateDoc(DOCTYPE, trackerDoc.name, updatedFields);
            
//             // Refetch data to update the local state and UI
//             await refetchTracker();
            
//             // Success notification (handled in the component that calls this, but we can keep a general one here too)
//             // toast({ title: "Success", description: "Project details updated." });

//         } catch (error) {
//             console.error("Failed to update parent document:", error);
//             // Re-throw the error so the calling component can handle the toast error message
//             throw error;
//         }
//     }, [trackerDoc, updateDoc, refetchTracker]);
    
    
//     // --- Actions: Robust Child Table (Task) Update ---
//     const handleTaskSave = useCallback(async (
//         taskId: string, 
//         updatedFields: Partial<DesignTrackerTask>
//     ): Promise<void> => {
//         if (!trackerDoc) {
//             throw new Error("Tracker document not loaded.");
//         }

//         const taskIndex = trackerDoc.design_tracker_task.findIndex(t => t.name === taskId);
    
//         if (taskIndex === -1) {
//           toast({
//             title: "Error",
//             description: "Target task not found in document structure.",
//             variant: "destructive",
//           });
//           throw new Error("Target task not found in document structure.");
//         }

//         // Create the modified array
//         const updatedTasks = JSON.parse(JSON.stringify(trackerDoc.design_tracker_task));
        
//         // Merge updated fields (which includes the serialized assigned_designers string)
//         updatedTasks[taskIndex] = {
//             ...updatedTasks[taskIndex],
//             ...updatedFields,
//             name: taskId 
//         };

//         const payload = {
//             design_tracker_task: updatedTasks,
//         };

//         try {
//             // Update the document via API
//             await updateDoc(DOCTYPE, trackerDoc.name, payload);
            
//             // Success cleanup
//             await refetchTracker(); 
//             setEditingTask(null); 
//             toast({ title: "Success", description: "Task updated successfully", });

//         } catch (error) {
//             console.error("Failed to update task via parent document:", error);
//             throw error; 
//         }

//     }, [trackerDoc, updateDoc, refetchTracker, setEditingTask]);

//     // --- Status Aggregation ---
//     const isLoading = docLoading || mastersLoading;
//     const error = docError || mastersError;

//     return {
//         trackerDoc,
//         groupedTasks,
//         isLoading,
//         error: error instanceof Error ? error : null,
//         getDesignerName,
//         handleTaskSave,
//         handleParentDocSave, // <-- EXPOSED
//         editingTask,
//         setEditingTask,
//         usersList,
//     };
// };




// frontend/src/pages/DesignTracker/hooks/useDesignTrackerLogic.ts
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFrappeGetDoc, useFrappeUpdateDoc } from 'frappe-react-sdk'; 
import { toast } from '@/components/ui/use-toast';
import {
    ProjectDesignTracker,
    DesignTrackerTask,
    User,
} from '../types';
import { useDesignMasters } from './useDesignMasters'; 

const DOCTYPE = 'Project Design Tracker';

interface UseDesignTrackerLogicProps {
    trackerId: string;
}

interface GroupedTasks {
    [categoryName: string]: DesignTrackerTask[];
}

export interface UseDesignTrackerLogicReturn {
    // Data
    trackerDoc: ProjectDesignTracker | undefined;
    groupedTasks: GroupedTasks;
    
    // Status/Loading
    isLoading: boolean;
    error: Error | null;
    
    // Master Data Lookups
    getDesignerName: (userId?: string) => string;
    
    // Actions
    handleTaskSave: (taskId: string, updatedFields: Partial<DesignTrackerTask>) => Promise<void>;
    handleParentDocSave: (updatedFields: Partial<ProjectDesignTracker>) => Promise<void>;
    handleNewTaskCreation: (newTaskData: Partial<DesignTrackerTask>) => Promise<void>; // <-- NEW ACTION
    
    // Edit State (used by the component to trigger the modal)
    editingTask: DesignTrackerTask | null;
    setEditingTask: (task: DesignTrackerTask | null) => void;
    
    // Master Data for Modals
    usersList: User[];
}

export const useDesignTrackerLogic = ({ trackerId }: UseDesignTrackerLogicProps): UseDesignTrackerLogicReturn => {
    
    const [editingTask, setEditingTask] = useState<DesignTrackerTask | null>(null);

    // --- Data Fetching ---
    const { data: trackerDoc, isLoading: docLoading, error: docError, mutate: refetchTracker } = useFrappeGetDoc<ProjectDesignTracker>(
        DOCTYPE, trackerId, trackerId ? undefined : null
    );

    // Fetch Master Data (Users)
    const { usersList: rawUsersList, categoryData, isLoading: mastersLoading, error: mastersError } = useDesignMasters();
    const usersList = rawUsersList || [];
    
    // Hook for updating the parent document
    const { updateDoc } = useFrappeUpdateDoc(); 

    // --- Derived Data & Lookups ---
    
    // 1. Group tasks by Category name
    const groupedTasks: GroupedTasks = useMemo(() => {
        if (!trackerDoc?.design_tracker_task) return {};

        return trackerDoc.design_tracker_task.reduce((acc, task) => {
            const categoryName = task.design_category || 'Uncategorized';
            if (!acc[categoryName]) {
                acc[categoryName] = [];
            }
            acc[categoryName].push(task);
            return acc;
        }, {} as GroupedTasks);
    }, [trackerDoc?.design_tracker_task]);


    // 2. Lookup function to get full name
    const getDesignerName = useCallback((userId?: string): string => {
        if (!userId) return '--';
        return usersList.find(u => u.name === userId)?.full_name || userId;
    }, [usersList]);


    // --- Actions: Parent Document Save ---
    const handleParentDocSave = useCallback(async (
        updatedFields: Partial<ProjectDesignTracker>
    ): Promise<void> => {
        if (!trackerDoc) {
            toast({ title: "Error", description: "Tracker document not loaded.", variant: "destructive" });
            throw new Error("Tracker document not loaded.");
        }

        try {
            // Update the main document fields
            await updateDoc(DOCTYPE, trackerDoc.name, updatedFields);
            
            // Refetch data to update the local state and UI
            await refetchTracker();
            
        } catch (error) {
            console.error("Failed to update parent document:", error);
            throw error;
        }
    }, [trackerDoc, updateDoc, refetchTracker]);
    
    
    // --- Actions: Robust Child Table (Task) Update ---
    const handleTaskSave = useCallback(async (
        taskId: string, 
        updatedFields: Partial<DesignTrackerTask>
    ): Promise<void> => {
        if (!trackerDoc) {
            throw new Error("Tracker document not loaded.");
        }

        const taskIndex = trackerDoc.design_tracker_task.findIndex(t => t.name === taskId);
    
        if (taskIndex === -1) {
          toast({
            title: "Error",
            description: "Target task not found in document structure.",
            variant: "destructive",
          });
          throw new Error("Target task not found in document structure.");
        }

        // Create the modified array
        const updatedTasks = JSON.parse(JSON.stringify(trackerDoc.design_tracker_task));
        
        // Merge updated fields (which includes the serialized assigned_designers string)
        updatedTasks[taskIndex] = {
            ...updatedTasks[taskIndex],
            ...updatedFields,
            name: taskId 
        };

        const payload = {
            design_tracker_task: updatedTasks,
        };

        try {
            // Update the document via API
            await updateDoc(DOCTYPE, trackerDoc.name, payload);
            
            // Success cleanup
            await refetchTracker(); 
            setEditingTask(null); 
            toast({ title: "Success", description: "Task updated successfully", });

        } catch (error) {
            console.error("Failed to update task via parent document:", error);
            throw error; 
        }

    }, [trackerDoc, updateDoc, refetchTracker, setEditingTask]);

    
    // --- Actions: NEW TASK CREATION ---
    const handleNewTaskCreation = useCallback(async (
        newTaskData: Partial<DesignTrackerTask>
    ): Promise<void> => {
        if (!trackerDoc) {
            throw new Error("Tracker document not loaded.");
        }
        
        // Frappe requires 'name' (child doc name) and 'sort_order' for child table insertions
        const tempName = 'new-task-' + Date.now(); 
        const nextSortOrder = (trackerDoc.design_tracker_task?.length || 0) + 1; 
        console.log("Creating new task with data:", newTaskData);
        // Frappe requires the child row object to contain specific fields for creation
        const newTaskObject: DesignTrackerTask = {
            // Default empty list string
            ...newTaskData as DesignTrackerTask, // Merge payload, overwriting defaults if provided
            // We rely on the caller (NewTaskModal) to pre-serialize assigned_designers if needed
        };
        
        const updatedTasks = [...(trackerDoc.design_tracker_task || []), newTaskObject];
        
        const payload = {
            design_tracker_task: updatedTasks,
        };

        try {
            await updateDoc(DOCTYPE, trackerDoc.name, payload);
            await refetchTracker(); 
        } catch (error) {
            console.error("Failed to create new task via parent document:", error);
            throw error; 
        }

    }, [trackerDoc, updateDoc, refetchTracker]);


    // --- Status Aggregation ---
    const isLoading = docLoading || mastersLoading;
    const error = docError || mastersError;

    return {
        trackerDoc,
        groupedTasks,
        isLoading,
        categoryData,
        error: error instanceof Error ? error : null,
        getDesignerName,
        handleTaskSave,
        handleParentDocSave, 
        handleNewTaskCreation, // <-- EXPOSED
        editingTask,
        setEditingTask,
        usersList,
    };
};