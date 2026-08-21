/**
 * Snag List — the ONE home for "who may do what" on the tracking tab.
 *
 * ADR-0010 F1/F4: a domain rule has one home, and the pure rule is unit-testable
 * without React. Nothing in `pages/SnagList/` may inline a role-string array —
 * import a predicate from here instead.
 *
 * FRONTEND IS UX ONLY. The server (`nirmaan_stack/api/snags/`) is the enforcement
 * boundary; these predicates only decide whether a control renders.
 *
 * Matrix of record: `frontend/.claude/plans/snag-list-plan.md` § 6.
 *
 *  | Action                                          | Who                          |
 *  |-------------------------------------------------|------------------------------|
 *  | Import / delete batch / add manual snag         | Admin, Project Lead, PMO     |
 *  | View import history (the batches icon)          | Admin, Project Lead, PMO     |
 *  | Change ONE row's status (+ its remark)          | Admin, Project Lead, PMO, PM |
 *  | BULK status change                              | Admin only                   |
 *
 * The `comments` row is GONE with the field (ADR-0018). A remark is no longer a
 * separate permission question: it is written as part of a status change, so
 * `canEditStatus` is the whole answer.
 */

export const ADMIN_PROFILE = "Nirmaan Admin Profile";
export const PROJECT_LEAD_PROFILE = "Nirmaan Project Lead Profile";
export const PMO_EXECUTIVE_PROFILE = "Nirmaan PMO Executive Profile";
export const PROJECT_MANAGER_PROFILE = "Nirmaan Project Manager Profile";

/**
 * The literal `useUserData()` returns while the Nirmaan Users doc is still in
 * flight. Treated as "no permission yet" so a control cannot flash in and out.
 */
export const ROLE_LOADING = "Loading";

/** Manage the batch lifecycle: import, delete a batch, add a manual snag. */
export const SNAG_MANAGE_PROFILES: readonly string[] = [
  ADMIN_PROFILE,
  PROJECT_LEAD_PROFILE,
  PMO_EXECUTIVE_PROFILE,
];

/** Edit one row at a time: its status, and the remark that rides that change. */
export const SNAG_ROW_EDIT_PROFILES: readonly string[] = [
  ADMIN_PROFILE,
  PROJECT_LEAD_PROFILE,
  PMO_EXECUTIVE_PROFILE,
  PROJECT_MANAGER_PROFILE,
];

/** Bulk status change — Admin only (mirrors Design Tracker's bulk update). */
export const SNAG_BULK_EDIT_PROFILES: readonly string[] = [ADMIN_PROFILE];

/** The identity a permission question is asked about. Both halves come from `useUserData()`. */
export interface SnagActor {
  role?: string | null;
  userId?: string | null;
}

/**
 * The `Administrator` user is a user_id, not a role profile (root CLAUDE.md
 * § Domain Gotchas), so it is handled explicitly everywhere.
 */
const isAdministratorUser = (actor: SnagActor): boolean =>
  actor.userId === "Administrator";

const hasProfile = (actor: SnagActor, profiles: readonly string[]): boolean => {
  if (isAdministratorUser(actor)) return true;
  const role = actor.role;
  if (!role || role === ROLE_LOADING || role === "Error") return false;
  return profiles.includes(role);
};

/** May open the import wizard. */
export const canImport = (actor: SnagActor): boolean =>
  hasProfile(actor, SNAG_MANAGE_PROFILES);

/** May delete a whole batch (and every snag in it). Unguarded server-side by design. */
export const canDeleteBatch = (actor: SnagActor): boolean =>
  hasProfile(actor, SNAG_MANAGE_PROFILES);

/** May add a one-off snag with no batch. */
export const canAddManual = (actor: SnagActor): boolean =>
  hasProfile(actor, SNAG_MANAGE_PROFILES);

/**
 * May open the Import History (the batches popover).
 *
 * Deliberately its OWN predicate rather than a reuse of `canImport`, even though
 * both resolve to the same profiles today: "may start an import" and "may see what
 * was imported" are different questions, and answering them through one name means
 * a later change to either silently moves the other.
 */
export const canViewBatches = (actor: SnagActor): boolean =>
  hasProfile(actor, SNAG_MANAGE_PROFILES);

/** May change ONE row's status. */
export const canEditStatus = (actor: SnagActor): boolean =>
  hasProfile(actor, SNAG_ROW_EDIT_PROFILES);

/** May set the status of many ticked rows at once. Admin only. */
export const canBulkEdit = (actor: SnagActor): boolean =>
  hasProfile(actor, SNAG_BULK_EDIT_PROFILES);

/** The whole answer for one actor, resolved once at the top of the tab. */
export interface SnagPermissions {
  canImport: boolean;
  canDeleteBatch: boolean;
  canAddManual: boolean;
  canViewBatches: boolean;
  canEditStatus: boolean;
  canBulkEdit: boolean;
  /** True when the actor may change nothing at all — the tab renders READ-ONLY. */
  isReadOnly: boolean;
}

/** Resolve every predicate at once. Pure — safe to unit-test without React. */
export function resolveSnagPermissions(actor: SnagActor): SnagPermissions {
  const perms = {
    canImport: canImport(actor),
    canDeleteBatch: canDeleteBatch(actor),
    canAddManual: canAddManual(actor),
    canViewBatches: canViewBatches(actor),
    canEditStatus: canEditStatus(actor),
    canBulkEdit: canBulkEdit(actor),
  };
  return {
    ...perms,
    // "No predicate is true" — so the SET of predicates decides who reads as
    // read-only. Revision 2 dropped `canEditComments` and added `canViewBatches`;
    // neither moves this line, because `canEditComments` shared its profile list
    // with `canEditStatus` and `canViewBatches` shares its with `canImport`. Any
    // FUTURE predicate on a profile list not already represented here WOULD move
    // it — check that before adding one.
    isReadOnly: !Object.values(perms).some(Boolean),
  };
}
