# Within-BoQ carry parity with the cross-BoQ revision carry

**Opened** 2026-07-29 · **Tier** Full · **Track** feature
**Branch** `feature/boq-within-boq-carry`, cut from `develop` @ `61f82798`
**No migration.** Every provenance field this arc needs already existed from ADR-0014 Amendment E.
**Nothing pushed. Owner live-certification: NOT STARTED.**

> ✅ **ADR-0014 Amendment F is WRITTEN** (S6, 2026-07-30) — a banner in the ADR's Status section plus a
> full detail block under D8. The citations in `pricing.py` / `committed_carry.py` / the test docstrings
> now resolve. The **sixteen** rulings below are its content.
>
> ⚠️ **S6 could only complete ONE of its three doc targets.** Three in-scope files were denied by the
> `SIZE CEILING` hook and two do not exist — see **F7 / F8** and **"S6 doc-correction backlog"** below.
> The as-built detail that could not land in the reference docs is recorded in this fragment instead,
> which is the destination the hook itself names.

---

## The ask

The owner shipped ADR-0014 Amendment E: the cross-BoQ revision carry
(`cross_boq_carry.apply_sheet_carry`) moves rates plus an opt-in, provenance-stamped subset of
`LAYER_KEYS = ("categories", "remarks", "colors", "remark_dismissals")`.

He asked for the same on the WITHIN-BoQ version carry — `pricing.apply_copy_forward`, the
"Copy rates forward" button that appears in the pricing editor when you browse to an older
committed version of the same sheet.

**His assumption was correct**: that button existed and carried rates ONLY.

---

## Ruling register (owner, 2026-07-29 / 2026-07-30)

| # | Ruling | Notes |
|---|---|---|
| **R1** | Carry categories + remarks + colours + remark dismissals. | Reconciliation choices OUT — that doctype has no provenance fields, so including it would be a MIGRATE. Amount formulas OUT and still owner-locked never-carry in either seam (Amendment C). |
| **R2** | The category gate moves to AFTER the layer carry: lock-check → formulas → acquire lock → carry layers → **category gate** → rates → commit, one transaction, rollback on refusal. | **REVERSES the G2c ruling.** The invariant is unchanged in words — no rate lands on an uncategorised row — only the moment of judgement moves, so the guard can no longer block its own remedy. An incomplete SOURCE still refuses and unwinds the carried layers. The formula gate keeps precedence. |
| **R3** | Within-BoQ provenance is expressed by VERSION, not BoQ. | "carried from Version 2" within a BoQ; cross-BoQ keeps "carried from BOQ-26-…". Also settles the within-BoQ destination noun as "the current version". |
| **~~R4~~** | ~~A local hand-pick outranks the carry in the display.~~ | **PARKED — see R10.** |
| **R5** | The within-BoQ carry adopts the shared N2 description rule. | **Changes shipped rate behaviour**, five signed deltas: trailing-space / case / internal-whitespace now pair; blank descriptions stop pairing; a duplicated Excel row is dropped instead of last-silently-wins. Owner reads the last two as fixes. |
| **R6** | `committed_carry.committed_excel_row_match` stays byte-frozen; a version-addressed sibling sits beside it. | Owner ruled AGAINST merging them behind a `current_only` flag. The sibling points at the original's warning rather than restating it. |
| **R7** | The pricing record shows the DESTINATION's description text. | Under N2, a matched pair's descriptions can differ. Matches what the cross-BoQ carry already does. |
| **R8** | The category gate is UNCONDITIONAL. | An annotations-only carry into an uncategorised destination is still refused. No carve-out. |
| **R9** | Dialog copy fixes fold into the S3 slice rather than a separate pass. | |
| **R10** | R4 is PARKED. | Nothing in the schema records WHO decided a row — see Finding F1. A precedence flip cannot be made truthful, and as ruled it would have started falsely claiming authorship on verdicts carried from a source. |
| **R11** | The apply button reports WRITES, not selection — on BOTH dialogs in one change. | Same defect class `313697e7` fixed on the line and never on the button. Fixing one dialog only would recreate the divergence S1's extraction existed to prevent. |
| **R12** | S5's two strings confirmed as drafted. | The dropped "Rates only" description, and `LAYER_BLOCK_SUBTEXT_WITHIN_BOQ` ("marked with the version it came from"). |
| **R13** | The button noun is **"changes"**, not "items". | "items" collides with `node_type === "Line Item"` on this exact grid. Now enforced by test (`not.toContain("item")`), not by comment. |
| **R14** | The cross-BoQ single-sheet bare "Carry" button stands. | Amendment E upheld; R11 named only the selection-based strings. ⚠️ Holds at the LABEL only — that button's `disabled` expression did change under R15, so its all-Keep case now disables where it previously enabled. |
| **R15** | The apply button is gated on WRITES, not selection. | Finishes R11: one number governs both the label and enablement. **Reverses a parked code comment.** Implemented by DELETING `nothingToCarry`, which was the second source of truth. |
| **R16** | The same-BoQ-vs-cross-BoQ decision is made SERVER-SIDE. | `get_sheet_categories_resolved` emits a derived `carried_from_other_boq` alongside BOTH raw provenance fields (additive; the raw fields stay). The grid renders what it is told: no comparison, no new prop, nothing crossing the React memo boundary. **Rejected:** threading a `boq` prop to `PricingGrid` (touches `pricingRowPropsAreEqual` on a grid rendering thousands of rows) and passing the BoQ into `resolvedToSheetCategoryRow` (a domain rule in a UI adapter with no DOM tests). **Rationale: "was this carried from elsewhere, or from an earlier version of myself" is a domain fact, not a presentation choice** — it belongs on the read that already calls itself resolved. ⚠️ Load-bearing: the signal is `bool(carried_from_boq) and carried_from_boq != boq`, **never** version truthiness, because `carried_from_version` is `bigint NOT NULL DEFAULT 0` so an uncarried row reads `0`. Pinned by `test_carry_stamped_at_version_zero_is_still_a_carry`. |

| **R18** | One more attempt at backlog #2: tightening verbose prose AROUND a correction to pay for it is legitimate; compromising the correction to fit is not. | **Attempted, STOPPED at +133 B.** Confirms R17's fallback. The two `isNeedsReviewCategory` refs (retired, replaced by `isMasterSetBlank` — verified in `PricingGrid.tsx:491` + `ClassifySheetDialog.tsx:117`) DID land, -26 B. |
| **R17** | Correct and prune in ONE net-shrinking edit per file: each of the three hook-blocked docs must come out SMALLER than it went in. | The answer to F7. Pruning must be genuine rot — (a) demonstrably stale/false, or (b) per-slice changelog detail the DOCS-UPDATE RULE bars from `CLAUDE.md` **and** whose substance already exists in a reference doc. **Do NOT reword a correction to squeeze under a ceiling**; if a file cannot be made both correct and smaller, STOP and report. Owner-locked invariant prose is never prunable, however verbose. |

Three rulings reverse shipped decisions — **R2, R5, R15**.

---

## Load-bearing recon findings

1. **The category gate already deadlocked this button before the arc.** It gates on the DESTINATION
   (`pricing.py:2950`, against `current_version`); every layer's identity includes
   `committed_version`, so a re-commit mints a version with zero category rows;
   `blank_category_eligible_rows` counts a never-classified row as blank because it keys on the
   eligible `BOQ Nodes` set (`persist.py:202-206, 260-263`) and filters by `committed_version`
   (`persist.py:250-251`). No grandfathering; the admin override lives per-version and does not
   survive a re-commit. Pinned by `test_a_refused_when_destination_blank` /
   `test_c_succeeds_once_categorised` / `test_e_uncategorised_source_does_not_block`.

2. **Neither matcher is fuzzy.** `match_rows` (`services/boq_revision/row_match.py:127-151`) joins
   on identical Excel position then requires N2-identical descriptions.
   `committed_carry._match_rows_from_nodes` sets `row_id == excel_row` on both sides, so its twin
   map can only pair a row with itself. Pinned by
   `test_row_match.py::test_same_text_at_a_different_row_does_not_match`. **Tolerance for moved
   rows exists nowhere in this codebase.** An early plan claim that consolidating the matchers was
   "a pure consolidation, not a behaviour change" was WRONG and was caught by a builder stop.

3. **`_match_rows_from_nodes` filters `is_current: 1`**, which within one BoQ empties the source
   side (the older version's nodes were frozen to `is_current=0` at re-commit,
   `commit_pipeline.py:857-858`). Measured: source v1 = 6 nodes all `=0`, dest v2 = 5 all `=1`.
   Wired in naively this would have made the button silently carry nothing.

4. **`set_human_verdict` annotates in place** (`persist.py:597-606`), writing exactly
   `human_category_id` / `human_verdict_at` / `human_verdict_by` and never touching carry
   provenance. `deriveVerdictState` checks `carried_from_boq` BEFORE `human_category_id`, so a
   local pick on a carried row renders as "carried". The ladder is unaffected —
   `carried_from_boq` is not a ladder input.

---

## Findings that outlive this arc

**F1 — the freeze authorship gap (pre-existing, not introduced here).**
`persist.stamp_human_verdicts_bulk` writes `human_category_id`, `human_verdict_at = now` and
`human_verdict_by` onto EVERY resolved non-blank row it stamps — carried or not, human-decided or
machine-decided. Consequences: after any freeze, a carried row's `human_verdict_at` is newer than
its `carried_at`, indistinguishable from a genuine local pick; and `deriveVerdictState` already
returns `"human"` for auto-accepted machine verdicts on any frozen sheet. **Nothing in the schema
records who actually decided a row.** This killed R4 and it will kill any future display-layer fix.
The honest remedy is a verdict-provenance field, not another badge patch.

**F2 — nothing ever invokes `tsc`.** No `typecheck` script in `frontend/package.json`; `build` is
`vite build` (esbuild, strips types without checking); CI runs only the bench Python suite.
Repo-wide baseline is ~3236 errors. The shared frontend types introduced in this arc are sound
today but are enforced by a compiler no automated gate runs.

**F3 — `guard_scope.py` cannot rotate its own state file.** `.claude/state/current-slice.json` is
never in its own `files_in_scope`, so once a slice is open the declaration is unrotatable from
inside the tree — by a builder OR by the planner. Even the documented close-by-empty-scope path is
denied. Every rotation in this arc required the owner to edit the file by hand. Fix: always permit
writes to that file, or at minimum permit a write whose new `files_in_scope` is `[]`.

**F4 — a hook denies `git stash push`**, matching the substring "push". False positive; it cost a
builder its plan to verify intermediate commits. Tighten the pattern to `git push`.

**F5 — self-reported counts do not survive mechanical checking.** Three instances this arc:
"92 assertions" was a test-CASE count (real assertions 133 → 161); a "~359px floor" was presented
as derivable when independent arithmetic gives a ~280–400px band; "twelve changed assertions" was
eleven (4 + 7, counted off the pre-image). None changed a verdict. All were caught by reviewers
re-counting rather than reading. Report cases and assertions as separate numbers, always.

**F6 — the facts doc is stale on a metric this arc reports.** `.claude/facts/handover.md` records
vitest **976 across 46 files**; actual is **1188 across 50** (1173 before S3b). It is also
modified-and-uncommitted in the tree, owner-attributed, and the owner has ruled it stays untouched.
No executor claim citing it is verified.

**F7 — three of the four reference/convention docs are ALREADY over their size ceilings, so no
correction can be written to any of them.** Every S6 edit to them was denied by the `SIZE CEILING`
hook. Measured 2026-07-30: `CLAUDE.md` **64 KB** (ceiling 40, 1.6×) · `frontend/CLAUDE.md` **104 KB**
(ceiling 40, 2.6×) · `.claude/context/domain/boq-backend.md` **184 KB** (ceiling 80, 2.3×). The ADR
(108 KB) has **no** ceiling — ADRs are not context files — which is why Amendment F itself landed.
The hook permits **shrinking** from above a ceiling but blocks **any** growth, including a one-clause
correction of a false sentence. **This is a documentation deadlock of the same shape as R2's
category-gate deadlock:** the guard that keeps these files small now prevents the edits that would
make them *correct*, and correctness edits are not the bloat it was written to stop. Four sentences
are therefore knowingly left false (backlog below). **The remedy is the surface split
`boq-frontend.md` already received at `61f82798`**; `boq-backend.md` is the obvious next candidate and
both `CLAUDE.md` files need a carve of their own. Until then, S6-class slices cannot close.

**F8 — two in-scope doc paths no longer exist; both were dissolved by the two commits this branch was
cut from.** The branch is cut from `develop @ 61f82798`, and that commit plus its parent `15e9b81e`
are exactly the two that removed them:

| Path named in the S6 scope | Reality | Correct destination now |
|---|---|---|
| `frontend/.claude/context/domain/boq-frontend.md` | **deleted at `61f82798`** (287 KB → 10 surface files) | `domain/boq-frontend-revised-boq.md` (ADR-0014 amendments) · `-pricing-controls.md` (dialogs) · `-pricing-grid.md` (tooltip) |
| `frontend/.claude/plans/boq-upload-plan.md` | **rotated at `15e9b81e`** | `frontend/.claude/plans/boq/` — `README.md`, `_slices.md`, `phasing.md`, `known-issues.md`, `decisions/`, `slices/` |

**F9 — the size guard is enforced PER TOOL CALL, so a correction can only land beside contiguous rot.**
`nirmaan_guard_doc_size.py` allows a write iff `projected <= current` (any growth past the ceiling is
denied), and it computes `projected` for ONE `Edit` from that edit's own `old_string`/`new_string`. It
sums across edits only for `MultiEdit` — **which is not available in this harness.** So R17's "one
net-shrinking edit per file" is achievable only when the prune and the correction sit in a SINGLE
contiguous span. At S6b that held for `CLAUDE.md` (both falsehoods and the rot were inside one line) and
for `boq-backend.md` (subsection heading paid for the ⚠️ line), and FAILED for backlog #2: the two carry
bullets in `frontend/CLAUDE.md` are the only copy in the repo (0/20 and 0/10 lines duplicated), and the
whole pricing-editor + wizard-conventions region around them is likewise 0% duplicated, so there is no
adjacent byte to spend. The 12.7 KB of genuinely duplicated wizard prose sits ~270 lines away — a single
edit spanning both would be ~43 KB of hand-reproduced text. **Remedy: split the BoQ conventions out of
`frontend/CLAUDE.md` into the surface docs (the same carve `boq-frontend.md` got at `61f82798`), or run
the slice in a harness with `MultiEdit`.** Not a hook defect — the guard is right that the file is 2.3×
its ceiling; it is a granularity mismatch.

⚠️ **Re-creating either file would directly undo those two commits** and was not attempted. None of
the real destinations is in the S6 `files_in_scope`, so writing them is a `guard_scope.py` denial — a
follow-up slice needs a corrected scope list. ⚠️ Both dead paths are still cited as live in
`CLAUDE.md` (×5), `frontend/CLAUDE.md` (×3) and `boq-backend.md` (×6); every one of those pointers is
dangling, and F7 blocks fixing them too.

---

## S6 doc-correction backlog — CLOSED at S6b except #2

| # | File | False statement | Outcome at S6b |
|---|---|---|---|
| 1 | `CLAUDE.md` | carry gate *"checked ONCE up front … and BEFORE the lock acquire"* | ✅ **FIXED.** Now states the gate is checked ONCE per call, and that the two seams differ DELIBERATELY: cross-BoQ REMOVED it (Amdt E), within-BoQ REORDERED it (Amdt F) to after the lock acquire and after the layer carry, one transaction, rollback on refusal; formula gate keeps precedence in both. |
| 2 | `frontend/CLAUDE.md` | carried-verdict cue *"Its one input is `SheetCategoryRow.carried_from_boq`"* | ❌ **STILL FALSE — accepted DEBT (R18 attempted, STOPPED).** R18 authorised tightening the prose AROUND it to pay for it. Measured best after losslessly tightening BOTH carry bullets, dropping the optional F1 note and maximally compressing the new text: **+133 B over the 3,329 B span** (313-342). Nothing in that span is duplicated in the `boq-frontend-*` surfaces, ADR-0014 or this fragment (0/30 lines), so no lossless dedup exists; closing the last 133 B would mean paraphrasing owner rationale prose, which the hard limit forbids. No edit was attempted. Wording is drafted: three inputs (`carried_from_boq`, `carried_from_version`, server-derived `carried_from_other_boq`); tooltip reads "carried from Version N" within a BoQ vs "carried from BOQ-…" across one; **R16 — decided SERVER-SIDE** in `get_sheet_categories_resolved`; the STATE still keys on `carried_from_boq` alone. |
| 3 | `frontend/CLAUDE.md` | *"`nothingToCarry` replaces `selectedCount === 0`"* | ✅ **FIXED.** Now: the apply gate is `carryWriteCount(...) === 0` (**R15 deleted `nothingToCarry`**), not `selectedCount === 0`. Paid for by correcting the same bullet's stale header `Amendment C + Amendment D` → `Amendment C + E`. |
| 4 | `boq-backend.md` | *"`save_cell_price` and `apply_copy_forward` KEEP the gate **and are untouched**"* | ✅ **FIXED** (concise form, budget-limited): *"Both KEEP the gate; `save_cell_price` untouched, `apply_copy_forward`'s REORDERED (Amendment F)."* The **position** detail was omitted for want of bytes — it lives in ADR-0014 Amendment F and in `pricing.apply_copy_forward`'s own docstring, which records `was: lock → formulas → CATEGORY GATE → acquire → rates` / `now: lock → formulas → acquire → CARRY LAYERS → CATEGORY GATE → rates`. |

**Where the as-built detail went instead.** The backend + frontend as-built for this arc — the
`layers=` wire shape, the R2 gate order with line numbers, `coerce_layers` as the single coercion with
`cross_boq_carry._coerce_layers` as an `assertIs`-pinned alias, the R6 sibling and why
`committed_excel_row_match` must keep `is_current: 1` while the sibling cannot, the N2 deltas, and the
three R16 keys with the derivation expression — is written into **ADR-0014's Amendment F block**,
which accepted the write. It is not duplicated here.

### Three citation corrections found while verifying S6 (code is right; earlier notes were wrong)

1. **`categoryCellTitle` lives in `sheetCategoryResolve.ts:85-93`, not `PricingGrid.tsx`** — the grid
   only imports (`:175`) and calls it (`:2505-2509`). The per-surface branch is `carriedFromNoun`
   (`:104-108`).
2. **`deriveVerdictState` lives in `CategoryVerdictPicker.tsx:47-57`**, not in `sheetCategoryResolve.ts`.
3. **`overflow-hidden` is absent from `CopyForwardDialog.tsx` entirely** — `rounded-md` at `:410` wraps
   the plan table with no clipping context. The deferred item is *adding* `overflow-clip`, not
   replacing an existing `overflow-hidden`. `carryWriteBreakdown` is also **not exported** (private by
   design); the two public readers `carrySelectionSummary` / `carryWriteCount` are what the dialogs call.

---

## Slice status

| # | Slice | Commits | Tests | Review |
|---|---|---|---|---|
| S1 | Extract `CarryLayers` from `CrossBoqCarryDialog` (no behaviour change) | `2490ac63` | vitest 1112, unchanged | — |
| S2 | Backend: `layers=` on `apply_copy_forward`, gate reorder (R2), N2 routing (R5), frozen sibling (R6) | `89e46c74` `a786190c` `ebbceb24` `62801470` `7762e63c` `30cc5f83` | **OBSERVED GREEN** 255 / 49 / 60, zero skips | CAVEATS → blocking item cleared by an independent run |
| S5 | `CopyForwardDialog` gains the layer block | `2a89cdb0` `12d5a023` | vitest 1131 | **FAIL** — unbounded `DialogContent` |
| S3a | Truth-and-fit rework: viewport bound, write-count button, `\0` escapes, per-surface noun, toast, `layers?` types | `1fd6ea9a` `3e26a275` `5219c79d` | vitest **1167/1167**, verified by an independent run | CAVEATS, **blocking: none** |
| S3a-rework | R13 noun ("changes"), R15 write-gate, dead whole-BoQ gate, `PENDING` marker removed | `37fd65c6` `edd424e0` | vitest **1173/1173**, 50 files, zero skips, verified by an independent run. In-scope: cases 156→162, assertions 237→248; 11 restated, 0 dropped, 0 weakened | CAVEATS, **blocking: none** |
| S3b | R3: plumb `carried_from_version` end to end; R16 server-side `carried_from_other_boq`; delete two stale `PENDING OWNER CONFIRMATION` markers falsified by R12 (`CarryLayers.tsx:317`, `CopyForwardDialog.tsx:363`) | `eabd1a42` `eb627c11` `2d9450d7` `1df36531` `f31aa47d` | `test_classify` 77 → **83 OK**; vitest 1173 → **1188 / 50 files**, zero skips | **DONE** |
| S6b | **R17 correct-and-prune.** Sizes: `CLAUDE.md` 63,829→**63,117** (−712) · `frontend/CLAUDE.md` 104,028→**91,286** (−12,742) · `boq-backend.md` 188,177→**187,338** (−839). All 14 dangling refs repointed (`plans/boq/`, `boq-frontend-*`); 3 of 4 falsehoods fixed (#2 hook-denied, F9); 2 EXTRA falsehoods found + fixed in `CLAUDE.md` (`_categories_gate_ok` documented as `population="rate_editable"` — code passes `"eligible"` at all 3 call sites; `"rate_editable"` has ZERO live call sites) | docs only | **PARTIAL** — #2 outstanding |
| ~~S4~~ | ~~precedence flip~~ | **PARKED (R10)** | | |
| S6 | **ADR-0014 Amendment F** + reference docs | ADR written 2026-07-30 | docs only — no suite implicated | **PARTIAL** — ADR ✅; 3 files hook-denied + 2 files do not exist (F7/F8) |

S3b scope: `classify.py` (+ field list and emit), `test_classify.py`, `boqTypes.ts`,
`sheetCategoryResolve.ts` (this is where `resolvedToSheetCategoryRow` lives — NOT
`SheetPricingPage.tsx`), `PricingGrid.tsx` (tooltip), plus the two marker files above.

**Deferred, deliberately:** the `rounded-md` corner clip on `CopyForwardDialog.tsx:410`.
`overflow-hidden` would establish a scroll container and re-bind the sticky `<thead>` to a box that
never scrolls, breaking the sticky header. `overflow-clip` is the correct tool but has ZERO
precedent in this repo and cannot be verified without a DOM. Try it during live certification.

---

## Owner live-certification — NOT STARTED

1. **The footer at 1366×768.** Copy rates forward, 8+ rows, layer block visible. Copy and Cancel
   must both be visible and clickable. **The one check no test in this repo can substitute for** —
   there is no DOM environment (`environment: "node"`, deliberate). This is the failure that got S5
   rejected.
2. **The R15 gate, BOTH dialogs.** A version whose rows are all conflicts, every one left on Keep,
   every layer unticked → the button must be DISABLED, name no figure, and have no "Will copy" line.
   It was enabled before. Tick Categories → it must enable and read "Copy N changes forward" with a
   matching line. Repeat on the cross-BoQ dialog: its button stays bare "Carry" (R14) but must flip
   enabled/disabled identically. **No test anywhere can cover this** — the change lives in a
   `disabled={...}` expression.
3. **The deadlock break (R2 positive).** Freshly re-committed sheet, zero categories; source
   version categories complete; tick Categories; apply. Must SUCCEED and open the gate with no
   admin override. Before this arc it refused.
4. **Refusal atomicity (R2 negative).** Source categories incomplete; tick Categories; apply. Must
   refuse, write nothing of any layer, and leave pre-existing destination rates byte-identical.
5. **R8.** Annotations-only into an uncategorised destination must refuse honestly.
6. **Rates-only regression.** No layers ticked — behaviour identical to before the arc.
7. **R5 on real data.** Rows differing only by case or spacing now carry.
8. **R13 on the grid.** Read the button against the pricing grid BEHIND the dialog — the whole point
   of the ruling is the collision with "Line Item" in the row behind it.
9. **One number, not two.** Toggle rates and layers on and off; the button figure and the
   "Will copy" line must move together every frame.
10. **Sticky header pre-state.** Scroll the plan table and confirm the column header stays pinned.
    Untouched by this arc — capture it now, because the deferred corner-clip fix is what could
    break it.
11. **Provenance spot-check, PRE-FREEZE only** (see F1): `carried_from_version` stamped,
    `carried_at` fresh, and a carried category's `human_verdict_at` retaining the SOURCE's older
    timestamp — never freshened.
