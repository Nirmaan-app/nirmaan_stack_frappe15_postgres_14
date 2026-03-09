import {
    useFrappeCreateDoc,
    useFrappeUpdateDoc,
    useFrappeDeleteDoc,
    useFrappePostCall,
} from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";

// ---------------------------------------------------------------------------
// 1. Create Work Plan
// ---------------------------------------------------------------------------
export const useCreateWorkPlan = () => {
    const { createDoc, loading, error, isCompleted } = useFrappeCreateDoc();

    const createWorkPlan = async (doc: any) => {
        try {
            const result = await createDoc("Work Plan", doc);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useCreateWorkPlan",
                api: "Create Work Plan",
                feature: "work-plan",
            });
            throw err;
        }
    };

    return { createWorkPlan, loading, error, isCompleted };
};

// ---------------------------------------------------------------------------
// 2. Update Work Plan
// ---------------------------------------------------------------------------
export const useUpdateWorkPlan = () => {
    const { updateDoc, loading, error, isCompleted } = useFrappeUpdateDoc();

    const updateWorkPlan = async (name: string, doc: any) => {
        try {
            const result = await updateDoc("Work Plan", name, doc);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useUpdateWorkPlan",
                api: "Update Work Plan",
                feature: "work-plan",
                entity_id: name,
            });
            throw err;
        }
    };

    return { updateWorkPlan, loading, error, isCompleted };
};

// ---------------------------------------------------------------------------
// 3. Delete Work Plan
// ---------------------------------------------------------------------------
export const useDeleteWorkPlan = () => {
    const { deleteDoc, loading, error } = useFrappeDeleteDoc();

    const deleteWorkPlan = async (name: string) => {
        try {
            const result = await deleteDoc("Work Plan", name);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useDeleteWorkPlan",
                api: "Delete Work Plan",
                feature: "work-plan",
                entity_id: name,
            });
            throw err;
        }
    };

    return { deleteWorkPlan, loading, error };
};

// ---------------------------------------------------------------------------
// 4. Update Milestone (PostCall)
// ---------------------------------------------------------------------------
export const useUpdateMilestone = () => {
    const { call, loading, error } = useFrappePostCall(
        "nirmaan_stack.api.seven_days_planning.work_plan_api.update_milestone"
    );

    const updateMilestone = async (params: {
        dpr_name: string;
        work_milestone_name: string;
        work_header: string;
        status: string;
        expected_starting_date: string;
        expected_completion_date: string;
        progress: number | string;
    }) => {
        try {
            const result = await call(params);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useUpdateMilestone",
                api: "update_milestone",
                feature: "work-plan",
                entity_id: params.dpr_name,
            });
            throw err;
        }
    };

    return { updateMilestone, loading, error };
};
