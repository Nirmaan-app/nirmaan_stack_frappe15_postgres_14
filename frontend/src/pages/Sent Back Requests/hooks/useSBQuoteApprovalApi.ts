// src/features/procurement/approve-sb-quotes/hooks/useSBQuoteApprovalApi.ts
import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback } from "react";

// Define specific payload types for SB APIs
export interface ApproveSBPayload {
    project_id: string; // Still likely needed for context
    sb_id: string; // ID of the Sent Back Category doc
    selected_items: string[]; // Array of SBItem names (child table row name)
    selected_vendors: { [itemName: string]: string }; // Map SBItem name to chosen vendorId
}

export interface SendBackSBPayload {
    sb_id: string; // ID of the Sent Back Category doc
    selected_items: string[]; // Array of SBItem names
    comment?: string; // Optional comment
}

// Define expected response structure (reuse ApiResponse if identical)
interface ApiResponse {
    message: {
        status: number;
        message?: string;
        error?: string;
    }
}

export const useSBQuoteApprovalApi = (sbId?: string) => {
    // Update API endpoint paths
    const { call: approveItemsCall, loading: approveLoading } = useFrappePostCall<ApiResponse>("nirmaan_stack.api.approve_reject_sb_vendor_quotes.new_handle_approve");

    const { call: sendBackItemsCall, loading: sendBackLoading } = useFrappePostCall<ApiResponse>("nirmaan_stack.api.approve_reject_sb_vendor_quotes.new_handle_sent_back");

    const approveSelection = useCallback(async (payload: ApproveSBPayload) => {
        if (!sbId) throw new Error("Sent Back ID is required for approval.");
        return await approveItemsCall(payload);
    }, [approveItemsCall, sbId]);

    const sendBackSelection = useCallback(async (payload: SendBackSBPayload) => {
        if (!sbId) throw new Error("Sent Back ID is required for send back.");
        return await sendBackItemsCall(payload);
    }, [sendBackItemsCall, sbId]);

    // No need for rejectCustomPr here

    return {
        approveSBSelection: approveSelection, // Renamed for clarity
        sendBackSBSelection: sendBackSelection, // Renamed for clarity
        isLoading: approveLoading || sendBackLoading,
    };
};