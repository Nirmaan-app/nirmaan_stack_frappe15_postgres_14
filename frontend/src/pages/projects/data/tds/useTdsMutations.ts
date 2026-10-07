import {
    useFrappeCreateDoc,
    useFrappeUpdateDoc,
    useFrappeDeleteDoc,
    useFrappeFileUpload,
    useFrappePostCall,
    useFrappeAuth,
} from "frappe-react-sdk";
import { useSWRConfig } from "swr";
import { tdsKeys } from "./useTdsQueries";
import { captureApiError } from "@/utils/sentry/captureApiError";

// ─── TDS Setting Mutations ──────────────────────────────────

/**
 * Create a new Project TDS Setting doc.
 * Invalidates the settings cache after success.
 */
export const useCreateTdsSetting = () => {
    const { createDoc, loading } = useFrappeCreateDoc();
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const wrappedCreateDoc = async (data: Record<string, any>) => {
        try {
            const result = await createDoc("Project TDS Setting", data);
            try {
                const projectId = data.tds_project_id;
                if (projectId) {
                    await mutate(tdsKeys.settings(projectId));
                }
            } catch (invalidateError) {
                captureApiError({
                    hook: "useCreateTdsSetting",
                    api: "SWR Invalidation",
                    feature: "tds",
                    error: invalidateError,
                    user: currentUser ?? undefined,
                });
            }
            return result;
        } catch (error) {
            captureApiError({
                hook: "useCreateTdsSetting",
                api: "Create Project TDS Setting",
                feature: "tds",
                doctype: "Project TDS Setting",
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { createDoc: wrappedCreateDoc, loading };
};

/**
 * Update an existing Project TDS Setting doc.
 * Invalidates the settings cache after success.
 */
export const useUpdateTdsSetting = () => {
    const { updateDoc, loading } = useFrappeUpdateDoc();
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const wrappedUpdateDoc = async (
        name: string,
        data: Record<string, any>,
        projectId?: string
    ) => {
        try {
            const result = await updateDoc("Project TDS Setting", name, data);
            try {
                if (projectId) {
                    await mutate(tdsKeys.settings(projectId));
                }
            } catch (invalidateError) {
                captureApiError({
                    hook: "useUpdateTdsSetting",
                    api: "SWR Invalidation",
                    feature: "tds",
                    error: invalidateError,
                    user: currentUser ?? undefined,
                });
            }
            return result;
        } catch (error) {
            captureApiError({
                hook: "useUpdateTdsSetting",
                api: "Update Project TDS Setting",
                feature: "tds",
                doctype: "Project TDS Setting",
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
 * Upload a file for TDS: settings logos (attached to the setting), and request
 * datasheets (left unattached; `submit_tds_request` attaches them to the row).
 */
export const useUploadTdsFile = () => {
    const { upload, loading } = useFrappeFileUpload();
    const { currentUser } = useFrappeAuth();

    const wrappedUpload = async (
        file: File,
        options: {
            doctype?: string;
            docname?: string;
            fieldname?: string;
            isPrivate: boolean;
        }
    ) => {
        try {
            const result = await upload(file, options);
            return result;
        } catch (error) {
            captureApiError({
                hook: "useUploadTdsFile",
                api: "File Upload",
                feature: "tds",
                doctype: options.doctype,
                entity_id: options.docname,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { upload: wrappedUpload, loading };
};

// ─── TDS Item Mutations ─────────────────────────────────────

/** One cart row as `submit_tds_request` reads it. */
export interface TdsSubmitRow {
    tds_item_id: string;
    make: string;
    is_new_request: boolean;
    is_project_custom: boolean;
    tds_boq_line_item: string;
    description?: string;
    tds_item_name?: string;   // Project Custom only (the server reads the rest from the TDS Item)
    work_package?: string;    // Project Custom only
    category?: string;        // Project Custom only: under `work_package`
    tds_attachment?: string;  // requests only: file_url of the sender's unattached upload
    previous_doc_name?: string;
}

/**
 * Send a cart for approval. The server saves every row or none, issues the
 * request id, re-checks duplicates and attaches each request's uploaded
 * datasheet (`api/tds/submit.py`). Invalidates history and existing project
 * items caches.
 */
export const useSubmitTdsRequest = () => {
    const { call, loading } = useFrappePostCall<{
        message: { request_id: string; names: string[] };
    }>("nirmaan_stack.api.tds.submit.submit_tds_request");
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const submit = async (projectId: string, rows: TdsSubmitRow[]) => {
        try {
            const result = await call({ project: projectId, rows: JSON.stringify(rows) });
            try {
                await Promise.all([
                    mutate(tdsKeys.historyItems(projectId)),
                    mutate(tdsKeys.existingProjectItems(projectId)),
                ]);
            } catch (invalidateError) {
                captureApiError({
                    hook: "useSubmitTdsRequest",
                    api: "SWR Invalidation",
                    feature: "tds",
                    error: invalidateError,
                    user: currentUser ?? undefined,
                });
            }
            return result.message;
        } catch (error) {
            captureApiError({
                hook: "useSubmitTdsRequest",
                api: "submit_tds_request",
                feature: "tds",
                doctype: "Project TDS Item List",
                entity_id: projectId,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { submit, loading };
};

/**
 * Delete a Project TDS Item List doc.
 * Invalidates history and existing project items caches.
 */
export const useDeleteTdsItem = () => {
    const { deleteDoc, loading } = useFrappeDeleteDoc();
    const { mutate } = useSWRConfig();
    const { currentUser } = useFrappeAuth();

    const wrappedDeleteDoc = async (name: string, projectId?: string) => {
        try {
            const result = await deleteDoc("Project TDS Item List", name);
            try {
                if (projectId) {
                    await Promise.all([
                        mutate(tdsKeys.historyItems(projectId)),
                        mutate(tdsKeys.existingProjectItems(projectId)),
                    ]);
                }
            } catch (invalidateError) {
                captureApiError({
                    hook: "useDeleteTdsItem",
                    api: "SWR Invalidation",
                    feature: "tds",
                    error: invalidateError,
                    user: currentUser ?? undefined,
                });
            }
            return result;
        } catch (error) {
            captureApiError({
                hook: "useDeleteTdsItem",
                api: "Delete Project TDS Item List",
                feature: "tds",
                doctype: "Project TDS Item List",
                entity_id: name,
                error,
                user: currentUser ?? undefined,
            });
            throw error;
        }
    };

    return { deleteDoc: wrappedDeleteDoc, loading };
};
