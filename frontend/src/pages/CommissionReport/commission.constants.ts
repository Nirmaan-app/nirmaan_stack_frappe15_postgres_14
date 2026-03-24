// frontend/src/pages/CommissionReport/commission.constants.ts

export const COMMISSION_REPORT_DOCTYPE = 'Project Commission Report';
export const COMMISSION_CATEGORY_DOCTYPE = 'Commission Report Category';
export const COMMISSION_TASK_MASTER_DOCTYPE = 'Commission Report Tasks';
export const PROJECTS_DOCTYPE = 'Projects';
export const WORK_PACKAGE_DOCTYPE = 'Work Packages';

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
};
