/**
 * Authorization for managing Tendering stubs.
 *
 * Create / edit / delete / convert of Tendering projects mirrors today's
 * project-creation permission: Nirmaan Admin + PMO Executive (plus the
 * Administrator user, whose role is hardcoded to Admin in `useUserData`).
 *
 * Used by the lightweight stub detail view and the Tendering list-tab row
 * actions to gate Edit / Delete (Convert is Slice 7).
 */
export const TENDERING_MANAGER_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
] as const;

/**
 * Whether the current user may edit/delete a Tendering stub.
 *
 * @param role    The user's role_profile (from `useUserData()`).
 * @param userId  The user_id (from `useUserData()`); "Administrator" is allowed.
 */
export const canManageTendering = (role?: string, userId?: string): boolean =>
  userId === "Administrator" ||
  (role ? (TENDERING_MANAGER_ROLES as readonly string[]).includes(role) : false);
