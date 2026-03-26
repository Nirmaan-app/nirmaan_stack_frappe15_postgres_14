import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { captureApiError } from "@/utils/sentry/captureApiError";

export interface WorkHeaderDoc {
  name: string;
  work_package_link: string;
  work_header_name: string;
}

const workReportTabKeys = {
  workHeaders: () => ["project-tab", "work-report", "work-headers"] as const,
};

export const useProjectWorkReportApi = () => {
  const updateDocResponse = useFrappeUpdateDoc();

  const allWorkHeadersResponse = useFrappeGetDocList<WorkHeaderDoc>(
    "Work Headers",
    {
      fields: ["name", "work_header_name", "work_package_link"],
      limit: 0,
    },
    workReportTabKeys.workHeaders()
  );

  const updateProjectDoc = async (projectName: string, payload: Record<string, any>) => {
    try {
      return await updateDocResponse.updateDoc("Projects", projectName, payload);
    } catch (error) {
      captureApiError({
        hook: "useProjectWorkReportApi",
        api: "Update Projects",
        feature: "projects-tab-work-report",
        doctype: "Projects",
        entity_id: projectName,
        error,
      });
      throw error;
    }
  };

  useApiErrorLogger(allWorkHeadersResponse.error, {
    hook: "useProjectWorkReportApi",
    api: "Work Headers",
    feature: "projects-tab-work-report",
  });

  return {
    updateProjectDoc,
    updateDocLoading: updateDocResponse.loading,
    allWorkHeadersResponse,
  };
};
