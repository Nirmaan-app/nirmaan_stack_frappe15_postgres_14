import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ApprovedQuotations as ApprovedQuotationsType } from "@/types/NirmaanStack/ApprovedQuotations";
import { Vendors as VendorsType } from "@/types/NirmaanStack/Vendors";
import { Items as ItemsType } from "@/types/NirmaanStack/Items"; // If needed for linking or facets
import { Category as CategoryType } from "@/types/NirmaanStack/Category"; // If needed for linking or facets


export const APPROVED_QUOTATION_DOCTYPE = 'Approved Quotations';
export const VENDOR_DOCTYPE = 'Vendors';
export const ITEM_DOCTYPE = 'Items';
export const CATEGORY_DOCTYPE = 'Category';

export const AQ_LIST_FIELDS_TO_FETCH: (keyof ApprovedQuotationsType | 'name')[] = [
    'name', // Quote ID
    'creation',
    'item_id', // Link to Items 
    'item_name',
    'unit',
    'quantity',  
    'quote', // Assuming this is the quoted amount
    'tax',
    'make',
    'vendor', // Link to Vendors
    'procurement_order', // Link to PO
    'category', // Link to Category
    //"procurement_package"//Link to Procurement Package
    // 'city', 'state' - these seem to be on the Approved Quotation itself, confirm if they should be fetched
];

export const AQ_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "item_name", label: "Item Name", placeholder: "Search by item name...", default: true },
    { value: "name", label: "Quote ID", placeholder: "Search by quote ID..." },
    { value: "quote", label: "Quote", placeholder: "Search by quote..." },
    { value: "unit", label: "Unit", placeholder: "Search by unit..." },
    // { value: "vendor_name", label: "Vendor Name", placeholder: "Search by vendor name...", is_lookup: true, lookup_doctype: VENDOR_DOCTYPE, lookup_search_field: "vendor_name", lookup_value_field: "name", target_filter_field: "vendor" }, // Advanced: requires backend mapping or client-side enrichment
    { value: "procurement_order", label: "PO Number", placeholder: "Search by PO number..." },
    { value: "make", label: "Make", placeholder: "Search by make..." },
];
// Note on vendor_name search:
// If you want to search by vendor_name directly when the AQ table stores `vendor` (ID),
// the backend API needs to support joining or looking up.
// Simpler approach: facet filter by Vendor, search by vendor ID.
// For now, let's assume user searches by vendor ID if selecting 'Vendor' as search field,
// or we rely on facet filters. If a direct text search on vendor_name is needed against the AQ doctype (which has vendor ID),
// it's more complex. The `is_lookup` is a conceptual idea here.

export const AQ_DATE_COLUMNS: string[] = ["creation", "modified"];

// Fields to fetch from Vendors for select options / display
export const VENDOR_LOOKUP_FIELDS: (keyof VendorsType | 'name')[] = ['name', 'vendor_name'];
// Fields to fetch from Items for select options / display
export const ITEM_LOOKUP_FIELDS: (keyof ItemsType | 'name')[] = ['name', 'item_name'];
// Fields to fetch from Category for select options / display
export const CATEGORY_LOOKUP_FIELDS: (keyof CategoryType | 'name')[] = ['name'];

// Function to get static filters based on props like customerId
export const getItemStaticFilters = (item_name?: string): Array<[string, string, any]> => {
    const filters: Array<[string, string, any]> = [];
    if (item_name) {
        filters.push(["item_id", "=", item_name]);
    }
    return filters;
};