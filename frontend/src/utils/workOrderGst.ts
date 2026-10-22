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

/** The GST rate on a GST-on Work Order. Server twin: `work_order_gst.GST_RATE`. */
export const GST_RATE = 0.18;

/**
 * A Work Order's total from its items' value: + GST_RATE when GST is on. Server twin:
 * `work_order_gst.work_order_total`. Only for a figure the server has not stored yet (a Work Order whose
 * amendment is open prints its amended items); otherwise show the stored `total_amount`.
 */
export const workOrderTotal = (subTotal: number, gstOn: boolean): number =>
  gstOn ? subTotal + subTotal * GST_RATE : subTotal;

/** A Work Order's items' value before GST: the sum of quantity x rate. Server twin: `work_order_gst.items_value`. */
export const itemsValue = (
  rows: ReadonlyArray<{ quantity?: number | string | null; rate?: number | string | null }> | null | undefined
): number => (rows || []).reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.rate || 0), 0);
