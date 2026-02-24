import { useFrappePostCall, useFrappeUpdateDoc, useFrappeCreateDoc } from "frappe-react-sdk";
import { useCallback } from "react";
import { useUserData } from "@/hooks/useUserData"; // Adjust path
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";

export interface ApprovePayload {
    project_id: string;
    pr_name: string;
    // payment_terms: string; // JSON string
    selected_items: string[]; // Array of item names (docnames)
    selected_vendors: { [itemName: string]: string }; // Map item name to chosen vendorId
    custom: boolean;
    payment_terms?: string;
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

export const useQuoteApprovalApi = (prId?: string, projectId?: string) => {
    const userData = useUserData();
    const { isCEOHold, showBlockedToast } = useCEOHoldGuard(projectId);
    const { call: approveItemsCall, loading: approveLoading } = useFrappePostCall<ApiResponse>("nirmaan_stack.api.approve_vendor_quotes.generate_pos_from_selection");
    const { call: sendBackItemsCall, loading: sendBackLoading } = useFrappePostCall<ApiResponse>("nirmaan_stack.api.reject_vendor_quotes.send_back_items");
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();

    const approveSelection = useCallback(async (payload: ApprovePayload) => {
        if (isCEOHold) {
            showBlockedToast();
            return;
        }
        if (!prId) throw new Error("PR ID is required for approval.");
        // Add validation for payload if needed
        const result = await approveItemsCall(payload);
        invalidateSidebarCounts();
        return result;
    }, [approveItemsCall, prId, isCEOHold, showBlockedToast]);

    const sendBackSelection = useCallback(async (payload: SendBackPayload) => {
        if (isCEOHold) {
            showBlockedToast();
            return;
        }
        if (!prId) throw new Error("PR ID is required for send back.");
        const result = await sendBackItemsCall(payload);
        invalidateSidebarCounts();
        return result;
    }, [sendBackItemsCall, prId, isCEOHold, showBlockedToast]);

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
        invalidateSidebarCounts();
    }, [prId, updateDoc, createDoc, userData?.user_id]);

    return {
        approveSelection,
        sendBackSelection,
        rejectCustomPr,
        isLoading: approveLoading || sendBackLoading || updateLoading || createLoading,
    };
};
