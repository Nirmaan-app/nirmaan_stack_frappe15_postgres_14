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
    // Monthly asset audit (owner, 2026-10-14): assigned assets of a ticked category are audited.
    'audit_required',
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
    'department',
    'asset_condition',
    'asset_serial_number',
    'asset_value',
    'project',
    'asset_city',
    'asset_state',
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

/**
 * The assignment plus its receive fields (owner, 2026-10-13): the profile cards. Kept apart from
 * ASSET_MANAGEMENT_FIELDS so the other lists don't need the columns. Returns were removed (2026-10-26).
 */
export const ASSET_MANAGEMENT_RETURN_FIELDS = [
    ...ASSET_MANAGEMENT_FIELDS,
    'received',
    'received_on',
] as const;

/**
 * The assignment plus its monthly-audit fields (owner, 2026-10-14): the profile cards, the sidebar
 * badge and the Asset Audit tab's Pending list. The server writes them; nobody types them.
 */
export const ASSET_MANAGEMENT_AUDIT_FIELDS = [
    ...ASSET_MANAGEMENT_RETURN_FIELDS,
    'audit_status',
    'audit_month',
    'last_audit_on',
    'audit_proof',
    'audit_overdue_since',
] as const;

/**
 * The audit fields plus the latest audit's answers (owner, 2026-10-15) -- for the screens that show "View
 * answers" (the profile cards). Kept apart so the data tables don't fetch the JSON for every row.
 */
export const ASSET_MANAGEMENT_AUDIT_ANSWER_FIELDS = [
    ...ASSET_MANAGEMENT_AUDIT_FIELDS,
    'audit_answers',
] as const;

// Searchable fields for Asset Master
export const ASSET_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "asset_name", label: "Asset Name", placeholder: "Search by asset name...", default: true },
    { value: "name", label: "Asset ID", placeholder: "Search by asset ID..." },
    { value: "asset_serial_number", label: "Serial Number", placeholder: "Search by serial number..." },
    { value: "asset_category", label: "Category", placeholder: "Search by category..." },
    { value: "department", label: "Department", placeholder: "Search by department..." },
];

// Extra searchable fields shown only on the Project Assets tab
export const PROJECT_ASSET_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    ...ASSET_SEARCHABLE_FIELDS,
    { value: "project", label: "Project", placeholder: "Search by project ID..." },
    { value: "asset_city", label: "City", placeholder: "Search by city..." },
    { value: "asset_state", label: "State", placeholder: "Search by state..." },
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
    // Per-category counts: all assets, and the ones someone holds (useCategoryAssetCounts)
    CATEGORY_ASSET_COUNTS: 'asset_counts_by_category',
    CATEGORY_ASSIGNED_COUNTS: 'assigned_asset_counts_by_category',

    // Category dropdowns (shared across all dialogs)
    CATEGORIES_DROPDOWN: `${ASSET_CATEGORY_DOCTYPE}_dropdown`,

    // Projects dropdown (Project-Asset project/city/state picker)
    PROJECTS_DROPDOWN: `${ASSET_MASTER_DOCTYPE}_projects_dropdown`,
    /** Every Won project, for the Project pickers (api/assets/projects.get_won_projects). */
    WON_PROJECTS: `${ASSET_MASTER_DOCTYPE}_won_projects`,

    // Category-name lists by type (used by useAssetCategoryNamesByType)
    PROJECT_CATEGORIES_NAMES: `${ASSET_CATEGORY_DOCTYPE}_names_project`,
    IT_CATEGORIES_NAMES: `${ASSET_CATEGORY_DOCTYPE}_names_it`,

    // Asset Management (for individual asset assignments)
    assetManagement: (assetId: string) => `${ASSET_MANAGEMENT_DOCTYPE}_${assetId}`,

    // Monthly asset audit: the open audits (useAuditPending), their assets, and the Fulfilled list
    // (a prefix: one key per tab + month + page).
    AUDIT_PENDING: `${ASSET_MANAGEMENT_DOCTYPE}_audit_pending`,
    auditPendingAssets: (assetIds: string[]) => `${ASSET_MASTER_DOCTYPE}_audit_pending:${assetIds.join('|')}`,
    AUDIT_FULFILLED_PREFIX: 'asset_audit_fulfilled:',
    AUDITED_CATEGORIES: `${ASSET_CATEGORY_DOCTYPE}_audited`,
} as const;
