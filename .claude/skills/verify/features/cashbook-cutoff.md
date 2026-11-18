# Cashbook cutoff: the import period and ₹0-record fills

A Cashbook Statement line dated before 1 Apr 2026, or with no date, is left out of the import (#1707). Since #1715 it
also counts toward nothing else: the import period on Review and on the stored import starts and ends at the kept
lines, and a left-out Bank → VA line gives no old ₹0 Internal Transfer record its amount, so a file of nothing but
such lines is refused even when one of them repeats a top-up. Review's refunds heading says each refund is booked
where its spend is booked, or else where its remark says (#1720 decision 3).

## Sub-features

- `cutoff-period` Review shows `· <first kept date> to <last kept date>` (ISO dates) under its heading; the import's
  `Outflow Import Batch.period_from` / `period_to` hold the same dates.
- `cutoff-fills` a left-out Bank → VA line that repeats a ₹0 record: Review shows no `N old Internal Transfer record(s)
  get(s) … amount from this file` line, the record keeps ₹0 after Create, and a file of only left-out lines reads
  `Not imported. All N lines in '<file>' are dated before 1 Apr 2026 …` with no Create to press.
- `refunds-heading` an unpaired refund heads `1 wallet refund will be booked as a minus expense: where its spend is
  booked, or else where its remark says` (plural: `N wallet refunds … minus expenses: each where its spend is booked,
  or else where its remark says`).

## How to get to it (user POV)

As an Accountant: sidebar `Bulk Import Transactions` -> `Import statement` -> Source `Cashbook` -> the .xlsx ->
`Read statement` (Review) -> `Create N records` -> `Close`.

## Driving it with drive.py

`BIN/walk_cashbook_cutoff.py --task <task> --accountant <email> --password <pw>` (seed `BIN/cashbook_cutoff_seed.py`,
DB read `BIN/cashbook_cutoff_db.py`). It asserts every sub-feature on screen and by a DB read, and exits 1 on a miss.

## Gotchas

- The seed needs an old Cashbook Internal Transfer record holding ₹0 on a `VALOAD-` line (the 2026-11-17 template has
  574 such records). The walk reuses the first one every run: on the fixed code it stays ₹0.
- An env runs no RQ worker: the walk drains the `long` queue after Create (`devenv.sh run <task> worker --queue long
  --burst`), then presses the dialog's `Close`; `Escape` does not close it while the job shows `Creating…`.
- `free_users.py` lists no Accountant on the 2026-11-17 template; `swathi@nirmaan.app` signs in unlocked.
