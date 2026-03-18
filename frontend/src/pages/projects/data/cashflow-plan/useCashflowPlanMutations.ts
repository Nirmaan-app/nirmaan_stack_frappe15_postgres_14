import { useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";

export const useCreateCashflowPlan = () => {
    const { createDoc, loading, error, isCompleted } = useFrappeCreateDoc();

    const createCashflow = async (doc: any) => {
        try {
            const result = await createDoc("Cashflow Plan", doc);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useCreateCashflowPlan",
                api: "Create Cashflow Plan",
                feature: "cashflow-plan",
            });
            throw err;
        }
    };

    return { createCashflow, loading, error, isCompleted };
};

export const useUpdateCashflowPlan = () => {
    const { updateDoc, loading, error, isCompleted } = useFrappeUpdateDoc();

    const updateCashflow = async (name: string, doc: any) => {
        try {
            const result = await updateDoc("Cashflow Plan", name, doc);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useUpdateCashflowPlan",
                api: "Update Cashflow Plan",
                feature: "cashflow-plan",
                entity_id: name
            });
            throw err;
        }
    };

    return { updateCashflow, loading, error, isCompleted };
};

export const useDeleteCashflowPlan = () => {
    const { deleteDoc, loading, error } = useFrappeDeleteDoc();

    const deleteCashflow = async (name: string) => {
        try {
            const result = await deleteDoc("Cashflow Plan", name);
            return result;
        } catch (err: any) {
            captureApiError({
                error: err,
                hook: "useDeleteCashflowPlan",
                api: "Delete Cashflow Plan",
                feature: "cashflow-plan",
                entity_id: name
            });
            throw err;
        }
    };

    return { deleteCashflow, loading, error };
};
