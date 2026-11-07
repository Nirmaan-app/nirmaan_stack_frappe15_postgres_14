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
15-minute job limit plus a 5-minute margin) shows on its pill as Not read, "The reading stopped.", and can be read again or decided.

## Sub-features

- `bill-attach-card` Credit Card pill: the spend is listed, Attach invoice -> Upload Invoice dialog -> Save Invoice;
  the spend leaves the list. DB: one `Expense Bill`, Checking, Pending, latest, against the card statement line.
- `bill-attach-cashbook` Cashbook pill: the same for a wallet spend, against its Cashbook line.
- `bill-reading` the reading runs on the env's `long` queue (`expense_bills.reading.check_expense_bill`). DB: Bill
  check Matched / Mismatched / Not read with its reason; Matched is Approved, `auto_approved`, by System.
- `bill-cashbook-import` a Cashbook import's copied bill and late bill: one Expense bill each, attached by the
  Accountant who confirmed the import; two or more links Not checked. Seen on the expense lists (`bill-lists`).
- `bill-lists` Dashboard -> Non-Project Expenses / Project Expenses -> Paid: a Matched bill's Invoice Ref and Invoice
  Date on the spend's row; nothing for any other result.

- `approval-pills` Pending Invoice Approvals -> `PO` / `WO` / `Cashbook` / `Credit Card`. Cashbook and Credit Card
  list each waiting bill: spend date, line amount, bill total read ("--" unless Matched or Mismatched), Bill check
  with its reason, invoice number and date (the bill's own, else the ones typed on the Expense), Paid by (wallet or
  card holder), Project, Invoice Added By, a `View` link to the file, `Approve` and `Reject`.
- `approve` Approve -> dialog with `#expense_bill_invoice_no` and `#expense_bill_invoice_date` prefilled -> Approve;
  the row leaves. DB: Approved, `approved_by` the person, `approved_on`; number and date on the bill and the Expense;
  a Version on both.
- `reject` Reject -> `#expense_bill_reject_reason` -> Reject; the row leaves. DB: Rejected with the reason; the
  Expense's `invoice_attachment`, `invoice_ref`, `invoice_date` cleared; a Version on both. Pending Invoices Upload
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
- `approval-refused` a profile outside Admin / Accountant / Accountant Lead (PMO) sees no Pending Invoice Approvals
  tab, and the endpoints answer 403.

## How to get to it (user POV)

- Accountant (or Accountant Lead, Admin, PMO, procurement): sidebar `Vendor Invoice Recon` -> `Pending Invoices
  Upload` -> pill `Credit Card` or `Cashbook` -> the row's `Attach invoice`.
- Accountant (or Accountant Lead, Admin): sidebar `Vendor Invoice Recon` -> `Pending Invoice Approvals` -> pill
  `Cashbook` or `Credit Card` -> the row's `Approve` or `Reject`.
- Accountant: sidebar `Dashboard` -> card `Non-Project Expenses` or `Project Expenses` -> tab `Paid`.
- Accountant: the same -> tab `Paid` or `All` -> the `Bill check` column's header funnels (#1640).

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
(`BIN/expense_bills_db.py`). It exits 1 on any miss. `--part attach` walks only that; `--part cashbook` walks only
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

## Gotchas

- **The env's reader key is not valid** (2026-11-07: Google answers 401 "API key not valid"). Every reading then
  ends Not read, "The reader failed (ClientError).", and the walk asserts the Not read path instead and prints
  NOT WALKED for Matched and Mismatched. Never add a key to an env.
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
