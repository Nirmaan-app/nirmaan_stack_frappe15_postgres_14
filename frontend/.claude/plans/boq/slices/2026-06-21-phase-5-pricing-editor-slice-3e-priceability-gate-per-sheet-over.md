### Phase 5 Pricing Editor -- Slice 3e -- priceability gate + per-sheet override toggle (FULL-STACK, feat pending, 2026-06-21)

**Goal.** A rate cell is editable ONLY on a committed row whose **node_type** is "Preamble" or "Line Item" (verbatim --
the priceability axis); "Other" (note/spacer/subtotal/header_repeat) renders rate cells READ-ONLY, enforced BOTH in the
grid AND server-side in `save_cell_price`, keyed on the SAME field both sides (no axis drift). PLUS a per-sheet,
per-session OVERRIDE TOGGLE (default OFF) that unlocks non-priceable rate editing for that sheet this session + makes
the server ACCEPT those writes (`allow_non_priceable`). **CLOSES the Slice 3 arc.** NO migrate.

**THE §6 PRICEABILITY RULE (load-bearing architectural fact -- a DELIBERATE, RECORDED §6 loosening of the §0 "server
always rejects" rule).** Editable only when `node_type in {"Preamble", "Line Item"}`. The server guard
(`save_cell_price`) is placed AFTER the cell-resolve + BEFORE the lock acquire/freeze+insert (so a rejected
non-priceable write mutates NOTHING): `node_type not in {Preamble, Line Item} AND not allow_non_priceable` ->
`frappe.throw`; override asserted -> ACCEPT. This is **reject-by-default / accept-on-asserted-override**, NOT drift. The
override-priced "needs review" anomaly is **DERIVABLE (no new schema; no marker field on BoQ Cell Pricing)** -- node_type
rides the delivered committed row + the priced flag, so the anomaly = `priced && !isPriceableType(node_type)`.

**node_type surfaced (no extra query).** `review_screen._committed_node_to_row` now emits `"node_type":
node.get("node_type")` (already in `_COMMITTED_NODE_FIELDS`); flows through `get_priced_rows` untouched.
`_resolve_committed_cell` resolves node_type at the SAME `get_value` (`["name","node_type"], as_dict`) and returns
`{"name","node_type"}`. `save_cell_price` gains `allow_non_priceable=None` (HTTP-coerced via `_coerce_bool`).

**Frontend gate + toggle.** NEW pure `isPriceableType(nodeType)` (VERBATIM Preamble/Line Item; false for Other/null/
mis-cased -- no fuzzy match); the rate-cell branch extends to `(isPriceableType(row.node_type) || override)`; a priced
non-priceable cell renders AMBER (bg-amber-50 + amber dot + "Priced on a non-priceable row -- flagged for review")
instead of the EMERALD marker, composed identically in BOTH the editable branch + the read-only fall-through (so the
anomaly stays visible when the override is OFF, e.g. on reload). The per-sheet per-session toggle (`useState(false)`,
loud amber when ON, suppressed for grid-only, resets in `useEffect([sheetName])`) threads `allow_non_priceable` into the
save. `PricedRow.node_type?: "Preamble"|"Line Item"|"Other"|null` (boqTypes.ts) -- DERIVE-NOT-STAMP.

**Tests + verification.** backend `test_pricing` **41 -> 47** (+6 `TestPriceabilityGuard`: Other rejected w/o override [+
a rejected write wrote no price row AND did not acquire the lock]; Other accepted w/ override; HTTP "true"; priceable
saves w/ and w/o override; node_type on the row). `test_review_screen` **205 unchanged** (additive emit). Vitest **68 ->
72** (+4 `isPriceableType`). tsc 3178, 0 in touched; Vite build exit 0. Live cert: get_priced_rows delivers node_type per
row; `_resolve_committed_cell` returns `{name, node_type:'Other'}`. (See root CLAUDE.md `// prior:` "Phase 5 Slice 3e" +
frontend CLAUDE.md `**Status (... Slice 3e ...)**`.)

