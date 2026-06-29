# 8. BoQ data starts at the row after the declared header

Date: 2026-06-29

## Status

Accepted.

## Context

The wizard derived "Data starts at row" as `header_row + header_row_count`, and the
parser (`services/boq_parser/orchestrator.py`) skipped `header_row` **and**
`header_row + 1` for a Double (2-row) header. But two other pieces of the system place
the second header tier **above** `header_row`: the wizard UI label ("Top header will be
row `header_row − 1`") and the parser's multi-area detection, which reads
`header_row − 1`. So the model was self-contradictory — the UI and area detection
treated the second header row as sitting above `header_row`, while the data-start math
treated it as sitting below — and `header_row + 1`, the first genuine data row, was
being silently dropped.

Real example: HVAC Low side (header_row=2) showed "Data starts at row 4" and lost its
first data row. That sheet in fact carries extra header tiers (a rate-split row, floor
rows, tower rows) that the simple 1–2 row header model cannot express at all, so the
fixed `+1` skip was both wrong for the common case and insufficient for the hard case.

## Decision

Data starts at **`header_row + 1`, always** — Single or Double.

1. **Remove the `header_row + 1` skip** from the orchestrator. The first row after the
   declared header is data.
2. **The second header tier lives above `header_row`.** It is still read for area /
   column detection (`header_row − 1`) and is kept out of data by the existing
   `row >= header_row` guard — no special-casing needed.
3. **Extra header tiers below `header_row`** (rate splits, area-tier rows) are removed
   by the reviewer using the redesigned manual **"Skip rows after header"** field, which
   accepts single rows and ranges.
4. **Section 1 of the config UI is unchanged** (Single/Double, Header row, Top header row
   controls). `header_row_count` stays `Literal[1, 2]` and now drives **only** area
   detection.

## Consequences

- Existing **Double** sheets, on **re-parse**, no longer auto-skip the `header_row + 1`
  row; it reappears. In the common case such a row lacks description / sl_no / qty, so
  it auto-classifies as a **spacer** — no corrupted line items — and is removed via the
  Skip field or re-classified on the review screen.
- **Committed / Finalized BoQs are frozen** (the commit pinned the rows), so they are
  unaffected until someone re-parses them.
- We deliberately did **not** add a legacy fork in the parser to preserve the old skip
  for old sheets. The Skip field already covers that row, and a permanent
  old-vs-new-behavior fork is not worth the carrying cost.
- Alternatives considered: (a) relabel the UI so `header_row` is the **top** of a 2-row
  band, keeping the old skip — rejected; the stakeholder wants data on the next row.
  (b) a full multi-row "header band" range UI — rejected; the stakeholder wants Section 1
  to stay simple, and the Skip field handles the extra tiers instead.
