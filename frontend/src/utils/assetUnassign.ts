// src/utils/assetUnassign.ts
//
// Why an asset is unassigned. Mirrors `UNASSIGN_REASONS` and `unassign_reason_refusal` in
// `nirmaan_stack/services/asset_unassign.py`; the server re-checks before saving, this copy only
// decides when the Unassign button is enabled. Change the list in both places.

export const OTHER_UNASSIGN_REASON = "Other";

export const UNASSIGN_REASONS: readonly string[] = [
  "Employee left / exit",
  "Returned – no longer needed",
  "Handing over to another person",
  "Project finished – returned to store",
  "Damaged – sent for repair",
  "Lost or stolen",
  OTHER_UNASSIGN_REASON,
];

/** Details needed with "Other" (the department-move reason's minimum too). */
export const MIN_UNASSIGN_DETAILS = 10;

/** True when the reason is from the list, and "Other" comes with enough details. */
export function isUnassignReasonValid(reason: string | null | undefined, details: string | null | undefined): boolean {
  if (!reason || !UNASSIGN_REASONS.includes(reason)) return false;
  if (reason === OTHER_UNASSIGN_REASON) return (details ?? "").trim().length >= MIN_UNASSIGN_DETAILS;
  return true;
}
