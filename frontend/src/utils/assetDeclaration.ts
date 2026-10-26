// src/utils/assetDeclaration.ts
//
// Who may e-sign an asset declaration. The server re-checks the same rule in
// `nirmaan_stack/services/asset_declaration.sign_refusal` before saving; this copy only
// decides whether a screen shows the Sign button.

export interface DeclarationSignContext {
  /** The logged-in user's id (`useUserData().user_id`). */
  viewerId: string | null | undefined;
  /** `Asset Management.asset_assigned_to` — who the assignment is for. */
  assignedTo: string | null | undefined;
  /** `Asset Master.current_assignee` — who the asset says holds it. */
  currentAssignee: string | null | undefined;
  /** `Asset Management.asset_declaration_attachment` — set once signed or uploaded. */
  declaration: string | null | undefined;
}

/**
 * True when the viewer is the person the asset is assigned to, the asset agrees they hold
 * it, and no declaration is attached yet.
 */
export function canSignDeclaration({
  viewerId,
  assignedTo,
  currentAssignee,
  declaration,
}: DeclarationSignContext): boolean {
  if (!viewerId || !assignedTo) return false;
  return viewerId === assignedTo && currentAssignee === assignedTo && !declaration;
}

/**
 * How many of a person's assignments they can sign now -- the app access gate's count. Same rule as the Sign
 * button, so a leftover row for an asset someone else now holds is never counted.
 *
 * @param heldAssets the assets whose `current_assignee` is `viewerId`.
 */
export function countDeclarationsToSign(
  viewerId: string | null | undefined,
  assignments: ReadonlyArray<{ asset: string; asset_assigned_to: string; asset_declaration_attachment: string | null }>,
  heldAssets: ReadonlySet<string>
): number {
  return assignments.filter((assignment) =>
    canSignDeclaration({
      viewerId,
      assignedTo: assignment.asset_assigned_to,
      currentAssignee: heldAssets.has(assignment.asset) ? viewerId : undefined,
      declaration: assignment.asset_declaration_attachment,
    })
  ).length;
}

export type AssetKindTab = "Project" | "IT";

/**
 * Which of a profile's Project / IT asset tabs to open: the one with a declaration waiting, Project
 * first when both have one; with none waiting, Project unless the person holds only IT assets.
 */
export function assetTabToOpen(
  project: { total: number; pending: number },
  it: { total: number; pending: number }
): AssetKindTab {
  if (project.pending > 0) return "Project";
  if (it.pending > 0 || project.total === 0) return it.total > 0 ? "IT" : "Project";
  return "Project";
}
