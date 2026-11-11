# Internal Transfers

The company's own money moving between its own places (wallet top-ups, the bank's own ledger move, card bills,
Cashbook's own moves, the card's auto-debit credit) is an Internal Transfer: a line status and one record per line
saying From and To (spec #1619, ADR-0044). Bulk Import lists these lines in their own tab, counts them in the
summary's Internal transfers figure, keeps them out of the Skipped popup, and lets an Admin or Accountant Lead mark
an open line as one, or send one back to Mismatched. The card import's Review lists its auto-debit credits apart.

## Sub-features

- `it-tab` the main table's `Internal Transfers <n>` tab, after `Settled – Inflow`: both directions, with
  `Direction`, `From`, `To`, `Detail` and `Made by` columns (no `Ledger`); its count is every Internal Transfer line.
  `Made by` is words: `Rule: Cashfree wallet top-up`, `Rule: Cashbook VA → Wallet`, `By hand` (#1619 review).
- `it-figure` the summary chip `Internal transfers <n> lines · ₹<out> out · ₹<in> in`, beside the status chips;
  zero is shown, not hidden; it follows Period and Import. Its line count equals the tab's count and the number of
  Internal Transfer records: every Internal Transfer line holds exactly one (owner decision 3, #1619).
- `it-skipped` the `<n> Skipped` chip's popup holds no line of a moved kind (Cashfree / Cashbook / Porter wallet
  top-up, Wallet money returned, Bank internal transfer, Credit card bill payment, Credit card auto-debit).
- `it-mark` `Mark as Internal Transfer` under `Choose` on an open ICICI, Cashfree or Cashbook line (Admin, Accountant
  Lead): a dialog with the line's own side fixed, a `From` or `To` select for the other end, `Detail`, `Reason`. The
  server sends what it offers with the row (`hand_mark`). On a Cashbook line `Detail` starts as the wallet holder:
  the statement's From for money out, its To for money in (owner decision 8a).
- `it-send-back` `Send back to Mismatched` on an Internal Transfer line (Admin, Accountant Lead): a dialog with
  `Reason`; the line returns to `Not Matched – Outflow` with `Sent back to Mismatched by … : <reason>`, and its own
  record is deleted. It takes no other line: every Internal Transfer line holds its own record (owner decision 3).
  It is never offered on a Cashbook move (`Bank → VA`, `VA → Wallet`, `Wallet → VA`; on an old line with no stored
  Type, read from its Txn Id `VALOAD-` / `BUSINESS_USER-` / `C2B-`), and the server refuses it there in words
  (#1619 review, owner 2026-11-10): the server sends `can_send_back` with each row.
- `it-cashbook-preview` the Cashbook upload preview (`Import statement` → Source `Cashbook (petty cash)` → file →
  `Read statement`) lists Cashbook's own moves under `Internal transfers · <n> line(s)`, each with the money it moved
  and `Internal Transfer from … to …`, not under `Not importing` (owner decision 7). When the file repeats an old
  line whose record holds ₹0, it says `<n> old Internal Transfer record(s) get(s) their amount from this file`, and
  after Create the progress panel says how many got it (owner decision 2).
- `it-card-review` a Credit Card Statement import's Review shows `Internal transfers · <n> line(s)` above the
  skipped lines, holding the `Autodebit Payment Recd.` credit.

## How to get to it (user POV)

- Sidebar `Bulk Import Transactions`, then the `Internal Transfers` tab, the summary chips, or the `Skipped` chip.
- A row's Outcome cell: `Mark as Internal Transfer` (open line) or `Send back to Mismatched` (Internal Transfer
  line). Shown only to Admin and Accountant Lead.
- `Import history` (clock button) → `Previous month` until `Credit Card (n)` is non-zero → that tab → the
  statement's button: the card import's Review.

## Driving it with drive.py

`BIN/walk_internal_transfers.py --task <task> --lead <accountant lead> --accountant <accountant> --password <pw>`
walks every sub-feature above and exits 1 on a miss. It seeds made-up lines (`BIN/internal_transfers_seed.py`): an
open Cashfree line it marks and sends back, an open Cashbook spend whose Mark dialog it opens and cancels, an
old Cashbook top-up whose record holds ₹0, and an old Cashbook `VA → Wallet` move with no stored Type (both moves
must show no Send back); and a made-up Cashbook statement (under the bench's `tmp/`) that repeats
that top-up, whose preview the Accountant reads and never confirms. It reads the DB beside each write
(`BIN/internal_transfers_db.py`: the tab, the chip and the records counts among it), saving `db.txt` beside the
screenshots. The result-after-Create line is not walked (the walk never confirms); `internalTransferView.test.ts`
pins its words.

Preconditions:

- The env was migrated after spec #1619 (the patch `v3_0.internal_transfers_from_old_skips` turns old skips into
  Internal Transfers) and holds a Credit Card Statement import with an auto-debit credit (the 2026-10-28 template
  does: Sep 2026).
- An Accountant Lead and an Accountant with passwords. `free_users.py` called both profiles locked on the
  2026-10-28 template, yet `deepa@nirmaan.app` and `swathi@nirmaan.app` reach Bulk Import there.

## Gotchas

- Do not walk while a test run uses the same env: tests stage and purge Internal Transfer lines, and the counts
  race the DB read.
- The Mark dialog's other-end control is a native `<select>` (`#it-from` for money in, `#it-to` for money out):
  `select_option` works, no coordinates needed.
- An old card auto-debit line converted by the patch names no card digits (its statement heading was never kept).
