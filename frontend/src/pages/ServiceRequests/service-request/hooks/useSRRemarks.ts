import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { useMemo, useCallback } from "react";

export type RemarkSubject = "accountant_remark" | "procurement_remark" | "admin_remark";

export interface SRRemarkData {
  name: string;
  content: string;
  subject: RemarkSubject;
  subject_label: string;
  comment_by: string;
  comment_by_name: string;
  creation: string;
  is_system_generated?: boolean;
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

interface DeleteSRRemarkResponse {
  message: {
    status: string;
    message: string;
  };
}

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

  return { remarks, counts, isLoading, error, mutate };
};

export const useAddSRRemark = () => {
  const { call, loading, error, reset } = useFrappePostCall<AddSRRemarkResponse>(
    "nirmaan_stack.api.sr_remarks.add_sr_remark"
  );

  const addRemark = useCallback(async (srId: string, content: string) => {
    return await call({ sr_id: srId, content });
  }, [call]);

  return { addRemark, isLoading: loading, error, reset };
};

export const useDeleteSRRemark = () => {
  const { call, loading, error, reset } = useFrappePostCall<DeleteSRRemarkResponse>(
    "nirmaan_stack.api.sr_remarks.delete_sr_remark"
  );

  const deleteRemark = useCallback(async (remarkId: string) => {
    return await call({ remark_id: remarkId });
  }, [call]);

  return { deleteRemark, isLoading: loading, error, reset };
};

export const getSubjectBadgeClass = (subject: RemarkSubject): string => {
  switch (subject) {
    case "accountant_remark": return "bg-blue-100 text-blue-800";
    case "procurement_remark": return "bg-green-100 text-green-800";
    case "admin_remark": return "bg-purple-100 text-purple-800";
    default: return "bg-gray-100 text-gray-800";
  }
};
