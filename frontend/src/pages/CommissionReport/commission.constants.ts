// frontend/src/pages/CommissionReport/commission.constants.ts

export const COMMISSION_REPORT_DOCTYPE = 'Project Commission Report';
export const COMMISSION_CATEGORY_DOCTYPE = 'Commission Report Category';
export const COMMISSION_TASK_MASTER_DOCTYPE = 'Commission Report Tasks';
export const COMMISSION_TEMPLATE_SNAPSHOT_DOCTYPE = 'Commission Report Template Snapshot';
export const NIRMAAN_ATTACHMENTS_DOCTYPE = 'Nirmaan Attachments';
export const COMMISSION_REPORT_CHILD_DOCTYPE = 'Commission Report Task Child Table';
export const PROJECTS_DOCTYPE = 'Projects';
export const WORK_PACKAGE_DOCTYPE = 'Work Packages';

// Template wizard constants
export const COMMISSION_REPORT_IMAGE_ATTACHMENT_TYPE = 'commission_report_image';
export const COMMISSION_REPORT_RESPONSE_MAX_BYTES = 1024 * 1024; // 1 MB
export const COMMISSION_REPORT_IMAGE_MAX_MB_DEFAULT = 5;

// Wizard image uploads use the standard Frappe File doctype attached to the
// child task row — same pattern as Inflow Payments (`useFrappeFileUpload`).
// The `fieldname` is purely a marker that lets the orphan janitor/cleanup
// scope its query to wizard-uploaded files only.
export const COMMISSION_REPORT_FILE_FIELDNAME = 'commission_report_image';

/**
 * Standardized SWR Cache Keys for Commission Report feature
 */
export const commissionKeys = {
    trackerList: () => ['commission', 'tracker-list'] as const,
    trackerDoc: (trackerId: string) => ['commission', 'tracker-doc', trackerId] as const,
    masterData: () => ['commission', 'master-data'] as const,
    projectAssignees: (projectId: string) => ['commission', 'project-assignees', projectId] as const,
    categoryList: (orderBy?: { field: string; order: 'asc' | 'desc' }) =>
        ['commission', 'category-list', orderBy?.field ?? null, orderBy?.order ?? null] as const,
    taskList: (orderBy?: { field: string; order: 'asc' | 'desc' }) =>
        ['commission', 'task-list', orderBy?.field ?? null, orderBy?.order ?? null] as const,
    workPackageList: (orderBy?: { field: string; order: 'asc' | 'desc' }) =>
        ['commission', 'work-package-list', orderBy?.field ?? null, orderBy?.order ?? null] as const,
    projectZones: (projectId: string) => ['commission', 'project-zones', projectId] as const,

    // Template wizard cache keys
    reportTemplate: (taskMasterName: string) => ['commission', 'report-template', taskMasterName] as const,
    reportPrefill: (projectId: string) => ['commission', 'report-prefill', projectId] as const,
    reportSnapshot: (snapshotHash: string) => ['commission', 'report-snapshot', snapshotHash] as const,
};
