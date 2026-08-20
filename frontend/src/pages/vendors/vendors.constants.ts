// src/features/vendors/constants/vendors.constants.ts
import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { Vendors as VendorsType } from "@/types/NirmaanStack/Vendors"; // Assuming this type includes vendor_category: {categories: string[]}
import { Category as CategoryType } from "@/types/NirmaanStack/Category";

export const VENDOR_DOCTYPE = 'Vendors';
export const CATEGORY_DOCTYPE = 'Category';

export const VENDOR_LIST_FIELDS_TO_FETCH: (keyof VendorsType | 'name' | 'vendor_city' | 'vendor_state' | 'vendor_category')[] = [
    'name',
    'vendor_name',
    'vendor_nickname',
    'creation',
    'vendor_type',
    'vendor_email',
    'vendor_city', 
    'vendor_state',
    'vendor_category',// JSON field: { categories: string[] }
    'vendor_gst',
    'vendor_status',
    'credit_limit',
    'credit_used',
    'available_credit',
    // Optional columns — hidden by default, revealed via the "Toggle columns" menu.
    // Fetched always because both the grid and `exportAllRows` read from this list.
    'account_name',
    'account_number',
    'ifsc',
    'bank_name',
    'bank_branch',
    'vendor_contact_person_name',
    'vendor_mobile',
];

/**
 * Bank / GST / contact columns start unchecked in the "Toggle columns" menu.
 * The user opts in per session (visibility is not persisted), and the CSV export
 * mirrors whatever is visible at the time of export.
 */
export const VENDOR_HIDDEN_COLUMNS: Record<string, boolean> = {
    account_name: false,
    account_number: false,
    ifsc: false,
    bank_name: false,
    bank_branch: false,
    vendor_gst: false,
    vendor_contact_person_name: false,
    vendor_mobile: false,
};

export const VENDOR_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "vendor_name", label: "Vendor Name", placeholder: "Search by name...", default: true },
    { value: "vendor_nickname", label: "Nickname", placeholder: "Search by nickname..." },
    { value: "name", label: "Vendor ID", placeholder: "Search by ID..." },
    { value: "vendor_email", label: "Email", placeholder: "Search by email..." },
    { value: "vendor_gst", label: "GST No.", placeholder: "Search by GST No...." },
    // Note: Searching directly within vendor_category.categories requires backend support.
    // For now, if 'category' is a searchable field, it might refer to a primary category string field if one exists,
    // or a generalized text search might pick it up if the JSON is cast to text.
];

export const VENDOR_DATE_COLUMNS: string[] = ["creation", "modified"];

export const VENDOR_STATUS_OPTIONS = [
    { label: "Active", value: "Active" },
    { label: "On-Hold", value: "On-Hold" },
];

export const VENDOR_TYPE_OPTIONS = [
    { label: "Material", value: "Material" },
    { label: "Service", value: "Service" },
    { label: "Material & Service", value: "Material & Service" },
];

export const CATEGORY_LIST_FIELDS_FOR_FACETS: (keyof CategoryType | 'name' | 'work_package')[] = [
    'name',
    'work_package',
];