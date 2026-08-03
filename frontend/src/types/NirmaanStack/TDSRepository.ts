// ---- TDS Repository — restructured entry shape ----
//
// After the 3-level grouping restructure, a TDS Repository entry links to the
// grouping doctype — now named "TDS Items" on the backend (renamed from
// "TDS Item"; its child is "TDS Items Child Table", renamed from "TDS Item
// Member") — instead of holding a bare item id/name/category. The TypeScript
// interface name (`TDSRepository`) is kept unchanged so imports don't break.
// `work_package` is fetched from the linked `tds_item`. Design source of
// truth: `nirmaan_stack/.claude/context/domain/tds/phase-1-plan.md`.

export interface TDSRepository {
  name: string;
  creation: string;
  modified: string;
  owner: string;
  modified_by?: string;
  docstatus?: 0 | 1 | 2;
  /** TDS Item : Link - TDS Item */
  tds_item: string;
  /** Work Package : fetched from tds_item.work_package */
  work_package: string;
  make: string;
  tds_attachment: string;
  status: "Verified" | "Not Verified";
  description?: string;
}
