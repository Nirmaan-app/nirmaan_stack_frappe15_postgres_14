# 9. Preamble `level` is derived from the effective tree, not carried from the parser

Date: 2026-06-30

## Status

Proposed — **pending Nitesh sign-off.** Reverses the recorded *"levels are absolute (carried from the parser)"* invariant. Sibling to [ADR-0007](./0007-preamble-level-relax.md) (relax #7 to strictly-shallower) and [ADR-0008](./0008-fully-hard-finalize-gate.md) (fully-hard finalize gate). Branch `feature/boq-level-derivation` (proposed, off `develop`).

## Context

Commit guard **#7** (`preamble_parent_ok`) hard-blocks a sheet when a preamble's stored `level` is not strictly shallower than its parent's stored `level`. ADR-0007 relaxed the strict-consecutive constraint to *strictly shallower*, but the underlying mismatch remained: **the `level` field and the parent chain can disagree after human re-parenting**, and when they do #7 fires on a structurally sound tree.

This was confirmed live on `BOQ-26-00023` / `"HVAC BOQ "` (11 must-fix `preamble_parent_level` breaks on the HVAC Low side sheet). Full analysis: `docs/boq/preamble-level-reparent-block.html`.

### Root cause

`level` is written once by the parser (`hierarchy.py`) from the heading's **numbering/styling axis** — the outline depth implied by the heading number or the `preamble_level_override`. It is then stored verbatim on `BoQ Review Row` and later committed verbatim to `BOQ Nodes`. The review screen's re-parent operations write only `human_parent` (and `effective_parent_index`); they never touch `level`. After a legitimate re-parent the two axes diverge:

- `effective_parent_index` (used by display, rollup, and commit hierarchy) reflects the human-edited tree.
- `level` reflects the parser's original numbering judgment — stale, and uneditable in the review UI.

### The `path` parallel

The sibling field `path` (dot-notation ancestry string) is in exactly the same position: the parser writes it, the commit pipeline **rebuilds it from scratch** using the effective parent chain. The rebuilt `path` is always consistent. `level` has no equivalent rebuild step — that is the gap this ADR closes.

### Why the parser is not the fix

Changing the parser would alter the classification/numbering axis that drives other downstream behaviour (preamble detection, heading-stack depth). The owner's instruction is that the parser is **not changed**. The fix must sit on the read/validation/commit path, not in the parser.

## Decision

1. **`level` becomes a derived value, computed from the effective tree.** The derivation rule is:
   - Preamble rows: `level = 1 + (count of preamble-classified ancestors in the effective-parent chain)`. The root preamble (no preamble ancestor) is L1; each nesting tier adds 1.
   - All non-preamble rows: `level = None` — the existing **system convention** (the parser already writes `None` for non-preambles). Only the preamble branch changes; non-preamble rows are left exactly as they are today.

2. **Single backend source of truth: `derive_effective_levels`.** One function in `commit_validation.py` walks the effective-parent chain for every row in the sheet (hop-cap 60, cycle-guard), counts preamble ancestors, and returns a `levels_by_idx` dict. This dict feeds all three consumers:
   - `validate_node_plan` — drives the #7/#15/#22 pre-commit validators.
   - `commit_pipeline.py` — the value written to `BOQ Nodes.level` at commit time.
   - `get_review_rows` (`review_screen.py`) — the new `effective_level` field shipped to the client (used by `ParentChain` to show `L{n}` chips on preamble crumbs).

   Validation, commit, and display can never disagree because they all consume the same single-source derivation.

3. **Parser `level` becomes vestigial — written but unread.** Like `path`, the parser continues to write it; all consumers downstream of the review screen now ignore it in favour of the derived value.

4. **All existing checks are kept unchanged as defensive tripwires** (owner instruction). `preamble_parent_ok` (#7) survives in both `validate_node_plan` and the `boq_nodes.py` controller backstop. #15 (deep-nesting warning) and #22 (computed-level squeeze warning) are re-pointed at the derived levels. Under correct derivation these checks should always pass; a future regression in the derivation or the parent chain will trip them loudly rather than silently.

5. **Cascade invariant.** Because each row's level is derived from its own full effective-ancestor chain, and `derive_effective_levels` always runs whole-sheet (never reusing a stored parent level), re-parenting a preamble recomputes that row *and every descendant* in lockstep. The frontend `mutate()` after each single-row edit already refetches `get_review_rows` (whole sheet), so the cascade reaches `ParentChain` and the must-fix panel on every keystroke.

6. **No migration of historical committed BoQs.** The committed `level` on existing `BOQ Nodes` rows is not recomputed. New derivation applies to new commits and re-commits only.

## Consequences

- **The live #7 block on `BOQ-26-00023` clears honestly.** Derived levels for the HVAC Low side become consistent (e.g. VALVES→L2, PN-16 Butterfly Valves→L3 with parent L2 < L3 ✓, BTU METER→L3, Ultrasonic BTUH→L4). #7 passes because the tree *is* valid — not because the rule was weakened further.
- **Committed `level` may change on un-edited rows** where the parser's numbering-style level differed from the true nesting depth. This is accepted: `level` is not displayed, not computed-on, and not load-bearing for any current consumer (capture-only tier, Phase 5 Slice 2.5). It matters to the future tendering module, which will prefer depth-consistent levels — making them consistent now is correct. Nitesh sign-off covers this consequence explicitly.
- **Non-preamble committed level stays `None`.** The system convention is maintained — non-preambles keep `None`, unchanged from current behaviour; only a preamble's `level` is now derived. (The verifier's `(x or 0)` normalisation and the controller's `if doc.level` guard both already tolerate `None`.)
- **`review_screen` imports `commit_validation` via a lazy function-level import** (same pattern as `structural_errors_for_sheet`) to avoid the existing module cycle (`commit_validation` imports `resolve_effective` from `review_screen` at module load).
- **The old helpers `_real_preamble_level` and `_compute_levelless_preamble_levels`** in `commit_validation.py` are deleted; `derive_effective_levels` replaces them. `_compute_levelless_preamble_levels` was non-cascading (it only patched level-less rows and trusted stored levels on the others) — eliminating that non-cascade is the core correctness gain.
- **Relation to ADR-0007:** ADR-0007 relaxed #7's equality constraint to strictly-shallower; this ADR ensures the levels being compared are always consistent with the human-edited tree. The two changes are complementary: ADR-0007 handles numbering-gap re-parents; ADR-0009 handles level-staleness after any re-parent.
- **Relation to ADR-0008:** The fully-hard finalize gate (ADR-0008) means any persistent #7 block prevents finalize. Without this ADR the HVAC BOQ case would be permanently stuck. With derivation, the gate becomes passable without any data edits.
- Review-phase `path` and its potential inconsistency after re-parent are **not addressed here** — left as a separate future cleanup.
