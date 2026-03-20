import { useEffect, useState } from "react";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { ProcurementPackages } from "@/types/NirmaanStack/ProcurementPackages";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

export interface PRStatusCounts {
  "New PR": number;
  "Open PR": number;
  "Approved PO": number;
  "Deleted PR": number;
  [key: string]: number;
}

interface PRStatusDataResponse {
  status_counts: PRStatusCounts;
  pr_statuses: { [key: string]: string };
}

const prSummaryKeys = {
  projects: (projectId?: string) => ["project-tab", "pr-summary", "projects", projectId || "all"] as const,
  pos: (projectId: string) => ["project-tab", "pr-summary", "pos", projectId] as const,
  quotes: () => ["project-tab", "pr-summary", "quotes"] as const,
  packages: () => ["project-tab", "pr-summary", "packages"] as const,
};

export const useProjectPRStatusSummary = (projectId?: string) => {
  const [statusCounts, setStatusCounts] = useState<PRStatusCounts>({
    "New PR": 0,
    "Open PR": 0,
    "Approved PO": 0,
    "Deleted PR": 0,
  });
  const [prStatuses, setPrStatuses] = useState<{ [key: string]: string }>({});

  const statusResponse = useFrappePostCall<{ message: PRStatusDataResponse }>(
    "nirmaan_stack.api.projects.project_aggregates.get_project_pr_status_counts"
  );

  useEffect(() => {
    if (projectId) {
      statusResponse
        .call({ project_id: projectId })
        .then((res) => {
          setStatusCounts((prev) => ({ ...prev, ...res.message.status_counts }));
          setPrStatuses((prev) => ({ ...prev, ...res.message.pr_statuses }));
        })
        .catch(() => {
          setStatusCounts({
            "New PR": 0,
            "Open PR": 0,
            "Approved PO": 0,
            "Deleted PR": 0,
          });
          setPrStatuses({});
        });
      return;
    }

    setStatusCounts({
      "New PR": 0,
      "Open PR": 0,
      "Approved PO": 0,
      "Deleted PR": 0,
    });
    setPrStatuses({});
  }, [projectId]);

  useApiErrorLogger(statusResponse.error, {
    hook: "useProjectPRStatusSummary",
    api: "get_project_pr_status_counts",
    feature: "projects-tab-pr-summary",
    entity_id: projectId,
  });

  return {
    statusCounts,
    prStatuses,
    statusCountsLoading: statusResponse.loading,
    statusCountsError: statusResponse.error,
  };
};

export const useProjectPRSupportingData = (projectId?: string) => {
  const projectsResponse = useFrappeGetDocList<Projects>(
    "Projects",
    {
      fields: ["name", "project_name"],
      filters: projectId ? [["name", "=", projectId]] : [],
      limit: projectId ? 1 : 1000,
    },
    prSummaryKeys.projects(projectId)
  );

  const poResponse = useFrappeGetDocList<ProcurementOrder>(
    "Procurement Orders",
    {
      fields: [
        "name",
        "procurement_request",
        "status",
        "`tabPurchase Order Item`.total_amount",
      ],
      filters: projectId ? [["project", "=", projectId]] : [],
      limit: 10000,
    },
    projectId ? prSummaryKeys.pos(projectId) : null
  );

  const quotesResponse = useFrappeGetDocList<ApprovedQuotations>(
    "Approved Quotations",
    { fields: ["item_id", "quote", "modified"], limit: 100000 },
    prSummaryKeys.quotes()
  );

  const packagesResponse = useFrappeGetDocList<ProcurementPackages>(
    "Procurement Packages",
    {
      fields: ["work_package_name"],
      orderBy: { field: "work_package_name", order: "asc" },
      limit: 0,
    },
    prSummaryKeys.packages()
  );

  useApiErrorLogger(projectsResponse.error, {
    hook: "useProjectPRSupportingData",
    api: "Projects List",
    feature: "projects-tab-pr-summary",
    entity_id: projectId,
  });

  useApiErrorLogger(poResponse.error, {
    hook: "useProjectPRSupportingData",
    api: "Procurement Orders List",
    feature: "projects-tab-pr-summary",
    entity_id: projectId,
  });

  useApiErrorLogger(quotesResponse.error, {
    hook: "useProjectPRSupportingData",
    api: "Approved Quotations List",
    feature: "projects-tab-pr-summary",
  });

  useApiErrorLogger(packagesResponse.error, {
    hook: "useProjectPRSupportingData",
    api: "Procurement Packages List",
    feature: "projects-tab-pr-summary",
  });

  return {
    projectsResponse,
    poResponse,
    quotesResponse,
    packagesResponse,
  };
};
