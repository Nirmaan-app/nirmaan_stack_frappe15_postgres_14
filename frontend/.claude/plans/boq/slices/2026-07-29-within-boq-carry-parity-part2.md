# Within-BoQ carry parity — PART 2 (S8, S9)

**Chained from** [`2026-07-29-within-boq-carry-parity.md`](2026-07-29-within-boq-carry-parity.md)
(part 1), which reached its 32,000 B fragment ceiling. Part 1 holds the ask, rulings **R1–R18**, the
recon findings, findings **F1–F9**, and slices **S1–S7**. This part holds **S8** (a shipped defect
found and fixed on this branch), rulings **R20–R23**, and the **S9 record-and-verify** slice with the
first bench-verified test counts this arc has ever had.

**Branch** `feature/boq-within-boq-carry` · **Tip at writing** `f215d6a9` · **Nothing pushed.**

---

## S8 — the pricing editor showed the WRONG version's categories

`8d70f5f0` (backend) + `f215d6a9` (frontend), 2026-07-30.

### The defect

Browsing an older committed version of a sheet, the pricing editor rendered the **CURRENT** version's
category verdicts against the **OLDER** version's rows. Two independent causes, one visible symptom:

1. `classify.get_sheet_categories_resolved` (`classify.py:528`) has **no version parameter**. It
   resolves `_resolve_committed_version(boq, sheet_name)` (`:558`) and answers for whatever is
   current — there was no way to ask it for an older version.
2. The page's SWR key carried no version either, so switching version did not even **refetch**.

### Measured production impact

On `BOQ-26-00133 | 'B- BOQ- Elec.'`, viewing v1 while v2 is current: **106 rows disagreed** and
**181 more were wrongly blank**. Recorded in the twin's docstring (`classify.py:570-574`).

⚠️ **No data was ever lost.** v1's 561 rows were intact the whole time; the reader simply could not
be asked for them. This matters for triage: the remedy was a read path, never a repair.

### PRE-EXISTING on `develop` — not introduced by this arc

Verified from git, not recalled:

| What | Commit | Date | On `develop`? |
|---|---|---|---|
| Version-view — read-only committed-version history browser (Phase 5) | `184caed3` | 2026-06-26 | ✅ yes |
| HV-10 — multi-engine per-row resolution + grouped picker, which put `get_sheet_categories_resolved` into `SheetPricingPage.tsx` | `76a41050` | 2026-07-22 | ✅ yes |

`76a41050` is the **first and only** commit to introduce that reader into the page
(`git log -S "get_sheet_categories_resolved" -- frontend/src/pages/boq-wizard/SheetPricingPage.tsx`).
It wired the reader to the page and **never wired it to the version selector**.

⚠️ **This was an OMISSION, not a decision. No ADR records a choice to scope it that way** — so S8 is
a *fix*, and deliberately not an amendment: there is nothing to reverse. The defect shipped on
`develop` roughly five weeks before this branch existed, and this branch merely found it.

### R20 — the fix is a separate version TWIN, not a parameter

| | Rows | Categories |
|---|---|---|
| Live (current version) | `pricing.get_priced_rows` (`pricing.py:2196`) | `classify.get_sheet_categories_resolved` (`classify.py:528`) |
| History (explicit version) | `pricing.get_version_priced_rows` (`pricing.py:2475`) | **`classify.get_version_sheet_categories` (`classify.py:565`)** — new |

The twin follows the shape this repo **already established for the ROWS at this same seam**. The two
cannot drift because the whole resolution body was extracted to
**`classify._resolved_categories_at_version(boq, sheet_name, committed_version)`** (`:433`) and both
endpoints end in a call to it — the live reader at `:561`, the twin at `:599`.

Why not parameterise the live reader: it is the editor hot path **and** the source the blank-count
and the category gate read. Leaving it untouched is precisely what keeps the gate on the current
version. The twin coerces its version through `pricing._coerce_int` (`:597`) rather than minting a
second coercion, so both version twins reject a bad version with the *same* message; an unknown
version returns **graceful empty**, mirroring `get_version_priced_rows`.

### ⚠️ The load-bearing constraint: DISPLAY follows the viewed version, the GATE does not

**In history mode the page deliberately holds TWO category reads at once.** This is not redundancy
and must not be "tidied up" into one:

- **Display** follows the version being **VIEWED** — otherwise the Category column lies.
- **The gate** stays on the **CURRENT** version — because it governs *writes*, and writes always land
  on the current version. A gate computed from a historical version's categories would be a **worse**
  defect than the one being fixed: it would let a rate land on an uncategorised current row because
  some older version happened to be complete.

This is recorded in the live reader's own docstring (`classify.py:531-536`), which is the right home
for it — it is the reason that reader must never gain a version parameter, and the docstring is what
a future editor reads immediately before trying to add one.

### Frontend wiring (`f215d6a9`)

- The twin fetch (`SheetPricingPage.tsx:604`), **disabled unless viewing history**; its SWR key is
  derived from the params, so `committed_version` is in the key and a version switch refetches.
- `categoriesByExcelRow` → **`liveCategoriesByExcelRow`** (`:562`) — the blank count, the category
  gate, and every write path. The rename is the point: the old name did not say which version it was.
- **`activeCategoriesByExcelRow`** (`:629`) joins the existing `isViewingHistory` funnel (`:444`).
- **Four DISPLAY surfaces** repointed at the active map: the grid's Category column, `hasRun`, the
  Check-Category view filter, and that filter's button.
- `boqTypes.ts:1679` — `GetSheetCategoriesResolvedResponse` now records that it is the twin's payload
  too. **One type, because the two endpoints share one server-side body.**

### Tests

11 new cases in `TestVersionScopedSheetCategories` (`test_classify.py`), including the two that make
the twin honest: **`test_twin_at_the_current_version_equals_the_live_reader`** (byte-equality pin —
the two cannot diverge) and **`test_live_reader_still_resolves_the_current_version`** (a pin that the
live reader was not quietly re-pointed while nobody was looking). `test_classify` **83 → 94 OK**.

Frontend: vitest unchanged by S8 — the change lives in hook wiring and a memo funnel, which is a
React semantic and therefore **structurally untestable here** (no DOM environment, deliberate). This
is why S8 needs a live check rather than a unit test.

---

## Ruling register, continued (owner, 2026-07-30)

Part 1 carries R1–R18. R19 was not issued.

| # | Ruling | Notes |
|---|---|---|
| **R20** | The version-scoped category read is a **separate TWIN endpoint** (`get_version_sheet_categories`), **not** a parameter on the live reader. | Follows the `pricing.get_priced_rows` / `get_version_priced_rows` precedent at the same seam. **One shared private body** (`_resolved_categories_at_version`) so the two cannot drift — the twin is a second door onto one room, not a second room. |
| **R21** | S8 lands on `feature/boq-within-boq-carry` rather than its own branch. | The defect is pre-existing on `develop` and unrelated to the carry arc, so a separate branch was defensible. The owner ruled for this lane: the arc is about to be certified in a browser, and the certifier will be sitting in exactly this screen. Splitting it would certify the fix nowhere. |
| **R22** | **Record bench-verified test counts in `.claude/facts/handover.md`.** | ⚠️ **Supersedes the earlier "the facts doc is untouchable" ruling**, which applied to the OLD stale copy. The doc was refolded at `5de64ed8` (v5.91, `status: current`) and now *explicitly asks* for these numbers at its own next-action item 3. Recording them closes finding **F6** — see below. |
| **R23** | **Browser certification is APPROVED**, against an eight-journey list, to run after this slice. | ⚠️ **The eight-journey list was not supplied to S9 and is not reproduced here.** Part 1's "Owner live-certification" section carries **ELEVEN** items. Whether the eight is a subset of those eleven or a separate list is **unresolved** — obtain the list before the certifier runs, and do not assume part 1's eleven are it. |

---

## S9 — record and verify (2026-07-30)

Documentation and test runs only; **no code changed**. Closes the two gaps a Checklist B review
raised: S8 was recorded nowhere, and no bench-verified test count existed anywhere in the arc.

### Bench-verified counts — measured at `f215d6a9`

Every number below was **OBSERVED** in this session, in-container, via the bench runner. Cases and
assertions are reported separately, per finding **F5**. Assertion counts are static counts of
assertion call sites in each file, not runtime counts.

| Suite | Cases | Assertions | Result | Skips |
|---|---|---|---|---|
| `api.boq.wizard.test_pricing` | **255** | 787 | OK | 0 |
| `api.boq.wizard.test_committed_carry` | **49** | 101 | OK | 0 |
| `api.boq.wizard.test_cross_boq_carry` | **60** | 152 | OK | 0 |
| `api.boq.wizard.test_classify` | **94** | 303 | OK | 0 |
| `services.boq_category.tests.test_decay` | **12** | 35 | OK | 0 |
| `services.boq_category.tests.test_hv2_voter_harness` | **14** | 33 | OK | 0 |
| `services.boq_category.tests.test_routing_policy` | **23** | 47 | OK | 0 |
| `services.boq_category.tests.test_runner_electrical` | **82** | 146 | OK | 0 |
| `services.boq_category.tests.test_runner_hvac` | **104** | 181 | OK | 0 |
| **boq_category subtotal** | **235** | 442 | OK | 0 |
| **vitest** (in-container) | **1222** across **53** files | 2216 `expect(` | passed | 0 |

`tsc --noEmit`, run by hand in-container: **3,236 error lines repo-wide — the pre-existing baseline,
unchanged** — and **0 in either file S8 touched** (`SheetPricingPage.tsx`, `boqTypes.ts`). **Nothing
in the repo invokes tsc automatically** (finding F2 still stands: no `typecheck` script, `build` is
`vite build`/esbuild which strips types without checking, CI runs the bench suite only). So this
number is only ever as fresh as the last time someone ran it by hand.

**Cross-check:** every backend suite's `Ran N tests` equals its count of `def test_` definitions, so
no case was silently filtered out by a name pattern.

⚠️ **`test_pricing` prints a SQL traceback and a duplicate-key line** from
`test_atomicity_concurrent_first_edit_exactly_one_winner` (`test_pricing.py:794`). This is the
suite **deliberately racing the pricing lock** and observing that exactly one insert wins — the
noise is the assertion working, not a failure. It is a known tracked rider in the facts doc. The
suite reports `OK`.

### F6 — CORRECTED (was: flagged, not corrected)

Part 1 left F6 flagged because the facts doc was ruled untouchable. **R22 lifted that**, so F6 is
now closed — and closing it exposed that **F6's own replacement number was itself stale**:

| Claim | Source | Status |
|---|---|---|
| "vitest 976 across 46 files" | facts doc, v5.90 | ❌ was already historical |
| "actual is 1188 across 50" | F6, as written in part 1 | ❌ **also stale** — that was true at S3b |
| **1222 across 53 files, zero skips** | measured this session at `f215d6a9` | ✅ **verified** |

**F6's conclusion always held; only its evidence rotted, twice.** This is finding **F5** demonstrated
on F5's own author: a number recorded as "actual" is a *measurement with a date*, and stops being
actual the moment the next slice lands. Cite the measurement commit or do not cite the number.

### Branch state — verified, and one earlier claim retracted

Measured with `git rev-list --left-right --count develop...HEAD` and `git branch --contains`:

- `feature/boq-within-boq-carry` is **29 commits ahead** of `develop`; `develop` is **0 ahead**.
- Merge-base is `2bd6032f`, which **is** `develop`'s tip — a **clean fast-forward**, no conflicts.

❌ **RETRACTED:** an earlier claim in this session's planning that the **RM-1…RM-4b** Rate Master arc
landed on this branch as branch-only work. **It did not.** `bc997eeb` and `fe61165a` are both on
`develop` (merged via PR #1133), and this branch's merge-base *is* that merge. The facts doc had this
right all along (`handover.md:34` records the arc as MERGED via PR #1133) — the error was in the
session narrative, not in the repo record. Nothing needed correcting in the fragment, which never
repeated it.

### Scope note

`frontend/.claude/plans/boq/_slices.md` is **NOT** in S9's `files_in_scope`, so **no register row was
added for S8, S9, or this part-2 file.** Per the fragment-chaining convention that row is owed
(`nirmaan_ceilings.py:73-75`: chain to `<slug>-part2.md` *and add its row to `_slices.md` beside part
1*). It needs a follow-up slice with `_slices.md` in scope — until then these records are reachable
only from part 1's pointer, not from the register.
