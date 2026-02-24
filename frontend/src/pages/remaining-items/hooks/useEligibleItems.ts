import { useMemo } from "react";
import { useMaterialUsageData } from "@/pages/projects/hooks/useMaterialUsageData";

export interface EligibleItem {
  itemId: string;
  itemName: string;
  unit: string;
  category: string;
  dnQuantity: number;
  maxQuote: number;
}

export function useEligibleItems(projectId: string) {
  const { allMaterialUsageItems, isLoading, error } = useMaterialUsageData(projectId);

  const eligibleItems = useMemo((): EligibleItem[] => {
    if (!allMaterialUsageItems) return [];

    return allMaterialUsageItems
      .filter((item) => {
        const maxQuote = Math.max(
          ...(item.poNumbers?.map((p) => p.quote ?? 0) ?? [0])
        );
        return maxQuote > 5000;
      })
      .map((item) => {
        const maxQuote = Math.max(
          ...(item.poNumbers?.map((p) => p.quote ?? 0) ?? [0])
        );
        return {
          itemId: item.itemId || "",
          itemName: item.itemName || "",
          unit: item.unit || "",
          category: item.categoryName,
          dnQuantity: item.deliveredQuantity,
          maxQuote,
        };
      });
  }, [allMaterialUsageItems]);

  return { eligibleItems, isLoading, error };
}
