
/**
 * @file approvedQuotations.constants.ts
 * @description Defines constants, API field lists, and filter logic for the Approved Quotations feature.
 */
import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ApprovedQuotations as ApprovedQuotationsType } from "@/types/NirmaanStack/ApprovedQuotations";
import { Items as ItemsType } from "@/types/NirmaanStack/Items";

export const APPROVED_QUOTATION_DOCTYPE = 'Approved Quotations';
export const ITEM_DOCTYPE = 'Items';

export const AQ_LIST_FIELDS_TO_FETCH: (keyof ApprovedQuotationsType | 'name')[] = [
    'name', 'creation', 'item_id', 'item_name', 'unit', 'quantity', 'quote',
    'tax', 'make', 'vendor', 'procurement_order', 'category',
];
export const AQ_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "item_name", label: "Item Name", placeholder: "Search by item name...", default: true },
    { value: "name", label: "Quote ID", placeholder: "Search by quote ID..." },
    { value: "quote", label: "Quote", placeholder: "Search by quote..." },
    { value: "unit", label: "Unit", placeholder: "Search by unit..." },
    { value: "procurement_order", label: "PO Number", placeholder: "Search by PO number..." },
    { value: "make", label: "Make", placeholder: "Search by make..." },
];
export const AQ_DATE_COLUMNS: string[] = ["creation", "modified"];

// This is an interface for the object we will use to store selected items.
// It holds both the unique ID (value) for filtering and the display name (label).
export interface SelectedItem {
    value: string; 
    label: string;
}

/**
 * --- THIS IS THE CRITICAL FIX ---
 * Generates filters for multiple items using their unique IDs.
 * @param {SelectedItem[]} items - An array of selected item objects.
 * @returns {Array<[string, string, any]>} - The array of Frappe filters.
 */
export const getItemsStaticFilters = (items: SelectedItem[]): Array<[string, string, any]> => {
    if (!items || items.length === 0) return [];
    const itemIds = items.map(item => item.value); // Extract the unique IDs
    return [
        ["item_id", "in", itemIds] // Filter by the 'item_id' Link field
    ];
};

export const getSingleItemStaticFilters = (productId?: string): Array<[string, string, any]> => {
    if (!productId) return [];
    return [["item_id", "=", productId]];
};

export const ALL_ITEMS_CACHE_KEY = 'allItemsMasterList';

