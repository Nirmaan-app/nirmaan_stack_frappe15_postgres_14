import { useFrappeGetCall, useFrappeGetDocList, useSWRConfig } from "frappe-react-sdk";
import { useMemo } from "react";

import { ASSET_MANAGEMENT_AUDIT_ANSWER_FIELDS, ASSET_MANAGEMENT_DOCTYPE } from "@/pages/Assets/assets.constants";
import { useUserData } from "@/hooks/useUserData";
import { auditsToSubmit, isAuditOverdue } from "@/utils/assetAudit";
import { countDeclarationsToSign } from "@/utils/assetDeclaration";

export interface UserAssignment {
  name: string;
  asset: string;
  asset_assigned_to: string;
  asset_assigned_on: string;
  asset_declaration_attachment: string | null;
  creation: string;
  received?: 0 | 1;
  received_on?: string | null;
  returned?: 0 | 1;
  returned_on?: string | null;
  /**
   * Monthly asset audit (owner, 2026-10-14): Pending / Fulfilled, the month (MM/YYYY), when sent, the photo, and
   * the first month of an unbroken run recorded Missed.
   */
  audit_status?: string | null;
  audit_month?: string | null;
  last_audit_on?: string | null;
  audit_proof?: string | null;
  audit_overdue_since?: string | null;
  /** The latest audit's questions and answers (owner, 2026-10-15); read through parseAuditAnswers. */
  audit_answers?: unknown;
}

/**
 * One person's current assignments (Asset Management). The profile page's Assets tab and the
 * app access gate share this query and SWR key, so signing a declaration or sending an audit on the
 * profile lifts the gate at once.
 */
export const userAssignmentsKey = (userId: string) => `asset_management_${userId}`;

/** The signed-in person's own assets (`useMyAssets`), for the app access gate and their profile. */
export const heldAssetsKey = (userId: string) => `assets_held_by_${userId}`;

/** What `api/assets/mine.get_my_assets` returns for each asset. */
export interface MyAsset {
  name: string;
  asset_name: string;
  asset_category: string;
  asset_condition: string | null;
  asset_serial_number: string | null;
  department: string | null;
  current_assignee: string | null;
}

/**
 * The signed-in person's own assets -- the ones they hold and the ones an assignment row names them
 * on -- whatever project they are booked against. A plain Asset Master read follows the person's
 * project User Permissions and hides an asset assigned to them for a project they are not on; this
 * server call does not (owner, 2026-10-13). One SWR key for the app access gate and the profile, so a sign or an
 * unassign refreshes both (`useRefreshUserAssignments`).
 */
export function useMyAssets(enabled = true) {
  const { user_id } = useUserData();
  const on = enabled && !!user_id && user_id !== "Administrator";
  const { data, isLoading, error } = useFrappeGetCall<{ message: MyAsset[] }>(
    "nirmaan_stack.api.assets.mine.get_my_assets",
    undefined,
    on ? heldAssetsKey(user_id) : null
  );
  return { data: data?.message, isLoading: on && isLoading, error };
}

export function useUserAssignments(userId: string | undefined, enabled = true) {
  return useFrappeGetDocList<UserAssignment>(
    ASSET_MANAGEMENT_DOCTYPE,
    {
      // With the receive / return and audit fields: the profile card shows Received, Returned, Return
      // and the audit row; the app access gate counts open audits.
      fields: [...ASSET_MANAGEMENT_AUDIT_ANSWER_FIELDS],
      filters: [["asset_assigned_to", "=", userId ?? ""]],
      limit: 1000,
      orderBy: { field: "creation", order: "desc" },
    },
    enabled && userId ? userAssignmentsKey(userId) : null
  );
}

export interface MyPendingAssetActions {
  declarations: number;
  audits: number;
  overdueAudits: number;
  /** The assets the signed-in person holds now; the app access gate keeps their pages open. */
  held: ReadonlySet<string>;
  /**
   * The first answer hasn't arrived yet: either query has neither data nor an error. Not SWR's `isLoading`, which
   * turns true again on every error retry and focus revalidation while there is no data -- the app access gate
   * would then swap the page for its spinner over and over (code review #1). A failed query is not loading.
   */
  isLoading: boolean;
}

/**
 * What the signed-in person can do on their assets now (0s for Administrator): declarations to sign
 * and monthly audits to send, and how many of those audits are overdue. Same rules as the Sign and
 * Submit audit buttons (canSignDeclaration, canSubmitAudit): a leftover row for an asset someone else
 * holds now is never counted, or the app access gate would lock the person on something no screen
 * lets them do.
 */
export function useMyPendingAssetActions(): MyPendingAssetActions {
  const { user_id } = useUserData();
  const enabled = !!user_id && user_id !== "Administrator";
  const { data: assignments, error: assignmentsError } = useUserAssignments(user_id, enabled);
  // Held = their own assets whose holder is them (an asset on a project they are not on included).
  const { data: mine, error: mineError } = useMyAssets(enabled);
  const held = useMemo(
    () => new Set((mine ?? []).filter((asset) => asset.current_assignee === user_id).map((asset) => asset.name)),
    [mine, user_id]
  );
  const audits = auditsToSubmit(user_id, assignments ?? [], held);
  return {
    declarations: countDeclarationsToSign(user_id, assignments ?? [], held),
    audits: audits.length,
    overdueAudits: audits.filter((assignment) => isAuditOverdue(assignment)).length,
    held,
    isLoading: enabled && ((assignments === undefined && !assignmentsError) || (mine === undefined && !mineError)),
  };
}

/** Refetch a person's assignments wherever they are shown (the profile tab and the app access gate). */
export function useRefreshUserAssignments() {
  const { mutate } = useSWRConfig();
  return (userId: string | undefined) => {
    if (!userId) return;
    mutate(userAssignmentsKey(userId));
    mutate(heldAssetsKey(userId));
  };
}
