import { useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMaterialUsageData } from "@/pages/projects/hooks/useMaterialUsageData";

export interface EligibleItem {
  itemId: string;
  itemName: string;
  unit: string;
  category: string;
  dnQuantity: number;
}

export function useEligibleItems(projectId: string) {
  const { allMaterialUsageItems, isLoading, error } = useMaterialUsageData(projectId);

  const { data: categoryList, isLoading: isCategoryLoading } = useFrappeGetDocList("Category", {
    fields: ["name", "work_package"],
    limit: 0,
  });

  const toolEquipmentCategories = useMemo(() => {
    if (!categoryList) return new Set<string>();
    return new Set<string>(
      categoryList
        .filter((cat) => cat.work_package === "Tool & Equipments")
        .map((cat) => cat.name)
    );
  }, [categoryList]);

  const eligibleItems = useMemo((): EligibleItem[] => {
    if (!allMaterialUsageItems) return [];

    return allMaterialUsageItems
      .filter((item) => !toolEquipmentCategories.has(item.categoryName))
      .filter((item) => item.categoryName !== "Additional Charges")
      .filter((item) => (item.totalAmount ?? 0) > 5000)
      .map((item) => ({
        itemId: item.itemId || "",
        itemName: item.itemName || "",
        unit: item.unit || "",
        category: item.categoryName,
        dnQuantity: item.deliveredQuantity,
      }));
  }, [allMaterialUsageItems, toolEquipmentCategories]);

  return { eligibleItems, isLoading: isLoading || isCategoryLoading, error };
}
