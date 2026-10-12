import { useFrappeGetDocList, useSWRConfig } from "frappe-react-sdk";

import { ASSET_MANAGEMENT_DOCTYPE, ASSET_MANAGEMENT_FIELDS } from "@/pages/Assets/assets.constants";
import { useUserData } from "@/hooks/useUserData";

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

/** How many of the signed-in person's assets still have no declaration (0 for Administrator). */
export function useMyPendingDeclarationCount(): number {
  const { user_id } = useUserData();
  const { data } = useUserAssignments(user_id, !!user_id && user_id !== "Administrator");
  return (data ?? []).filter((assignment) => !assignment.asset_declaration_attachment).length;
}

/** Refetch a person's assignments wherever they are shown (the profile tab and the sidebar badge). */
export function useRefreshUserAssignments() {
  const { mutate } = useSWRConfig();
  return (userId: string | undefined) => {
    if (userId) mutate(userAssignmentsKey(userId));
  };
}
