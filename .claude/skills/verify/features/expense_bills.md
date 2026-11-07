# Expense bills

An Accountant attaches a bill to a card spend (Vendor Invoice Recon -> Pending Invoices Upload -> Credit Card) or a
wallet spend (-> Cashbook). The spend leaves the list at once, as before, and the bill becomes an **Expense bill**
with a **Bill check** (GLOSSARY *Expense bills*, ADR-0045, spec #1637, ticket #1639). In the background the shared
invoice reader reads the bill and its total (incl. GST) is compared with the statement line's amount: **Matched**
(within ₹1) fills the Expense's Invoice Ref and Invoice Date where empty and auto-approves the bill; **Mismatched**
and **Not read** (with the reason) leave it Pending and write nothing to the Expense.

## Sub-features

- `bill-attach-card` Credit Card pill: the spend is listed, Attach invoice -> Upload Invoice dialog -> Save Invoice;
  the spend leaves the list. DB: one `Expense Bill`, Checking, Pending, latest, against the card statement line.
- `bill-attach-cashbook` Cashbook pill: the same for a wallet spend, against its Cashbook line.
- `bill-reading` the reading runs on the env's `long` queue (`expense_bills.reading.check_expense_bill`). DB: Bill
  check Matched / Mismatched / Not read with its reason; Matched is Approved, `auto_approved`, by System.
- `bill-lists` Dashboard -> Non-Project Expenses / Project Expenses -> Paid: a Matched bill's Invoice Ref and Invoice
  Date on the spend's row; nothing for any other result.

## How to get to it (user POV)

- Accountant (or Accountant Lead, Admin, PMO, procurement): sidebar `Vendor Invoice Recon` -> `Pending Invoices
  Upload` -> pill `Credit Card` or `Cashbook` -> the row's `Attach invoice`.
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

## Gotchas

- **The env's reader key is not valid** (2026-11-07: Google answers 401 "API key not valid"). Every reading then
  ends Not read, "The reader failed (ClientError).", and the walk asserts the Not read path instead and prints
  NOT WALKED for Matched and Mismatched. Never add a key to an env.
- **A text-only PDF is refused by the reader.** Frappe hands back a local file that decodes as text as a str; the
  walk's PDFs carry the binary marker line every real PDF has.
- **No Cashbook spend waits in the 2026-10-28 data**, so the seed makes one (a Project Expense with the Cashbook
  marker and a Settled match).
- The expense lists open on a tab other than Paid; the seeded spends are Paid.
