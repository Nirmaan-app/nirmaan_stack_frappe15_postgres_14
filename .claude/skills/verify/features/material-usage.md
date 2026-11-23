# Material Usage

A project's Material Usage tab lists every item the project ordered and received. Since #1731 an incoming Internal
Transfer Memo (ITM, status Approved or later) counts like a PO: its quantity joins the item's Ordered Qty, its id
joins the PO numbers, the challans filed against it join the item's DCs and MIRs, and the PO/ITM Wise view gives it a
row of its own.

## Sub-features

- `mu_ordered` Ordered Qty = the PO quantity + the incoming ITM quantity. Hovering the underlined figure splits it:
  `PO Ordered Quantity` and `Internal Transfer Memo Qty`.
- `mu_numbers` the `PO / ITM Number(s)` cell counts both (`4 POs · 1 ITM`). Its hover card lists each PO and each ITM
  with `From <source project> · <status>` and a paid badge: `Fully Paid` once the ITM is Delivered, `Unpaid` before.
- `mu_docs` the DCs (and MIRs) popover lists a document filed against an ITM with an `ITM` tag and a link to the ITM.
- `mu_powise` the `PO/ITM Wise` view: `Type` is the column after `PO / ITM Number`, its filter offers PO and ITM, and
  an ITM row shows `From <source project>` for Vendor and `-` for Rate.

## How to get to it (user POV)

- Admin: sidebar `Admin Options` -> `Projects` -> search the project -> its name -> `Material Usage`.
- Procurement Lead (and other roles with a `Projects` entry): sidebar `Projects` -> the project -> `Material Usage`.
- Inside the tab: `Item Wise` (the default), `PO/ITM Wise`, `DC Wise`, `MIR Wise` buttons.

## Driving it with drive.py

- **Whole walk.** `python3 -I BIN/walk_material_usage.py <env> <out dir>`. It picks a project and an item with PO
  quantity, an incoming ITM from another project and a challan filed against that ITM, reads the expected figures
  from the env DB (`<out dir>/db/`), sets a password on the env for an unlocked Admin and Procurement Lead, and walks
  every sub-feature as Admin, then Ordered Qty and the PO / ITM label again as the Procurement Lead. One part:
  `... <env> <out dir> mu_admin` (or `mu_lead`); a part run leaves the stamp alone.
- **Find the item.** Fill `Search item name, vendor...` with the item's name, then take the row whose cell is that
  name. Find a column by its header (`Ordered Qty`, `PO / ITM Number(s)`, `DCs`), not by position.
- **Hover cards.** The split and the PO / ITM list open on hover in `[data-radix-popper-content-wrapper]`. Move the
  mouse away and press Escape before the next hover, or the old card stays.
- **Type filter.** Click the `svg` funnel in the `Type` column header, then the `ITM` option, then Escape.

## Gotchas

- The tab reads ITMs through `get_transfer_summary` and the challans through `get_project_po_delivery_documents`
  with `include_itm=1`; DC Wise and MIR Wise stay PO-only by design.
- An item filed under two categories across POs gets two rows, and the ITM quantity joins both: the walk picks an
  item with one category.
- A warehouse ITM (no source project) shows `-` for Vendor on PO/ITM Wise, not `From Warehouse`.
