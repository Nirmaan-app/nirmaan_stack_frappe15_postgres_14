### Phase 5 Pricing Editor -- Slice 1a -- committed-read endpoint get_committed_rows (BACKEND, pure-read, feat pending, 2026-06-20)

**Goal.** The first Phase-5 build: a NEW whitelisted read endpoint `get_committed_rows` in `review_screen.py` that adapts
the COMMITTED tier (BOQ Nodes + BOQ Node Qty By Area children + the committed `BoQ Sheet` column config) into the SAME
`{rows, column_descriptors}` descriptor contract `get_review_rows` emits from the DRAFT tier -- so the descriptor-driven
frontend render can later draw committed rows unchanged. NO new doctype, NO schema/JSON change, NO migrate, NO frontend
(the pricing-layer doctype is Slice 1b). `get_review_rows` / `_build_column_descriptors` / `resolve_effective` UNCHANGED
(read-to-reuse).

**Column half = pure reuse.** `_build_column_descriptors` runs UNCHANGED on the committed `column_role_map` (identical
`{letter:{role,area}}` shape).

**Row half = a bounded INVERSION of `commit_pipeline.py`'s draft->committed map** (`_committed_node_to_row` +
`_collapse_area_children`): money word-order re-key (node `supply_rate`->`rate_supply`, `combined_rate`->`rate_combined`,
`total_amount`->`amount_total`, ...); identity (`code`->`sl_no_value`, `qty`->`qty_total`, `notes`->`row_notes`); the
per-area children RE-COLLAPSED into the nested `*_by_area` dicts (`qty_by_area` flat; `rate_by_area`
`{area:{supply_rate,install_rate,combined_rate}}`; `amount_by_area` `{area:{supply,install,total}}` -- the amount-kind
rename `total_amount`->`total` / `supply_amount`->`supply` / `install_amount`->`install`).

**Index-field choice (A20).** `row_index = node.sort_order` (the exact committed analog -- commit_pipeline maps draft
`row_index`->`sort_order`; 0-based contiguous as `computeDepths` expects). `effective_parent_index` = parent node's
`sort_order` via `parent_node`->name->sort_order, ROOT (parent_node NULL) -> None; `source_row_number` carried separately
for the Parent column's Excel display. `classification`/`effective_classification` = `node.row_class` (the pill's
taxonomy; `node_type` is the separate priceability axis). DRAFT-ONLY fields (ai_*, edit_log, flags, revert_available,
human_*) OMITTED -- AI-free minimal contract. Guards mirror `get_review_rows` (boq/sheet required; "BOQs '...' not
found." throw); uncommitted/grid-only -> graceful empty lists. sheet_name VERBATIM (#152).

**Tests.** `test_review_screen` 196 -> **205** (+9: 4 hermetic negative/empty + 5 positive against the live committed
multi-area BOQ-26-00145/'Electrical ', skip-if-absent so CI-safe). Live probe: 194 rows, 9 descriptors, rates 0.0
(un-priced committed state), 2 roots. NEXT = Slice 1b. (See root CLAUDE.md `// prior:` "Phase 5 Slice 1a"; this is the
rehomed full detail.)

