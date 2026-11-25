# Nirmaan Stack verification map

This directory is the maintained source for verifying the user-facing behaviour of Nirmaan Stack. Read the index
before driving the app, then use the matching feature file as the recipe.

Last maintained: 2026-10-26 (written with `/pstack:create-verification-skill`; Purchase Orders proven live).

Upkeep: update a feature file in the same commit as a change that alters how that feature is reached or proven. When
`BIN/doctor.sh` warns that the date above is over 30 days old, ask the user to run
`/pstack:maintain-verification-skill`, which re-checks every file here against the source and the live app and
moves the date.

## Baseline preconditions

- The checkout has its own env, served: `DEVENV up`, then `DEVENV serve --wait`.
- `BIN/doctor.sh` prints only `ok` lines and the env URL `http://t-<task>.localhost:<port>/`.
- Each role user you drive has a password on the env DB (`DEVENV run <task> set-password <email> <pw>`), and
  `BIN/free_users.py` lists them as unlocked.
- Never drive the user's own site (`localhost:8080`, site `localhost`).

## Driving conventions

- Act as the role the story names, never as Administrator.
- Reach each screen the way that user does: sidebar button, tab, row link. Typing a route is setup only.
- Prefer ARIA roles and names. Tab names end in a count, so match them with a regex.
- Wait for `Loading data...` to be hidden before reading a document page.
- Save evidence with `save(page, out, "<nn>-<step>")` from `BIN/drive.py`.

## Proof and skip reporting

- Capture the action and the state after it, not only the last screen.
- A write needs a DB read (`DEVENV script`) saved beside the screenshots.
- Compare an on-screen count with the DB under the same user's project filter.
- Report each sub-feature as *seen*, *failed* (with what was seen) or *not walked* (with the reason).
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph on the user-visible behaviour, then four H2 sections in this
order: `Sub-features`, `How to get to it (user POV)`, `Driving it with drive.py`, `Gotchas`.

## Graduated PR walks

A merged PR's walk (`.claude/skills/pr-walk/bin/walk_pr_<n>.py`) graduates into feature walks here (pr-walk
`SKILL.md` step 9). `graduated.json` maps each of its claim ids to the `BIN/walk_<feature>.py` that walks it again, or
to `skip: <reason>`. Each such walk ends with `w.finish(<feature file>)`, which writes `Last walked (<script>): <date>
UTC at <commit>, passed.` (or `failed.`) into its feature file before the first `##` section. Residence check W1
refuses a commit or merge that brings in a merged walk with a claim left out, or a named walk with no passing stamp.
`BIN/feature_walk.py` holds what such walks share, so a new graduated walk imports it rather than copying it:
`<env> <out dir> [function ...]` arguments, records and expected figures read from the env DB at the start, an
unlocked user per role with a password set on the env only, the ways into a project, a PO and a vendor, a table
footer's row total, a downloaded PDF shown as an image, and a `finish` that stamps only a run of every function.

## Features

- [Login and the app access gate](./login-and-access-gate.md): signing in, the role landing page, the lock card.
- [Purchase Orders](./purchase-orders.md): the PO list tabs, a PO's page, its figures against the DB. Walked
  end to end by `BIN/walk_purchase_orders.py`.
  The Revised PO Date in a PO's preview and PDF (#1731): `BIN/walk_revised_po_date.py`.
- [Material Usage](./material-usage.md): a project's Material Usage tab with incoming Internal Transfer Memos counted
  in Ordered Qty, the PO / ITM numbers, the DCs and the PO/ITM Wise view (#1731), and ITM documents on DC Wise and
  MIR Wise with `From Warehouse` (#1736). Walked by
  `BIN/walk_material_usage.py`.
- [Material Test Certificates](./material-test-certificates.md): Upload, Edit and Delete of a PO's MTCs by role, a
  Project Manager uploading on their own project and editing only their own (#1731). Walked by `BIN/walk_mtc.py`.
- [Audit View](./audit-view.md): Reports -> Audit View for Admin and the Accountants only, its tab counts and Net Paid
  = Amount Paid + TDS held to the server's summary (#1732); its Report Type names, date box, refresh, summary cards
  and columns (#1736). Walked by `BIN/walk_audit_view.py`.
- [Procurement Requests](./procurement-requests.md): the PR list tabs, items, Add New PR.
- [GST Payment Requests](./gst-requests.md): a Work Order GST request raised from Request Payment, approved in GST Requests straight to Approved with no L1 or CEO step, rejected with a reason, the tab's Reviewed and Actions columns, base payments still at L1 (#1738). Walked by `BIN/walk_gst_requests.py`.
- [Reimbursements](./reimbursements.md): every step of a claim on the Reimbursements page, each by its role (HR,
  Admin L1, CEO, Accounts' pay and reconcile), the claim carrying its expense's status, claim expenses gone from
  Project Payments, the Project Manager's ₹2,000 monthly cap, the Action Center item (#1737). Walked by
  `BIN/walk_reimbursements.py`.
- [Pasted link fields](./link_fields.md): a project's Drive links, a Customer PO link, a Design Tracker task's file
  link, a Commission Report task's report link (shown only in a handover document's Sources) and a bill's document
  link each save a link of any length whole, show it and open it (#1680). Walked by `BIN/walk_link_fields.py`
  (`--part drive|cpo|design|commission|billing`).
- [Bulk Import Transactions](./bulk-import-transactions.md): bank, card and cashbook statement lines and their
  matches. A Cashbook Collect payment created like any wallet spend (#1708) is walked by
  `BIN/walk_cashbook_collect.py`; spec #1711's Cashbook stories (a Collect payment's pairing and Skip by hand, lines
  before 1 Apr 2026 left out, an unpaired wallet refund as a minus Expense where its spend is booked) by
  `BIN/walk_cashbook_refunds.py`; Move of a Cashbook spend to a project, another project or Non Project, from the line
  and from the expense's edit dialog (#1757), by `BIN/walk_cashbook_move.py`; Move of a Cashbook spend to Internal
  Transfer, its bill kept as the record's proof, and Unreconcile hidden where Move accepts the line (#1762), by
  `BIN/walk_move_to_transfer.py`; Move of a card spend to a Won project, still in Pending Invoices Upload -> Credit
  Card with its holder (#1761), by `BIN/walk_card_move.py`.
- [Cashbook Wallet Credits](./cashbook-credits.md): a Wallet Credit booked as a minus Expense where its remark places
  it, and a no-Expense refund placed the same way (#1720). Walked by `BIN/walk_cashbook_credits.py`.
- [Cashbook cutoff](./cashbook-cutoff.md): the import period and the ₹0 Internal Transfer fills read only the lines
  kept by the 1 Apr 2026 cutoff, and Review's refunds heading (#1715). Walked by `BIN/walk_cashbook_cutoff.py`.
- [Skip Types](./skip-types.md): the Skipped popup's Skip Type funnel and the Unskip warning without the 8 retired
  kinds, and Failed payment bounced back and Card payment received as before (#1628). Walked by
  `BIN/walk_skip_types.py`.
- [Credit Card Statement import](./card-import.md): upload, Review with its Refunds list, Create, and the refund
  as a negative Non-Project Expense, and the dialog's Review / Creating / Finished / Needs another Create (spec
  #1653). Walked end to end by `BIN/walk_card_import.py`.
- [Background operations](./background-operations.md): TDS export, the handover binder, commission and bulk PDF
  download, BoQ upload and template seed, template clone, snag PDF, classify per engine, rate suggest and match,
  hub parse and AI checks, each followed through its owner-only status record: queued apart from running, each tab
  its own file or outcome, by polling alone; one commission download, one binder and one document download per
  user, a queued binder never holding back a document (spec #1654, #1662-#1669, #1671). Walked by
  `BIN/walk_background_operation_screens.py` (`--part tds|handover|commission|bulk|boq|template|clone|snag|
  commission-second|binder-second|document-beside-binder|classify|suggest|hub|review`).
  With N `long` workers, N template clones, ceil(N/2) two-engine Classify clicks, N rate suggests on N sheets and N
  TDS exports at once all succeed, and the check prints peak memory per worker, peak DB connections and the longest
  BoQ series lock wait (#1656, #1657, #1659, #1662). With `--fake-provider-limit K`, N historical matches against a
  fake provider that answers 429 above K in flight never halt (#1718; `BIN/fake_ai_provider.py`). The N-worker check,
  `BIN/walk_background_operations.py --workers N`.
- [Projects](./projects.md): the project list and a project's page.
- [Vendors](./vendors.md): a vendor's Work Orders tab and its PDF, the Work Order lists' Project and Vendor ⓘ links,
  and Edit Vendor's MSME ID and certificate (#1731), walked by `BIN/walk_vendor_work_orders.py` and
  `BIN/walk_vendor_msme.py`; its Payments sub-tabs and its Cheques tab, read-only for PMO (#1732), walked by
  `BIN/walk_vendor_payments.py` and `BIN/walk_vendor_cheques.py`; the MSME certificate attached on Update only and
  the Cheque Tracker's date header (#1736), walked by `BIN/walk_vendor_msme.py` and `BIN/walk_vendor_cheques.py`.
- [Customers](./customers.md): the customer list, a customer's page and edit form (as an Accountant), and creating
  and editing a customer (as the Admin), each held to its DB row. Walked end to end by `BIN/walk_customers.py`
  (`--part view` for the read-only Accountant steps). Live refresh of the list (#1670): `BIN/walk_live_refresh.py`
  (needs the env's own realtime; see the feature file).
- [Office Rent](./office-rent.md): a bill incl. 18% GST raised by HR, approved by Admin and the CEO, split
  into rent, GST, TDS and what the landlord gets, paid by an Accountant. Walked end to end by
  `BIN/walk_office_rent.py`.
- [Internal Transfers](./internal-transfers.md): the Internal Transfers tab, the summary's Internal transfers figure,
  the Skipped popup without the moved lines, Mark as Internal Transfer and Send back to Mismatched (one line; never on a Cashbook move), Made by
  in words, the Cashbook preview's and the card Review's Internal transfers lists, and the preview's sentence on the
  old ₹0 records it fills. Walked end to end by `BIN/walk_internal_transfers.py`.
- [Vendor Invoice Recon](./vendor_invoice_recon.md): the Pending Invoice Approvals and All Invoices tabs, and their
  "Invoice Added By" column; the PO and WO Invoices 2B Recon tabs, and their "Invoice Uploaded By" column (full
  name or email, cut with "…", whole text on hover); who may approve or reject a PO invoice (an Accountant on
  screen; a procurement or HR user refused by the server, #1638). Walked by `BIN/walk_vendor_invoice_recon.py`.
- [Expense bills](./expense_bills.md): a bill attached in Pending Invoices Upload -> Credit Card or -> Cashbook
  becomes an Expense bill with a Bill check (Checking, then Matched / Mismatched / Not read); a Matched bill fills
  the Invoice Ref and Date on the expense lists; the bills a Cashbook import copies, late bills too, get the same
  check, and two or more bill links are Not checked, but are approved on arrival by System (#1755; a one-off patch
  approved the ones waiting or rejected before it); any other result of a person's upload waits in Pending Invoice
  Approvals -> Cashbook or -> Credit Card, to be approved (number and date corrected) or rejected (the spend waits again, with the reason);
  a Not read bill (or one whose reading stopped) can be read again by Admin or Accountant Lead; a paid spend's bill
  an Admin or Accountant Lead replaces on Payment Done is approved at once in their name; the Project and
  Non-Project Expenses lists show each spend's Bill check and approval on Paid and All, with a filter on each;
  Project Payments -> All Payments shows each Expense row's Invoice and Bill check (PO / WO rows empty). Vendor Invoice Recon -> All Invoices has
  PO / WO / Cashbook / Credit Card / Porter pills: every Expense bill, latest and history, and every Porter Invoice
  with its Validate result. The #1649 patch marks this financial year's older Cashbook Expenses, so they wait in
  Pending Invoices Upload -> Cashbook.
  Walked end to end by `BIN/walk_expense_bills.py` (`--part read-again`, `--part cashbook`, `--part bill-check`,
  `--part paid-replace`, `--part all-payments` or `--part all-invoices` for one part alone;
  `--part marker-patch` runs the #1649 patch on the env and walks the Cashbook pill before and after it).
  `BIN/walk_cashbook_bill_approval.py` walks #1755: the import's bills Approved on arrival, a person's upload alone
  on Pending Invoice Approvals -> Cashbook, and an import bill Mismatched and Auto-approved on All Invoices.
