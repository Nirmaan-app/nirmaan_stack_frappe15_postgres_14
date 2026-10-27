// A Material Plan's remarks (`Material Delivery Plan.remarks`): a general note typed when the plan is created
// (Existing PO per plan, New PO) or edited, and the required reason when it is Partially Delivered.
// Pure, so the rule is testable without React (F4); `AddMaterialPlanForm` and `EditMaterialPlanForm` only wire it.

/** The status that makes remarks required. */
export const REMARKS_REQUIRED_STATUS = "Partially Delivered";

export const REMARKS_REQUIRED_MESSAGE = "Remarks are required when status is Partially Delivered.";

/** Are remarks required for this delivery status? Only Partially Delivered. */
export const remarksRequired = (status: string | null | undefined): boolean => status === REMARKS_REQUIRED_STATUS;

/** Does the plan lack the remarks its status requires? Blank or spaces only counts as missing. */
export const remarksMissing = (status: string | null | undefined, remarks: string | null | undefined): boolean =>
  remarksRequired(status) && !(remarks ?? "").trim();

/**
 * The remarks to save: trimmed, and kept whatever the status. Before remarks became a create/edit field, any
 * status but Partially Delivered saved them as "", which would now wipe a note on Partially -> Delivered.
 */
export const remarksToSave = (remarks: string | null | undefined): string => (remarks ?? "").trim();
