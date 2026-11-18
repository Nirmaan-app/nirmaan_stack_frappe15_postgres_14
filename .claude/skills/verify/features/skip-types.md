# Skip Types: the Skipped popup's filter and the Unskip warning

The Skipped popup lists every skipped line with its Skip Type. Its Skip Type funnel offers the kinds the lines on
screen hold, and Unskip on a line a bank rule skipped warns first. Since #1628 the 8 kinds whose lines are Internal
Transfers (Cashfree / Cashbook / Porter wallet top-up, Wallet money returned, Bank internal transfer, Credit card bill
payment, Credit card auto-debit, Cashbook internal movement) are retired: the funnel never offers one, and no Unskip
warns for one. Failed payment bounced back and Card payment received work as before.

## Sub-features

- `skip-type-funnel` the funnel lists the live kinds of the lines on screen, never a retired one, even while an old
  line still holds one.
- `unskip-warning` Unskip on a Failed payment bounced back (or Bank card rounding) line opens `Unskip this transfer?`
  with an amber alert: `A bank rule read this line as money moving between our own accounts (<kind>) …`.
- `unskip-locked` a Card payment received line's Unskip is disabled, with `A payment into the card is never a spend or
  a receipt.` under it.

## How to get to it (user POV)

As an Accountant Lead (or Admin): sidebar `Bulk Import Transactions` -> the `N Skipped` chip -> `Skipped transfers`
popup -> the funnel beside `Skip Type` (`Filter Skip Type`) / a row's `Unskip`.

## Driving it with drive.py

`BIN/walk_skip_types.py --task <task> --lead <email> --password <pw>` (seed `BIN/skip_types_seed.py`, DB read
`BIN/skip_types_db.py`). It asserts each sub-feature on screen and by a DB read, unskips nothing, and exits 1 on a
miss.

## Gotchas

- The funnel's options sit in a Radix popper (`[data-radix-popper-content-wrapper] label`); Escape closes it.
- The env holds no Failed payment bounced back line of its own; the seed adds one to the latest ICICI import.
- The 2026-11-17 template still holds 295 Cashbook lines as `Cashbook internal movement` (pre-reset data); a
  Cashbook line's Unskip is disabled by the Cashbook rule whatever its kind.
- `deepa@nirmaan.app` (Accountant Lead) signs in unlocked on the 2026-11-17 template.
