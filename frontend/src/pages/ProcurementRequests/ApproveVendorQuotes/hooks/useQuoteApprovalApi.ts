import { useFrappePostCall, useFrappeUpdateDoc, useFrappeCreateDoc } from "frappe-react-sdk";
import { useCallback } from "react";
import { useUserData } from "@/hooks/useUserData"; // Adjust path

export interface ApprovePayload {
    project_id: string;
    pr_name: string;
    selected_items: string[]; // Array of item names (docnames)
    selected_vendors: { [itemName: string]: string }; // Map item name to chosen vendorId
    custom: boolean;
}

export interface SendBackPayload {
    project_id: string;
    pr_name: string;
    selected_items: string[]; // Array of item names (docnames)
    comments?: string; // Optional comment
}

// Define expected success/error response structure from backend API if possible
interface ApiResponse {
    message: {
        status: number;
        message?: string; // Success message
        error?: string; // Error message
    }
}

export const useQuoteApprovalApi = (prId?: string) => {
    const userData = useUserData();
    const { call: approveItemsCall, loading: approveLoading } = useFrappePostCall<ApiResponse>("nirmaan_stack.api.approve_vendor_quotes.generate_pos_from_selection");
    const { call: sendBackItemsCall, loading: sendBackLoading } = useFrappePostCall<ApiResponse>("nirmaan_stack.api.reject_vendor_quotes.send_back_items");
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();

    const approveSelection = useCallback(async (payload: ApprovePayload) => {
        if (!prId) throw new Error("PR ID is required for approval.");
        // Add validation for payload if needed
        return await approveItemsCall(payload);
    }, [approveItemsCall, prId]);

    const sendBackSelection = useCallback(async (payload: SendBackPayload) => {
        if (!prId) throw new Error("PR ID is required for send back.");
        return await sendBackItemsCall(payload);
    }, [sendBackItemsCall, prId]);

    // Specific function for rejecting a custom PR (no work package)
    const rejectCustomPr = useCallback(async (comment?: string) => {
        if (!prId) throw new Error("PR ID is required for rejection.");

        await updateDoc("Procurement Requests", prId, {
            workflow_state: "Rejected"
        });

        // Add comment if provided
        if (comment && userData?.user_id) {
            await createDoc("Nirmaan Comments", {
                comment_type: "Comment",
                reference_doctype: "Procurement Requests",
                reference_name: prId,
                comment_by: userData.user_id,
                content: comment,
                subject: "rejecting custom pr",
            });
        }
        // No specific return value needed, success indicated by lack of error
    }, [prId, updateDoc, createDoc, userData?.user_id]);

    return {
        approveSelection,
        sendBackSelection,
        rejectCustomPr,
        isLoading: approveLoading || sendBackLoading || updateLoading || createLoading,
    };
};