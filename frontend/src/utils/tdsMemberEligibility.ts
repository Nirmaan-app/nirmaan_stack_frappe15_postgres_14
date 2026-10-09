/**
 * Which catalogue SKUs (`Items`) may become members of a TDS Item. The Add New TDS Item wizard and
 * the Link Item SKUs dialog both pick members through `useTDSItemOptions`, which applies this rule.
 * The backend refuses the same SKUs in `api/tds/linking.set_items_tds_link`; a parity test pins the
 * two lists together.
 */

/** Categories that never hold a datasheet product. Pinned to `linking.py` by a parity test. */
export const TDS_EXCLUDED_CATEGORIES: readonly string[] = ["HVAC Junk", "Additional Charges"];

/** The `Items.billing_category` value a member must carry. Pinned to `linking.py` by a parity test. */
export const BILLABLE = "Billable";

export interface TdsMemberCandidate {
  category?: string | null;
  billing_category?: string | null;
}

/**
 * True when `item` may be offered as a TDS Item member. An excluded category is always refused;
 * with `billableOnly`, so is any SKU not marked Billable.
 */
export function isTdsMemberEligible(item: TdsMemberCandidate, billableOnly: boolean): boolean {
  if (TDS_EXCLUDED_CATEGORIES.includes(item.category ?? "")) return false;
  return !billableOnly || item.billing_category === BILLABLE;
}
