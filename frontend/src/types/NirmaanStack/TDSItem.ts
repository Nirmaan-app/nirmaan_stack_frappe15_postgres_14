// ---- TDS Item — grouping doctype for the restructured TDS Repository ----
//
// Backend doctype names: the grouping doctype is "TDS Items" and its child is
// "TDS Items Child Table" (renamed from the original "TDS Item" / "TDS Item
// Member"). The TypeScript interface names below (`TDSItem`, `TDSItemMember`)
// are intentionally kept as-is so existing imports don't break.
//
// A TDS Items doc groups multiple `Items` SKUs (via the "TDS Items Child
// Table" child table). `TDS Repository` entries now link to a TDS Items doc
// instead of holding a bare item id/name/category. Design source of truth:
// `nirmaan_stack/.claude/context/domain/tds/phase-1-plan.md` (section T3).

export interface TDSItemMember {
  name: string;
  /** Item : Link - Items */
  item: string;
  /** Item Name : fetched from Items */
  item_name: string;
  /** Category : fetched from Items */
  category: string;
  parent: string;
  parentfield: string;
  parenttype: string;
  idx: number;
}

export interface TDSItem {
  name: string; // TDS-ITEM-#####
  creation: string;
  modified: string;
  owner: string;
  modified_by?: string;
  docstatus?: 0 | 1 | 2;
  tds_item_name: string;
  /** Work Package : Link - Procurement Packages */
  work_package: string;
  description?: string;
  members?: TDSItemMember[];
}
