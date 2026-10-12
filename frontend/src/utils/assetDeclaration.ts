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
