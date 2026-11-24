# Cashbook Wallet Credits

A Wallet Credit on a Cashbook Statement is money paid into the wallet from outside (a staff repayment, scrap money, a
shop's refund that names no spend). Since #1720 (ADR-0015 Amendment E) the import books it as a Paid Expense of minus
its Credit, placed from its remark the way a spend is: a remark naming one project makes it a Project Expense on that
project, any other a Non Project Expense typed from the remark, else Petty Cash. An unpaired refund whose spend has no
Expense is placed the same way. Nothing stays open on the main table.

## Sub-features

- `cbc-review` Review lists the credits apart from the spends: `N wallet credits (money paid in from outside) will be
  booked as minus expenses`, each `Wallet Credit <Txn Id> · <remark> · <ledger> · <project> · <type>` at `-₹…`. The
  header (`N expense records`, ₹) counts the spends only. A refund with no spend Expense says the ledger and project
  its remark gives.
- `cbc-create` Create's job writes each credit as a Paid Expense of minus its Credit: `payment_ref` its Txn Id,
  `payment_date` its date, the Cashbook marker, described `Wallet credit from <From>`; its match carries the minus
  amount. It waits for no bill (not in Pending Invoices Upload -> Cashbook) and reads the SYSTEM tier.
- `cbc-lists` it reads green `−₹…` on Dashboard -> Project Expenses / Non-Project Expenses -> Paid.
- `cbc-unreconcile` Unreconcile (Admin, Accountant Lead) on `Settled – Inflow` deletes its Expense and reopens the
  line on `Not Matched – Inflow`.
- `cbc-patch` the one-off patch `v3_0.create_open_wallet_credit_expenses` books the Wallet Credit lines an earlier
  import left open (no screen; proven by `test_cashbook_wallet_credits`).

## How to reach it

Accountant: sidebar `Bulk Import Transactions` -> `Import statement` -> Source `Cashbook` -> the file -> `Read
statement` -> Review -> `Create N records`. An env runs no RQ worker: drain it with `DEVENV run <task> worker --queue
long --burst`. Accountant Lead: `Bulk Import Transactions` -> `Settled – Inflow` -> the credit's row -> `Unreconcile`.

## Walk

`BIN/walk_cashbook_credits.py --task <task> --accountant <email> --lead <email> --password <pw>` (seed
`BIN/cashbook_credits_seed.py`, DB read `BIN/cashbook_credits_db.py`, helpers shared with the #1711 walk in
`BIN/cashbook_walk.py`). It asserts every sub-feature above but `cbc-patch` on screen and in the DB, and exits 1 on
any miss.
