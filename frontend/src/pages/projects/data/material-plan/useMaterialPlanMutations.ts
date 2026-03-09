import { useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";

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
    const { deleteDoc, loading, error } = useFrappeDeleteDoc();

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

    return { deleteMaterialPlan, loading, error };
};
