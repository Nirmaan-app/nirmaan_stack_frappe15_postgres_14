import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Category } from "@/types/NirmaanStack/Category";
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { captureApiError } from "@/utils/sentry/captureApiError";

const makesTabKeys = {
  categories: () => ["project-tab", "makes", "categories"] as const,
  makesList: () => ["project-tab", "makes", "makes-list"] as const,
  categoryMap: () => ["project-tab", "makes", "category-map"] as const,
};

export const useProjectMakesTabData = () => {
  const updateDocResponse = useFrappeUpdateDoc();

  const categoriesResponse = useFrappeGetDocList<Category>(
    "Category",
    {
      fields: ["name", "category_name"],
      limit: 0,
    },
    makesTabKeys.categories()
  );

  const makesListResponse = useFrappeGetDocList(
    "Makelist",
    {
      fields: ["name", "make_name"],
      limit: 0,
    },
    makesTabKeys.makesList()
  );

  const categoryMakeListResponse = useFrappeGetDocList<CategoryMakelist>(
    "Category Makelist",
    {
      fields: ["make", "category"],
      limit: 0,
    },
    makesTabKeys.categoryMap()
  );

  const updateProjectMakes = async (projectName: string, payload: Record<string, any>) => {
    try {
      return await updateDocResponse.updateDoc("Projects", projectName, payload);
    } catch (error) {
      captureApiError({
        hook: "useProjectMakesTabData",
        api: "Update Project Makes",
        feature: "projects-tab-makes",
        doctype: "Projects",
        entity_id: projectName,
        error,
      });
      throw error;
    }
  };

  useApiErrorLogger(categoriesResponse.error, {
    hook: "useProjectMakesTabData",
    api: "Category List",
    feature: "projects-tab-makes",
  });

  useApiErrorLogger(makesListResponse.error, {
    hook: "useProjectMakesTabData",
    api: "Makelist",
    feature: "projects-tab-makes",
  });

  useApiErrorLogger(categoryMakeListResponse.error, {
    hook: "useProjectMakesTabData",
    api: "Category Makelist",
    feature: "projects-tab-makes",
  });

  return {
    updateProjectMakes,
    updateLoading: updateDocResponse.loading,
    categoriesResponse,
    makesListResponse,
    categoryMakeListResponse,
  };
};
