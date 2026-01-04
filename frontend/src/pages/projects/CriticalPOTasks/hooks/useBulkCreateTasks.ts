import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { calculatePOReleaseDate } from "../utils/calculatePODate";
import { CriticalPOItem } from "@/pages/CriticalPOCategories/components/CriticalPOCategoriesMaster";

interface CreateTasksParams {
  selectedCategoryIds: string[];
  projectId: string;
  projectName: string;
  projectStartDate: string;
}

interface CreateTasksResult {
  success: boolean;
  count?: number;
  error?: any;
}

export const useBulkCreateTasks = () => {
  const { createDoc } = useFrappeCreateDoc();

  const createTasksForCategories = async ({
    selectedCategoryIds,
    projectId,
    projectName,
    projectStartDate,
  }: CreateTasksParams): Promise<CreateTasksResult> => {
    try {
      // Fetch all Critical PO Items for selected categories
      const response = await fetch(
        `/api/resource/Critical PO Items?filters=[["critical_po_category","in",${JSON.stringify(
          selectedCategoryIds
        )}]]&fields=["name","item_name","sub_category","critical_po_category","release_timeline_offset"]&limit=0`,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch Critical PO Items");
      }

      const data = await response.json();
      const items: CriticalPOItem[] = data.data || [];

      if (items.length === 0) {
        return { success: true, count: 0 };
      }

      // Create tasks in sequence (to avoid overwhelming the server)
      const results = [];
      for (const item of items) {
        const poReleaseDate = calculatePOReleaseDate(
          projectStartDate,
          item.release_timeline_offset || 0
        );

        const taskDoc = await createDoc("Critical PO Tasks", {
          project: projectId,
          project_name: projectName,
          critical_po_category: item.critical_po_category,
          item_name: item.item_name,
          sub_category: item.sub_category || "",
          po_release_date: poReleaseDate,
          status: "Not Released",
          associated_pos: JSON.stringify({ pos: [] }),
          revised_date: null,
          remarks: "",
        });

        results.push(taskDoc);
      }

      return { success: true, count: results.length };
    } catch (error: any) {
      console.error("Error creating Critical PO Tasks:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  };

  return { createTasksForCategories };
};
