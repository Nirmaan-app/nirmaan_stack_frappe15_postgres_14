// Who may start which transfer on the New Transfer page. `allowedTransferDirections` in
// utils/itmTransfer.ts reads these lists, and the "Create Internal Transfer Memo"
// buttons show for anyone it gives at least one direction.
import { MATERIAL_PROCUREMENT_PROFILES } from "@/constants/roles";

/**
 * Roles allowed every direction: Project → Project, Project → Warehouse, Warehouse → Project,
 * from any project to ANY Won project, whatever projects they are assigned to (rule set by
 * Abhishek, 2026-10-16). Mirrors `DESTINATION_PROFILES` in
 * `api/internal_transfers/get_transfer_destinations.py`, which serves their "To Project" list.
 */
export const ITM_CREATE_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  ...MATERIAL_PROCUREMENT_PROFILES,
] as const;

/**
 * Roles allowed Project → Warehouse ONLY: they return their projects' surplus to the
 * warehouse, and never move stock between projects or out of the warehouse. Rule set by
 * Abhishek (manager), 2026-10-16. Their source projects are limited to their own:
 * ITM_SOURCE_SCOPED_ROLES.
 */
export const ITM_PROJECT_RETURN_ROLES: readonly string[] = [
  "Nirmaan Project Manager Profile",
  "Nirmaan Project Lead Profile",
] as const;

/**
 * Roles whose "From Project" list is limited to projects they can read (their User
 * Permissions, i.e. their assigned projects). Without it a Project Manager or Lead could
 * return any project's stock. Procurement is deliberately not here: some of those users
 * are project-scoped too, and they have always picked from every project's stock.
 */
export const ITM_SOURCE_SCOPED_ROLES: readonly string[] = [
  "Nirmaan Project Manager Profile",
  "Nirmaan Project Lead Profile",
] as const;

/**
 * Roles allowed to approve or reject an ITM (Admin-only per design).
 * NOTE: Administrator user is treated as Admin elsewhere via useUserData hook.
 */
export const ITM_APPROVE_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
] as const;

/**
 * Roles allowed to delete a pre-dispatch ITM. Mirrors backend ``DELETE_ROLES``
 * in ``integrations/controllers/internal_transfer_memo.py``. Creator-eligible
 * profiles can clean up an Approved ITM regardless of who originally raised it.
 */
export const ITM_DELETE_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  ...MATERIAL_PROCUREMENT_PROFILES,
] as const;

/**
 * Roles allowed to dispatch an approved ITM. Mirrors backend ``DISPATCH_ROLES``
 * in ``integrations/controllers/internal_transfer_memo.py``.
 */
export const ITM_DISPATCH_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  ...MATERIAL_PROCUREMENT_PROFILES,
] as const;

/**
 * Roles allowed to view the Internal Transfer Memos module (list + detail).
 */
export const ITM_VIEW_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  ...MATERIAL_PROCUREMENT_PROFILES,
  "Nirmaan Project Lead Profile",
  "Nirmaan Project Manager Profile",
] as const;
