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

/** Which side of step 1 a line belongs to: picked from the rate card, or typed in by hand. */
export type ServiceItemKind = "approved" | "custom";

/**
 * A rate-card item carries `standard_rate`; a custom item leaves it unset.
 * This is the one test for "custom" — the column split and the editable
 * description/unit both read it.
 */
export function isCustomServiceItem(item: Pick<ServiceItemType, "standard_rate">): boolean {
    return item.standard_rate === undefined || item.standard_rate === null;
}

export interface PackageOption {
    value: string;
    label: string;
    /** True when the package has at least one rate-card (approved) service. */
    hasItems: boolean;
}

/**
 * The package picker lists every package in one alphabetical list, whether or
 * not it has rate-card services; `hasItems` only drives the Service Type choice.
 */
export function orderPackageOptions(
    withItems: Array<{ value: string; label: string }>,
    withoutItems: Array<{ value: string; label: string }>,
): PackageOption[] {
    return [
        ...withItems.map((c) => ({ value: c.value, label: c.label, hasItems: true })),
        ...withoutItems.map((c) => ({ value: c.value, label: c.label, hasItems: false })),
    ].sort((a, b) => a.label.localeCompare(b.label));
}

export interface IndexedServiceItem {
    /** Position in the form's `items` array — edits and deletes address the row by it. */
    index: number;
    item: ServiceItemType;
}

/**
 * Every line, approved and custom together, grouped by package in order of
 * first appearance. Each line keeps its index in the full `items` array so an
 * edit made in the table lands on the right row.
 */
export function groupItemsByPackage(items: ServiceItemType[]): Array<[string, IndexedServiceItem[]]> {
    const groups = new Map<string, IndexedServiceItem[]>();
    items.forEach((item, index) => {
        const bucket = groups.get(item.category);
        if (bucket) bucket.push({ index, item });
        else groups.set(item.category, [{ index, item }]);
    });
    return Array.from(groups.entries());
}
