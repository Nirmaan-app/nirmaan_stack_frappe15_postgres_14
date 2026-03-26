import { useEffect, useState } from "react";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

interface POAmountsDict {
  [key: string]: {
    total_incl_gst: number;
    total_excl_gst: number;
  };
}

interface POAggregates {
  total_po_value_inc_gst: number;
  total_po_value_excl_gst: number;
  total_amount_paid_for_pos: number;
  total_gst_on_items: number;
  final_total_gst: number;
}

interface POAggregatesResponse extends POAggregates {
  po_amounts_dict: POAmountsDict;
}

const poSummaryKeys = {
  projects: (projectId?: string) => ["project-tab", "po-summary", "projects", projectId || "all"] as const,
  prs: (projectId: string) => ["project-tab", "po-summary", "prs", projectId] as const,
  payments: (projectId: string) => ["project-tab", "po-summary", "payments", projectId] as const,
};

export const useProjectPOAggregates = (projectId?: string) => {
  const [poAggregates, setPOAggregates] = useState<POAggregates | null>(null);
  const [poAmountsDict, setPOAmountsDict] = useState<POAmountsDict | null>(null);

  const aggregateResponse = useFrappePostCall<{ message: POAggregatesResponse }>(
    "nirmaan_stack.api.projects.project_aggregates.get_project_po_summary_aggregates"
  );

  useEffect(() => {
    if (projectId) {
      aggregateResponse
        .call({ project_id: projectId })
        .then((data) => {
          const { po_amounts_dict, ...rest } = data.message;
          setPOAggregates(rest);
          setPOAmountsDict(po_amounts_dict);
        })
        .catch(() => {
          setPOAggregates(null);
          setPOAmountsDict(null);
        });
      return;
    }

    setPOAggregates(null);
    setPOAmountsDict(null);
  }, [projectId]);

  useApiErrorLogger(aggregateResponse.error, {
    hook: "useProjectPOAggregates",
    api: "get_project_po_summary_aggregates",
    feature: "projects-tab-po-summary",
    entity_id: projectId,
  });

  return {
    poAggregates,
    poAmountsDict,
    aggregatesLoading: aggregateResponse.loading,
    aggregatesError: aggregateResponse.error,
  };
};

export const useProjectPOSupportingData = (projectId?: string) => {
  const projectsResponse = useFrappeGetDocList<Projects>(
    "Projects",
    {
      fields: ["name", "project_name"],
      filters: projectId ? [["name", "=", projectId]] : [],
      limit: projectId ? 1 : 1000,
    },
    poSummaryKeys.projects(projectId)
  );

  const prResponse = useFrappeGetDocList<ProcurementRequest>(
    "Procurement Requests",
    {
      fields: ["name", "work_package"],
      filters: projectId ? [["project", "=", projectId]] : [],
      limit: 0,
    },
    projectId ? poSummaryKeys.prs(projectId) : null
  );

  const projectPaymentsResponse = useFrappeGetDocList<ProjectPayments>(
    "Project Payments",
    {
      fields: ["document_name", "amount", "status"],
      filters: [
        ["document_type", "=", "Procurement Orders"],
        ["status", "=", "Paid"],
        ["project", "=", projectId],
      ],
      limit: 0,
    },
    projectId ? poSummaryKeys.payments(projectId) : null
  );

  useApiErrorLogger(projectsResponse.error, {
    hook: "useProjectPOSupportingData",
    api: "Projects List",
    feature: "projects-tab-po-summary",
    entity_id: projectId,
  });

  useApiErrorLogger(prResponse.error, {
    hook: "useProjectPOSupportingData",
    api: "Procurement Requests List",
    feature: "projects-tab-po-summary",
    entity_id: projectId,
  });

  useApiErrorLogger(projectPaymentsResponse.error, {
    hook: "useProjectPOSupportingData",
    api: "Project Payments List",
    feature: "projects-tab-po-summary",
    entity_id: projectId,
  });

  return {
    projectsResponse,
    prResponse,
    projectPaymentsResponse,
  };
};
