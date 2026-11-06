# ADR 0044 — An internal move is a record and a line status, not one more Skip Type

**Status:** Accepted · 2026-11-06 (owner) · Spec #1619

Bulk Import set aside the company's own money moves (wallet top-ups, the bank's own ledger move, card bills,
Cashbook's own moves, the card's auto-debit credit) as **Skipped**, under one Skip Type per bank rule, in the same
popup as duplicates and refused transfers. We decided that such a line gets its own line status, **Internal
Transfer**, and one **Internal Transfer** record that says where the money came from and went (From, To, a short
detail). *Skipped* means "nothing to record". These lines have something to record, a move between two named
places, and the owner wants them listed and counted apart from real spend and income.

## Considered options

- **Keep them Skipped and filter the popup by Skip Type** (rejected): it keeps "set aside" and "moved between our
  own accounts" under one word, nothing is recorded, and nothing can be counted except by a list of kinds.
- **A Skipped sub-status or a flag on the line** (rejected): every reader of Skipped (the popup, Unskip, the
  totals) would need to learn the exception, and there would still be no From and To.
- **Record it in the expense or inflow ledgers** (rejected): the money is not spent or received, and every figure
  that sums those ledgers would move.

## Consequences

- The status is final, like Settled: the match run never touches it, it is in no open-work figure, and every hand
  action refuses it except *Send back to Mismatched* (#1626), which deletes the record and reopens the line.
- The record links to its line (one record per line, a unique index), never the other way, and no expense, inflow
  or payment figure reads it. A status-changed repeat of an internal line is an Internal Transfer line with no
  second record.
- The import summary's totals leave these lines out, as they did while they were Skipped, and show them in their
  own *Internal transfers* figure. Gross Outflow and Gross Inflow already include them and do not change.
- The two sides of one move (the bank statement and the wallet statement) are two records and stay unlinked.
- From and To are a fixed list of places in code; a second bank account or card issuer extends it in code.
- The Skip Types whose lines all moved leave the list only after the one-time patch has run on production (#1628).
