import { useFrappeGetDocList } from "frappe-react-sdk";
import { ProjectEstimates } from "@/types/NirmaanStack/ProjectEstimates";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

const spendsTabKeys = {
  estimates: (projectId: string) => ["project-tab", "spends", "estimates", projectId] as const,
  serviceRequests: (projectId: string) => ["project-tab", "spends", "service-requests", projectId] as const,
};

export const useProjectSpendsTabData = (projectId: string) => {
  const projectEstimatesResponse = useFrappeGetDocList<ProjectEstimates>(
    "Project Estimates",
    {
      fields: [
        "quantity_estimate",
        "rate_estimate",
        "category",
        "name",
        "work_package",
        "item",
        "item_name",
      ],
      filters: [["project", "=", projectId]],
      limit: 0,
    },
    projectId ? spendsTabKeys.estimates(projectId) : null
  );

  const approvedServiceRequestsResponse = useFrappeGetDocList<ServiceRequests>(
    "Service Requests",
    {
      fields: ["service_order_list", "name"],
      filters: [
        ["status", "=", "Approved"],
        ["project", "=", projectId],
      ],
      limit: 0,
    },
    projectId ? spendsTabKeys.serviceRequests(projectId) : null
  );

  useApiErrorLogger(projectEstimatesResponse.error, {
    hook: "useProjectSpendsTabData",
    api: "Project Estimates List",
    feature: "projects-tab-spends",
    entity_id: projectId,
  });

  useApiErrorLogger(approvedServiceRequestsResponse.error, {
    hook: "useProjectSpendsTabData",
    api: "Approved Service Requests List",
    feature: "projects-tab-spends",
    entity_id: projectId,
  });

  return {
    projectEstimatesResponse,
    approvedServiceRequestsResponse,
  };
};
