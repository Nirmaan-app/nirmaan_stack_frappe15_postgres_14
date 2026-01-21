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
];

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

export const VENDOR_TYPE_OPTIONS = [
    { label: "Material", value: "Material" },
    { label: "Service", value: "Service" },
    { label: "Material & Service", value: "Material & Service" },
];

export const CATEGORY_LIST_FIELDS_FOR_FACETS: (keyof CategoryType | 'name' | 'work_package')[] = [
    'name',
    'work_package',
];