import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useMemo, useCallback } from "react";

// Types
export type RemarkSubject = "accountant_remark" | "procurement_remark" | "admin_remark";

export interface SRRemarkData {
    name: string;
    content: string;
    subject: RemarkSubject;
    subject_label: string;
    comment_by: string;
    comment_by_name: string;
    creation: string;
}

export interface SRRemarksCounts {
    total: number;
    accountant_remark: number;
    procurement_remark: number;
    admin_remark: number;
}

interface GetSRRemarksResponse {
    message: {
        status: string;
        remarks: SRRemarkData[];
        counts: SRRemarksCounts;
    };
}

interface AddSRRemarkResponse {
    message: {
        status: string;
        message: string;
        remark: SRRemarkData;
    };
}

interface GetSRRemarksCountResponse {
    message: {
        count: number;
    };
}

interface DeleteSRRemarkResponse {
    message: {
        status: string;
        message: string;
    };
}

interface GetSRRecentRemarksResponse {
    message: {
        remarks: SRRemarkData[];
        total: number;
    };
}

/**
 * Hook to fetch remarks for a Service Request
 */
export const useSRRemarks = (srId: string | undefined, subjectFilter?: RemarkSubject) => {
    const { data, isLoading, error, mutate } = useFrappeGetCall<GetSRRemarksResponse>(
        "nirmaan_stack.api.sr_remarks.get_sr_remarks",
        {
            sr_id: srId,
            subject_filter: subjectFilter || null,
        },
        srId ? `sr_remarks_${srId}_${subjectFilter || "all"}` : null
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
 * Hook to add a remark to a Service Request
 */
export const useAddSRRemark = () => {
    const { call, loading, error, reset } = useFrappePostCall<AddSRRemarkResponse>(
        "nirmaan_stack.api.sr_remarks.add_sr_remark"
    );

    const addRemark = useCallback(async (srId: string, content: string) => {
        const response = await call({
            sr_id: srId,
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
 * Hook to get the count of remarks for a Service Request
 * Lightweight version for table views
 */
export const useSRRemarksCount = (srId: string | undefined) => {
    const { data, isLoading, error, mutate } = useFrappeGetCall<GetSRRemarksCountResponse>(
        "nirmaan_stack.api.sr_remarks.get_sr_remarks_count",
        {
            sr_id: srId,
        },
        srId ? `sr_remarks_count_${srId}` : null
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
export const useDeleteSRRemark = () => {
    const { call, loading, error, reset } = useFrappePostCall<DeleteSRRemarkResponse>(
        "nirmaan_stack.api.sr_remarks.delete_sr_remark"
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
export const useSRRecentRemarks = (srId: string | undefined, enabled: boolean = true) => {
    const { data, isLoading, error, mutate } = useFrappeGetCall<GetSRRecentRemarksResponse>(
        "nirmaan_stack.api.sr_remarks.get_sr_recent_remarks",
        {
            sr_id: srId,
            limit: 3,
        },
        enabled && srId ? `sr_recent_remarks_${srId}` : null
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
