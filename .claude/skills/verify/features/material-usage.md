# Material Usage

A project's Material Usage tab lists every item the project ordered and received. Since #1731 an incoming Internal
Transfer Memo (ITM, status Approved or later) counts like a PO: its quantity joins the item's Ordered Qty, its id
joins the PO numbers, the challans filed against it join the item's DCs and MIRs, and the PO/ITM Wise view gives it a
row of its own. Since #1736 DC Wise and MIR Wise list the documents filed against an ITM too.

Last walked (walk_material_usage.py): 2026-11-23 UTC at 4fb4ccdea, passed.

## Sub-features

- `mu_ordered` Ordered Qty = the PO quantity + the incoming ITM quantity. Hovering the underlined figure splits it:
  `PO Ordered Quantity` and `Internal Transfer Memo Qty`.
- `mu_numbers` the `PO / ITM Number(s)` cell counts both (`4 POs · 1 ITM`). Its hover card lists each PO and each ITM
  with `From <source project> · <status>` and a paid badge: `Fully Paid` once the ITM is Delivered, `Unpaid` before.
- `mu_docs` the DCs (and MIRs) popover lists a document filed against an ITM with an `ITM` tag and a link to the ITM.
- `mu_powise` the `PO/ITM Wise` view: `Type` is the column after `PO / ITM Number`, its filter offers PO and ITM, and
  an ITM row shows `From <source project>` for Vendor and `-` for Rate.
- `mu_itm` `DC Wise` and `MIR Wise` list documents filed against an ITM beside the PO ones: a `Type` column (PO /
  ITM, with a filter) before `PO/ITM No.`, and an ITM document's `DN Qty` = the ITM's received quantity of that
  document's own items (`itmDeliveryLookups` in `config/materialUsageHelpers.ts`).
- `mu_source` an ITM from the warehouse (`source_type` Warehouse, no source project) reads `From Warehouse` as its
  Vendor, on DC Wise, MIR Wise and PO/ITM Wise.

## How to get to it (user POV)

- Admin: sidebar `Admin Options` -> `Projects` -> search the project -> its name -> `Material Usage`.
- Procurement Lead (and other roles with a `Projects` entry): sidebar `Projects` -> the project -> `Material Usage`.
- Inside the tab: `Item Wise` (the default), `PO/ITM Wise`, `DC Wise`, `MIR Wise` buttons.

## Driving it with drive.py

- **Whole walk.** `python3 -I BIN/walk_material_usage.py <env> <out dir>`. It picks a project and an item with PO
  quantity, an incoming ITM from another project and a challan filed against that ITM, reads the expected figures
  from the env DB (`<out dir>/db/`), sets a password on the env for an unlocked Admin and Procurement Lead, and walks
  every sub-feature as Admin, then Ordered Qty and the PO / ITM label again as the Procurement Lead. `mu_doc_views`
  picks, per view, the project with the most DCs (or MIRs) filed against one warehouse ITM, and walks DC Wise as
  Admin and MIR Wise as a Procurement Executive of that project (Admin when it has none). One part:
  `... <env> <out dir> mu_admin` (or `mu_lead`, `mu_doc_views`); a part run leaves the stamp alone.
- **Find the item.** Fill `Search item name, vendor...` with the item's name, then take the row whose cell is that
  name. Find a column by its header (`Ordered Qty`, `PO / ITM Number(s)`, `DCs`), not by position.
- **Hover cards.** The split and the PO / ITM list open on hover in `[data-radix-popper-content-wrapper]`. Move the
  mouse away and press Escape before the next hover, or the old card stays.
- **Type filter.** Click the `svg` funnel in the `Type` column header, then the `ITM` option, then Escape.

## Gotchas

- The tab reads ITMs through `get_transfer_summary` and the challans through `get_project_po_delivery_documents`
  with `include_itm=1`; an ITM document's Vendor and DN Qty come from the transfer summary (its `source_type` too).
- An item filed under two categories across POs gets two rows, and the ITM quantity joins both: the walk picks an
  item with one category.
- On DC Wise and MIR Wise a document's rows sit low on the page: the DN Qty column of an ITM row can be off a
  1440 px screenshot to the right; read figures from the table, not the picture.
