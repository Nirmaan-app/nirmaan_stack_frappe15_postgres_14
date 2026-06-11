import { useMemo } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
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
      fields: ["name"],
      filters: [
        ["status", "=", "Approved"],
        ["project", "=", projectId],
      ],
      limit: 0,
    },
    projectId ? spendsTabKeys.serviceRequests(projectId) : null
  );

  const srNames = useMemo(
    () => (approvedServiceRequestsResponse.data || []).map((s) => s.name).filter(Boolean),
    [approvedServiceRequestsResponse.data]
  );
  const { data: itemsResp } = useFrappeGetCall(
    "nirmaan_stack.api.sr_items.get_sr_items_for_parents",
    { sr_names: srNames },
    srNames.length ? `sr_items_spends_${projectId}_${srNames.length}` : null
  );
  const itemsByParent: Record<string, any[]> = (itemsResp as any)?.message || {};

  const enrichedSRs = useMemo(() => {
    if (!approvedServiceRequestsResponse.data) return approvedServiceRequestsResponse.data;
    return approvedServiceRequestsResponse.data.map((sr) => ({
      ...sr,
      work_order_items: itemsByParent[sr.name] || [],
    }));
  }, [approvedServiceRequestsResponse.data, itemsByParent]);

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
    approvedServiceRequestsResponse: {
      ...approvedServiceRequestsResponse,
      data: enrichedSRs,
    },
  };
};
