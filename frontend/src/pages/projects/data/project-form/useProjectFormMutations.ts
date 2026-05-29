import { useFrappePostCall, useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";

export const useCreateProjectWithAddress = () => {
    const { call, loading, error, isCompleted } = useFrappePostCall("nirmaan_stack.api.projects.new_project.create_project_with_address");

    const createProject = async (payload: any) => {
        try {
            const result = await call(payload);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useCreateProjectWithAddress",
                api: "create_project_with_address",
                feature: "project-form",
            });
            throw err;
        }
    };

    return { createProject, loading, error, isCompleted };
};

export const useConvertTenderingToWon = () => {
    const { call, loading, error, isCompleted } = useFrappePostCall("nirmaan_stack.api.projects.tendering.convert_tendering_to_won");

    /**
     * Convert an existing Tendering stub into a Won project in place.
     *
     * @param projectId The existing stub's docname (frozen `{city}-PROJ-#####`).
     * @param values    The full wizard payload — same shape as create_project_with_address.
     */
    const convertProject = async (projectId: string, values: any) => {
        try {
            const result = await call({ project_id: projectId, values });
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useConvertTenderingToWon",
                api: "convert_tendering_to_won",
                feature: "project-form",
                entity_id: projectId,
            });
            throw err;
        }
    };

    return { convertProject, loading, error, isCompleted };
};

export const useCreateProjectChildDoc = () => {
    const { createDoc, loading, error, isCompleted } = useFrappeCreateDoc();

    const createChildDoc = async (doctype: string, doc: any) => {
        try {
            const result = await createDoc(doctype, doc);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useCreateProjectChildDoc",
                api: `Create ${doctype}`,
                feature: "project-form",
            });
            throw err;
        }
    };

    return { createChildDoc, loading, error, isCompleted };
};

export const useUpdateProjectDoc = () => {
    const { updateDoc, loading, error, isCompleted } = useFrappeUpdateDoc();

    const updateProject = async (name: string, doc: any) => {
        try {
            const result = await updateDoc("Projects", name, doc);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useUpdateProjectDoc",
                api: "Update Projects",
                feature: "project-form",
                entity_id: name
            });
            throw err;
        }
    };

    return { updateProject, loading, error, isCompleted };
};
