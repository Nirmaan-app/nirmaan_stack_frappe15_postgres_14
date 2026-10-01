# 31. Already-imported statement lines are not saved

Date: 2026-10-01

## Status

**Accepted** (owner grilling session 2026-10-01, Q1–Q12). Built in #1353–#1356. Amended by
#1358 (see *Amendment A*) and #1359 (see *Amendment B*).

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

## Amendment A: what "already holds" means, per source (#1358)

Date: 2026-10-01

A review of the first build found three places where the rule above was applied too loosely. This
amendment states the rule precisely.

- **An earlier import's line counts only on the source's FULL identity.** On ICICI the identity is
  `(transfer_id, amount, date, direction, remarks)` ([ADR-0016](0016-bank-statement-import-creates-inflows.md)
  § 4). The lookup against earlier imports compared only `(transfer_id, amount, date)`. So the other
  leg of an SGST/CGST pair or of a GL transfer counted as an earlier sighting. Before this ADR that was
  a visible skip; now a matched line is dropped silently. The lookup now requires the full identity
  (`duplicates.find_prior_sightings`, `wide_fields`). A true re-upload still matches each leg to its
  own stored leg. Cashfree and Cashbook use the triple, so they are unchanged.
- **Which lines of the same file count as sightings depends on the source.**
  - Cashfree and ICICI: every terminal line, whatever its own outcome.
  - Cashbook: only a line the plan will **create**. This was Cashbook's rule before this ADR, and
    #1355 lost it. Under the terminal rule, Txn X FAILED then Txn X SUCCESS in one file made the
    SUCCESS line a status-changed repeat of the failure. It was skipped and Unskip-locked, and the
    spend never became an expense. SUCCESS then SUCCESS is still an exact repeat. One consequence:
    a line already booked as an expense is not created, so a copy of it later in the same file is
    stored too, and both say *Already booked*.
- **The one-time cleanup uses the upload's own rule.** It replays each stored import, in file order,
  through the same walk (`repeats.split_repeats`) with the same identity, the same earlier sightings
  (from imports created before it, any of them with the same bank status) and the same in-file rule.
  It does not use the Skipped popup's display lookups. An import whose every row it deletes is kept,
  with its count, and is marked `Completed`. An empty import would otherwise derive as `Draft`, which
  reads as open work.

## Amendment B: any status, and a cleanup of any kind (#1359)

Date: 2026-10-01

Simulating future uploads on a restore of the 2026-10-01 production backup found two gaps.

- **The same-status rule applies to every status (owner decision).** Only a final bank status
  (SUCCESS, FAILED, REJECTED, REVERSED) used to make a line count as already held. A line still
  QUEUED, PENDING or RECEIVED, or a Cashbook REFUNDED line, was never a sighting, so every
  overlapping upload stored it again: 110 rows covering 66 lines on the backup. Now a line whose
  identity *and* bank status match a line already held is an exact repeat, whatever the status, in
  every source, from an earlier import or from earlier in the same file.
  - **The basis of a "status changed" skip does not change.** An in-flight line never makes a
    *different* status a repeat: a QUEUED line must never block its later SUCCESS (the D4 rule).
    Cashfree and ICICI judge a status change against terminal lines; Cashbook against terminal
    earlier imports and lines of the same file the plan creates (Amendment A). In code, every
    sighting carries `final`, and only a final one can be that basis.
  - **A line that is not final never makes a final line a repeat.** On Cashbook a wallet top-up and a
    spend can share an identity and a status; the top-up creates nothing and must not swallow the
    spend that would.
  - Consequences: Cashbook SUCCESS → REFUNDED is stored once, as a status change, and later REFUNDED
    copies are counted. A file of nothing but exact repeats, in-flight ones included, is refused. A
    copy of an *already booked* line later in the same file is now counted, not stored (this replaces
    the last consequence in Amendment A).
- **The one-time cleanup covers every skip kind.** The old staging checked bank-exclusion rules,
  and Cashbook "not a spend", before "already imported". So many old repeats were stored as, for
  example, *Cashfree wallet top-up* or *Cashbook internal movement*, which the first cleanup did not
  read. A second patch, `delete_stored_exact_repeats_of_any_kind`, replays every import through the
  same walk, with this amendment's rule, and deletes exact repeats of any kind. It uses the first
  patch's planner and applier. It deletes only rows that are `Skipped` with `skip_origin = System`,
  not pointed at by an `Outflow Row Match`, and carrying no `duplicate_basis` claim. It never touches
  a hand skip or a row in any other status. Dry run on the backup, after the first patch: 167 rows
  (67 ICICI, 58 Cashbook, 42 Cashfree in-flight copies).
- **Wording.** A line repeated only within the file is no longer described as "already imported" in
  the preview. Cashbook's status-change reason is now Cashfree's sentence: "Already imported in batch
  OFI-…, bank status changed A → B."
