/**
 * A Work Order's GST flag (ADR-0030; glossary: CONTEXT.md, "GST flag").
 *
 * Server twin: `nirmaan_stack/services/work_order_gst.gst_is_on`. `Service Requests.gst` is a Data
 * field holding "true" / "false"; any spelling of on counts as on, and anything else -- blank
 * included -- is off, exactly as the server reads it.
 */

const ON_SPELLINGS = ["true", "1", "yes"];

/** Is GST on for this Work Order? */
export const isGstOn = (workOrder: { gst?: string | null } | null | undefined): boolean =>
  ON_SPELLINGS.includes(String(workOrder?.gst ?? "").trim().toLowerCase());
