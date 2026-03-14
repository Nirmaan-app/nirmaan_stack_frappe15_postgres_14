// frontend/src/pages/CommissionReport/hooks/useCommissionTrackerLogic.ts
import { useState, useCallback } from 'react';
import { useFrappeGetDoc, useFrappeUpdateDoc } from 'frappe-react-sdk';
import { toast } from '@/components/ui/use-toast';
import {
    ProjectCommissionReportType,
    CommissionReportTask,
    User,
} from '../types';
import { useCommissionMasters } from './useCommissionMasters';

const DOCTYPE = 'Project Commission Report';

interface UseCommissionTrackerLogicProps {
    trackerId: string;
}

export interface UseCommissionTrackerLogicReturn {
    trackerDoc: ProjectCommissionReportType | undefined;
    isLoading: boolean;
    error: Error | null;

    handleTaskSave: (taskId: string, updatedFields: Partial<CommissionReportTask>) => Promise<void>;
    handleParentDocSave: (updatedFields: Partial<ProjectCommissionReportType>) => Promise<void>;
    handleNewTaskCreation: (newTaskData: Partial<CommissionReportTask>) => Promise<void>;

    editingTask: CommissionReportTask | null;
    setEditingTask: (task: CommissionReportTask | null) => void;

    usersList: User[];
    categoryData: { category_name: string; tasks: { task_name: string; deadline_offset?: number }[] }[];
    statusOptions: { label: string; value: string }[];

    refetchTracker: () => void;
}

export const useCommissionTrackerLogic = ({ trackerId }: UseCommissionTrackerLogicProps): UseCommissionTrackerLogicReturn => {

    const [editingTask, setEditingTask] = useState<CommissionReportTask | null>(null);

    // --- Data Fetching ---
    const { data: trackerDoc, isLoading: docLoading, error: docError, mutate: refetchTracker } = useFrappeGetDoc<ProjectCommissionReportType>(
        DOCTYPE, trackerId, trackerId ? undefined : null
    );

    const {
        usersList: rawUsersList,
        categoryData,
        statusOptions,
        isLoading: mastersLoading,
        error: mastersError
    } = useCommissionMasters();
    const usersList = rawUsersList || [];

    const { updateDoc } = useFrappeUpdateDoc();

    const handleParentDocSave = useCallback(async (
        updatedFields: Partial<ProjectCommissionReportType>
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
        updatedFields: Partial<CommissionReportTask>
    ): Promise<void> => {
        if (!trackerDoc) {
            throw new Error("Tracker document not loaded.");
        }

        const taskIndex = trackerDoc.commission_report_task.findIndex(t => t.name === taskId);

        if (taskIndex === -1) {
            toast({
                title: "Error",
                description: "Target task not found in document structure.",
                variant: "destructive",
            });
            throw new Error("Target task not found in document structure.");
        }

        // Create the modified array
        const updatedTasks = JSON.parse(JSON.stringify(trackerDoc.commission_report_task));

        // Merge updated fields (which includes the serialized assigned_designers string)
        updatedTasks[taskIndex] = {
            ...updatedTasks[taskIndex],
            ...updatedFields,
            name: taskId
        };

        const payload = {
            commission_report_task: updatedTasks,
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
        newTaskData: Partial<CommissionReportTask>
    ): Promise<void> => {
        if (!trackerDoc) {
            throw new Error("Tracker document not loaded.");
        }

        const newTaskObject: CommissionReportTask = {
            ...newTaskData as CommissionReportTask,
        };

        const updatedTasks = [...(trackerDoc.commission_report_task || []), newTaskObject];

        const payload = {
            commission_report_task: updatedTasks,
        };

        try {
            await updateDoc(DOCTYPE, trackerDoc.name, payload);
            await refetchTracker();
        } catch (error) {
            console.error("Failed to create new task via parent document:", error);
            throw error;
        }

    }, [trackerDoc, updateDoc, refetchTracker]);


    const isLoading = docLoading || mastersLoading;
    const error = docError || mastersError;

    return {
        trackerDoc,
        isLoading,
        categoryData,
        error: error instanceof Error ? error : null,
        handleTaskSave,
        handleParentDocSave,
        handleNewTaskCreation,
        editingTask,
        setEditingTask,
        usersList,
        statusOptions,
        refetchTracker
    };
};
