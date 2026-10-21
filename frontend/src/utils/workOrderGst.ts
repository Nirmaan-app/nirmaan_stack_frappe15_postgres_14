/**
 * A Work Order's GST flag (ADR-0030; glossary: GLOSSARY.md, "GST flag").
 *
 * Server twin: `nirmaan_stack/services/work_order_gst.gst_is_on`. `Service Requests.gst` is a Data
 * field holding "true" / "false"; any spelling of on counts as on, and anything else -- blank
 * included -- is off, exactly as the server reads it.
 */

const ON_SPELLINGS = ["true", "1", "yes"];

/** Is GST on for this Work Order? */
export const isGstOn = (workOrder: { gst?: string | null } | null | undefined): boolean =>
  ON_SPELLINGS.includes(String(workOrder?.gst ?? "").trim().toLowerCase());

const OFF_SPELLINGS = ["false", "0", "no"];

/**
 * Does the Work Order's GST flag say off in so many words? A blank flag is neither, so a generated
 * invoice (#1546) waits until it is set. Server twin: `work_order_gst.gst_is_explicitly_off`.
 */
export const isGstExplicitlyOff = (workOrder: { gst?: string | null } | null | undefined): boolean =>
  OFF_SPELLINGS.includes(String(workOrder?.gst ?? "").trim().toLowerCase());

/**
 * The GST flag a Work Order should carry for its vendor: on exactly when the vendor has a GST number
 * (ADR-0028 Amendment A). Server twin: `work_order_gst.gst_flag_for_vendor`.
 */
export const gstForVendor = (vendorGst: string | null | undefined): boolean => !!String(vendorGst ?? "").trim();

/** Does the Work Order's GST flag agree with its vendor? When not, Match GST to vendor can fix it. */
export const gstMatchesVendor = (
  workOrder: { gst?: string | null } | null | undefined,
  vendorGst: string | null | undefined
): boolean => isGstOn(workOrder) === gstForVendor(vendorGst);
