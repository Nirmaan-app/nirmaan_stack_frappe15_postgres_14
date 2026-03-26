import { useEffect, useState } from "react";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

export interface SRAggregates {
  total_sr_value_inc_gst: number;
  total_sr_value_excl_gst: number;
  total_amount_paid_for_srs: number;
}

const srSummaryKeys = {
  projects: (projectId?: string) => ["project-tab", "sr-summary", "projects", projectId || "all"] as const,
};

export const useProjectSRAggregates = (projectId?: string) => {
  const [srAggregates, setSRAggregates] = useState<SRAggregates>({
    total_sr_value_inc_gst: 0,
    total_sr_value_excl_gst: 0,
    total_amount_paid_for_srs: 0,
  });

  const aggregateResponse = useFrappePostCall<{ message: SRAggregates }>(
    "nirmaan_stack.api.projects.project_aggregates.get_project_sr_summary_aggregates"
  );

  useEffect(() => {
    if (projectId) {
      aggregateResponse
        .call({ project_id: projectId })
        .then((res) => setSRAggregates((prev) => ({ ...prev, ...res.message })))
        .catch(() => {
          setSRAggregates({
            total_sr_value_inc_gst: 0,
            total_sr_value_excl_gst: 0,
            total_amount_paid_for_srs: 0,
          });
        });
      return;
    }

    setSRAggregates({
      total_sr_value_inc_gst: 0,
      total_sr_value_excl_gst: 0,
      total_amount_paid_for_srs: 0,
    });
  }, [projectId]);

  useApiErrorLogger(aggregateResponse.error, {
    hook: "useProjectSRAggregates",
    api: "get_project_sr_summary_aggregates",
    feature: "projects-tab-sr-summary",
    entity_id: projectId,
  });

  return {
    srAggregates,
    aggregatesLoading: aggregateResponse.loading,
    aggregatesError: aggregateResponse.error,
  };
};

export const useProjectSRSupportingData = (projectId?: string) => {
  const projectsResponse = useFrappeGetDocList<Projects>(
    "Projects",
    {
      fields: ["name", "project_name"],
      filters: projectId ? [["name", "=", projectId]] : [],
      limit: projectId ? 1 : 1000,
    },
    srSummaryKeys.projects(projectId)
  );

  useApiErrorLogger(projectsResponse.error, {
    hook: "useProjectSRSupportingData",
    api: "Projects List",
    feature: "projects-tab-sr-summary",
    entity_id: projectId,
  });

  return { projectsResponse };
};
