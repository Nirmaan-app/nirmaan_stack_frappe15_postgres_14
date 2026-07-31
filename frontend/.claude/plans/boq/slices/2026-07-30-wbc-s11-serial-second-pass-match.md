# WBC-S11 — serial-number second-pass match

**Branch** `feature/boq-within-boq-carry` · **Base** `283a0199` · **Tier** FULL · **Date** 2026-07-30

The original → revised rate carry could only match a row that had **not moved**: `match_rows`
required identical Excel position AND identical N2 description, a conjunction with no fallback. A
row that shifted could not carry even with byte-identical text. It now gets a second pass keyed on
**serial number + description**.

---

## ADR-0014 **Amendment G** — the boundary

### The rule

Pass 1 is unchanged and takes precedence. Pass 2 runs **only** over rows unmatched on **both** sides
after pass 1, and pairs two rows only when all of:

- serial non-blank on both sides
- N2-normalized descriptions equal (the same comparison pass 1 makes)
- the `(serial, description)` key occurs **exactly once** among unmatched originals **and** exactly
  once among unmatched revised

Anything else stays unmatched. This mirrors the existing *second sighting → neither is trustworthy →
drop the key outright* discipline already used for duplicate positions. The owner's chosen failure
mode: **a bad serial LOSES a match, it never CREATES a wrong one.**

### Where it is enabled

| call site | pass 2 | consumer |
|---|---|---|
| `committed_carry.committed_excel_row_match` | **ON** | `cross_boq_carry` — the rate carry **and** the opt-in layer carry |
| `committed_carry.version_addressed_excel_row_match` | off | `pricing.apply_copy_forward`, the within-BoQ copy-forward |
| `review_carry.merge_revision_review_carry` | off | the parse-time classification + parenting carry |

`serial_second_pass` is **keyword-only, default False**, so the consumers that must not have it are
unaffected **by construction**, not by care.

### ⚠️ The boundary is STRUCTURE vs. everything else — not rates vs. layers

**The build prompt's original framing was wrong and the owner corrected it mid-slice (2026-07-30).**
It listed four consumers and said only the rate carry may have pass 2, with the cross-BoQ *layer*
carry (categories / remarks / colours / dismissals) explicitly "unchanged". That is not achievable
and not desirable:

- **Not achievable.** #1 and #2 are not two `match_rows` call sites. `cross_boq_carry` derives **one**
  match per sheet and four consumers read it — `_classify_carry` (rates), `_count_new_priceable_rows`,
  `_plan_layer_counts` and `_carry_layers` (both via `_carry_ctx`, which takes
  `twin=match.original_to_revised`). Holding the layers back would have required a second, stricter
  derivation.
- **Not desirable.** The risk the strict position rule contains is a row being **re-parented under a
  stale or superseded heading** — a structural fault that propagates silently through every
  descendant, unlike a wrong rate, which is a visible number a human catches in the pricing grid.
  That risk lives in consumer #4, the **parse-time** carry, which stays strict and is untouched by
  this slice. Categories, remarks and colours are **row-addressed annotations, not parenting**;
  putting one on a row the match has *already decided is the same row* adds no structural risk the
  rate does not already carry.
- **And splitting would have partly undone Amendment E**, whose whole point is that the carry moves
  categories and rates in **one** action so the category gate cannot block its own remedy. A moved
  row left priced-but-uncategorised reinstates exactly the manual finishing step E removed. This is
  the strongest argument for the ruling.

**Ruling: one match, the layers ride along.** #1 and #2 both get pass 2. #3 and #4 stay strict, and
the tests pinning them are now the entire boundary.

### ⚠️ If you are bisecting: commit `72933a60`'s message is SUPERSEDED

`72933a60` (the pure-matcher commit) says the flag exists so that *"the three consumers that must
not get it (the cross-BoQ layer carry, the within-BoQ copy-forward, the parse-time
classification/parenting carry) are unaffected"*. **The first of those three is wrong.** The owner's
ruling above arrived *after* that commit was written, and the cross-BoQ **layer** carry **does** get
pass 2 — it reads the very same match object as the rate carry, so it was never separable.

Corrected one commit later in `bce47806`, whose message and code docstrings carry the true boundary
(structure vs. everything else). **Commit history is immutable, so the message itself cannot be
fixed** — this note is the correction of record. Only two consumers must not get the flag:
`version_addressed_excel_row_match` and the parse-time carry.

### This is a sanctioned exception, not drift

`row_match.py`'s docstring warns that the design went through **four owner narrowings** and says not
to loosen it back toward a diff or a walk. That warning stands. This slice is a deliberate,
owner-approved, **opt-in and narrowly-scoped** exception, recorded so a future reader sees intent
rather than erosion. What keeps it from being a re-run of the description-only engine D6 rejected:
**pass 2 never guesses.** A key that is not unique on both sides pairs nothing.

### Deliberately out of scope — no float repair

Live `code` values include `"2.3000000000000003"` (a formula cell whose float precision leaked into
stored text), plus prose (`"GRAND TOTAL (EX GST 18%)"`), date strings (`"2010-06-01 00:00:00"`),
`"SUB HEAD A"`, `"A."`, `"1.1.7"` and blanks. **No numeric coercion, no trailing-zero repair** —
clever coercion is exactly how a wrong pairing gets made. Such rows stay unmatched. A possible later
refinement, not an oversight.

`normalize_n2` was **not modified** — it is single-homed across three unrelated carry axes. It is
reused on both halves of the key, and **no separate serial normalizer was added**: trim + lowercase +
whitespace-collapse is already the right rule for a printed serial. Case folding cannot mis-pair,
because a fold that collided two real serials produces a duplicate key, which is dropped.

---

## Seam (A21)

**`match_rows`'s interface.** The flag, the `MatchRow.serial` input and the `RowMatchResult.serial_matched`
output all live there. It is the right seam because it is the **only** place the four consumers
differ: they already share one row projection (`_content_match_rows`) and one result type, so the
matching *rule* is the single thing that can vary between them. Putting the switch anywhere else
makes the boundary worse:

- on `_content_match_rows` (withholding the serial from the within-BoQ reader) — the boundary becomes
  invisible at the call site, and a reader of `version_addressed_excel_row_match` cannot see why it
  behaves differently. Pinned against by `test_both_entry_points_see_the_same_serials`.
- as a parameter on `committed_excel_row_match` — the owner already ruled against widening that entry
  point with a flag (Amendment F R6), and `test_freeze_pin_committed_excel_row_match_signature`
  enforces it. That test still passes untouched: the flag is passed *through* to `match_rows`, so the
  entry point's own signature is unchanged.

The interface stayed small: one keyword-only boolean in, one frozenset out, both defaulted.

---

## What changed

| File | Change |
|---|---|
| `services/boq_revision/row_match.py` | `MatchRow.serial`, `RowMatchResult.serial_matched`, the `serial_second_pass` flag, `_serial_second_pass` + `_serial_key`. `_index_by_excel_row` generalised to `_unique_index(rows, key)`; `_entered(rows)` becomes the one definition of which rows enter a match. Amendment G docstring. |
| `services/boq_revision/test_row_match.py` | 22 new tests (17 → 39). |
| `api/boq/wizard/committed_carry.py` | `code` added to `_NODE_MATCH_FIELDS`; `_content_match_rows` projects it onto `MatchRow.serial` for **both** readers; flag enabled in `committed_excel_row_match` only, with the ruling recorded on both entry points. |
| `api/boq/wizard/test_committed_carry.py` | `_node()` gains `code=`. `TestCommitOverlayShiftStopsCarry` widened. New `TestSerialSecondPassBoundary` (9 new tests, 49 → 58). |
| `api/boq/wizard/cross_boq_carry.py` | `match_pass` on every plan row; `removed` reason string corrected; Amendment G module docstring. |
| `api/boq/wizard/test_cross_boq_carry.py` | `_seed_sheet` accepts `code`; `_color_on` / `_dismissal_on` helpers. Rich fixture gains row 17 → 30. New `TestSerialMovedRowCarriesEverything` (8 new tests, 60 → 68). |
| `api/boq/wizard/pricing.py` | **Doc-only.** `_guard_categories_complete` docstring; body byte-identical. |

**No `.tsx` touched** — owner's explicit call: plan data only, the dialog does not change.

### Intended consequence: `_count_new_priceable_rows` shrinks

A serial-matched destination row genuinely **no longer needs a value typed by hand**, so it correctly
drops out of the "N rows need new values" figure. Recorded as intended, not incidental, and pinned by
causation: `test_a_serial_matched_row_does_not_count_as_needing_a_new_value` strips the destination
serial and watches the figure go 3 → 4.

### The `removed` bucket is narrower

Was *"moved, reworded or removed"*. A moved row can now carry, so the string reads
**"removed, reworded, or moved without a matching serial number"** — which is exactly what is left in
the bucket.

---

## Documentation rot corrected (commit `f289889a`)

Five sites asserted that `pricing.apply_copy_forward` still keeps the category gate. All became false
at **`283a0199`** (WBC-S10), not at this slice: `cross_boq_carry.py` ×2, `test_cross_boq_carry.py` ×2,
`pricing.py` ×1.

The `pricing.py` one is **S10's Finding 2, now discharged** — S10 recorded it as *"owed: a one-line
docstring fix, in a slice that puts `_guard_categories_complete` in scope"*. This slice does.
`_guard_categories_complete`'s **body verified byte-identical (646 B)**; only the docstring changed.

In the **S10 fragment**, `Three` → `Four` in the `_categorise_fixture_eligible_rows` count sentence
(it listed four). Sentence-initial, so capitalised; owner confirmed.

---

## Test dispositions

Nothing was bulk-deleted. **40 tests added, 1 renamed away as a disclosed split — net +39.** The one
that went is `test_the_shifted_row_is_not_a_twin` (row 2 below); it was replaced by two tests that
cover *both* outcomes of the same move, so coverage is strictly stronger after the split.

| # | Test | Disposition | Why |
|---|---|---|---|
| 1 | `TestPositionIsLoadBearing` (`test_row_match.py`) | **UNTOUCHED — verbatim** | The prompt's own failure test: it drives `match_rows` with the default and must keep passing. It does. If it ever fails, the default has leaked and the slice is wrong. Deliberately not modified even to add a comment. |
| 2 | `test_the_shifted_row_is_not_a_twin` (`test_committed_carry.py`) | **SPLIT** → `test_the_shifted_row_without_a_serial_is_not_a_twin` + `test_the_shifted_row_WITH_a_matching_serial_is_a_twin` | The fixture had no serials, so with the flag on this test would have kept passing **for the wrong reason** — nothing in it could reach pass 2. The fixture gains a third row that moves *with* a serial, so both outcomes of the same move now sit side by side and neither can go green vacuously. A third test pins `serial_matched`. |
| 3 | `test_plan_unmatched_rows_all_report_removed` (`test_cross_boq_carry.py`) | **MODIFIED, kept** | Row 14 is genuinely still `removed` — it moved *and has no serial*. Kept because that is a real, distinct case worth protecting. But "a moved row does not carry" is now only half true, so the test asserts the reason explicitly **and asserts row 14 really is serial-less** — otherwise a later fixture edit could silently turn it into a vacuous pass. Also now asserts `match_pass is None` on every skip. |
| 4 | `test_plan_counts` (`test_cross_boq_carry.py`) | **MODIFIED** | `clean` 1 → 2: row 17 joins row 10 via the serial pass. The only count that moved; `removed` stays 3. |
| 5 | `test_plan_new_rows_absent_but_counted` | **UNCHANGED, and checked** | `needs_new_value_count` stays 3. Dest row 30 is *matched*, so it never enters the unmatched set. Verified rather than assumed. |
| 6 | `test_freeze_pin_committed_excel_row_match_signature` | **UNCHANGED** | Amendment F R6 pins this entry point's signature against exactly this kind of widening. It still passes: the flag is passed through to `match_rows`, not added as a parameter here. |
| 7 | all apply tests in `TestCrossBoqRateCarry` | **UNCHANGED** | They pass explicit decisions, so an extra plan row cannot reach them. |

### New tests

**`test_row_match.py` (+22)** — `TestSerialSecondPassIsOptIn` (default-off + keyword-only signature
pin; a moved+serialled row does *not* pair with the flag off) and `TestSerialSecondPass`: the moved
row carries; blank serial (both sides, one side, whitespace-only); differing serial; differing
description on a matching serial; duplicate key on either side; sticky third sighting; same serial
under *different* descriptions still pairs; pass 1 wins over a competing pass-2 candidate (both
directions); a position-dropped duplicate can still pair on its serial; no float repair; a non-string
serial does not raise; symmetry across both passes.

**`test_committed_carry.py` (+9)** — `TestSerialSecondPassBoundary` seeds **the same** moved-and-
serialled row into both committed shapes, so the two entry points are compared on identical data and
the only difference can be the flag: cross-BoQ pairs it, within-BoQ does not. Plus blank / changed /
duplicated serials against real `BOQ Nodes`, and `test_both_entry_points_see_the_same_serials`, which
closes the one way the within-BoQ pin could pass hollowly (if the serial never reached `MatchRow` at
all, the pin would hold even with the flag on).

**`test_cross_boq_carry.py` (+8)** — the serial-moved row planned as a clean copy; `match_pass`
reported per row; the reason string; the `needs_new_value_count` shrink proved by stripping the
serial; and `TestSerialMovedRowCarriesEverything`, the end-to-end proof through `apply_sheet_carry`
that a moved row carries its **rate and all four layers**, each still attributed with
`carried_from_boq` / `carried_from_version`, and that stripping the destination serial makes all five
stop landing.

### Consumers #3 and #4 — the whole boundary, pinned two ways

- **Behavioural**: `test_the_within_boq_entry_point_does_NOT_pair_the_same_moved_row`.
- **Structural**: `test_exactly_one_production_call_site_enables_the_second_pass` walks the app's
  **AST** and asserts `serial_second_pass` appears as a call keyword in exactly one non-test file.
  It covers the parse-time carry, which has no fixture here, and it catches a *third* consumer added
  later — the actual regression this slice invites. Source-scanning is deliberate; a behavioural
  mirror would need a full parse-worker fixture to assert a negative and still would not catch that.

---

## Live data — the expected-unmatched population

Read-only query against the dev bench, 2026-07-30. **This is the number someone will ask about when
a row does not carry.**

| Measure | Value |
|---|---|
| current `BOQ Nodes` | 37,800 |
| …with a non-blank `code` | **24,926** (~66%) |
| unique `(sheet, code, description)` groups | **22,646** |
| rows sitting in duplicate `(sheet, code, description)` groups | **2,280** — unmatched **by design** |

**Serial alone was never viable**, and this is the evidence: within the live corpus `'a'` occurs
**999** times, `'b'` 849, `'c'` 615, `'a.'` 333; inside a *single* sheet `'i)'` occurs 71 times and
`'ii'` 62. It is the **pair** that carries the information — which is why the key is
`(serial, description)` and never the serial on its own.

The ~2,280 duplicate-group rows staying unmatched **is the safe failure mode working**, not a defect.
Rows with no serial at all (~34%) are likewise untouched by pass 2 and keep behaving exactly as
before.

*(No `code` matching `%.%0000%` was found on this bench, so the `"2.3000000000000003"` shape was not
directly observed here — but equivalent noise was: prose headers and date strings. The no-coercion
ruling stands on that evidence regardless.)*

---

## Verification — observed output

One suite at a time, in-container. No browser session ran against localhost during the bench runs
(`tabSeries` naming-lock collision).

| Suite | Baseline | Final |
|---|---|---|
| `test_row_match` | **Ran 17 — OK** | **Ran 39 — OK** |
| `test_carry` | **Ran 29 — OK** | **Ran 29 — OK** |
| `test_committed_carry` | **Ran 49 — OK** | **Ran 58 — OK** |
| `test_cross_boq_carry` | **Ran 60 — OK** | **Ran 68 — OK** |
| `test_pricing` | **Ran 252 — OK** | **Ran 252 — OK** |
| vitest (in-container) | **1222 passed, 53 files** | **1222 passed, 53 files** |

Net **+39** (40 added, 1 renamed away as the disclosed split). `test_pricing` prints a SQL traceback from
`test_atomicity_concurrent_first_edit_exactly_one_winner` (`duplicate key … tabBoQ Sheet Pricing
Lock_pkey`), which deliberately races the pricing lock — expected noise; the suite reports OK.

### Red runs shown before green (A22)

| Cycle | Red | Green |
|---|---|---|
| the pure matcher | `Ran 39 … FAILED (errors=39)` — `TypeError: MatchRow.__init__() got an unexpected keyword argument 'serial'`, `KeyError: 'serial_second_pass'` | `Ran 39 … OK` |
| the wiring | `Ran 58 … FAILED (failures=5)` | `Ran 58 … OK` |
| plan data | `Ran 68 … FAILED (failures=1, errors=3)` | `Ran 68 … OK` |

The doc-rot commit has no red run — it is comment-only, and there is no behaviour to fail.

---

## Findings

1. **The spec's four-way consumer list was wrong; the build STOPPED and asked.** #1 and #2 are one
   match, not two call sites. Resolved by owner ruling (b) — see the boundary section. The stop was
   the right call: the two resolutions differed in user-visible behaviour (a moved row arriving
   priced-but-uncategorised, or not).

2. **⚠️ The prompt's predicted test conflicts did not exist, and that was the most dangerous thing in
   the slice.** `_node()` and `_seed_sheet()` never populated `code`, so with the flag on, pass 2 was
   **inert across every existing fixture** — `test_the_shifted_row_is_not_a_twin` and
   `test_plan_unmatched_rows_all_report_removed` would both have stayed green **because the feature
   never executed**. Fixed by extending both helpers and seeding serial-bearing moved rows beside the
   serial-less ones. Recorded because the same trap will recur: *a green suite is not evidence a
   fixture reaches the code under test.*

3. **A test of mine was wrong twice before it was right, and both defects were in the test.** The
   call-site pin first scanned raw text — which flagged `row_match.py` for merely *mentioning* the
   flag in a docstring — and used a path root one level too shallow. Rewritten to match on the AST. A
   pin a comment can trip is a pin people learn to ignore.

4. **`_NODE_MATCH_FIELDS` fetches `level`, which `_content_match_rows` never uses.** Pre-existing dead
   read. **NOT fixed** — out of scope. Harmless (`row_match` bars `level` from the matcher and the
   projection does not pass it), but it should go in a slice that owns the file.

5. **`scripts/residence_check.py` fails on rule F2 (207 → 208) — PRE-EXISTING, not this slice.**
   Verified by running the checker from a throwaway worktree at base `283a0199`: byte-identical
   output. This slice touched no frontend page (F2 is a frontend-page rule) and no `.tsx` at all.
   Reported rather than worked around; the ratchet was **not** re-baselined.

6. No hook denied any write. No guard fired. No scope violation attempted.

---

## Deliberately NOT done

- **No frontend.** Owner's explicit call: plan data only. `match_pass` is served and nothing renders
  it. The dialog still says "N rows will carry" without distinguishing how they matched — a
  deliberate deferral, not an omission.
- **`normalize_n2` not modified**, and no separate serial normalizer added.
- **No float repair / numeric coercion** — see above.
- **`version_addressed_excel_row_match` not widened**, and `review_carry` not touched at all.
- **Finding 4 not fixed** — out of scope.
- **The F2 ratchet not re-baselined** — it is not this slice's violation to absorb.
- **No browser E2E.** The change is server-side and fully covered by bench tests; the frontend diff
  is empty. Worth a live check at the arc's certification pass: a revision whose rows shifted should
  now show rates carried onto the moved rows, with the "needs new value" count correspondingly lower.
