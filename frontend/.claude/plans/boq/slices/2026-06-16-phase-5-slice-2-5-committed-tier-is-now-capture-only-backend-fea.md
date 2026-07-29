## Phase 5 Slice 2.5 — committed tier is now CAPTURE-ONLY (BACKEND, feat 49b77635, 2026-06-16)

**What this slice is.** Makes the committed BOQ Nodes tier a TRUTHFUL CAPTURE STORE: when the Slice-3 pipeline
commits a reviewed BoQ, the node + its per-area child rows persist EXACTLY the reviewed values — no
recomputation. All money computation (amount = rate × qty, parent rate roll-up, child rate inheritance) is REMOVED
from the controller write chain and moves to the future tendering phase (built against that consumer's shape).
This is the owner-decided **capture-only** principle. Computation-removal ONLY: every STRUCTURAL invariant stays
and stays green; NOT the commit pipeline (Slice 3); NOT a schema redesign.

**Verify-first (re-confirmed at tip c5f72358 before editing):** V1 the two parent compute methods are called ONLY
from before_save (no external caller); V2 child compute is reached only via the parent's `_process_qty_by_area_rows`
→ `apply_before_save`; V3 NO structural validation reads a computed value (validate runs BEFORE before_save, so the
combined_rate consistency check + the child tolerance read INPUT rates; amounts are read only by `_write_audit`);
V4 the four fields are read_only=1; V5 `amount_override` is read at exactly 3 sites; V6 `is_rate_only` is written
only inside `_compute_amounts`.

**PARENT (`integrations/controllers/boq_nodes.py`):** `before_save` now calls only `_compute_path` (structural
path identity). REMOVED: the `_compute_amounts` call + def (recomputed supply/install/total_amount from qty×rate;
auto-set `is_rate_only`) and the `_recompute_parent_rates_from_areas` call + def (overwrote the parent rate with a
qty-weighted average on per-area divergence). `_process_qty_by_area_rows` did nothing but reach the (now-removed)
child compute, so the whole dead chain (it + the child `apply_before_save`) was removed; the `_area_ctrl` import
STAYS for `validate_child` (the kept tolerance check). **`is_rate_only` is NO LONGER auto-set anywhere** — the
field STAYS (structural-audit KEEP decision: rate-only rows aggregate differently downstream) and its value is
**CARRIED THROUGH from the BoQ Review Row by the Slice-3 pipeline** (the parser sets it; Slice 3 maps it onto the
node verbatim, same as every other captured field — **Slice 3 OWES this carry-through**). KEPT untouched: the full
`validate` chain (sheet-required, boq↔sheet sync-guard, node_type/description required, level rules, combined_rate
consistency, parent rules, `_validate_qty_by_area` incl. no-dup-area + per-child tolerance), `_compute_path`,
`after_insert`, `on_update`/`_write_audit`, `on_trash`.

**CHILD (`integrations/controllers/boq_node_qty_by_area.py`):** REMOVED `apply_before_save`, `_apply_rate_fallback`
(blank child rate inheriting the parent's) and `_compute_child_amounts` (child amount = rate×qty). KEPT
`validate_child` + `_validate_combined_rate` (structural tolerance). With fallback gone, a blank child rate stays
None, so the "all three set" guard short-circuits and never spuriously trips on an inherited value.

**SCHEMA (`boq_nodes.json`):** dropped `read_only` on `supply_amount` / `install_amount` / `total_amount` /
`is_rate_only` (now captured values written by the pipeline, not controller-derived display). NO field
added/removed. `amount_override` KEPT — its only remaining read is the cosmetic non-leaf-Preamble warning in
validate:38 (the field is otherwise dormant). **Known cosmetic-stale (not touched, tight JSON scope):** the
`is_rate_only` description still reads "Auto-set when qty=0…" and `amount_override`'s reads "prevent automatic
recomputation" — both now inaccurate; a later slice can correct the description text.

**TESTS (`test_boq_nodes.py`, still 71 — the suite now CERTIFIES capture-only):** the ~19 compute-asserting tests
were retargeted to assert "a value I set persists UNCHANGED; a value I leave blank STAYS blank (not
computed/inherited/auto-set)". 13 parent-COMPUTE retargeted (amounts-not-computed, set-amounts-persist-verbatim,
parent-rate-persists-when-per-area-diverges, is_rate_only-not-auto-set/persists-when-set), 5 child-COMPUTE
retargeted (child rate not-inherited, child amounts persist verbatim), 5 MIXED split (kept the structural
assertion — saves / consistency-fires-or-not — dropped only the dead `total_amount==` line). The **48
STRUCTURAL+NEUTRAL tests are untouched and stayed green**, proving no structural check depended on a removed
compute value (V3 confirmed empirically).

**Combined_rate consistency invariant STAYS (the dogfood watch).** It is the one structural check over rate inputs;
it remains enforced at validate time on the values the pipeline writes.

**VERIFICATION (in-session).** `bench migrate` CLEAN — after clearing 10 stale Role-Profile fixture-sync lock files
(the recurring environmental no-live-worker `DocumentLockedError` in `sync_fixtures`, unrelated to this change; the
`read_only` drops applied in the earlier schema-sync phase, which completed). `test_boq_nodes` **71/71 OK**;
`test_boq_node_qty_by_area` 0 tests (empty stub, green); parser suite **597 UNCHANGED**. **Zero blast radius:** no
other test module asserts node compute, and no live code (api/, parser, patches, `commit_gate.py`, the Slice-1
doctype) depends on node auto-compute (the parser's own `is_rate_only`/amount classification is a separate path).
4 files changed, +138/−199. **NEXT = Slice 3** must carry `is_rate_only` (+ all amounts/rates) from the review row
onto the node verbatim.

