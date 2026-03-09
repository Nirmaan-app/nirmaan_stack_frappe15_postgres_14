import {
    useFrappeCreateDoc,
    useFrappeUpdateDoc,
    useFrappeDeleteDoc,
    useFrappePostCall
} from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

// ---------------------------------------------------------------------------
// 1. Create Material Delivery Plan
// ---------------------------------------------------------------------------
export const useCreateMaterialDeliveryPlan = () => {
    const { createDoc, loading, error, isCompleted } = useFrappeCreateDoc();

    const createMaterialPlan = async (doc: any) => {
        try {
            const result = await createDoc("Material Delivery Plan", doc);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useCreateMaterialDeliveryPlan",
                api: "Create Material Delivery Plan",
                feature: "material-plan",
            });
            throw err;
        }
    };

    return { createMaterialPlan, loading, error, isCompleted };
};

// ---------------------------------------------------------------------------
// 2. Update Material Delivery Plan
// ---------------------------------------------------------------------------
export const useUpdateMaterialDeliveryPlan = () => {
    const { updateDoc, loading, error, isCompleted } = useFrappeUpdateDoc();

    const updateMaterialPlan = async (name: string, doc: any) => {
        try {
            const result = await updateDoc("Material Delivery Plan", name, doc);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useUpdateMaterialDeliveryPlan",
                api: "Update Material Delivery Plan",
                feature: "material-plan",
                entity_id: name,
            });
            throw err;
        }
    };

    return { updateMaterialPlan, loading, error, isCompleted };
};

// ---------------------------------------------------------------------------
// 3. Delete Material Delivery Plan
// ---------------------------------------------------------------------------
export const useDeleteMaterialDeliveryPlan = () => {
    const { deleteDoc, loading: isDeleting, error } = useFrappeDeleteDoc();

    const deleteMaterialPlan = async (name: string) => {
        try {
            const result = await deleteDoc("Material Delivery Plan", name);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useDeleteMaterialDeliveryPlan",
                api: "Delete Material Delivery Plan",
                feature: "material-plan",
                entity_id: name,
            });
            throw err;
        }
    };

    return { deleteMaterialPlan, loading: isDeleting, error };
};

// ---------------------------------------------------------------------------
// IMPERATIVE DROPDOWN / SEARCH CALLS (for AddMaterialPlanForm)
// ---------------------------------------------------------------------------
export const useFetchCategoriesAndTasks = () => {
    const { call, result, loading, error } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_categories_and_tasks"
    );

    useApiErrorLogger(error, {
        hook: "useFetchCategoriesAndTasks",
        api: "get_categories_and_tasks",
        feature: "material-plan",
    });

    return { fetchCategoriesAndTasks: call, catTaskResult: result, isLoadingCatTasks: loading };
};

export const useFetchDataV2 = () => {
    const { call, result, loading, error } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_material_plan_data_v2"
    );

    useApiErrorLogger(error, {
        hook: "useFetchDataV2",
        api: "get_material_plan_data_v2",
        feature: "material-plan",
    });

    return { fetchDataV2: call, dataV2Result: result, isLoadingDataV2: loading };
};

export const useFetchAllPOs = () => {
    const { call, result, loading, error } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_all_project_pos"
    );

    useApiErrorLogger(error, {
        hook: "useFetchAllPOs",
        api: "get_all_project_pos",
        feature: "material-plan",
    });

    return { fetchAllPOs: call, allPOsResult: result, isLoadingAllPOs: loading };
};
