# Vendor Invoice Recon

An Accountant (also Accountant Lead, Admin, PMO and procurement) reviews the vendor invoices entered against POs
and WOs: the Pending Invoice Approvals tab lists the ones waiting for a decision, with Approve and Reject; All
Invoices lists every invoice with its status and who actioned it. Both tables show who entered each invoice in
"Invoice Added By": the uploader's full name, or their email when they have no name, on one line cut with "…",
the whole text in a tooltip on hover (#1647). The PO Invoices 2B Recon and WO Invoices 2B Recon tabs list the
Approved invoices of each document type for reconciliation, and show the same uploader the same way in "Invoice
Uploaded By" (#1650). Approving or rejecting a Purchase Order invoice takes Admin or an Accountant profile on the
server, whatever the surface (#1638): anyone else calling the approve endpoint or saving the status is refused.

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
- `po-decide` on the PO pill, the green tick opens "Confirm Approval" (button `Approve`) and the red cross opens
  "Reject Invoice" (a reason, then `Reject`); the row leaves the queue. The tick and cross are icon buttons with no
  name (only a tooltip): find them as `row.locator("button.text-green-600")` / `"button.text-red-600"`.
- `po-decide-refused` a user outside Admin / Accountant / Accountant Lead gets HTTP 403 and "Only Admin and
  Accountants can approve or reject a Purchase Order invoice." from `approve_vendor_invoice`, for approve and
  reject; the screen shows them no Pending tab, so the walk calls the endpoint from their logged-in page.
- `uploaded-by-cut` "Invoice Uploaded By" on PO Invoices 2B Recon (`?tab=po_invoices`) and WO Invoices 2B Recon
  (`?tab=sr_invoices`) does the same, inside its 160 px cell, with the same hover tooltip.

## How to get to it (user POV)

- The sidebar entry `Vendor Invoice Recon` (`/invoice-reconciliation`), then a tab button.
- The Service Procurement dashboard's `Vendor Invoice Recon` card (not walked).

## Driving it with drive.py

Preconditions:

- `DEVENV script <task> BIN/vendor_invoice_recon_seed.py` makes the open Accountant `walk-accountant@example.com`
  and gives the two newest Pending invoices made-up uploaders: `Walkerton Fairweather-Longbottom Montgomery`, and an
  email with no Nirmaan Users row; so do the two newest Approved invoices of each document type, for the 2B Recon
  tabs. The walk runs it itself; run it once by hand first to create the user, then
  `DEVENV run <task> set-password walk-accountant@example.com <pw>`.

- **Whole walk.** `python3 BIN/walk_vendor_invoice_recon.py --task <task> --password <pw> [--shots <dir>]`. It
  asserts, on all four tabs and for both rows: one line with `text-overflow: ellipsis`, the text wider than its box,
  its right edge inside its `td`, and the hover tooltip equal to the whole text; and, by `BIN/vendor_invoice_recon_db.py`,
  each invoice's `uploaded_by` and the uploader's Nirmaan Users name (none for the email). Exits 1 on any miss.
- **Decisions** (#1638). `python3 BIN/walk_vendor_invoice_recon.py --task <task> --password <pw> --part decisions
  [--shots <dir>]`. It runs `BIN/po_invoice_decision_seed.py` (three Pending `WALK-1638-…` PO invoices, and the
  made-up `walk-procurement@example.com` and `walk-hr@example.com`; give all three walk users the same password).
  As the Accountant it approves one and rejects one on screen, each checked by its DB row (Approved by the
  Accountant; Rejected with the reason). As procurement and HR it calls the approve endpoint for approve and reject
  (403, the rule's message) and, as both, `PUT /api/resource/Vendor Invoices/<name>` with status Approved
  (refused); the third invoice stays Pending. `--part uploader` runs only the uploader walk below.
- **Find a row.** `get_by_role("row").filter(has=get_by_role("link", name=<PO id>, exact=True))`; its cell is
  `get_by_role("cell", name=<full text>)`, because the ARIA name keeps the whole text even when the screen cuts it.
- **All Invoices.** Type the PO id into the `Search by PO…` box and wait until every row is that PO's.
- **2B Recon tabs.** The document id is plain text there (beside an info link), so find the row by its text: the
  PO / SR id and the invoice no. Type the invoice no into the `Search by Invoice No…` box (its default field), then
  wait for the summary's `"<invoice no>"` chip and for the row.

## Gotchas

- The search box is debounced: the table redraws after `networkidle`, and a redraw closes an open tooltip. Wait
  for the rows, not for the network.
- The 2B Recon search matches loosely: an amount like `₹46,725` matches `4725`. Wait for the invoice's row, not
  for every row to be the invoice's.
- A late redraw can detach a found cell before it is measured (`closest('td')` is null); measure again.
- Close a tooltip with Escape; moving the mouse to the sidebar leaves Radix's tooltip open in headless Chromium.
- The tables use `table-layout: fixed`, so a column is exactly its `size` and the cell content has 16 px less
  (`p-2`). A cell's cap must be `max-w-full`, not a fixed width, or it pokes past the cell.
- Every Accountant copied from production holds an asset, so the access gate locks them: use the seeded one.
