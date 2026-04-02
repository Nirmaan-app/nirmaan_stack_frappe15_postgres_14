import {
  useFrappeCreateDoc,
  useFrappeDeleteDoc,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { ProjectEstimates as ProjectEstimatesType } from "@/types/NirmaanStack/ProjectEstimates";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { captureApiError } from "@/utils/sentry/captureApiError";

const projectEstimatesKeys = {
  project: (projectId?: string) => ["project-tab", "estimates", "project", projectId] as const,
  estimates: (projectId?: string) => ["project-tab", "estimates", "list", projectId] as const,
  categories: () => ["project-tab", "estimates", "categories"] as const,
  items: () => ["project-tab", "estimates", "items"] as const,
};

export const useProjectEstimatesPageData = (projectId?: string) => {
  const projectResponse = useFrappeGetDoc("Projects", projectId, projectId ? projectEstimatesKeys.project(projectId) : null);

  const estimatesResponse = useFrappeGetDocList<ProjectEstimatesType>(
    "Project Estimates",
    {
      fields: ["*"],
      filters: [["project", "=", projectId]],
      limit: 10000,
    },
    projectId ? projectEstimatesKeys.estimates(projectId) : null
  );

  useApiErrorLogger(projectResponse.error, {
    hook: "useProjectEstimatesPageData",
    api: "Projects Doc",
    feature: "projects-tab-estimates",
    entity_id: projectId,
  });

  useApiErrorLogger(estimatesResponse.error, {
    hook: "useProjectEstimatesPageData",
    api: "Project Estimates List",
    feature: "projects-tab-estimates",
    entity_id: projectId,
  });

  return {
    projectResponse,
    estimatesResponse,
  };
};

export const useProjectEstimatesMasterData = () => {
  const categoriesResponse = useFrappeGetDocList(
    "Category",
    {
      fields: ["category_name", "work_package", "image_url", "tax"],
      orderBy: { field: "category_name", order: "asc" },
      limit: 10000,
    },
    projectEstimatesKeys.categories()
  );

  const itemsResponse = useFrappeGetDocList(
    "Items",
    {
      fields: ["name", "item_name", "make_name", "unit_name", "category", "creation"],
      orderBy: { field: "creation", order: "desc" },
      limit: 100000,
    },
    projectEstimatesKeys.items()
  );

  useApiErrorLogger(categoriesResponse.error, {
    hook: "useProjectEstimatesMasterData",
    api: "Category List",
    feature: "projects-tab-estimates",
  });

  useApiErrorLogger(itemsResponse.error, {
    hook: "useProjectEstimatesMasterData",
    api: "Items List",
    feature: "projects-tab-estimates",
  });

  return {
    categoriesResponse,
    itemsResponse,
  };
};

export const useProjectEstimatesMutations = () => {
  const createDocResponse = useFrappeCreateDoc();
  const updateDocResponse = useFrappeUpdateDoc();
  const deleteDocResponse = useFrappeDeleteDoc();

  const createEstimate = async (payload: Record<string, any>) => {
    try {
      return await createDocResponse.createDoc("Project Estimates", payload);
    } catch (error) {
      captureApiError({
        hook: "useProjectEstimatesMutations",
        api: "Create Project Estimate",
        feature: "projects-tab-estimates",
        doctype: "Project Estimates",
        error,
      });
      throw error;
    }
  };

  const updateEstimate = async (estimateId: string, payload: Record<string, any>) => {
    try {
      return await updateDocResponse.updateDoc("Project Estimates", estimateId, payload);
    } catch (error) {
      captureApiError({
        hook: "useProjectEstimatesMutations",
        api: "Update Project Estimate",
        feature: "projects-tab-estimates",
        doctype: "Project Estimates",
        entity_id: estimateId,
        error,
      });
      throw error;
    }
  };

  const deleteEstimate = async (estimateId: string) => {
    try {
      return await deleteDocResponse.deleteDoc("Project Estimates", estimateId);
    } catch (error) {
      captureApiError({
        hook: "useProjectEstimatesMutations",
        api: "Delete Project Estimate",
        feature: "projects-tab-estimates",
        doctype: "Project Estimates",
        entity_id: estimateId,
        error,
      });
      throw error;
    }
  };

  useApiErrorLogger(createDocResponse.error, {
    hook: "useProjectEstimatesMutations",
    api: "Create Project Estimates",
    feature: "projects-tab-estimates",
  });

  useApiErrorLogger(updateDocResponse.error, {
    hook: "useProjectEstimatesMutations",
    api: "Update Project Estimates",
    feature: "projects-tab-estimates",
  });

  useApiErrorLogger(deleteDocResponse.error, {
    hook: "useProjectEstimatesMutations",
    api: "Delete Project Estimates",
    feature: "projects-tab-estimates",
  });

  return {
    createEstimate,
    updateEstimate,
    deleteEstimate,
    createLoading: createDocResponse.loading,
    updateLoading: updateDocResponse.loading,
    deleteLoading: deleteDocResponse.loading,
  };
};
