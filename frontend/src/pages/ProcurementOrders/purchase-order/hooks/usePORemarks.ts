import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useMemo, useCallback } from "react";

// Types
export type RemarkSubject = "accountant_remark" | "procurement_remark" | "admin_remark";

export interface PORemarkData {
    name: string;
    content: string;
    subject: RemarkSubject;
    subject_label: string;
    comment_by: string;
    comment_by_name: string;
    creation: string;
}

export interface PORemarksCounts {
    total: number;
    accountant_remark: number;
    procurement_remark: number;
    admin_remark: number;
}

interface GetPORemarksResponse {
    message: {
        status: string;
        remarks: PORemarkData[];
        counts: PORemarksCounts;
    };
}

interface AddPORemarkResponse {
    message: {
        status: string;
        message: string;
        remark: PORemarkData;
    };
}

interface GetPORemarksCountResponse {
    message: {
        count: number;
    };
}

interface DeletePORemarkResponse {
    message: {
        status: string;
        message: string;
    };
}

interface GetPORecentRemarksResponse {
    message: {
        remarks: PORemarkData[];
        total: number;
    };
}

/**
 * Hook to fetch remarks for a Procurement Order
 */
export const usePORemarks = (poId: string | undefined, subjectFilter?: RemarkSubject) => {
    const { data, isLoading, error, mutate } = useFrappeGetCall<GetPORemarksResponse>(
        "nirmaan_stack.api.po_remarks.get_po_remarks",
        {
            po_id: poId,
            subject_filter: subjectFilter || null,
        },
        poId ? `po_remarks_${poId}_${subjectFilter || "all"}` : null
    );

    const remarks = useMemo(() => data?.message?.remarks || [], [data]);
    const counts = useMemo(() => data?.message?.counts || {
        total: 0,
        accountant_remark: 0,
        procurement_remark: 0,
        admin_remark: 0,
    }, [data]);

    return {
        remarks,
        counts,
        isLoading,
        error,
        mutate,
    };
};

/**
 * Hook to add a remark to a Procurement Order
 */
export const useAddPORemark = () => {
    const { call, loading, error, reset } = useFrappePostCall<AddPORemarkResponse>(
        "nirmaan_stack.api.po_remarks.add_po_remark"
    );

    const addRemark = useCallback(async (poId: string, content: string) => {
        const response = await call({
            po_id: poId,
            content: content,
        });
        return response;
    }, [call]);

    return {
        addRemark,
        isLoading: loading,
        error,
        reset,
    };
};

/**
 * Hook to get the count of remarks for a Procurement Order
 * Lightweight version for table views
 */
export const usePORemarksCount = (poId: string | undefined) => {
    const { data, isLoading, error, mutate } = useFrappeGetCall<GetPORemarksCountResponse>(
        "nirmaan_stack.api.po_remarks.get_po_remarks_count",
        {
            po_id: poId,
        },
        poId ? `po_remarks_count_${poId}` : null
    );

    const count = useMemo(() => data?.message?.count || 0, [data]);

    return {
        count,
        isLoading,
        error,
        mutate,
    };
};

/**
 * Hook to delete a remark (users can only delete their own)
 */
export const useDeletePORemark = () => {
    const { call, loading, error, reset } = useFrappePostCall<DeletePORemarkResponse>(
        "nirmaan_stack.api.po_remarks.delete_po_remark"
    );

    const deleteRemark = useCallback(async (remarkId: string) => {
        const response = await call({
            remark_id: remarkId,
        });
        return response;
    }, [call]);

    return {
        deleteRemark,
        isLoading: loading,
        error,
        reset,
    };
};

/**
 * Hook to get recent remarks for hover display in tables
 */
export const usePORecentRemarks = (poId: string | undefined, enabled: boolean = true) => {
    const { data, isLoading, error, mutate } = useFrappeGetCall<GetPORecentRemarksResponse>(
        "nirmaan_stack.api.po_remarks.get_po_recent_remarks",
        {
            po_id: poId,
            limit: 3,
        },
        enabled && poId ? `po_recent_remarks_${poId}` : null
    );

    const remarks = useMemo(() => data?.message?.remarks || [], [data]);
    const total = useMemo(() => data?.message?.total || 0, [data]);

    return {
        remarks,
        total,
        isLoading,
        error,
        mutate,
    };
};

/**
 * Get badge color class based on subject
 */
export const getSubjectBadgeClass = (subject: RemarkSubject): string => {
    switch (subject) {
        case "accountant_remark":
            return "bg-blue-100 text-blue-800 hover:bg-blue-100";
        case "procurement_remark":
            return "bg-green-100 text-green-800 hover:bg-green-100";
        case "admin_remark":
            return "bg-purple-100 text-purple-800 hover:bg-purple-100";
        default:
            return "bg-gray-100 text-gray-800 hover:bg-gray-100";
    }
};
