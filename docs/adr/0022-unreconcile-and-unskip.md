# 22. Unreconcile and unskip

Date: 2026-09-15

## Status

**Accepted** (owner grilling session 2026-09-15, Q1–Q19; spec #1270). Being built in slices; this
record grows with them. Built so far: the one decision module and write path (#1271), one-line
matching (#1272), Skip by hand with a skipped-by-hand marker (#1273), and **Unskip (#1274)**. Still to
come: Unreconcile for every settle path, import-created records, part-payment un-split, Confirm by hand.

As-built detail: `.claude/context/domain/outflow-import.md` § *#1271*, *#1272*, *#1273*, *#1274*.
Approved mockups: https://claude.ai/artifact/K6vEJXGoALunzfdqTfrVVt

## Context

On Bulk Import Transactions nothing an accountant does can be taken back from the screen:

- a matched line can never be un-matched, for any kind of match — the only undo reverses one payment
  leg, and only while the line is Partially Allocated;
- a person cannot skip a line that has nothing to link, because the Skip button is hidden;
- a skipped line — skipped by the system or by a person — cannot be brought back. The documented fix
  is an admin editing the row in Desk, which leaves the import's status stale and silently releases
  duplicate claims.

## Decision

Three actions on the screen — **Unreconcile**, **Skip** and **Unskip** — each on one line at a time,
each with a typed reason, each available only to **Admin and Accountant Lead**.

### Rulings this reverses

Recorded so later work does not bring "no undo" back by mistake.

| Ruling | Where | What replaces it |
|---|---|---|
| **Q9 — no undo of a settle from inside the import** | Bulk Import Outflow owner rulings; domain doc | Unreconcile, per record or Reverse all, all-or-nothing |
| **AR3 — an import-created inflow cannot be undone** | [ADR-0016](0016-bank-statement-import-creates-inflows.md) | an untouched import-created record is deleted by Unreconcile |
| **R6 — `SHOW_SKIP_ROW` stays off; a line with nothing to link has no manual terminal state** | [ADR-0016](0016-bank-statement-import-creates-inflows.md) | **reversed by #1273**: the "Nothing to link?" Skip box |
| **The 2026-08-10 hidden-skip ruling** (`DecisionDialog.tsx`, "hidden, not deleted") | owner ruling, 2026-08-10 | **reversed by #1273**: `SHOW_SKIP_ROW` is deleted |
| **A split payment is refused outright; only payments can be reversed** | [ADR-0020](0020-one-transfer-many-payments.md) | narrowed: an untouched part payment is un-split; expenses revert too |
| **Skips are final** | domain doc (several places); `expenses.SKIPPED_ROW_REFUSAL` ("correct it in Desk") | **reversed by #1274, for hand skips only**: Unskip from the Skipped popup; a system skip stays final |

### Access (Q1)

A second, narrower check, `permissions.require_outflow_undo_access`: the `Administrator` user, `Nirmaan
Admin Profile`, `Nirmaan Accountant Lead Profile`. It is **layered on** the module check — someone
outside the module reads the module's sentence — the Pricing Module's read/write split. It guards Skip,
Unskip, Unreconcile and the existing single-leg Reverse. A plain Accountant keeps matching and
confirming. The frontend mirrors the set (`outflowImportStatus.OUTFLOW_UNDO_PROFILES`) for convenience
only, pinned by `outflowUndoAccessParity.test.ts`.

### Skip by hand, and who skipped (Q7, Q8, Q16, Q17) — built at #1273

- `Outflow Import Row.skip_origin` — blank / **System** / **Manual**. **Only a Manual skip may ever be
  unskipped.** A system skip is a duplicate, money the bank never moved, an exclusion rule or a repeat
  of an earlier statement; bringing one back is how the same money gets recorded twice.
- **Every skip the software derives is System** — a property of `status.RowOutcome`, so upload
  staging, the gateway match run and the ICICI contains-guard cannot land a skip without it; the
  Cashbook writer stamps it too. **Manual is written in exactly one place**, `review.skip_row`.
- `skip_row` refuses any line that is not open (**including an already Skipped line**, which the old
  endpoint accepted and which would have relabelled a system skip as a hand skip) and any Cashbook
  line. It locks the line, saves through the document layer (a Version row), makes the typed reason the
  line's displayed note, and adds a comment.
- **Back-fill (Q17):** `patches/v3_0/backfill_outflow_skip_origin.py`. Manual only when a person is on
  the line, neither note is a system skip sentence, the line is not Cashbook, **and the bank says the
  transfer succeeded**. The last condition is added to the spec's rule on purpose: a refused transfer
  re-skipped by hand lost its sentence to the typed reason, and would otherwise become unskippable
  (story 59). Every doubt resolves to System.

### Unskip (Q8, Q9) — built at #1274

- `review.unskip_row(row, reason)`, undo access, one line. Refused unless the line is **Skipped**, its
  source is **not Cashbook**, and `skip_origin` is **Manual** (`skip_origin.unskip_refusal`; a blank
  origin is refused like System).
- Through the document layer, back to `Pending match run`, clearing `skip_origin`, `skip_reason`,
  `outcome_note`, the decision stamps and `duplicate_basis`; a comment carries the reason. Then the
  matcher re-checks **that one line** (`match_line`, #1272) **in the same transaction**, which also
  refreshes the import's rollup, so a Completed import reopens.
- It lands Not-Matched, Matched (with its suggestion), or **skipped again as System** when the money was
  recorded since — and a System skip can never be unskipped, so Unskip cannot open a duplicate path.
- A released line's duplicate claim goes with it: a claim is only read off a Skipped line.
- The Skipped popup shows an Unskip column to the undo roles: live for a hand skip, disabled with the
  cause in words for every other line; the result notice is built from the re-check's answer.

## Consequences

- A hand skip is reversible from the screen, and so is its reversal auditable (Version row, comment).
  A system skip still is not: "Not a duplicate" overrides stay out of scope.
- A hand skip is now an audited decision (Version row, comment, who and when) rather than two
  overwritable columns.
- **Known limit of the back-fill:** an OLD upload skip for a repeat or an exclusion that was later
  re-skipped by hand kept no trace of its first sentence and back-fills as Manual. On the dev database
  that shape does not occur (7 Manual, all genuine; 1,945 System). The patch prints its counts so
  production can be checked.
- `get_outflow_summary` now reports two related counts that differ on purpose: `manually_skipped_rows`
  (keys on a decider) and `skipped_by_hand_rows` (keys on `skip_origin = Manual`, what can be unskipped).
