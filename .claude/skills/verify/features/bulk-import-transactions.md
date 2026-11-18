# Bulk Import Transactions

An accountant imports a bank, card, cashbook, Cashfree or Porter statement, and each statement line is matched to
the payment or expense it settles, or skipped. The page lists every line by match state; Import history lists the
past imports by source and month.

## Sub-features

- `bit-tabs` the line tabs, each with a count: `All`, `Not Matched – Outflow`, `Not Matched – Inflow`,
  `Matched / Settled – Outflow`, `Skipped`, `Awaiting Bank Line`, and `Internal Transfers` after the Settled tabs
  (spec #1619; see [Internal Transfers](./internal-transfers.md)).
- `bit-filter` the column filters (`Filter Source`, `Filter Status`, `Filter Amount`, …) and the date range
  (`All time`).
- `bit-import` `Import statement` opens the dialog `Import a bank statement` with a `Source` combobox.
- `bit-history` `Import history` opens a dialog with one tab per source (`Cashfree`, `Credit Card`,
  `ICICI Bank Statement`, `Cashbook`, `Porter Statement`) and a `Statement month` combobox.
- `bit-confirm` `Confirm <n> matched` settles the ticked matches (disabled at 0).
- `bit-cashbook-resume` a pinned Cashbook import whose job stopped part-way shows `Stopped: N lines still waiting`
  (or `Stopped: M bills still to copy`, or both, when it died before its late bill copies) and
  `Resume` above the tabs; while its job runs, `Creating… X created, N still waiting.` (#1589, code review S1, S2).
  Once the job is done, the same panel lists any bill not copied with its reason (code review S3).
- `bit-cashbook-invoices` a Cashbook Review says `N spends: A with 1 file, B with 2–4 files (merged), C will wait for an
  invoice`; after Create each spend's bills are its Expense's invoice (Paid tab `Edit Inv`, or `View invoice` in the
  Expenses list), and the finished job lists any spend whose bills were not copied (#1591). An env cannot reach the
  bill storage: seed with `DEVENV script`, running `_cashbook_worker` with `cashbook_bills.fetch_bill` patched.
- `bit-cashbook-collect` a Collect payment is a wallet spend like any other (#1708, ADR-0015 Amendment C): a Cashbook
  Review counts it in `N expense records` and lists it in its ledger group (no amber `shop-requested payments` box),
  and the import's job creates its Expense (Cashbook marker, `payment_ref` = its Txn Id) with its bills as the
  invoice. Walked by `BIN/walk_cashbook_collect.py` (seed `BIN/cashbook_collect_seed.py`, DB read
  `BIN/cashbook_collect_db.py`), as an Accountant.
- `bit-cashbook-refunds` a Cashbook Review lists `N lines will stay open …` (wallet credits) and `N paired wallet
  refunds …` (a refund giving back a whole Wallet Spend or Collect Payment on the same statement: both lines Skipped,
  no Expense); after Create the open lines sit on `Not Matched – Inflow` with `Choose`, which
  offers the card-credit choices (project / non-project inflow, waiting or new vendor refund, Skip transfer) (#1594).
  The summary's `Received` counts them (all deposits, all undecided) and its counter matches the Inflow tab: a
  refund's raw status REFUNDED is money that moved, not a failed transfer (story 42).
  A non-project inflow needs the File folders `Home/Attachments`; a template without them refuses it with
  `Could not find Folder` (seed them with `frappe.core.doctype.file.utils.make_home_folder`).
- `bit-cashbook-refund-expense` an unpaired wallet refund (#1709, ADR-0015 Amendment D) is listed apart on Review
  (`N wallet refunds will be booked as minus expenses where their spends are booked`, each with `reduces <spend Txn
  Id> (<its Expense> | no Expense yet | created by this import)`, its ledger, project and type); the header
  (`N expense records`, ₹) counts the spends only. The job books it as a Paid Expense of minus its Credit on the
  spend's Expense's ledger, project and type, else a Non Project Expense (type from its remark, else Petty Cash). It
  reads green `−₹…` on Project / Non-Project Expenses -> Paid, has no Upload / Edit Inv on Payment Done (nor does a
  card refund), is not in Pending Invoices Upload -> Cashbook, and Unreconcile (Admin, Accountant Lead) on
  `Settled – Inflow` deletes it and reopens the line on `Not Matched – Inflow`.
- `bit-cashbook-cutoff` a Cashbook line dated before 1 Apr 2026 is left out and not stored (#1707): Review, the
  Create progress and the import's Import history row say `N lines before 1 Apr 2026 left out`; a file of only such
  lines reads `Not imported. All N lines in '<file>' are dated before 1 Apr 2026 …` with `Create 0 records` disabled.
- `bit-cashbook-1711` the stories above, with a Collect payment's pairing and its Skip by hand once open, are walked
  by `BIN/walk_cashbook_refunds.py` (seed `BIN/cashbook_refunds_seed.py`, DB read `BIN/cashbook_refunds_db.py`), as
  an Accountant and an Accountant Lead.

## How to get to it (user POV)

- The sidebar entry `Bulk Import Transactions` (Admin, Accountant Lead, Accountant).

## Driving it with drive.py

Preconditions:

- An Accountant that `free_users.py` lists (on the 2026-10-08 template: `urgouroji@gmail.com`; every Accountant
  Lead there is locked). `free_users.py` counts any asset holder as locked; on the 2026-11-17 template it lists none,
  yet `swathi@nirmaan.app` (Accountant) and `deepa@nirmaan.app` (Accountant Lead) sign in unlocked (no declaration
  or audit due).

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

- The Import statement dialog opens on the source last used in the page: a second Cashbook import in one session
  opens as `Import a petty cash statement` at once, with no `Import a bank statement` step.
- The `Matched / Settled – Outflow` tab's name continues with its counts (`… 0 matched 0 settled`): match its start.
- Unreconcile shows only to Admin and Accountant Lead; its dialog's button is `Reverse all <n>`.

- The tab names hold an en dash (`–`), not a hyphen.
- The tab is not in the URL, so a reload returns to the default tab.
- A real import needs a statement file. Use a fixture with names changed (see `api/outflow_import` tests), never a
  real statement in the evidence folder.
