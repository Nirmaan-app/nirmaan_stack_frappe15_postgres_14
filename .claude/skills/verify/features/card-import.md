# Credit Card Statement import

An Accountant imports a company card's monthly ICICI PDF from Bulk Import Transactions. Review lists every spend
with its expense type, the unpaired card refunds under them in their own Refunds list (each at a minus amount, with
its own type picker), the internal transfers and the skipped lines. Create writes one Paid Non-Project Expense per
spend and one of minus its amount per refund (spec #1653, #1673; ADR-0039 Amendment D). A refund never reaches the
main table and needs no bill. The dialog shows where the import stands: Review, Creating (a progress bar), Finished
(a green banner, Done only) or Needs another Create (#1674).

## Sub-features

- `card-upload` the import dialog's `Credit Card Statement (ICICI)` source: upload the PDF, Review opens.
- `card-refunds` Review's `Refunds` region lists each unpaired merchant credit at `-₹<amount>` with its own type
  picker (#1673).
- `card-use-for-all` a spend's `Use for all N <MERCHANT> spends` link retypes the merchant's spends, never its refund.
- `card-create-label` the Create button names both counts: `Create 40 expenses and 1 refund`.
- `card-create` Create writes the spends and the refund; the refund is a Paid Non-Project Expense of minus its amount,
  described `Card refund from <MERCHANT>, <holder>'s card`.
- `card-phase-review` before Create: no banner, footer `Create …` and `Done` (Discard only for Admin / Accountant
  Lead).
- `card-phase-creating` while the Create job is queued or running: `status "Create progress"` with `Creating… N of M`
  and a `progressbar`; footer `Done` only.
- `card-phase-finished` nothing left to create: `status "Import finished"` listing expenses created and their
  total, refunds recorded and their total, lines skipped, internal transfers; the lines below with no picker; footer
  `Done` only. Reopened from Import History, the same.
- `card-phase-needs-create` lines failed or wait: `N of M created. 1 line still waits: press Create again to create
  it.` and `Create the remaining 1 expense`.
- `card-main-table` the refund is in no Not Matched tab of the main table.
- `card-npe-list` the Non-Project Expenses list (Paid tab) shows the refund at minus its amount (rounded, `₹-802`).

## How to get to it (user POV)

- Sidebar `Bulk Import Transactions` → `Import statement` → Source `Credit Card Statement (ICICI)` → choose the PDF →
  `Upload statement`: Review opens in the dialog.
- An earlier import: `Import history` (clock button) → `Previous month` until `Credit Card (n)` is non-zero → that
  tab → the statement's button.
- The Non-Project Expenses list: Dashboard card `Non-Project Expenses` → `Paid` tab → search by description.

## Driving it with drive.py

`BIN/walk_card_import.py --task <task> --accountant <accountant email> --password <pw>` walks every sub-feature
above as the Accountant and exits 1 on a miss. It writes a made-up statement PDF each run (`BIN/card_import_seed.py`:
the card fixture with a fresh holder and SerNos, under the bench's `tmp/`), uploads it through the dialog, and reads
the DB beside each write (`BIN/card_import_db.py`), saving `db.txt` beside the screenshots. Creating is seen because
the env has no worker: the job waits in the queue until the walk drains it. Needs another Create is reached by
unreconciling one created spend as Administrator (`BIN/card_import_reopen_seed.py`, setup). The made-up import is
left on the env.

## Gotchas

- An env runs no RQ worker: the walk drains the `long` queue itself with `devenv.sh run <task> worker --queue long
  --burst` after the upload (the type suggestion) and after Create.
- Merchant memory carries over between runs: an earlier walk's Create teaches MakeMyTrip its type, so the walk picks
  whichever of its two types the line does not hold yet.
- The type picker is a react-select: click it, type, then click the `option` by name (Enter takes the first option).
- The Bulk Import summary panel counts a created refund under Received → `Other` (an open question of #1673).
