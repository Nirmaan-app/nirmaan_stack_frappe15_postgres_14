# Expense bills

An Accountant attaches a bill to a card spend (Vendor Invoice Recon -> Pending Invoices Upload -> Credit Card) or a
wallet spend (-> Cashbook). The spend leaves the list at once, as before, and the bill becomes an **Expense bill**
with a **Bill check** (GLOSSARY *Expense bills*, ADR-0045, spec #1637, ticket #1639). In the background the shared
invoice reader reads the bill and its total (incl. GST) is compared with the statement line's amount: **Matched**
(within ₹1) fills the Expense's Invoice Ref and Invoice Date where empty and auto-approves the bill; **Mismatched**
and **Not read** (with the reason) leave it Pending and write nothing to the Expense.

A bill that is not Matched waits for a person in Vendor Invoice Recon -> Pending Invoice Approvals, on the
**Cashbook** and **Credit Card** pills (#1644; PO and WO are the Vendor Invoices beside them). Admin, Accountant and
Accountant Lead approve it, correcting its number and date, which are mirrored onto the Expense, or reject it with a
reason: the Expense loses its bill and waits again in Pending Invoices Upload, showing "Last bill rejected: <reason>".
The server refuses both to anyone else.

A Not read bill can be **read again** (#1645) by Admin and Accountant Lead: Read again puts it back to Checking (it
leaves the pill) and queues its reading; its new result comes back to the pill, or a Matched one is auto-approved
and does not. A bill left Checking by a reading that stopped (a worker killed mid-read: its claim is older than the
15-minute job limit plus a 5-minute margin) shows on its pill as Not read, "The reading stopped.", and can be read again or decided.

A paid wallet spend's or card spend's bill replaced on Project Payment & Expense -> Payment Done / Reconciliation
Done (Edit Inv / Upload Inv, #1643) is a new Expense bill too: an Admin's or Accountant Lead's is **Approved at once
in their name** (not auto-approved) with the number and date they typed; its Bill check still runs and is recorded,
and never replaces that number or date. The previous bill stays as history, no longer latest. Anyone else's
(Accountant, HR) waits like an attached one. Editing only the number or date lands no new bill. Any other paid
Expense (hand-keyed, Porter, ...) gets no Expense bill.

## Sub-features

- `bill-attach-card` Credit Card pill: the spend is listed, Attach invoice -> Upload Invoice dialog -> Save Invoice;
  the spend leaves the list. DB: one `Expense Bill`, Checking, Pending, latest, against the card statement line.
- `bill-attach-cashbook` Cashbook pill: the same for a wallet spend, against its Cashbook line.
- `bill-reading` the reading runs on the env's `long` queue (`expense_bills.reading.check_expense_bill`). DB: Bill
  check Matched / Mismatched / Not read with its reason; Matched is Approved, `auto_approved`, by System.
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
- `paid-replace` Project Payment & Expense -> `Payment Done / Reconciliation Done` -> search the spend -> `Edit Inv`
  (`Upload Inv` with no bill) -> dialog `Edit Invoice`: a file in `input[type=file]`, `#invoice_ref_update_id`,
  `#invoice_date_update_id` -> `Save Invoice`. DB: a new `Expense Bill`, Approved, `approved_by` the person,
  `auto_approved` 0, Checking, latest, `invoice_no` / `invoice_date` typed; the old one `is_latest` 0. After the
  reading: a result, still Approved, the typed number and date on the bill and the spend. A hand-keyed spend: none.
- `approval-refused` a profile outside Admin / Accountant / Accountant Lead (PMO) sees no Pending Invoice Approvals
  tab, and the endpoints answer 403.

## How to get to it (user POV)

- Accountant (or Accountant Lead, Admin, PMO, procurement): sidebar `Vendor Invoice Recon` -> `Pending Invoices
  Upload` -> pill `Credit Card` or `Cashbook` -> the row's `Attach invoice`.
- Accountant (or Accountant Lead, Admin): sidebar `Vendor Invoice Recon` -> `Pending Invoice Approvals` -> pill
  `Cashbook` or `Credit Card` -> the row's `Approve` or `Reject`.
- Accountant: sidebar `Dashboard` -> card `Non-Project Expenses` or `Project Expenses` -> tab `Paid`.

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
(`BIN/expense_bills_db.py`). It exits 1 on any miss.

Then the approval part: `BIN/expense_bill_approval_seed.py <stamp>` seeds a made-up card spend whose bill reads
Mismatched (₹1,250 against ₹1,180; a seeded state, since the env's reader cannot give one) with a typed number and
date, and the made-up users `walk-accountant-lead@example.com` and `walk-pmo@example.com` (the walk gives them
`--password`). The walk approves the seeded bill with a corrected number and date, rejects the wallet bill of step 3,
sees it back in Pending Invoices Upload with its reason, marks it No invoice as the Accountant Lead, and checks the
PMO has no tab and gets 403 from the reject endpoint (`BIN/expense_bill_approval_db.py` reads each state).
`--shots DIR` keeps one half-size screenshot per acceptance criterion.

Then Read again (#1645), steps 11-14: `BIN/expense_bills_seed.py R<stamp>` makes two more made-up spends and
`BIN/expense_bill_read_again_seed.py <stamp> <card> <wallet>` puts a Not read bill on the card spend and a bill whose
reading stopped on the wallet spend (wallet holder "Walk Reread Holder <stamp>"; both seeded states). The walk checks
the Accountant sees both rows Not read with no Read again and gets 403, presses Read again on both as the Accountant
Lead, presses the card one twice more by hand (200, still Checking), runs one burst worker, and reads each row's new
result beside its DB row. `--part read-again` runs only these steps (it needs the users of the steps above).

Then Payment Done's replace (#1643), steps 15-18, `--part paid-replace`: `BIN/expense_bills_seed.py P<stamp>` makes a
card spend and a wallet spend, and `BIN/expense_bill_paid_seed.py <stamp> <card> <wallet>` gives each a first bill
(Not read, Pending: a seeded state), makes a hand-keyed Paid spend ("Walk hand-keyed spend <stamp>") and the
Accountant Lead. The walk replaces both bills as the Accountant Lead, runs one burst worker, checks each Bill check
left the approval and the typed number and date alone, and uploads a bill on the hand-keyed spend (no Expense bill).
Matched over a typed number is NOT WALKED (the reader key is refused); `test_paid_expense_bill` proves it.

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
- **Payment Done's tab name has a slash** (`Payment Done / Reconciliation Done 19464`): escape it in a role-name
  regex (`r"^Payment Done \/ Reconciliation Done"`). Its search reads the description.
- **No screen lists an Expense's bill history yet** (the All Invoices pills are a later ticket of spec #1637): the
  previous bill staying as history is read from the DB.
