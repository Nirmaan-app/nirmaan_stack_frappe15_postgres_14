# 31. Already-imported statement lines are not saved

Date: 2026-10-01

## Status

**Accepted** (owner grilling session 2026-10-01, Q1–Q12). Not built yet.

## Context

Bank statements are exported daily, so their periods overlap, and one transfer can appear in 3–13
files. Since the first build, every parsed line has been staged as an `Outflow Import Row`. A line an
earlier import already holds becomes a `Skipped` row with the skip kind *Already imported*, and a
repeat within one file becomes *Repeated in same file*. The stated reason was that a dropped line is
an absence, "and nobody can review, count or argue with an absence".

Measured on a production copy (2026-10-01): 2,964 of 4,537 rows (65%) were *Already imported*, which
is 88% of all Skipped rows. Nothing links to them, and every one's original row still exists. They
took only about 2.6 MB. **The problem is noise in the Skipped list, not storage.**

## Decision

An **exact repeat** is discarded at upload and never stored. An exact repeat is a line whose identity
(`duplicates.row_identity`) *and* bank status match a line the system already holds, either from an
earlier import or from earlier in the same file. This applies to Cashfree, ICICI and Cashbook.

- **A repeat whose bank status changed is still stored.** Example: SUCCESS earlier, REVERSED now.
  It is skipped as *Already imported*, and its reason names both statuses. A status change is new
  information about the money.
- **Each import keeps one number:** how many exact repeats it left out. That number is the only trace
  a discarded line leaves. It is shown in import history.
- **An import's counters and money totals describe only the rows it stored.** This covers
  `total_rows`, `skipped_rows`, `gross_amount` and `charges_amount`. The preview still describes the
  whole file.
- **A file of nothing but exact repeats is refused, and nothing is written.** This now includes
  Cashbook. A file holding even one status-changed repeat is accepted.
- **One-time cleanup of existing data:**
  - First, record each import's exact-repeat count.
  - Then hard-delete those rows, leaving no *Deleted Document* copy. A database backup is taken first.
  - Keep the status-changed repeats.
  - Recompute each import's counters and money totals from the rows that remain, never by
    subtracting.

The guard against recording money twice (`Outflow Row Match` unique key, the Cashbook lookups) is
unchanged. Duplicate detection reads original rows, never the repeats, so nothing depends on a repeat
row existing.

## Rulings this reverses

| Ruling | Where | What replaces it |
|---|---|---|
| Every parsed row is staged, including lines we have decided are not work | `upload._stage_batch` docstring; ICICI ruling Q16; domain doc invariant 13 | Every parsed row is staged **except an exact repeat**, which is counted instead |
| Duplicates below the 90% threshold "are staged and auto-skipped with their reason visible" | Duplicate-guard ruling Q2 (Option B), `duplicates.assess_duplicates` | Exact repeats are discarded; the refusal and the 90% warning are kept |
| `total_rows` reports the whole file | domain doc; `derive_batch_counters` | `total_rows` reports the rows stored |

[ADR-0022 Amendment C](0022-unreconcile-and-unskip.md) is unchanged. *Already imported* and
*Repeated in same file* stay locked kinds, and they now apply only to status-changed repeats.

## Consequences

If the duplicate check ever wrongly calls a real line a repeat, that line leaves no row to notice or
repair. The 2026-08-18 D4 stranding bug was exactly this kind of mistake, and its repair patch found
the victims by reading stored skipped rows. The per-import count is the only remaining signal. A count
that looks wrong for a file is the cue to investigate.
