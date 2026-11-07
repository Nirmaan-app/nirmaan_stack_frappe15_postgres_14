# Expense bills

An Accountant attaches a bill to a card spend (Vendor Invoice Recon -> Pending Invoices Upload -> Credit Card) or a
wallet spend (-> Cashbook). The spend leaves the list at once, as before, and the bill becomes an **Expense bill**
with a **Bill check** (GLOSSARY *Expense bills*, ADR-0045, spec #1637, ticket #1639). In the background the shared
invoice reader reads the bill and its total (incl. GST) is compared with the statement line's amount: **Matched**
(within ₹1) fills the Expense's Invoice Ref and Invoice Date where empty and auto-approves the bill; **Mismatched**
and **Not read** (with the reason) leave it Pending and write nothing to the Expense. The bills a Cashbook import
copies -- a created line's and a late bill a later statement brings -- get the same Bill check (ticket #1641); a
spend with two or more bill links is **Not checked** at once (its total the line amount, Pending, never read).

A bill that is not Matched waits for a person in Vendor Invoice Recon -> Pending Invoice Approvals, on the
**Cashbook** and **Credit Card** pills (#1644; PO and WO are the Vendor Invoices beside them). Admin, Accountant and
Accountant Lead approve it, correcting its number and date, which are mirrored onto the Expense, or reject it with a
reason: the Expense loses its bill and waits again in Pending Invoices Upload, showing "Last bill rejected: <reason>".
The server refuses both to anyone else.

A Not read bill can be **read again** (#1645) by Admin and Accountant Lead: Read again puts it back to Checking (it
leaves the pill) and queues its reading; its new result comes back to the pill, or a Matched one is auto-approved
and does not. A bill left Checking by a reading that stopped (a worker killed mid-read: its claim is older than the
15-minute job limit plus a 5-minute margin) shows on its pill, on All Invoices and on the expense lists as Not read,
"The reading stopped.", and can be read again or decided. Read again also reaches a bill a person approved on
Payment Done (Pending or Approved by a person; never Rejected, replaced, or one with a result): the reading records
its result beside their approval and never changes it or what they typed.

A number and date typed when a bill is attached (or replaced) are the Expense bill's own from the start; a Matched
reading fills only what is still empty, on the bill and on the Expense alike.

A paid wallet spend's or card spend's bill replaced on Project Payment & Expense -> Payment Done / Reconciliation
Done (Edit Inv / Upload Inv, #1643) is a new Expense bill too: an Admin's or Accountant Lead's is **Approved at once
in their name** (not auto-approved) with the number and date they typed; its Bill check still runs and is recorded,
and never replaces that number or date. The previous bill stays as history, no longer latest. Anyone else's
(Accountant, HR) waits like an attached one. Editing only the number or date lands no new bill. Any other paid
Expense (hand-keyed, Porter, ...) gets no Expense bill. An Admin's or Accountant Lead's edit of only the number and
date corrects the latest Expense bill's own number and date too (a Version on the bill); an Accountant's or HR's
edit changes the Expense only.

An open **Collect payment** keeps its bill on its line until someone decides it (#1642): that stored bill gets its
Bill check at import, against the line's amount, and the result is kept on the line. The line's decide dialog
(Bulk Import Transactions -> Not Matched – Outflow -> Choose) says **Invoice already available** and `Create
expense: Will be auto-approved` (Matched), `Will go to Pending Approval` (Mismatched, Not read, Not checked) or
`Checking`. A line left Checking by a reading that stopped (claim older than 20 minutes) has no result, so it ships
no `bill_check`, as a line stored before #1642 does (the dialog's "Will be read on Create"), and Create makes a
Checking Expense bill with a fresh reading queued. Create a new expense makes the Expense bill from a finished
result without reading again; Skip makes none.

## Sub-features

- `bill-attach-card` Credit Card pill: the spend is listed, Attach invoice -> Upload Invoice dialog -> Save Invoice;
  the spend leaves the list. DB: one `Expense Bill`, Checking, Pending, latest, against the card statement line,
  with the typed number and date as its `invoice_no` / `invoice_date`; its `bill_file` is the Expense's file URL
  (a plain Data field: no File row of the bill's own, so no "Error Attaching File" log either).
- `bill-attach-cashbook` Cashbook pill: the same for a wallet spend, against its Cashbook line.
- `bill-reading` the reading runs on the env's `long` queue (`expense_bills.reading.check_expense_bill`). DB: Bill
  check Matched / Mismatched / Not read with its reason; Matched is Approved, `auto_approved`, by System.
- `bill-cashbook-import` a Cashbook import's copied bill and late bill: one Expense bill each, attached by the
  Accountant who confirmed the import; two or more links Not checked. Seen on the expense lists (`bill-lists`).
- `bill-lists` Dashboard -> Non-Project Expenses / Project Expenses -> Paid: a Matched bill's Invoice Ref and Invoice
  Date on the spend's row; nothing for any other result.
- `collect-bill` an open Collect payment's stored bill: DB `Outflow Import Row.bill_check` (Checking with a reading
  queued as `expense_bills.line_check.check_collect_line`, or Not checked for two or more links), then the kept
  result and `read_*` fields. The decide dialog's `collect-bill-note` (test id) shows `Invoice already available`,
  `View bill` and `Create expense: <outcome>`. After Create: one Expense bill against the line, its file the line's
  stored bill (the File stays on the line); Matched Approved by System, its number on the Expense, never claimed by
  a reading; anything else Pending; a line still Checking gives a Checking bill whose reading is queued. Skip by
  hand (Admin, Accountant Lead): no Expense bill.
- `approval-pills` Pending Invoice Approvals -> `PO` / `WO` / `Cashbook` / `Credit Card`. Cashbook and Credit Card
  list each waiting bill: spend date, line amount, bill total read ("--" unless Matched or Mismatched), Bill check
  with its reason, invoice number and date (the bill's own, else the ones typed on the Expense), Paid by (wallet or
  card holder), Project, Invoice Added By, a `View` link to the file, `Approve` and `Reject`.
- `approve` Approve -> dialog with the fields labelled `Invoice number` and `Invoice date` prefilled -> Approve;
  the row leaves. DB: Approved, `approved_by` the person, `approved_on`; number and date on the bill and the Expense;
  a Version on both.
- `reject` Reject -> the field labelled `Reason` -> Reject; the row leaves. DB: Rejected with the reason,
  `rejected_by` the person, `rejected_on`; the Expense's `invoice_attachment`, `invoice_ref`, `invoice_date` cleared;
  a Version on both. All Invoices' Cashbook / Credit Card rows and the pending queue's rows carry `approved_by`,
  `approved_on`, `rejected_by`, `rejected_on` (story 35). Pending Invoices Upload
  -> Cashbook / Credit Card then lists the spend with "Last bill rejected: <reason>" under its remark or details;
  No invoice (Admin, Accountant Lead) still works on it.
- `read-again` Cashbook / Credit Card -> a Not read row's `Read again` (Admin, Accountant Lead only; an Accountant
  sees no button and the endpoint `read_expense_bill_again` answers 403) -> the row leaves. DB: Checking,
  `read_claimed_at` cleared, the reading queued on `long`; a second press is answered 200 and changes nothing. After
  the reading: the row's new result (Not read with its reason, Mismatched), or gone (Matched, auto-approved).
- `reading-stopped` a bill Checking with `read_claimed_at` older than 20 minutes shows as Not read, "The reading
  stopped."; Read again and Approve / Reject reach it (a decision records it Not read with that reason).
- `bill-check-column` (#1640) Non-Project Expenses and Project Expenses -> `Paid` or `All` (standalone lists only,
  not the project page's read-only Expenses view): a `Bill check` column after Invoice Ref. Its cell shows the
  latest Expense bill's result (Checking / Matched / Mismatched / Not read / Not checked; a reading that stopped is
  Not read) over its approval (Auto-approved / Pending / Approved / Rejected), or "—" when the spend has no Expense
  bill. Its header holds two funnels: `Bill check` (each result, and "— (no bill)") and `Approval` (each status,
  and "— (no bill)"). Both are sent with the list request (`bill_check` / `bill_approval` `in` filters, filled and
  narrowed on the server by `api/data_table/virtual_fields.py`), so they page with the list.
- `paid-replace` Project Payment & Expense -> `Payment Done / Reconciliation Done` -> search the spend -> `Edit Inv`
  (`Upload Inv` with no bill) -> dialog `Edit Invoice`: a file in `input[type=file]`, `#invoice_ref_update_id`,
  `#invoice_date_update_id` -> `Save Invoice`. DB: a new `Expense Bill`, Approved, `approved_by` the person,
  `auto_approved` 0, Checking, latest, `invoice_no` / `invoice_date` typed; the old one `is_latest` 0. After the
  reading: a result, still Approved, the typed number and date on the bill and the spend. A hand-keyed spend: none.
- `all-payments` (#1648) Project Payment & Expense -> `All Payments` (this tab only): an `Invoice` column (a
  paperclip link to the Expense's bill, its `invoice_attachment`; "—" when it has none) and a `Bill check` column
  (the latest Expense bill's result over its approval, the cell the expense lists draw; "—" when the Expense has no
  Expense bill), after Payment Source. A PO / WO payment row leaves both cells empty. No filter on either.
- `approval-refused` a profile outside Admin / Accountant / Accountant Lead (PMO) sees no Pending Invoice Approvals
  tab, and the endpoints answer 403.
- `all-invoices` (#1646) Vendor Invoice Recon -> `All Invoices` -> pills `PO` / `WO` / `Cashbook` / `Credit Card` /
  `Porter`. PO and WO are the Vendor Invoices table it was before, narrowed by `document_type` (PO keeps the url key
  `inv_history`). Cashbook and Credit Card list every Expense bill of the pill, latest and history (a `Bill` column:
  Latest / Replaced), with spend date, expense, line amount, bill total read, invoice no. / date, Bill check,
  Approval (a rejected bill's reason under it), Decided by / on (who approved or rejected it and when; "System" on
  an auto-approved one), Paid by, Project, Invoice Added By, Attached on and the file, and `Read again` on a latest
  Not read bill that was not rejected (Admin and Accountant Lead only). Porter
  lists one row per Porter Invoice: invoice no., date, Validate result with its message, city, trips, total, import,
  and `Open` for its PDF (none until the PDF arrived). All three are server-mode tables
  (`api/expenses/all_expense_bills.get_all_expense_bills` with the filter `["kind","=",<pill>]`,
  `api/invoices/all_porter_invoices.get_all_porter_invoices`): funnels `Bill check` / `Approval` / `Bill`, and
  `Validate result`, page, search and sort on the server. Shown to Admin, Accountant and Accountant Lead; anyone
  else sees PO and WO only, and the endpoints answer 403.

## How to get to it (user POV)

- Accountant (or Accountant Lead, Admin, PMO, procurement): sidebar `Vendor Invoice Recon` -> `Pending Invoices
  Upload` -> pill `Credit Card` or `Cashbook` -> the row's `Attach invoice`.
- Accountant (or Accountant Lead, Admin): sidebar `Vendor Invoice Recon` -> `Pending Invoice Approvals` -> pill
  `Cashbook` or `Credit Card` -> the row's `Approve` or `Reject`.
- Accountant: sidebar `Dashboard` -> card `Non-Project Expenses` or `Project Expenses` -> tab `Paid`.
- Accountant: the same -> tab `Paid` or `All` -> the `Bill check` column's header funnels (#1640).
- Accountant: sidebar `Project Payment & Expense` -> tab `All Payments` -> the `Invoice` and `Bill check` columns
  (#1648); the search box (PO / SR / Description) finds a row.
- Accountant: sidebar `Bulk Import Transactions` -> `Not Matched – Outflow` -> an open Collect payment's `Choose`
  (#1642); the search box (remarks) finds the line.
- Accountant (or Accountant Lead, Admin): sidebar `Vendor Invoice Recon` -> `All Invoices` -> pill `PO`, `WO`,
  `Cashbook`, `Credit Card` or `Porter` (#1646).

## Driving it with drive.py

Preconditions:

- `DEVENV script <task> BIN/office_rent_seed.py` once per env: the made-up unlocked Accountant
  `walk-accountant@example.com` and the Home file folder uploads need. Give it a password with
  `DEVENV run <task> set-password walk-accountant@example.com <pw>`.
- The env serves no worker: the walk runs one burst worker on the `long` queue (`DEVENV run <task> worker --queue
  long --burst`) after attaching.

`python3 BIN/walk_expense_bills.py --task <task> --password <pw>` seeds its own made-up card spend and wallet spend
(`BIN/expense_bills_seed.py <stamp>`), writes two made-up PDF bills (₹1,180 for Matched, ₹2,500 for Mismatched),
attaches them in both pills, runs the readings and reads both lists, asserting each screen and its DB row
(`BIN/expense_bills_db.py`). It exits 1 on any miss. These steps have no `--part` of their own: the default
`--part all` walks them and every part below. `--part cashbook` walks only
the Cashbook import (`bill-cashbook-import`): `BIN/cashbook_bills_seed.py <stamp> <accountant>` confirms two made-up
Cashbook imports as the Accountant through the real endpoint and runs their job, then the walk asserts each spend's
Expense bill and its row on the expense list.

Then the approval part: `BIN/expense_bill_approval_seed.py <stamp>` seeds a made-up card spend whose bill reads
Mismatched (₹1,250 against ₹1,180; a seeded state, since the env's reader cannot give one) with a typed number and
date, and the made-up users `walk-accountant-lead@example.com` and `walk-pmo@example.com` (the walk gives them
`--password`). The walk approves the seeded bill with a corrected number and date, rejects the wallet bill of step 3,
sees it back in Pending Invoices Upload with its reason, marks it No invoice as the Accountant Lead, and checks the
PMO has no tab and gets 403 from the reject endpoint (`BIN/expense_bill_approval_db.py` reads each state).
`--shots DIR` keeps one half-size screenshot per acceptance criterion.

Then the Bill check column (#1640), steps 15-18: `BIN/expense_bill_list_seed.py <stamp>` makes made-up Paid spends
"WalkBC <stamp> ..." with their latest bill seeded in each state (four Non-Project, three Project; one of each with
no bill, and a rejected one with an older Matched bill under it). The walk reads each list's Paid and All tabs,
searched by "WalkBC <stamp>", compares every Bill check cell with its DB row (`BIN/expense_bill_list_db.py`), and
uses each funnel, checking that the list request sent the filter. `--part bill-check` runs only these steps (it
needs only the Accountant).

Then Read again (#1645), steps 11-14: `BIN/expense_bills_seed.py R<stamp>` makes two more made-up spends and
`BIN/expense_bill_read_again_seed.py <stamp> <card> <wallet>` puts a Not read bill on the card spend and a bill whose
reading stopped on the wallet spend (wallet holder "Walk Reread Holder <stamp>"; both seeded states). The walk checks
the Accountant sees both rows Not read with no Read again and gets 403, presses Read again on both as the Accountant
Lead, presses the card one twice more by hand (200, still Checking), runs one burst worker, and reads each row's new
result beside its DB row. `--part read-again` runs only these steps (it needs the users of the steps above).

Then Payment Done's replace (#1643), steps 19-22, `--part paid-replace`: `BIN/expense_bills_seed.py P<stamp>` makes a
card spend and a wallet spend, and `BIN/expense_bill_paid_seed.py <stamp> <card> <wallet>` gives each a first bill
(Not read, Pending: a seeded state), makes a hand-keyed Paid spend ("Walk hand-keyed spend <stamp>") and the
Accountant Lead. The walk replaces both bills as the Accountant Lead, runs one burst worker, checks each Bill check
left the approval and the typed number and date alone, and uploads a bill on the hand-keyed spend (no Expense bill).
Matched over a typed number is NOT WALKED (the reader key is refused); `test_paid_expense_bill` proves it.

Then All Payments (#1648), step 23: `BIN/all_payments_bill_seed.py <stamp>` makes made-up Paid records
"WalkAP-<stamp> ..." -- a Mismatched / Pending and a Matched / Auto-approved Expense (seeded states), an Expense with
a bill but no Expense bill, and a PO and a WO payment -- each Expense with its own private PDF. The walk searches
All Payments for them, checks each Invoice link names its own file and that the file opens (200) for the Accountant,
each Bill check cell, and that the PO / WO rows' two cells are empty, beside the DB read (`23-db.db.json`).
`--part all-payments` runs only this step (it needs only the Accountant).

Then the Collect payment (#1642), steps 24-27, `--part collect`: `BIN/collect_bills_seed.py <stamp> <accountant>`
stages five made-up open Collect payments (copies of the fixture's ₹480 one) as the Accountant and runs their import
with made-up downloads and a stand-in reader: M Matched, X Mismatched, N two links (Not checked), K left Checking,
S Matched. The walk opens each line's Choose dialog as the Accountant, reads the note, creates M, X, N and K, reads
each Expense bill (`BIN/collect_bills_db.py`), shows the Cashbook pill of Pending Invoice Approvals, and skips S as
the Accountant Lead.

Then All Invoices (#1646), steps 28-32: `BIN/expense_bills_seed.py A<stamp>` makes a card spend and a wallet spend,
and `BIN/all_invoices_seed.py A<stamp> <card> <wallet>` gives the card spend a Rejected Mismatched bill under a Matched
auto-approved one and the wallet spend a Not read bill (seeded states), and makes a Porter Invoice "WALKPRTA<stamp>"
with Validate result Error and no PDF. The walk reads every pill as the Accountant: PO's and WO's server counts against
the DB (`BIN/all_invoices_db.py`), the card spend's two rows, the wallet row, the Porter row, a funnel on each kind
(the list request must carry it) and the next page (a request with `limit_start` past the first page).
`--part all-invoices` runs only these steps (they need only the Accountant).

## Gotchas

- **A file link points at `localhost:8000` under vite.** `SITEURL` is `http://localhost:8000` in vite's dev mode (the
  main bench, never an env) and the page's own origin in production. The walk checks the link's path and opens it
  on the env's origin; never follow the link as it stands.
- **The Collect payment part is seeded, not live**, for the same reasons as the Cashbook part: the stored bills are
  made-up files and the line readings a stand-in reader, so the dialog's Matched and Mismatched notes show seeded
  results.
- **An env's reader may have no valid key.** Then Google answers 401 "API key not valid", every reading ends Not
  read, "The reader failed (ClientError).", and the walk asserts the Not read path instead and prints NOT WALKED for
  Matched and Mismatched. With a working key the attach steps read the made-up PDFs for real: the ₹1,180 bill
  Matched and auto-approved, the ₹2,500 one Mismatched. Never add a key to an env yourself.
- **Every run's wallet spend has the holder "Walk Wallet Holder".** A run that stopped before its reject step leaves
  its Mismatched bill waiting on the Cashbook pill, so the reject step picks this run's row by its View link (the
  run's own bill file name), not by the holder.
- **A text-only PDF is refused by the reader.** Frappe hands back a local file that decodes as text as a str; the
  walk's PDFs carry the binary marker line every real PDF has.
- **No Cashbook spend waits in the 2026-10-28 data**, so the seed makes one (a Project Expense with the Cashbook
  marker and a Settled match).
- **Frappe keeps no Version under tests** (`ignore_version` defaults to `in_test`): a test that asserts one patches
  `frappe.flags.in_test` off around the save (`test_expense_bill_approval.keeping_versions`). The walk reads real ones.
- **Read again's Matched path cannot be walked on an env** (its reader key is refused): the walk prints NOT WALKED
  and `test_expense_bill_read_again` proves it through the reader seam.
- **The approval table scrolls sideways**: scroll a row's buttons into view before a screenshot that shows them.
- **The env DB has no Pending WO Vendor Invoice** (2026-10-28 data), so the WO pill is walked empty.
- The expense lists open on a tab other than Paid; the seeded spends are Paid.
- **The Cashbook part is seeded, not live.** The env cannot reach the wallet's bill storage and its reader key is
  refused, so `cashbook_bills_seed.py` answers the downloads with made-up files and reads with a stand-in reader
  (one-bill line Matched, late bill Mismatched). The lists show the Invoice Ref only; the Bill check itself is in
  the DB read (`07-cashbook-import.db.json`) until the lists get a Bill check column (spec #1637 ticket 7).
- **A made-up file must have bytes of its own.** Frappe gives a saved file the URL of any File with the same
  content; a private one another user owns (a test's leftover) is then refused to the Accountant, and the copy
  ends "Bill not copied: the bills could not be stored."
- **Payment Done's tab name has a slash** (`Payment Done / Reconciliation Done 19464`): escape it in a role-name
  regex (`r"^Payment Done \/ Reconciliation Done"`). Its search reads the description.
- **Payment Done's replace is walked from the DB for history:** the previous bill staying as history is read from
  the DB there; Vendor Invoice Recon -> All Invoices (steps 28-32) lists every bill, latest and history.
- **A Porter PDF does not open on an env.** The real ones are in the production bucket
  (`frappe_gcp_attachment.controller.generate_file?key=...`), which every env is cut off from. The walk checks the
  `Open` link is the row's own `invoice_file` and prints NOT WALKED for the PDF itself.
- **File links name `localhost:8000` in dev** (`SITEURL` is the main bench in vite's development mode), as every file
  link in the app: open the path on the env's host.
- **The server-mode table drops a filter set while a fetch is loading** (`useServerDataTable.fetchData` returns
  early on `isLoading`): after typing a search, wait for it to settle before using a funnel.
