# Vendor Invoice Recon

An Accountant (also Accountant Lead, Admin, PMO and procurement) reviews the vendor invoices entered against POs
and WOs: the Pending Invoice Approvals tab lists the ones waiting for a decision, with Approve and Reject; All
Invoices lists every invoice with its status and who actioned it. Both tables show who entered each invoice in
"Invoice Added By": the uploader's full name, or their email when they have no name, on one line cut with "…",
the whole text in a tooltip on hover (#1647).

## Sub-features

- `recon-tabs` the page opens on Pending Invoice Approvals (for a user who may action it); the tabs are buttons
  `Pending Invoice Approvals`, `All Invoices`, `Pending Invoices Upload`, `WO Invoices 2B Recon`,
  `PO Invoices 2B Recon`, and the open one is in the URL (`?tab=pending`, `?tab=history`).
- `pending-pills` Pending Invoice Approvals is split into pills `PO` / `WO` / `Cashbook` / `Credit Card` (#1644;
  `?approval_tab=po|wo|cashbook|card`, PO first). PO and WO are the Vendor Invoices table narrowed to its document
  type; Cashbook and Credit Card are the Expense bills waiting for a person ([Expense bills](./expense_bills.md)).
- `added-by-cut` "Invoice Added By" shows the full name, or the email, on one line with an ellipsis, inside its own
  150 px cell, on both tables.
- `added-by-hover` a hover over a cut value opens a tooltip with the whole text.

## How to get to it (user POV)

- The sidebar entry `Vendor Invoice Recon` (`/invoice-reconciliation`), then a tab button.
- The Service Procurement dashboard's `Vendor Invoice Recon` card (not walked).

## Driving it with drive.py

Preconditions:

- `DEVENV script <task> BIN/vendor_invoice_recon_seed.py` makes the open Accountant `walk-accountant@example.com`
  and gives the two newest Pending invoices made-up uploaders: `Walkerton Fairweather-Longbottom Montgomery`, and an
  email with no Nirmaan Users row. The walk runs it itself; run it once by hand first to create the user, then
  `DEVENV run <task> set-password walk-accountant@example.com <pw>`.

- **Whole walk.** `python3 BIN/walk_vendor_invoice_recon.py --task <task> --password <pw> [--shots <dir>]`. It
  asserts, on both tabs and for both rows: one line with `text-overflow: ellipsis`, the text wider than its box,
  its right edge inside its `td`, and the hover tooltip equal to the whole text; and, by `BIN/vendor_invoice_recon_db.py`,
  each invoice's `uploaded_by` and the uploader's Nirmaan Users name (none for the email). Exits 1 on any miss.
- **Find a row.** `get_by_role("row").filter(has=get_by_role("link", name=<PO id>, exact=True))`; its cell is
  `get_by_role("cell", name=<full text>)`, because the ARIA name keeps the whole text even when the screen cuts it.
- **All Invoices.** Type the PO id into the `Search by PO…` box and wait until every row is that PO's.

## Gotchas

- The search box is debounced: the table redraws after `networkidle`, and a redraw closes an open tooltip. Wait
  for the rows, not for the network.
- Close a tooltip with Escape; moving the mouse to the sidebar leaves Radix's tooltip open in headless Chromium.
- The tables use `table-layout: fixed`, so a column is exactly its `size` and the cell content has 16 px less
  (`p-2`). A cell's cap must be `max-w-full`, not a fixed width, or it pokes past the cell.
- Every Accountant copied from production holds an asset, so the access gate locks them: use the seeded one.
