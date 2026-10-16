/**
 * Whether a user adding a new item to a PR may create it in the Items master, or only request it.
 *
 * A requested item rides the PR as a `REQ-…` line with status "Request"; the PR approver creates
 * it (or swaps in an existing item) on the Approve PR screen, and the PR cannot be approved until
 * every requested line is resolved.
 *
 * - Admin may always create.
 * - PMO may only request, in every category (owner 2026-10-16).
 * - Everyone else may create unless the category's `new_items` is "false".
 */
import { ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE } from "@/constants/roles";

/** Why the item can only be requested: the user's role, or the category's setting. */
export type NewItemRequestReason = "role" | "category";

/** Why a new item in this category can only be requested, or null when the user may create it. */
export function newItemRequestReason(
  role: string | null | undefined,
  categoryNewItems: string | null | undefined
): NewItemRequestReason | null {
  if (role === ADMIN_PROFILE) return null;
  if (role === PMO_EXECUTIVE_PROFILE) return "role";
  if (categoryNewItems === "false") return "category";
  return null;
}
