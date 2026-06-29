# 8. The sheet-finalize gate is fully hard (structural breaks block; "Mark anyway" removed)

Date: 2026-06-29

## Status

Accepted. The S2 slice of the commit-preflight work (surfacing `#7`/`#8` in the review screen). **Reverses** the soft "warn & confirm" finalize gate. Builds on [ADR-0007](./0007-preamble-level-relax.md) (the `#7` relax) + the S1 preflight. Branch `feature/boq-commit-preflight`.

## Context

The finalize gate (`review_screen.mark_sheet_parsed_check_done`) was **soft**: structural breaks (`line_item_as_parent`, `cycle`) were shown, but a `confirm=True` ("Mark anyway") re-call finalized the sheet *despite* them (returning `overridden: true`).

S1 made the **commit** hard-block the two structural errors — `#7` (sub-heading level line-up) and `#8` (item under a non-heading): the BOQ Nodes controller `frappe.throw`s on them, and the preflight surfaces them as blocking errors that exclude the sheet from the commit. S2 surfaces those same `#7`/`#8` in the review screen, computed by the *shared* validators (`commit_validation.build_sheet_node_plan` + `validate_node_plan`) over the same `ai_*`-free human>parser tree the commit uses — so review and commit can never disagree.

The crux: `#7`/`#8`/`cycle` are genuine commit-blockers that **cannot be acknowledged away** — the controller throws regardless. A soft override that lets the user finalize past them just produces a **finalized-but-uncommittable** sheet: the user finalizes, reaches the commit dialog, is blocked, and bounces back to review. The override was pointless once commit hard-blocks the same breaks.

## Decision

1. **The finalize gate is fully hard.** Any structural break ⇒ `mark_sheet_parsed_check_done` returns `{ok: False, breaks}` **regardless of `confirm`**. Finalize succeeds only when `breaks` is empty. (`confirm` stays in the Python signature for HTTP back-compat but is inert.)
2. **"Mark anyway" + `overridden` are retired.** The frontend's "Structural issues found" → `confirm=True` re-call is removed; the **Finalize button is disabled while any structural break exists**, and the must-fix panel (already rendered in the review tree) shows what to fix. `overridden` is dropped from the response + the TS type.
3. **The model collapses to two clean tiers:** structural breaks (`#7`, `#8`, `cycle`) = **hard must-fix** (block finalize); advisory flags (`orphan` / `parser` / `classifier_warning`) = **soft** (never block; `orphan` stays the dismissable amber advisory from the 2026-06-26 demotion).
4. **`#8` is generalized.** `review_screen.check_structural_integrity` drops its narrow `line_item_as_parent` block (item-under-item only) in favour of the shared `line_item_parent_not_preamble` (item under **any** non-heading — another item *or* a note), a strict superset. `check_structural_integrity` now computes only `cycle`; `#7`/`#8` come from `commit_validation.structural_errors_for_sheet`.

## Consequences

- A **finalized sheet is guaranteed structurally committable** (re `#7`/`#8`/`cycle`) — the commit dialog never surprises the user with a structural error on a sheet they already finalized. The review↔commit asymmetry that motivated this work is closed.
- Review becomes the single place structure is *enforced*; the commit dialog enforces nothing structural that review didn't already.
- The soft "warn & confirm" finalize affordance is gone — intentional. Scope decision (S2): review surfaces **errors only** (`#7`/`#8`); the soft commit warnings (`#15`/`#16`/`#20`/`#22`) stay in the commit dialog's "Looks OK" gate, not duplicated in review.
- `review_screen` + `commit_validation` share one cycle-free import path (the merge calls `structural_errors_for_sheet` via a lazy function-level import, since `commit_validation` imports `resolve_effective` from `review_screen` at module load). `test_review_screen` 232 → 236.
- The commit-side controller `frappe.throw` guards + the preflight are unchanged — they remain the durable backstop / defense-in-depth.
