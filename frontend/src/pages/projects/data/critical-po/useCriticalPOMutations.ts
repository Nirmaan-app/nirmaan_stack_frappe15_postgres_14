import {
    useFrappeCreateDoc,
    useFrappeUpdateDoc,
    useFrappeDeleteDoc,
    useFrappeAuth,
} from "frappe-react-sdk";
import { useSWRConfig } from "swr";
import { criticalPOKeys } from "./useCriticalPOQueries";
import { captureApiError } from "@/utils/sentry/captureApiError";

// ─── Critical PO Tasks Mutations ─────────────────────────────

/**
 * Create a new Critical PO Task doc.
 * Invalidates the task lists cache after success.
 */
export const useCreateCriticalPOTask = () => {
    const { createDoc, loading } = useFrappeCreateDoc();
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const wrappedCreateDoc = async (data: Record<string, any>) => {
        try {
            const result = await createDoc("Critical PO Tasks", data);
            try {
                const projectId = data.project;
                if (projectId) {
                    await Promise.all([
                        mutate(criticalPOKeys.tasks(projectId)),
                        mutate(criticalPOKeys.allTasks(projectId)),
                    ]);
                }
            } catch (invalidateError) {
                captureApiError({
                    hook: "useCreateCriticalPOTask",
                    api: "SWR Invalidation",
                    feature: "critical-po",
                    error: invalidateError,
                    user: currentUser ?? undefined,
                });
            }
            return result;
        } catch (error) {
            captureApiError({
                hook: "useCreateCriticalPOTask",
                api: "Create Critical PO Tasks",
                feature: "critical-po",
                doctype: "Critical PO Tasks",
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { createDoc: wrappedCreateDoc, loading };
};

/**
 * Update an existing Critical PO Task doc.
 * Invalidates the task lists cache after success.
 */
export const useUpdateCriticalPOTask = () => {
    const { updateDoc, loading } = useFrappeUpdateDoc();
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const wrappedUpdateDoc = async (
        name: string,
        data: Record<string, any>,
        projectId?: string
    ) => {
        try {
            const result = await updateDoc("Critical PO Tasks", name, data);
            try {
                if (projectId) {
                    await Promise.all([
                        mutate(criticalPOKeys.tasks(projectId)),
                        mutate(criticalPOKeys.allTasks(projectId)),
                    ]);
                }
            } catch (invalidateError) {
                captureApiError({
                    hook: "useUpdateCriticalPOTask",
                    api: "SWR Invalidation",
                    feature: "critical-po",
                    error: invalidateError,
                    user: currentUser ?? undefined,
                });
            }
            return result;
        } catch (error) {
            captureApiError({
                hook: "useUpdateCriticalPOTask",
                api: "Update Critical PO Tasks",
                feature: "critical-po",
                doctype: "Critical PO Tasks",
                entity_id: name,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { updateDoc: wrappedUpdateDoc, loading };
};

/**
 * Delete a Critical PO Task doc.
 * Invalidates the task lists cache after success.
 */
export const useDeleteCriticalPOTask = () => {
    const { deleteDoc, loading } = useFrappeDeleteDoc();
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const wrappedDeleteDoc = async (name: string, projectId?: string) => {
        try {
            const result = await deleteDoc("Critical PO Tasks", name);
            try {
                if (projectId) {
                    await Promise.all([
                        mutate(criticalPOKeys.tasks(projectId)),
                        mutate(criticalPOKeys.allTasks(projectId)),
                    ]);
                }
            } catch (invalidateError) {
                captureApiError({
                    hook: "useDeleteCriticalPOTask",
                    api: "SWR Invalidation",
                    feature: "critical-po",
                    error: invalidateError,
                    user: currentUser ?? undefined,
                });
            }
            return result;
        } catch (error) {
            captureApiError({
                hook: "useDeleteCriticalPOTask",
                api: "Delete Critical PO Tasks",
                feature: "critical-po",
                doctype: "Critical PO Tasks",
                entity_id: name,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { deleteDoc: wrappedDeleteDoc, loading };
};
