import {
    useFrappeCreateDoc,
    useFrappeUpdateDoc,
    useFrappeDeleteDoc,
    useFrappeAuth,
    useFrappePostCall,
} from "frappe-react-sdk";
import { useCallback } from "react";
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

// ─── PO ↔ Critical PO Task links ─────────────────────────────

export interface POTaskLink {
    po: string;
    task: string;
}

/**
 * Add and/or remove (PO, Critical PO Task) links through the one write endpoint, which stores
 * them as `Critical PO Task Child Table` rows on the PO. A call is one transaction, so a move (remove + add)
 * can never half-apply. Invalidates every cache that shows links for the project.
 */
export const useUpdatePOTaskLinks = () => {
    const { call, loading } = useFrappePostCall<{ message: { added: number; removed: number } }>(
        "nirmaan_stack.api.critical_po_tasks.po_links.update_po_task_links"
    );
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const updateLinks = useCallback(
        async (projectId: string, changes: { add?: POTaskLink[]; remove?: POTaskLink[] }) => {
            try {
                const result = await call({ add: changes.add ?? [], remove: changes.remove ?? [] });
                try {
                    await Promise.all([
                        mutate(criticalPOKeys.poLinks(projectId)),
                        mutate(criticalPOKeys.poLinksAll()),
                        mutate(criticalPOKeys.tasks(projectId)),
                        mutate(criticalPOKeys.allTasks(projectId)),
                    ]);
                } catch (invalidateError) {
                    captureApiError({
                        hook: "useUpdatePOTaskLinks",
                        api: "SWR Invalidation",
                        feature: "critical-po",
                        error: invalidateError,
                        user: currentUser ?? undefined,
                    });
                }
                return result?.message;
            } catch (error) {
                captureApiError({
                    hook: "useUpdatePOTaskLinks",
                    api: "Update PO Task Links",
                    feature: "critical-po",
                    doctype: "Critical PO Task Child Table",
                    error,
                    user: currentUser ?? undefined,
                });
                throw error;
            }
        },
        [call, mutate, currentUser]
    );

    return { updateLinks, loading };
};
