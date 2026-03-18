// frontend/src/pages/CommissionReport/data/useCommissionMutations.ts

import { useFrappeUpdateDoc, useFrappePostCall, useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeAuth } from 'frappe-react-sdk';
import { useSWRConfig } from "swr";
import { commissionKeys } from './useCommissionQueries';
import { 
    COMMISSION_REPORT_DOCTYPE, 
    COMMISSION_CATEGORY_DOCTYPE, 
    COMMISSION_TASK_MASTER_DOCTYPE 
} from "../commission.constants";
import { captureApiError } from '@/utils/sentry/captureApiError';

/**
 * Hook for creating a new commission tracker
 */
export const useCreateCommissionTracker = () => {
    const { createDoc, loading } = useFrappeCreateDoc();
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const createTracker = async (data: any) => {
        try {
            const result = await createDoc(COMMISSION_REPORT_DOCTYPE, data);
            await mutate(commissionKeys.trackerList());
            return result;
        } catch (error) {
            captureApiError({
                hook: "useCreateCommissionTracker",
                api: "Create Doc",
                feature: "commission-report",
                doctype: COMMISSION_REPORT_DOCTYPE,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { createTracker, loading };
};

/**
 * Hook for updating a commission tracker (parent doc)
 */
export const useUpdateCommissionTracker = () => {
    const { updateDoc, loading } = useFrappeUpdateDoc();
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const updateTracker = async (name: string, data: any) => {
        try {
            const result = await updateDoc(COMMISSION_REPORT_DOCTYPE, name, data);
            await Promise.all([
                mutate(commissionKeys.trackerDoc(name)),
                mutate(commissionKeys.trackerList())
            ]);
            return result;
        } catch (error) {
            captureApiError({
                hook: "useUpdateCommissionTracker",
                api: "Update Doc",
                feature: "commission-report",
                doctype: COMMISSION_REPORT_DOCTYPE,
                entity_id: name,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { updateTracker, loading };
};

/**
 * Hook for updating commission report visibility
 */
export const useToggleCommissionReportVisibility = () => {
    const { updateTracker, loading } = useUpdateCommissionTracker();
    
    const toggleVisibility = async (trackerId: string, isHidden: boolean) => {
        return updateTracker(trackerId, { hide_commission_report: isHidden ? 1 : 0 });
    };

    return { toggleVisibility, loading };
};

/**
 * Hook for renaming a zone
 */
export const useRenameZone = () => {
    const { call, loading } = useFrappePostCall('nirmaan_stack.api.commission_report.rename_zone.rename_zone');
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const renameZone = async (trackerId: string, oldZone: string, newZone: string) => {
        try {
            const result = await call({
                tracker_id: trackerId,
                old_zone_name: oldZone,
                new_zone_name: newZone
            });
            await mutate(commissionKeys.trackerDoc(trackerId));
            return result;
        } catch (error) {
            captureApiError({
                hook: "useRenameZone",
                api: "rename_zone",
                feature: "commission-report",
                entity_id: trackerId,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { renameZone, loading };
};

/**
 * Master Data Mutations: Category
 */
export const useCategoryMutations = () => {
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { call: renameDoc, loading: renameLoading } = useFrappePostCall('frappe.model.rename_doc.update_document_title');
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const createCategory = async (data: any) => {
        try {
            const result = await createDoc(COMMISSION_CATEGORY_DOCTYPE, data);
            await mutate(commissionKeys.categoryList());
            return result;
        } catch (error) {
            captureApiError({
                hook: "useCategoryMutations",
                api: "Create Category",
                feature: "commission-report",
                doctype: COMMISSION_CATEGORY_DOCTYPE,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    const updateCategory = async (name: string, data: any) => {
        try {
            const result = await updateDoc(COMMISSION_CATEGORY_DOCTYPE, name, data);
             await mutate(commissionKeys.categoryList());
            return result;
        } catch (error) {
            captureApiError({
                hook: "useCategoryMutations",
                api: "Update Category",
                feature: "commission-report",
                doctype: COMMISSION_CATEGORY_DOCTYPE,
                entity_id: name,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    const renameCategory = async (oldName: string, newName: string) => {
        try {
            const result = await renameDoc({
                doctype: COMMISSION_CATEGORY_DOCTYPE,
                docname: oldName,
                name: newName,
                merge: 0,
            });
            await mutate(commissionKeys.categoryList());
            return result;
        } catch (error) {
            captureApiError({
                hook: "useCategoryMutations",
                api: "Rename Category",
                feature: "commission-report",
                doctype: COMMISSION_CATEGORY_DOCTYPE,
                entity_id: oldName,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { 
        createCategory, 
        updateCategory, 
        renameCategory, 
        loading: createLoading || updateLoading || renameLoading 
    };
};

/**
 * Master Data Mutations: Tasks
 */
export const useTaskMasterMutations = () => {
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const createTaskMaster = async (data: any) => {
        try {
            const result = await createDoc(COMMISSION_TASK_MASTER_DOCTYPE, data);
            await mutate(commissionKeys.taskList());
            return result;
        } catch (error) {
            captureApiError({
                hook: "useTaskMasterMutations",
                api: "Create Task",
                feature: "commission-report",
                doctype: COMMISSION_TASK_MASTER_DOCTYPE,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    const updateTaskMaster = async (name: string, data: any) => {
        try {
            const result = await updateDoc(COMMISSION_TASK_MASTER_DOCTYPE, name, data);
            await mutate(commissionKeys.taskList());
            return result;
        } catch (error) {
            captureApiError({
                hook: "useTaskMasterMutations",
                api: "Update Task",
                feature: "commission-report",
                doctype: COMMISSION_TASK_MASTER_DOCTYPE,
                entity_id: name,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    const deleteTaskMaster = async (name: string) => {
        try {
            const result = await deleteDoc(COMMISSION_TASK_MASTER_DOCTYPE, name);
            await mutate(commissionKeys.taskList());
            return result;
        } catch (error) {
            captureApiError({
                hook: "useTaskMasterMutations",
                api: "Delete Task",
                feature: "commission-report",
                doctype: COMMISSION_TASK_MASTER_DOCTYPE,
                entity_id: name,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { 
        createTaskMaster, 
        updateTaskMaster, 
        deleteTaskMaster, 
        loading: createLoading || updateLoading || deleteLoading 
    };
};

/**
 * Hook for updating Commission Report child task row directly
 */
export const useUpdateCommissionTaskChild = () => {
    const { updateDoc, loading } = useFrappeUpdateDoc();
    const { currentUser } = useFrappeAuth();

    const updateTaskChild = async (taskRowName: string, data: any) => {
        try {
            return await updateDoc("Commission Report Task Child Table", taskRowName, data);
        } catch (error) {
            captureApiError({
                hook: "useUpdateCommissionTaskChild",
                api: "Update Child Task",
                feature: "commission-report",
                doctype: "Commission Report Task Child Table",
                entity_id: taskRowName,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { updateTaskChild, loading };
};
