/**
 * Project Action Item — the row shape returned by the two permission-scoped read
 * endpoints in `nirmaan_stack.api.action_items.read`:
 *
 *   - `get_project_action_items(project_name)` → drives Surface B (the project page).
 *   - `get_my_action_items()`                  → drives Surface A (the PM dashboard).
 *
 * Both endpoints return `{ message: { action_items: ActionItemRow[] } }` and include
 * `project` on every row (so Surface A can group). This single interface is the shared
 * row type for both surfaces — do not duplicate it.
 */
export type ActionItemType = "DN_PENDING" | "DC_PENDING";

export interface ActionItemRow {
  /** PAI- docname. */
  name: string;
  /** Projects docname — present on rows from BOTH endpoints (Surface A groups by this). */
  project: string;
  /** Human-readable project name — hydrated by get_my_action_items (Surface A) only. */
  project_name?: string | null;
  action_type: ActionItemType;
  /** v1 always "Procurement Orders". */
  reference_doctype: string;
  /** The PO docname. May reference a since-deleted PO on a Resolved row — but these
   *  endpoints only return Open rows, so a dangling value is not expected in practice. */
  reference_name: string;
  status: "Open" | "Resolved";
  /** Denormalized display, e.g. "Upload Delivery Challan — PO/123". */
  title: string;
  /** In-app deep-link, e.g. "/projects/{project}?page=projectdcmir". */
  action_url: string;
  first_opened_at: string | null;
  last_opened_at: string | null;
  assigned_role: string | null;
  /** Enriched display fields (added by the enriched get_my_action_items contract). */
  vendor_name?: string | null;
  /** Dispatch date — relevant to DN_PENDING rows. */
  dispatch_date?: string | null;
  /** Latest delivery/update date — relevant to DC_PENDING rows. */
  latest_delivery_date?: string | null;
}

export interface GetActionItemsResponse {
  message: {
    action_items: ActionItemRow[];
  };
}
