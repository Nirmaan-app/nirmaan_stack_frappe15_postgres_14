// "Link / Change PO" and "Link / Change WO" in the Cashflow Edit dialogs: what a save writes when a cashflow
// entry moves onto another PO or WO. Pure, so the rules are testable without React (F4); `EditPOCashflowForm` and
// `EditWOCashflowForm` wire them.
//
// Rules (owner, 27 Nov 2026), the same as Material Plan's Link / Change PO:
// - The entry becomes "Existing PO" / "Existing WO" on the picked one; its items are the picked PO's ticked items
//   (PO), or all of the picked WO's descriptions (WO), as Add does. The old items are dropped.
// - The estimated price only belongs to New PO / New WO, so it is cleared.
// - PO only: category / task follow the Material Plan rule (`criticalFieldsForPO`).
// - Planned amount and date are the user's and are not touched here; the vendor is the form's (filled from the
//   picked PO / WO when it is picked).

import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { criticalFieldsForPO, type PlanCriticalFields, type ProjectPO } from "@/utils/materialPlan/poLink";

/** A WO as `get_all_project_wos` returns it (only the fields these rules read). */
export interface ProjectWO {
  name: string;
  vendor?: string | null;
  vendor_name?: string | null;
  status?: string | null;
  grand_total?: number | null;
  items?: { description?: string | null; category?: string | null }[];
}

/** The fields a cashflow save writes when the entry moves onto `po` (its ticked items only). */
export function cashflowPOLinkUpdate(po: ProjectPO, isTicked: (rowName: string) => boolean, plan: PlanCriticalFields) {
  const list = (po.items ?? [])
    .filter((item) => isTicked(item.name))
    .map((item) => ({ name: item.name, item_id: item.item_id, item_name: item.item_name, category: item.category }));
  return {
    type: "Existing PO",
    id_link: po.name,
    estimated_price: 0,
    items: JSON.stringify({ list }),
    ...criticalFieldsForPO(po, plan),
  };
}

/** The fields a cashflow save writes when the entry moves onto `wo` (all of its descriptions, as Add does). */
export function cashflowWOLinkUpdate(wo: ProjectWO) {
  return {
    type: "Existing WO",
    id_link: wo.name,
    estimated_price: 0,
    items: JSON.stringify({ list: wo.items ?? [] }),
  };
}

/** A WO's line in the picker: "SR-00107-001158 · SRI AMMAN FORKLIFT · ₹7,670 · Approved". */
export function woOptionLabel(wo: ProjectWO): string {
  return [
    wo.name,
    wo.vendor_name,
    wo.grand_total != null ? formatToRoundedIndianRupee(wo.grand_total) : null,
    wo.status,
  ]
    .filter(Boolean)
    .join(" · ");
}
