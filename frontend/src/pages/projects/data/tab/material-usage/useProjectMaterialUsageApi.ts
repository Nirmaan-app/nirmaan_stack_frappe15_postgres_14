import { useFrappeGetCall } from "frappe-react-sdk";

const materialUsageKeys = {
  poSummary: (projectId: string) => ["project-tab", "material-usage", "po-summary", projectId] as const,
  estimates: (projectId: string) => ["project-tab", "material-usage", "estimates", projectId] as const,
  itemCategories: () => ["project-tab", "material-usage", "item-categories"] as const,
  poDeliveryDocs: (projectId: string) => ["project-tab", "material-usage", "po-delivery-docs", projectId] as const,
  remainingQuantities: (projectId: string) => ["project-tab", "material-usage", "remaining-quantities", projectId] as const,
};

export const useMaterialUsageRemainingQuantities = (projectId: string) => {
  return useFrappeGetCall<{
    message: {
      report_date: string | null;
      submitted_by: string | null;
      submitted_by_full_name: string | null;
      items: Record<string, { remaining_quantity: number | null; dn_quantity: number | null }>;
    };
  }>(
    "nirmaan_stack.api.remaining_items_report.get_latest_remaining_quantities",
    { project: projectId },
    projectId ? materialUsageKeys.remainingQuantities(projectId) : undefined
  );
};
