import { useFrappeGetDocList, useSWRConfig } from "frappe-react-sdk";

import { ASSET_MANAGEMENT_DOCTYPE, ASSET_MANAGEMENT_FIELDS, ASSET_MASTER_DOCTYPE } from "@/pages/Assets/assets.constants";
import { useUserData } from "@/hooks/useUserData";
import { countDeclarationsToSign } from "@/utils/assetDeclaration";

export interface UserAssignment {
  name: string;
  asset: string;
  asset_assigned_to: string;
  asset_assigned_on: string;
  asset_declaration_attachment: string | null;
  creation: string;
}

/**
 * One person's current assignments (Asset Management). The profile page's Assets tab and the
 * sidebar's pending-declaration badge share this query and SWR key, so signing or uploading a
 * declaration on the profile clears the badge at once.
 */
export const userAssignmentsKey = (userId: string) => `asset_management_${userId}`;

/** The assets a person holds now (Asset Master.current_assignee), for the badge. */
export const heldAssetsKey = (userId: string) => `assets_held_by_${userId}`;

export function useUserAssignments(userId: string | undefined, enabled = true) {
  return useFrappeGetDocList<UserAssignment>(
    ASSET_MANAGEMENT_DOCTYPE,
    {
      fields: [...ASSET_MANAGEMENT_FIELDS],
      filters: [["asset_assigned_to", "=", userId ?? ""]],
      limit: 1000,
      orderBy: { field: "creation", order: "desc" },
    },
    enabled && userId ? userAssignmentsKey(userId) : null
  );
}

/**
 * How many declarations the signed-in person can sign now (0 for Administrator). Same rule as the
 * Sign button (canSignDeclaration): a leftover row for an asset someone else holds now is never
 * counted, or the badge would ask them to sign something no screen lets them sign.
 */
export function useMyPendingDeclarationCount(): number {
  const { user_id } = useUserData();
  const enabled = !!user_id && user_id !== "Administrator";
  const { data: assignments } = useUserAssignments(user_id, enabled);
  const { data: held } = useFrappeGetDocList<{ name: string }>(
    ASSET_MASTER_DOCTYPE,
    { fields: ["name"], filters: [["current_assignee", "=", user_id ?? ""]], limit: 0 },
    enabled && user_id ? heldAssetsKey(user_id) : null
  );
  return countDeclarationsToSign(user_id, assignments ?? [], new Set((held ?? []).map((asset) => asset.name)));
}

/** Refetch a person's assignments wherever they are shown (the profile tab and the sidebar badge). */
export function useRefreshUserAssignments() {
  const { mutate } = useSWRConfig();
  return (userId: string | undefined) => {
    if (!userId) return;
    mutate(userAssignmentsKey(userId));
    mutate(heldAssetsKey(userId));
  };
}
