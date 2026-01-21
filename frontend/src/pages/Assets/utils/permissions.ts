/**
 * Asset Module Permission Utilities
 *
 * Centralizes role-based access control for the Assets module.
 * Granular permissions allow different roles to have specific capabilities.
 */

// Roles that can manage ALL aspects of assets (add, edit, delete, assign, categories)
export const ASSET_ADMIN_ROLES = [
    'Nirmaan Admin Profile',
    'Nirmaan PMO Executive Profile',
] as const;

// Roles that can manage assets (add, edit, assign) but not all admin functions
export const ASSET_HR_ROLE = 'Nirmaan HR Executive Profile' as const;

// Roles that have limited asset management capabilities (add assets, assign/unassign)
export const ASSET_PROCUREMENT_ROLE = 'Nirmaan Procurement Executive Profile' as const;

// Combined list of all roles that can access assets module
export const ASSET_ACCESS_ROLES = [
    ...ASSET_ADMIN_ROLES,
    ASSET_HR_ROLE,
    ASSET_PROCUREMENT_ROLE,
] as const;

export interface AssetPermissions {
    /** Can view the Assets module and all lists */
    canViewAssets: boolean;
    /** Can add new assets to the system */
    canAddAsset: boolean;
    /** Can add new asset categories */
    canAddCategory: boolean;
    /** Can assign/unassign assets to users */
    canAssignAsset: boolean;
    /** Can edit existing assets */
    canEditAsset: boolean;
    /** Can delete assets */
    canDeleteAsset: boolean;
    /** Can edit/delete categories */
    canManageCategories: boolean;
}

/**
 * Get granular asset permissions for a user based on their role
 *
 * Permission matrix:
 * | Capability        | Admin/PMO | HR | Procurement |
 * |-------------------|-----------|----| ------------|
 * | View Assets       | ✓         | ✓  | ✓           |
 * | Add Asset         | ✓         | ✓  | ✓           |
 * | Add Category      | ✓         | ✓  | ✗           |
 * | Assign/Unassign   | ✓         | ✓  | ✓           |
 * | Edit Asset        | ✓         | ✓  | ✗           |
 * | Delete Asset      | ✓         | ✓  | ✗           |
 * | Manage Categories | ✓         | ✓  | ✗           |
 */
export function getAssetPermissions(
    userId: string | undefined,
    role: string | undefined | null
): AssetPermissions {
    const isAdmin = userId === 'Administrator';
    const isAdminRole = ASSET_ADMIN_ROLES.includes(role as typeof ASSET_ADMIN_ROLES[number]);
    const isHRRole = role === ASSET_HR_ROLE;
    const isProcurementRole = role === ASSET_PROCUREMENT_ROLE;

    // Full admin access: Administrator user or Admin/PMO roles
    const hasFullAccess = isAdmin || isAdminRole;

    // HR has most capabilities except limited to their domain
    const hasHRAccess = isHRRole;

    // Procurement has limited capabilities
    const hasProcurementAccess = isProcurementRole;

    // Can manage all (for backward compatibility with existing code)
    const canManageAll = hasFullAccess || hasHRAccess;

    return {
        // View: Anyone with asset access can view
        canViewAssets: hasFullAccess || hasHRAccess || hasProcurementAccess,

        // Add Asset: All roles with asset access can add assets
        canAddAsset: hasFullAccess || hasHRAccess || hasProcurementAccess,

        // Add Category: Only admin roles and HR (NOT Procurement)
        canAddCategory: hasFullAccess || hasHRAccess,

        // Assign/Unassign: All roles with asset access can assign
        canAssignAsset: hasFullAccess || hasHRAccess || hasProcurementAccess,

        // Edit Asset: Only admin roles and HR (NOT Procurement)
        canEditAsset: canManageAll,

        // Delete Asset: Only admin roles and HR (NOT Procurement)
        canDeleteAsset: canManageAll,

        // Manage Categories (edit/delete): Only admin roles and HR
        canManageCategories: canManageAll,
    };
}

/**
 * Helper to format role profile name for display
 * Removes "Nirmaan " prefix and " Profile" suffix
 *
 * @example
 * getRoleLabel('Nirmaan Procurement Executive Profile') // "Procurement Executive"
 * getRoleLabel('Nirmaan Admin Profile') // "Admin"
 */
export function getRoleLabel(roleProfile: string | null | undefined): string | null {
    if (!roleProfile) return null;

    return roleProfile
        .replace(/^Nirmaan\s+/, '')
        .replace(/\s+Profile$/, '');
}
