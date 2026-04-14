import { ServiceItemType } from "./schema";

/**
 * Reorders a list of service items such that they are grouped by category.
 * Preserves the order of categories by their first appearance in the input list.
 * Preserves the relative order of items within each category.
 * 
 * @param items - The list of service items to reorder
 * @returns A new array with items grouped by category
 */
export function groupItemsByCategoryFlat(items: ServiceItemType[]): ServiceItemType[] {
    if (!items || items.length === 0) return [];

    const uniqueCategories: string[] = [];
    const categoryGroups: Record<string, ServiceItemType[]> = {};

    items.forEach((item) => {
        const cat = item.category;
        if (!categoryGroups[cat]) {
            uniqueCategories.push(cat);
            categoryGroups[cat] = [];
        }
        categoryGroups[cat].push(item);
    });

    return uniqueCategories.flatMap((cat) => categoryGroups[cat]);
}
