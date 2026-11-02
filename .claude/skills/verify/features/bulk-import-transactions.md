# Bulk Import Transactions

An accountant imports a bank, card, cashbook, Cashfree or Porter statement, and each statement line is matched to
the payment or expense it settles, or skipped. The page lists every line by match state; Import history lists the
past imports by source and month.

## Sub-features

- `bit-tabs` the line tabs, each with a count: `All`, `Not Matched – Outflow`, `Not Matched – Inflow`,
  `Matched / Settled – Outflow`, `Skipped`, `Awaiting Bank Line`.
- `bit-filter` the column filters (`Filter Source`, `Filter Status`, `Filter Amount`, …) and the date range
  (`All time`).
- `bit-import` `Import statement` opens the dialog `Import a bank statement` with a `Source` combobox.
- `bit-history` `Import history` opens a dialog with one tab per source (`Cashfree`, `Credit Card`,
  `ICICI Bank Statement`, `Cashbook`, `Porter Statement`) and a `Statement month` combobox.
- `bit-confirm` `Confirm <n> matched` settles the ticked matches (disabled at 0).
- `bit-cashbook-resume` a pinned Cashbook import whose job stopped part-way shows `Stopped: N lines still waiting`
  and `Resume` above the tabs; while its job runs, `Creating… X created, N still waiting.` (#1589).
- `bit-cashbook-invoices` a Cashbook Review says `N spends: A with 1 file, B with 2–4 files (merged), C will wait for an
  invoice`; after Create each spend's bills are its Expense's invoice (Paid tab `Edit Inv`, or `View invoice` in the
  Expenses list), and the finished job lists any spend whose bills were not copied (#1591). An env cannot reach the
  bill storage: seed with `DEVENV script`, running `_cashbook_worker` with `cashbook._fetch_bill` patched.
- `bit-cashbook-refunds` a Cashbook Review lists `N lines will stay open …` (unpaired wallet refunds, wallet credits)
  and `N paired wallet refunds …`; after Create the open lines sit on `Not Matched – Inflow` with `Choose`, which
  offers the card-credit choices (project / non-project inflow, waiting or new vendor refund, Skip transfer) (#1594).
  A non-project inflow needs the File folders `Home/Attachments`; a template without them refuses it with
  `Could not find Folder` (seed them with `frappe.core.doctype.file.utils.make_home_folder`).

## How to get to it (user POV)

- The sidebar entry `Bulk Import Transactions` (Admin, Accountant Lead, Accountant).

## Driving it with drive.py

Preconditions:

- An Accountant that `free_users.py` lists (on the 2026-10-08 template: `urgouroji@gmail.com`; every Accountant
  Lead there is locked).

- **Open the page.** `sidebar(page, "Bulk Import Transactions")`. The URL is `/bulk-import-transactions` and
  `heading "Bulk Import Transactions"` shows.
- **Choose a tab.** Click `get_by_role("button", name=re.compile(r"^Not Matched – Outflow \d+$"))`. The URL does not
  change: prove the tab by the rows.
- **Import dialog.** Click `Import statement`. `dialog "Import a bank statement"` opens with `combobox "Source"`.
  Close it with `Escape`.
- **History.** Click `Import history`. `dialog "Import history"` opens with the source tabs.
- **Resume a stopped Cashbook import.** Seed one with `DEVENV script`: stage the fixture
  (`cashbook._stage`) and run `_cashbook_worker` with `_write_one` patched to raise a `BaseException` after two
  lines. Open it from `Import history` → `Cashbook` → its month → the file name; the page pins it. Press `Resume`.
  ⚠️ An env runs no RQ worker: drain the queue with `DEVENV run <task> worker --queue long` (it does not exit; wrap
  it in `timeout`). Delete the batch afterwards (`test_cashbook_import._purge`): its fixture Txn Ids break tests.

## Gotchas

- The tab names hold an en dash (`–`), not a hyphen.
- The tab is not in the URL, so a reload returns to the default tab.
- A real import needs a statement file. Use a fixture with names changed (see `api/outflow_import` tests), never a
  real statement in the evidence folder.
