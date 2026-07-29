## Phase 5 — level-less preamble guard fix (post-dogfood) (BACKEND, feat pending, 2026-06-17)

**The bug (found by the dogfood + a read-only recon).** `commit_pipeline._build_node_pass1` stamped a flat
`level=1` on ANY preamble whose parser level was unset/0. That breaks the tree when a child is also level 1 — e.g.
BOQ-26-00145 'Electrical ' row 18 "Note:" was committed at level 1, but its child row 20 is level 1 (parent ==
child level). A read-only recon across ALL finalized committable sheets found exactly **3 live cases**, all
committed at the buggy level 1, and **no squeeze/inversion edges** in real data.

**The rule.** A level-less preamble (no classifier override ≥1 and no parser level ≥1) is assigned:
- **WITH children → `max(0, min(child effective-level) − 1)`** — the shallowest child wins, so the preamble sits one
  level above its shallowest child; line-item children count as level 0.
- **CHILDLESS → the sheet's shallowest DEFINED preamble level; if the sheet has no defined levels at all → 0**
  (a sheet of line-items + one promoted preamble has no defined levels).
A normal preamble with a real ≥1 level (override or parser) is **unchanged**. The Preamble level constraint relaxes
from `≥1` to `≥0` (`integrations/controllers/boq_nodes.py`: throws only on `level is None or < 0`; the JSON `level`
is a plain Int with no min, so **no doctype change, no migrate**).

**The 3 real cases (now asserted with seeded review rows, not live data):** children all level 1 → 0 (Electrical
row 18); children mix level-0 line-items + level-1 preamble → 0 (low side row 191, min child 0); childless, sheet
has no defined levels → 0 (Fire Fitting row 8). Plus a control (normal multi-level preamble tree unchanged).

**Implementation.** `commit_pipeline.py`: new module-level `_real_preamble_level(d)` (override≥1 wins, else
level≥1, else None = level-less) + `_compute_levelless_preamble_levels(sheet_name, node_rows, eff_parent_by_idx)`
computed ONCE per sheet in `_commit_node_tree` (reuses the eff map; no re-resolve) and passed into
`_build_node_pass1` (signature extended with `assigned_levels`). A SAFETY warning (`frappe.msgprint`, not exercised
by current data) fires if a level-less preamble has both a parent and children and the computed level wouldn't sit
above the parent (squeeze) — best-effort assign, never silently jam.

**Tests.** `test_boq_nodes` 71→72 (`test_preamble_level_zero_rejected` retargeted → `_zero_saves` [level 0
persists] + new `_negative_rejected` [level −1 still throws]); `test_commit_pipeline` 19→23 (+4: with-children,
mixed-min, childless-no-levels, normal-multilevel regression); `test_review_screen` 158 UNCHANGED (import safe);
parser **597 UNCHANGED**. No migrate (no schema JSON change).

**OWED — a SEPARATE run before push:** the 3 live cases (and any other affected sheets) are still committed at the
buggy `level=1` until **re-committed**; the re-commit + a round-trip re-verify is a separate run. Pure-backend →
root CLAUDE.md + this plan; frontend/CLAUDE.md NOT touched.

