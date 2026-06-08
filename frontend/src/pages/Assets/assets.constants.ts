import { SearchFieldOption } from '@/components/data-table/new-data-table';

// Doctype names
export const ASSET_CATEGORY_DOCTYPE = 'Asset Category';
export const ASSET_MASTER_DOCTYPE = 'Asset Master';
export const ASSET_MANAGEMENT_DOCTYPE = 'Asset Management';

// Asset Category fields
export const ASSET_CATEGORY_FIELDS = [
    'name',
    'asset_category',
    'category_type',
    'creation',
    'modified',
] as const;

// Asset Category types
export type AssetCategoryType = 'Project' | 'IT';

export const ASSET_CATEGORY_TYPE_OPTIONS: { label: AssetCategoryType; value: AssetCategoryType }[] = [
    { label: 'Project', value: 'Project' },
    { label: 'IT', value: 'IT' },
];

// Asset Master fields
export const ASSET_MASTER_FIELDS = [
    'name',
    'asset_name',
    'asset_description',
    'asset_category',
    'asset_condition',
    'asset_serial_number',
    'asset_value',
    'asset_email',
    'current_assignee',
    'creation',
    'modified',
] as const;

// Asset Management fields (for assignment details)
export const ASSET_MANAGEMENT_FIELDS = [
    'name',
    'asset',
    'asset_assigned_to',
    'asset_assigned_on',
    'asset_declaration_attachment',
    'creation',
] as const;

// Searchable fields for Asset Master
export const ASSET_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "asset_name", label: "Asset Name", placeholder: "Search by asset name...", default: true },
    { value: "name", label: "Asset ID", placeholder: "Search by asset ID..." },
    { value: "asset_serial_number", label: "Serial Number", placeholder: "Search by serial number..." },
    { value: "asset_category", label: "Category", placeholder: "Search by category..." },
];

// Date columns for filtering
export const ASSET_DATE_COLUMNS: string[] = ["creation"];

// Asset condition options
export const ASSET_CONDITION_OPTIONS = [
    { label: "New", value: "New" },
    { label: "Good", value: "Good" },
    { label: "Fair", value: "Fair" },
    { label: "Poor", value: "Poor" },
    { label: "Damaged", value: "Damaged" },
];

// Assignment status options (derived from current_assignee field)
export const ASSIGNMENT_STATUS_OPTIONS = [
    { label: "Assigned", value: "assigned" },
    { label: "Unassigned", value: "unassigned" },
];

// Searchable fields for Asset Management (Assigned Assets)
export const ASSET_MANAGEMENT_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "asset", label: "Asset ID", placeholder: "Search by asset ID...", default: true },
    { value: "asset_assigned_to", label: "Assigned To", placeholder: "Search by assignee..." },
];

// Date columns for Asset Management
export const ASSET_MANAGEMENT_DATE_COLUMNS: string[] = ["asset_assigned_on", "creation"];

// Declaration status options
export const DECLARATION_STATUS_OPTIONS = [
    { label: "Uploaded", value: "uploaded" },
    { label: "Pending", value: "pending" },
];

// Centralized SWR cache keys for consistent cross-component invalidation
export const ASSET_CACHE_KEYS = {
    // Summary counts (global — used by Categories tab)
    CATEGORIES_COUNT: `${ASSET_CATEGORY_DOCTYPE}_summary`,
    TOTAL_ASSETS_COUNT: `${ASSET_MASTER_DOCTYPE}_total_summary`,
    ASSIGNED_ASSETS_COUNT: `${ASSET_MASTER_DOCTYPE}_assigned_summary`,
    UNASSIGNED_ASSETS_COUNT: `${ASSET_MASTER_DOCTYPE}_unassigned_summary`,
    PENDING_DECLARATION_COUNT: `${ASSET_MANAGEMENT_DOCTYPE}_pending_summary`,

    // Summary counts scoped to Project-type assets
    PROJECT_TOTAL_ASSETS_COUNT: `${ASSET_MASTER_DOCTYPE}_total_summary_project`,
    PROJECT_ASSIGNED_ASSETS_COUNT: `${ASSET_MASTER_DOCTYPE}_assigned_summary_project`,
    PROJECT_UNASSIGNED_ASSETS_COUNT: `${ASSET_MASTER_DOCTYPE}_unassigned_summary_project`,
    PROJECT_PENDING_DECLARATION_COUNT: `${ASSET_MANAGEMENT_DOCTYPE}_pending_summary_project`,

    // Summary counts scoped to IT-type assets
    IT_TOTAL_ASSETS_COUNT: `${ASSET_MASTER_DOCTYPE}_total_summary_it`,
    IT_ASSIGNED_ASSETS_COUNT: `${ASSET_MASTER_DOCTYPE}_assigned_summary_it`,
    IT_UNASSIGNED_ASSETS_COUNT: `${ASSET_MASTER_DOCTYPE}_unassigned_summary_it`,
    IT_PENDING_DECLARATION_COUNT: `${ASSET_MANAGEMENT_DOCTYPE}_pending_summary_it`,

    // Category dropdowns (shared across all dialogs)
    CATEGORIES_DROPDOWN: `${ASSET_CATEGORY_DOCTYPE}_dropdown`,

    // Category-name lists by type (used by useAssetCategoryNamesByType)
    PROJECT_CATEGORIES_NAMES: `${ASSET_CATEGORY_DOCTYPE}_names_project`,
    IT_CATEGORIES_NAMES: `${ASSET_CATEGORY_DOCTYPE}_names_it`,

    // Asset Management (for individual asset assignments)
    assetManagement: (assetId: string) => `${ASSET_MANAGEMENT_DOCTYPE}_${assetId}`,
} as const;
