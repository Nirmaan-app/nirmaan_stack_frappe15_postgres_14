# Purchase Orders

A procurement user lists the purchase orders of their projects by status, opens one, and reads its status,
amounts, timeline and items. The page also offers the PO's actions (Revise PO, Upload DC, Upload MIR, Add Invoice,
Upload Test Certificate, Preview).

Last walked (walk_revised_po_date.py): 2026-11-23 UTC at 4fb4ccdea, passed.

## Sub-features

- `po-list` the list opens on the `Approved PO` tab, with one tab per status, each showing a count.
- `po-tab` choosing a tab filters the rows and puts the tab in the URL (`?tab=Delivered+PO`).
- `po-open` a PO id link opens its page: PO Details, AMOUNTS, TIMELINE, the action buttons, Order Details.
- `po-figures` the page's status and Total Amount Paid match the database.
- `po_date` a PO with an Approved PO Revision shows `Revised PO Date: <latest approval date>` in its Preview and in
  both downloaded PDFs; a PO never revised shows `PO Date: <creation date>` (#1731).

## How to get to it (user POV)

- The sidebar entry `Purchase Orders`.
- On the Procurement Dashboard, the status cards (`Approved PO Ready to dispatch 12`, `Delivered PO Fully received
  810`, …) are links to the same list.
- From a project's page (not yet mapped).

## Driving it with drive.py

Preconditions:

- A Procurement Executive that `free_users.py` lists (on the 2026-10-08 template: `keerti@nirmaan.app`).

- **Whole walk.** Run `python3 BIN/walk_purchase_orders.py --task <task> --user <email> --password <pw>`. It prints
  the PO id and the evidence folder, and saves `01-po-list`, `02-delivered-tab` and `03-po-page`.
- **Open the list.** `sidebar(page, "Purchase Orders")`. The URL is `/purchase-orders?tab=Approved+PO`, and the
  buttons `All POs <n>` and `Delivered PO <n>` show.
- **Choose a tab.** Click `get_by_role("button", name=re.compile(r"^Delivered PO \d+$"))`. The URL has
  `tab=Delivered+PO`, and every row's status is Delivered.
- **Open a PO.** Click `get_by_role("link", name=re.compile(r"^PO\/")).first`, then wait for `Loading data...` to
  be hidden. The page shows `PO Details`, `STATUS Delivered` and `Total Amount Paid`.
- **Revised PO Date.** Run `python3 -I BIN/walk_revised_po_date.py <env> <out dir>`. It picks the latest PO revised
  on a later day than it was made and the latest Delivered PO never revised, reads both dates from the env DB, and
  as an unlocked Admin opens each from `All POs` (search by `PO ID`), then `Preview`; it downloads the revised PO's
  PDFs with `Download` and `Download Without Rate`, renders page 1 of each as a step and finds the date in its text.
- **Check the figures.** Run `DEVENV script <task> BIN/po_db.py <po id> > "<evidence>/db.txt"`. Its `status` equals
  the page's STATUS, and its `amount_paid`, rounded to the rupee, equals Total Amount Paid.

## Gotchas

- The PO page's URL writes each `/` of the id as `&=` (`/purchase-orders/PO&=103&=00086&=25-26`). Reach it by the
  link, never by building the URL.
- The tab counts cover only the user's projects (keerti: Delivered 810; the whole table: 5,371). Compare a count
  with the DB under the same project filter.
- The page shows `Loading data...` for several seconds after `networkidle`.
- The Preview opens in a dialog: press Escape before the sidebar, or its overlay takes the click.
- The action buttons upload and write. On an env that is safe, but each one needs its own DB read as proof.
