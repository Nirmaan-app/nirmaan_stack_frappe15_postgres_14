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

## Features

- [Login and the app access gate](./login-and-access-gate.md): signing in, the role landing page, the lock card.
- [Purchase Orders](./purchase-orders.md): the PO list tabs, a PO's page, its figures against the DB. Walked
  end to end by `BIN/walk_purchase_orders.py`.
- [Procurement Requests](./procurement-requests.md): the PR list tabs, items, Add New PR.
- [Bulk Import Transactions](./bulk-import-transactions.md): bank, card and cashbook statement lines and their
  matches.
- [Projects](./projects.md): the project list and a project's page.
- [Office Rent](./office-rent.md): a bill incl. 18% GST raised by HR, approved by Admin and the CEO, split
  into rent, GST, TDS and what the landlord gets, paid by an Accountant. Walked end to end by
  `BIN/walk_office_rent.py`.
- [Internal Transfers](./internal-transfers.md): the Internal Transfers tab, the summary's Internal transfers figure,
  the Skipped popup without the moved lines, Mark as Internal Transfer and Send back to Mismatched (one line), Made by
  in words, the Cashbook preview's and the card Review's Internal transfers lists, and the preview's sentence on the
  old ₹0 records it fills. Walked end to end by `BIN/walk_internal_transfers.py`.
- [Vendor Invoice Recon](./vendor_invoice_recon.md): the Pending Invoice Approvals and All Invoices tabs, and their
  "Invoice Added By" column; the PO and WO Invoices 2B Recon tabs, and their "Invoice Uploaded By" column (full
  name or email, cut with "…", whole text on hover). Walked by `BIN/walk_vendor_invoice_recon.py`.
- [Expense bills](./expense_bills.md): a bill attached in Pending Invoices Upload -> Credit Card or -> Cashbook
  becomes an Expense bill with a Bill check (Checking, then Matched / Mismatched / Not read); a Matched bill fills
  the Invoice Ref and Date on the expense lists; the bills a Cashbook import copies, late bills too, get the same
  check, and two or more bill links are Not checked; any other result waits in Pending Invoice Approvals -> Cashbook
  or -> Credit Card, to be approved (number and date corrected) or rejected (the spend waits again, with the reason);
  a Not read bill (or one whose reading stopped) can be read again by Admin or Accountant Lead; a paid spend's bill
  an Admin or Accountant Lead replaces on Payment Done is approved at once in their name; the Project and
  Non-Project Expenses lists show each spend's Bill check and approval on Paid and All, with a filter on each;
  Project Payments -> All Payments shows each Expense row's Invoice and Bill check (PO / WO rows empty); an open
  Collect payment's stored bill is checked at import, its decide dialog says "Invoice already available" and what
  Create leads to, and Create moves the kept check to the Expense bill. Vendor Invoice Recon -> All Invoices has
  PO / WO / Cashbook / Credit Card / Porter pills: every Expense bill, latest and history, and every Porter Invoice
  with its Validate result.
  Walked end to end by `BIN/walk_expense_bills.py` (`--part read-again`, `--part cashbook`, `--part bill-check`,
  `--part paid-replace`, `--part all-payments`, `--part collect` or `--part all-invoices` for one part alone).
