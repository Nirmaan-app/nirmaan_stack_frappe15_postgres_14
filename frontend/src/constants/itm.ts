/**
 * Roles allowed to create Internal Transfer Memos (from Inventory Item-Wise CTA).
 */
export const ITM_CREATE_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Procurement Executive Profile",
] as const;

/**
 * Roles allowed to approve or reject an ITM (Admin-only per design).
 * NOTE: Administrator user is treated as Admin elsewhere via useUserData hook.
 */
export const ITM_APPROVE_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
] as const;

/**
 * Roles allowed to delete a pre-dispatch ITM (Creator may also delete their own).
 */
export const ITM_DELETE_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
] as const;

/**
 * Roles allowed to dispatch an approved ITM.
 */
export const ITM_DISPATCH_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan Procurement Executive Profile",
] as const;

/**
 * Roles allowed to view the Internal Transfer Memos module (list + detail).
 */
export const ITM_VIEW_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Procurement Executive Profile",
  "Nirmaan Project Lead Profile",
  "Nirmaan Project Manager Profile",
] as const;
