import React, { useEffect, useMemo, useState } from 'react';
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from 'frappe-react-sdk';
import { Accordion } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectEstimates } from '@/types/NirmaanStack/ProjectEstimates';
import { po_item_data_item } from '../project';
import { CategoryAccordionItem } from './CategoryAccordionItem';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';

interface ProjectMaterialUsageTabProps {
    projectId: string;
}

// Combined structure for display in the inner table
export interface MaterialUsageDisplayItem {
  itemId?: string;          // From PO or Estimate
  itemName?: string;        // From PO or Estimate
  unit?: string;            // From PO (or UOM from Estimate)
  orderedQuantity: number;
  deliveredQuantity: number;
  estimatedQuantity?: number;
  // Optional: Add PO numbers if you want to list them per item
  poNumbers?: string[];
}

export interface CategorizedMaterialUsage {
  categoryName: string;
  items: MaterialUsageDisplayItem[];
}

// Helper to parse numbers safely
const safeParseFloat = (value: string | number | undefined | null, defaultValue = 0): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? defaultValue : parsed;
    }
    return defaultValue;
};

export const ProjectMaterialUsageTab: React.FC<ProjectMaterialUsageTabProps> = ({ projectId }) => {
    // 1. Fetch PO Summary data (item-wise)


    const { data: po_item_data, isLoading: po_item_loading, error: po_item_error } = useFrappeGetCall<{
        message: {
          po_items: po_item_data_item[],
          custom_items: po_item_data_item[]
        }
      }>(
        "nirmaan_stack.api.procurement_orders.generate_po_summary",
        { project_id: projectId }
      );

    // 2. Fetch Project Estimates
    const {
        data: projectEstimates,
        isLoading: estimatesLoading,
        error: estimatesError,
    } = useFrappeGetDocList<ProjectEstimates>('Project Estimates', {
        fields: ['name', 'project', 'work_package', 'category', 'item', 'item_name', 'uom', 'quantity_estimate'],
        filters: [['project', '=', projectId]],
        limit: 100000, // Fetch all for the project
    }, `project_estimates_${projectId}`); // SWR key

    // useEffect(() => {
    //     if (projectId) {
    //         fetchPoSummary({ project_id: projectId });
    //     }
    // }, [projectId, fetchPoSummary]);

    // 3. Process and combine data
    const categorizedUsageData = useMemo((): CategorizedMaterialUsage[] => {
        if (!po_item_data?.message || !projectEstimates) {
            return [];
        }

        const allPoItems = [...(po_item_data.message.po_items || []), ...(po_item_data.message.custom_items || [])];

        // Create a map for quick lookup of estimates by item_id (and optionally wp/category for more precision)
        const estimatesMap = new Map<string, ProjectEstimates>();
        projectEstimates.forEach(est => {
            // Create a composite key if needed, e.g., `${est.item}_${est.work_package}`
            // For simplicity, using item ID assuming it's unique enough in this context or
            // that the PO item's category/WP will guide selection.
            if (est.item) {
                estimatesMap.set(est.item, est);
            }
        });

        const usageByItem = new Map<string, MaterialUsageDisplayItem>();

        allPoItems.forEach(poItem => {
            if (!poItem.item_id || !poItem.category) return; // Skip items without ID or category

            const key = `${poItem.category}_${poItem.item_id}`; // Group by category AND item
            let currentItemUsage = usageByItem.get(key);

            if (!currentItemUsage) {
                const estimate = estimatesMap.get(poItem.item_id);
                currentItemUsage = {
                    itemId: poItem.item_id,
                    itemName: poItem.item_name || estimate?.item_name,
                    unit: poItem.unit || estimate?.uom,
                    orderedQuantity: 0,
                    deliveredQuantity: 0,
                    estimatedQuantity: safeParseFloat(estimate?.quantity_estimate),
                    poNumbers: [], // Initialize PO numbers array
                };
            }

            currentItemUsage.orderedQuantity += safeParseFloat(poItem.quantity);
            currentItemUsage.deliveredQuantity += safeParseFloat(poItem.received);
            if (poItem.po_number && !currentItemUsage.poNumbers?.includes(poItem.po_number)) {
                currentItemUsage.poNumbers?.push(poItem.po_number);
            }
            
            usageByItem.set(key, currentItemUsage);
        });

        // Now group by category
        const byCategory = new Map<string, MaterialUsageDisplayItem[]>();
        usageByItem.forEach((usage, key) => {
            const categoryName = key.split('_')[0]; // Extract category from the key
            if (!byCategory.has(categoryName)) {
                byCategory.set(categoryName, []);
            }
            byCategory.get(categoryName)!.push(usage);
        });
        
        const result: CategorizedMaterialUsage[] = [];
        byCategory.forEach((items, categoryName) => {
            result.push({ categoryName, items });
        });

        // Sort categories alphabetically
        result.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
        // Sort items within each category
        result.forEach(cat => cat.items.sort((a,b) => (a.itemName || "").localeCompare(b.itemName || "")));

        return result;

    }, [po_item_data, projectEstimates]);

    // --- NEW: Create an array of all category names to be open by default ---
    const defaultOpenCategories = useMemo(() => {
      return categorizedUsageData.map(categoryData => categoryData.categoryName);
    }, [categorizedUsageData]);
  // --- END NEW ---

    // Loading and Error States
    if (po_item_loading || estimatesLoading) {
        return (
            <div className="space-y-4 p-4">
                <Skeleton className="h-12 w-1/3" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
            </div>
        );
    }

    const error = po_item_error || estimatesError;

    if (error) {
        return (
            <AlertDestructive error={error} />
        );
    }

    if (categorizedUsageData.length === 0) {
        return <div className="p-4 text-center text-muted-foreground">No material usage data found for this project.</div>;
    }

    return (
        <div className="">
            {/* <h2 className="text-2xl font-semibold mb-6">Project Material Usage</h2> */}
            <Accordion type="multiple" 
            defaultValue={defaultOpenCategories}
            className="w-full space-y-3">
                {categorizedUsageData.map((categoryData, index) => (
                    <CategoryAccordionItem
                        key={categoryData.categoryName || `category-${index}`}
                        categoryName={categoryData.categoryName}
                        items={categoryData.items}
                        projectId={projectId} // Pass projectId if needed by inner component for more lookups
                    />
                ))}
            </Accordion>
        </div>
    );
};


export default ProjectMaterialUsageTab;