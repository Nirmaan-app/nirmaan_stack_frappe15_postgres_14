# BoQ Review-Screen Refinements — Implementation Plan

**Status:** BUILT + GREEN 2026-07-01 on `feature/boq-review-refinements` (off `feature/boq-level-derivation`
`183177ca`; local, NOT pushed). Grilled 2026-06-30 via `/grill-with-docs`; implemented via a 3-agent
Wave-1 workflow. **Verification:** test_commit_validation 51, test_commit_pipeline 50, test_review_screen
241→247 (+6 advisory-suppression tests), test_boq_nodes 77 — all green; tsc delta-0 (0 new errors in
`boq-wizard/`); row 143 of BOQ-26-00023/"HVAC BOQ " confirmed advisory-cleared against the live DB.
ADR-0009 amended for the #22 demotion (still pending Nitesh sign-off). OWED: browser E2E of the picker
(optional) + Nitesh sign-off.
**Scope:** three independent refinements to the BoQ review screen, layered on the level-derivation fix.

---

## Execution Strategy

Execute via the Plan-to-Parallel workflow (see global CLAUDE.md).

- **Wave 1 (parallel — no cross-dependencies):**
  - **Task A** — Req 1: demote check #22 (backend `commit_validation.py` + tests).
  - **Task B** — Req 2: advisory suppression on edit (backend `review_screen.py` + tests) **and** the
    one-line "Looks OK" left-align (frontend `ReviewTree.tsx:2727`).
  - **Task C** — Req 3: new `ReviewRowParentPicker` + `RestructureModal` rewire + delete `SheetSearchView`
    (frontend) + tests.
- **Wave 2 (after Wave 1):**
  - **Task D** — docs: ADR-0009 amendment (#22), `boq-backend.md` (advisory + #22), `boq-frontend.md`
    (picker refactor), update this plan to "as-built".
  - **Task E** — verification: backend test suites green, `tsc` delta-0, browser/DB confirm row 143
    advisory clears + picker renders from rows.

File-overlap note: Task B and Task C both touch `ReviewTree.tsx`, but **disjoint regions** (B = line 2727
container class; C = the `<RestructureModal rows=… />` mount + import). Run B's ReviewTree edit and C's
ReviewTree edit on the same branch; if parallelized as subagents, hand each the exact line ranges to avoid a
clobber, or serialize the two ReviewTree edits.

Create tasks with `TaskCreate`, set deps with `TaskUpdate`, launch Wave 1 as parallel subagents.

---

## Decisions locked in the grilling

1. **#22 `levelless_preamble_squeeze` → Option A:** stop surfacing it as a user-facing preflight warning;
   keep the `consistency_warnings` computation and route it to an internal `frappe.logger` + Sentry tripwire
   when non-empty. (Reverses ADR-0009 owner-locked decision #3 *for #22 only* → one-line ADR amendment.)
2. **#7 `preamble_parent_level` → keep as-is** (error severity, both preflight + controller backstop). It
   still uniquely guards a Preamble filed under a non-heading parent — not redundant.
3. **Advisory-after-edit → Option A (dimension-aligned):** suppress `parser` + `classifier_warning` flags on
   the **backend** when the row has a human classification override (`human_classification` set). `orphan`
   stays recompute-on-read (already reflects current truth).
4. **"Looks OK" button → left-align:** `ReviewTree.tsx:2727`, `justify-end` → `justify-start`.
5. **Pick-parent refactor → Option B + Option 1:** new tree-aware `ReviewRowParentPicker` rendered from the
   in-memory `rows`, emitting `row_index` directly; **delete `SheetSearchView`**; grey out self+descendants
   (single-chain cycle mirror); backend stays the authority for batch-cycle + classification validity;
   interaction (click-row → "Set as parent") unchanged.

---

## Requirement 1 — Demote #22, keep #7

**Files:** `nirmaan_stack/api/boq/wizard/commit_validation.py`, `test_commit_validation.py`
(possibly `commit_pipeline.py` for the log site).

- **#7:** no change.
- **#22:** remove the user-facing warning-emission block in `validate_node_plan` (`commit_validation.py:462-481`)
  and the `level_warnings` parameter plumbing into it (update `build_sheet_node_plan` / `evaluate_sheet` /
  `structural_errors_for_sheet` call sites that pass it).
- **Keep the tripwire:** `derive_effective_levels` still returns `consistency_warnings`. Where it is currently
  consumed for surfacing (preflight `evaluate_sheet`; and `commit_pipeline.py:649` already computes+discards),
  when `consistency_warnings` is non-empty emit a single internal log:
  `frappe.logger("boq").warning(...)` **plus** `frappe.log_error(title="boq_levelless_preamble_squeeze", …)`
  (Sentry) — never a user-facing finding.
- **Tests:** drop/repoint `test_warning22_levelless_squeeze_from_level_warnings`; keep
  `test_build_no_squeeze_warning_under_derivation` (still asserts *no* warning); update the cycle / >60-hop
  tests (`test_cycle_is_safe`, `test_hop_cap_terminates_on_very_deep_chain`) so they assert *no user warning*
  surfaces (and, if practical, that the internal log path fires). `test_tripwire_inconsistent_level_still_fires_7`
  and the #7 suite stay green unchanged.

## Requirement 2 — Advisory suppression on edit + "Looks OK" left-align

**Files:** `nirmaan_stack/api/boq/wizard/review_screen.py`, `test_review_screen.py`,
`frontend/src/pages/boq-wizard/ReviewTree.tsx`.

- **Backend (`_compute_advisory_flags`, `review_screen.py:464-541`):**
  - Flag (i) `classifier_warning` (L507): gate on `not _get(row, "human_classification")`.
  - Flag (iii) `parser` (L533): gate on `not _get(row, "human_classification")`.
  - Flag (ii) `orphan`: unchanged.
  - **Pre-req check:** ensure `human_classification` is present in the row dicts fed to this function on
    *both* paths (`get_review_rows` build + any `get_structural_breaks` `frappe.db.get_all` field list). Add to
    the fetched fields if missing.
- **Frontend:** `ReviewTree.tsx:2727` container `justify-end` → `justify-start`. No other change.
- **Tests:** add `test_review_screen` cases — a row with `human_classification` set + `needs_classification_review=1`
  emits **no** `parser` flag; + non-empty `classifier_warnings` emits **no** `classifier_warning`; `orphan`
  still emits regardless of edit. Update any existing advisory-count assertions.
- **Verify:** row 143 of `BOQ-26-00023` (`BOQRR-26-21017`, `human_classification="line_item"`,
  `needs_classification_review=1`, `review_reason="priced_preamble_with_children"`) — its `parser` advisory
  must disappear after the change (DB-driven `get_review_rows` call or browser).

## Requirement 3 — Pick-parent from in-memory rows

**Files (frontend):** new `ReviewRowParentPicker.tsx`; rewrite picker mounts in `RestructureModal.tsx`;
**delete** `SheetSearchView.tsx`; (leave backend `get_sheet_preview_full` parked).

- **New `ReviewRowParentPicker.tsx`:**
  - Props: `rows: ReviewRow[]`, `excludeSubtreeRoots: number[]` (roots whose subtree is disabled to prevent a
    cycle), `selectedRowIndex: number | null`, `onSelect: (rowIndex: number) => void`,
    `initialCentreRowIndex?: number`.
  - Disabled set = union of each `excludeSubtreeRoots` entry + its descendants (walk `effective_parent_index`
    children with a cycle-safe guard). Disabled rows are not selectable.
  - Render: `computeDepths(rows)` indent + classification badge (reuse `CLS_LABELS`) + Sl.No / description /
    Unit / Qty (from `qty_total` / `qty_by_area`). Skip blank spacers (no description).
  - Search: `fuzzyDescriptionMatchSet` + prev/next stepper + scroll-to-hit + transient flash (port
    SheetSearchView's pattern; both already share `boqDescriptionSearch`).
  - Click a (non-disabled) row → `onSelect(row_index)`.
- **`RestructureModal.tsx` rewire:**
  - Replace the 3 `<SheetSearchView>` mounts (L484, L586, L664) with `<ReviewRowParentPicker>`.
  - Replace `currentHit: SheetPreviewRow` state with `currentSelIdx: number | null` (emitted directly);
    **delete** `hitRowIndex` (L189-193) and the "isn't a selectable parent" no-match guards (L478-482,
    L580-584, L658-662).
  - `excludeSubtreeRoots` per mount: row-own-position → `[row.row_index]`; option 3 → `children.map(row_index)`;
    option 4 (child C) → `[C.row_index]`.
  - Keep "Set as parent" / "Top level" buttons + all gating (`canSave`, `buildChildMoves`) and the inline
    backend-throw surface (the batch cycle guard remains authoritative).
  - Drop the now-unused `SheetPreviewRow` import / `boqName`+`sheetName` props no longer needed by the picker
    (they are still used elsewhere in the modal — verify before removing).
- **Delete `SheetSearchView.tsx`** (sole consumer was RestructureModal).
- **Tests:** vitest (CI; not installed locally per memory) — a unit test for the descendants/disabled-set
  helper (pure) + a RestructureModal render/select test if feasible. `tsc` delta-0 is the local gate.

---

## Docs / ADR (Wave 2)

- **ADR-0009 amendment** (`docs/adr/0009-derive-preamble-level-from-tree.md`): note #22 demoted from
  user-facing warning to internal tripwire; #7 explicitly retained.
- **`.claude/context/domain/boq-backend.md`**: advisory suppression-on-edit rule; #22 demotion.
- **`frontend/.claude/context/domain/boq-frontend.md`**: RestructureModal pick-parent now renders from `rows`
  via `ReviewRowParentPicker`; `SheetSearchView` removed; advisory + "Looks OK" change.
- Update this plan to as-built; **do not** re-bloat the always-loaded `CLAUDE.md` files (DOCS-UPDATE RULE).

## Branch strategy (owner decision)

The level-derivation fix is **local/uncommitted on `develop`**. Recommended: commit it to
`feature/boq-level-derivation` first, then do these three refinements on a sibling branch
`feature/boq-review-refinements` (they share the same pending Nitesh review of ADR-0009). Alternatively keep
all of it on one branch. **Confirm before committing.**

## Risks / watch-items

- Req 2: confirm `human_classification` is in the row dicts on the `get_structural_breaks` path too, else the
  suppression silently no-ops there.
- Req 3: confirm `boqName`/`sheetName` props are still needed by RestructureModal after the picker swap before
  removing them; verify no other code imports `SheetSearchView`.
- Req 1: ensure removing the `level_warnings` param doesn't break a caller signature elsewhere.
