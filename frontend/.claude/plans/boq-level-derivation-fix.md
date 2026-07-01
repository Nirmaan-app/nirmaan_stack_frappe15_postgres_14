# BoQ Fix Plan — Derive preamble `level` from the effective tree (kills the #7 "sub-heading not under a higher-level heading" block)

**Status:** EXECUTED locally + tested green (419 backend tests: test_commit_validation 51, test_commit_pipeline 50, test_boq_nodes 77, test_review_screen 241; + new `ParentChain.test.tsx` 4 cases; tsc delta-0 new errors). **Still pending Nitesh ADR-0009 sign-off. NOT committed. NOT deployed.**
**Branch (proposed):** `feature/boq-level-derivation` off `develop`.
**Confirmed live on:** `BOQ-26-00023` / `"HVAC BOQ "` (11 must-fix `preamble_parent_level` breaks). Analysis doc: `docs/boq/preamble-level-reparent-block.html`.

---

## 1. The decision (grilled & locked)

- **Option A — `level` becomes a derived function of the effective tree.** A preamble's level = `1 + (count of preamble ancestors in the effective-parent chain)`; **any non-preamble = `None`** (system convention). Root preamble = 1, +1 per nesting tier.
- **Parser `level` is dropped from all consumers** (#7, commit, display). The parser is **NOT changed** (per owner instruction) — its `level` write becomes vestigial (written, unread), exactly like `path`.
- **Single backend source of truth:** one helper `derive_effective_levels(...)` feeds (a) `#7`/plan validation, (b) the commit pipeline's `BOQ Nodes.level`, and (c) `get_review_rows` (new `effective_level` field shipped to the client). Validation, commit, and display can never disagree.
- **Keep ALL existing checks as defensive tripwires** (owner instruction — "might catch errors if the source changes later"): `preamble_parent_ok` (#7) in both `validate_node_plan` and the `boq_nodes.py` controller backstop stay **unchanged**; the #22 squeeze + #15 deep-nesting checks stay, re-pointed at the derived levels. Under correct derivation they always pass; a future regression that produces an inconsistent level trips them loudly.
- **Today's bug clears honestly:** derived levels become consistent (VALVES→2, "PN-16 Butterfly valves"→3 with parent 2 < 3 ✓, BTU METER→3, Ultrasonic→4), so #7 passes — *not* by weakening the rule.
- **No migration** of already-committed BoQs (committed `level` isn't computed-on; new derivation applies to new/re-commits only).
- **`ParentChain` (edit-row detail):** show an `L{n}` chip **for preamble crumbs only** (non-preambles get no chip; their `effective_level` is `None`); add a `ClassificationPill` to the current-row terminal.

### Parser observation (requirement 1 — checked, not changed)
Parser sets `level` ONLY inside the preamble branch (`hierarchy.py` ~560–630); non-preambles default to `None` (`hierarchy.py:31`), and a demoted leaf preamble is reset to `row.level = None` (`hierarchy.py:792`). So the parser never leaves a non-zero level on a non-preamble — the staleness is purely a review-edit artifact, and the derivation MAINTAINS that `None` convention for non-preambles (it only changes how a PREAMBLE's level is computed).

---

## 2. The heart — one derivation function

`commit_validation.py` (new):

```
def derive_effective_levels(node_rows) -> tuple[dict, list]:
    # node_rows: list of (d, eff) where eff has effective_classification + effective_parent_index.
    # For EACH row: walk up effective_parent_index (hop-cap 60, cycle-guard) counting
    # PREAMBLE ancestors. preamble  -> level = 1 + preamble_ancestor_count ; else -> None (convention).
    # Also emit consistency_warnings: a preamble whose effective parent is a preamble but whose
    # derived level != parent_level + 1 (impossible under correct derivation -> #22 tripwire).
    # Returns (levels_by_idx, consistency_warnings).
```

Properties: order-independent (counts ancestors, doesn't need parents pre-computed), cycle-safe (hop-cap + seen-set), and identical for every call site.

VALVES branch sanity: CHILLD WATER=1 → VALVES=2 → PN-16 Butterfly=3 / BTU METER=3 → Ultrasonic BTUH=4; line items under any of them = None. #7 passes at every edge.

**CASCADE INVARIANT (load-bearing).** Because each row's level is derived from its OWN full effective-ancestor chain and the derivation runs **whole-sheet on every read** (never reusing a stored/cached parent level), re-parenting a preamble recomputes the level of that row **AND every descendant** — they shift in lockstep. The frontend `mutate()` after each single-row edit refetches `get_review_rows` (whole sheet), so the cascade reaches `ParentChain`/#7; the commit-time `derive_effective_levels` pass cascades `BOQ Nodes.level` identically. This is exactly what the current `_compute_levelless_preamble_levels` does NOT do (it only touches level-less preambles and trusts stored levels) — eliminating that non-cascade is the core of the fix. Example: re-parenting VALVES (L2) up to top-level shifts VALVES→1, PN-16 Butterfly→2, Ultrasonic BTUH→3.

---

## 3. File-by-file changes

### Backend
| File | Change |
|---|---|
| `api/boq/wizard/commit_validation.py` | **ADD** `derive_effective_levels(node_rows)`. **REMOVE** `_real_preamble_level` (reads parser level — dead) and `_compute_levelless_preamble_levels` (replaced). **CHANGE** `derive_node_type_and_level(d, eff, levels_by_idx)`: ONLY the preamble branch changes → `levels_by_idx[idx]`; line_item → **None**; other → **None** (UNCHANGED — maintains the system convention). **CHANGE** `build_sheet_node_plan` to call `derive_effective_levels` and return its consistency_warnings (feeds #22). `validate_node_plan` #7/#15/#22 bodies **unchanged** (now validate derived levels). |
| `api/boq/wizard/commit_pipeline.py` | Update import (`:94`) + call (`:646`) `_compute_levelless_preamble_levels` → `derive_effective_levels`; update the `:87-88` comment. `derive_node_type_and_level` call (`:732`) unchanged → `node.level` now derived for preambles / `None` for non-preambles (unchanged). Verifier (`:1059-1062`) unchanged. |
| `api/boq/wizard/review_screen.py` | `get_review_rows`: after resolving rows, build `(row_index, eff_class, eff_parent)` triples, call `derive_effective_levels` (via **lazy/function-level import** to avoid the existing module cycle — same pattern as `structural_errors_for_sheet`), attach **`effective_level`** to each row dict (preambles → derived level; all non-preambles → `None`); add it to the returned payload. |
| `integrations/controllers/boq_nodes.py` | **No logic change.** Preamble derived level ≥ 1 passes the `level < 0` guard; non-preamble level `None` passes `if doc.level`. Keep the #7 backstop. Add one clarifying comment that `level` is now derived (preambles only; non-preambles stay `None`). |

### Frontend
| File | Change |
|---|---|
| `src/pages/boq-wizard/boqTypes.ts` | Add `effective_level: number \| null;` to `ReviewRow`. |
| `src/pages/boq-wizard/ParentChain.tsx` | Render an `L{n}` chip (muted) on each crumb **only when `effective_classification === "preamble"`** (reads `effective_level`); add `<ClassificationPill cls={row.effective_classification} />` + the chip (if preamble) to the current-row terminal (replacing the bare "(this row)"). |

### Tests
| File | Change |
|---|---|
| `api/boq/wizard/test_commit_validation.py` | New `derive_effective_levels` unit tests (root=1, nesting, non-preamble=None, reclassify preamble→line-item=None, VALVES 4-tier, cycle-safety). **CASCADE test (load-bearing):** build a 4-deep preamble subtree, re-parent the middle node, assert the row AND every descendant level shift in lockstep (and the symmetric move back). Update existing #7 tests whose inputs assumed stored levels. Add a **tripwire test**: inject an inconsistent level → #7 fires. Keep `TestPreflightCommitParity` green. |
| `api/boq/wizard/test_review_screen.py` | `get_review_rows` ships `effective_level`; reclassify → None; nested preambles → correct levels. |
| `api/boq/wizard/test_boq_nodes.py` | Controller accepts derived preamble levels + line-item level None. |
| `api/boq/wizard/test_commit_pipeline.py` | Committed `node.level` = derived; verifier passes; line-item node level None. |
| `src/pages/boq-wizard/reviewRender.test.ts` (or new) | `ParentChain`: level chip for preambles only; current row shows its pill. |

### ADR + reference docs (NOT CLAUDE.md — per DOCS-UPDATE RULE)
- **NEW** `docs/adr/0009-derive-preamble-level-from-tree.md` — the model change, reversal of "absolute levels," parser-level vestigial, keep-checks-as-tripwires, non-preamble=None, no migration, relation to ADR-0007/0008. **Nitesh sign-off required.**
- Update `.claude/context/domain/boq-backend.md` (level now derived), `frontend/.claude/context/domain/boq-frontend.md` (ParentChain shows derived level), `frontend/.claude/plans/boq-upload-plan.md` (slice entry). Add a "Fix shipped" note to `docs/boq/preamble-level-reparent-block.html`.

---

## 4. Execution Strategy (Plan-to-Parallel — see ~/.claude/CLAUDE.md)

Execute via TaskCreate → TaskUpdate (dependencies) → parallel subagents (general-purpose). Ultracode is on → run the implementation as a Workflow pipeline keyed on these waves.

- **Wave 1 (spine):** Task A — backend derivation core (`commit_validation.py` + `commit_pipeline.py` wiring + comments). Everything depends on `derive_effective_levels` existing.
- **Wave 2 (parallel, after A):** Task C — `get_review_rows` `effective_level`; Task D — `boq_nodes.py` comment + controller verification; Task E — backend tests (commit_validation / commit_pipeline / boq_nodes).
- **Wave 3 (parallel, after C):** Task F — frontend `boqTypes` + `ParentChain`; Task G — `test_review_screen`.
- **Wave 4 (after F):** Task H — frontend ParentChain test + `yarn tsc`.
- **Wave 5 (after all):** Task I — ADR-0009 + reference-doc updates + full verification + browser E2E.

Each subagent prompt includes the **why** (the derived-level model + the bug it fixes), the exact files, the keep-checks constraint, and the expected output.

---

## 5. Verification
- In-container: `bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_commit_validation` (+ `test_review_screen`, `test_boq_nodes`, `test_commit_pipeline`).
- `yarn tsc` (delta-0 new errors) + frontend test.
- **Browser E2E on a LOCAL repro** (dev bench) of an L2-under-L2 structure: confirm the must-fix breaks clear, **Mark Finalized** enables, `ParentChain` shows level chips for preambles + a classification pill on the current row. (`BOQ-26-00023` is prod; after deploy, re-confirm there — the 11 breaks should vanish with no data edits.)

## 6. Risks & rollback
- **Committed-level value changes** on some un-edited rows (parser numbering-level vs depth) — accepted (level not computed-on/displayed); covered by ADR-0009 + owner sign-off.
- **Module import cycle** if `review_screen` imports `commit_validation` at top level → mitigated by the lazy import.
- **Non-preamble committed level stays `None`** (system convention maintained — no change from current behavior for non-preambles).
- Rollback = revert the branch; derivation is isolated to `derive_effective_levels` + its 3 call sites + the `ParentChain`/`effective_level` display.

## 7. Open items for the owner (Nitesh)
1. Approve ADR-0009 (derive level; reverse "absolute levels").
2. OK to change committed `level` on un-edited rows (invisible/inert today; matters only to the future tendering module — which will *prefer* depth-consistent levels)?
3. No migration of historical committed BoQs — confirm.
