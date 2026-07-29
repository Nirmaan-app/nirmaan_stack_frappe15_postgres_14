### Phase 5 Preamble-only qty-bearing rate-edit gate (FULL-STACK, predicate-only, NO migrate, feat pending, 2026-06-24; base tip cbb93b16)

**What + why.** A read-only recon (Checklist-B PASS) found the rate-edit gate used TYPE-ONLY priceability (`isPriceableType`
frontend / `_PRICEABLE_NODE_TYPES` server), so a zero-qty Preamble showed an editable rate cell that the flags/priced-count
correctly excluded -- the inconsistency the owner spotted. This slice makes the gate ASYMMETRIC (owner-locked), enforced on
BOTH sides. FRONTEND + BACKEND, predicate-only, NO schema/migrate (reads existing fields).

**The asymmetric rule (owner-locked).** A rate cell is editable iff: **override OR `node_type == "Line Item"` (ALWAYS) OR
(`node_type == "Preamble"` AND qty-bearing)**. A LINE ITEM is always editable -- **a zero-qty Line Item is a valid rate-only
line, do NOT lock it.** A PREAMBLE is editable only when qty-bearing -- a zero-qty Preamble (nearly all Preambles) is
read-only. "Other"/null node_type is non-priceable. The override ("Price any row") unlocks BOTH a zero-qty Preamble AND any
non-priceable type. **The Preamble/Line-Item asymmetry is the FIRST time the two diverge for rate editing -- DELIBERATE,
recorded so nobody "fixes" it into uniformity.**

**Qty-bearing = "Definition A" (qty ANYWHERE).** The scalar qty OR any per-area qty is finite non-zero. DELIBERATELY SIMPLER
+ LOOSER than the existing `priceability.isPriceableLine` (qty in a RATE-COLUMN area, per-area). **THE DELIBERATE DIVERGENCE
(recorded, owner-locked):** two qty definitions now coexist ON PURPOSE -- the EDIT GATE ("qty anywhere", per-row,
Preamble-only) answers "can I edit this row?"; the FLAGS/priced-count/rollup (`isPriceableLine`, unchanged) answer "does
THIS area need a rate?". Different questions -> different predicates -> do NOT align them.

**Frontend (`PricingGrid.tsx`).** New self-contained pure leaves (exported, unit-tested): `isNonZeroNum` (a COPY of
priceability's, NOT imported -- importing back would reverse the one-way dependency / make a cycle), `isRowQtyBearing(row)`
(qty_total OR any qty_by_area non-zero), `isRateEditableRow(row, override)` (the asymmetric gate). The rate-cell render
branch swapped `(isPriceableType(row.node_type) || override)` -> `isRateEditableRow(row, override)`. Reads only
`row.qty_total`/`row.qty_by_area`/`row.node_type` (already on the memoized `PricingGridRow` prop) -> NO new shared-object
prop, the perf memo is NOT defeated. **Markers left unchanged** (the amber "needs review" still keys on `isPriceableType`
TYPE) -> an override-priced zero-qty Preamble renders emerald not amber: a known cosmetic nuance, out of scope, reported.

**Backend (`pricing.py`).** `_resolve_committed_cell` now also fetches the node's scalar `qty` (added to the SAME
get_value -> `["name","node_type","qty"]`, no extra query). New `_is_nonzero_qty` (mirrors `isNonZeroNum`; guards None/bool)
+ `_node_is_qty_bearing(node_name, node_qty)` (scalar qty OR any `BOQ Node Qty By Area` child qty non-zero; the child read
via `frappe.get_all` filtered `parent`/`parenttype="BOQ Nodes"`/`parentfield="qty_by_area"`, firing ONLY for a
Preamble-without-override). The `save_cell_price` guard (after cell-resolve, before lock/freeze/insert -- reject mutates
nothing, placement preserved) is now the per-type split: Line Item -> pass; Preamble -> require `_node_is_qty_bearing`;
else -> the UNCHANGED "not priceable" throw. Override (`allow_non_priceable`) bypasses the whole guard. `_PRICEABLE_NODE_TYPES`
is now inert (definition only; left in place, harmless).

**Build-time consistency finding (REPORTED, not decided -- owner follow-up).** A zero-qty rate-only Line Item is now
editable but, because `isPriceableLine` (qty-bearing) excludes it, is NOT in the N/M priced-count denominator nor flagged
needs_rate -> EDITABLE but NOT counted/flagged. `isPriceableLine`/flags/count were DELIBERATELY NOT changed in this slice
(edit-gate only). Surfaced for the owner to decide whether a follow-up is needed.

**Real targets (read-only DB peek, prior recon).** Zero-qty current Preamble/Line-Item committed nodes the gate newly locks
(Preambles): 145 -> 54/55 Preamble + 40/209 Line Item; 150 -> 23/23 + 57/104; 166 -> 13/13 + 42/56. The large Preamble
magnitude (~all Preambles lock) is INTENDED (Preambles are headers). Line Items stay editable regardless.

**Tests.** Frontend `PricingGrid.test.ts` 94 -> 106 (+12: `isNonZeroNum` edge set incl. "0"-string/NaN/Infinity/negative;
`isRowQtyBearing` scalar/area/negative/all-zero; `isRateEditableRow` Preamble-zero-locked / Preamble-qty-open /
LineItem-always-open / Other-locked / null-locked / override-unlocks-all); full Vitest suite 214 -> 226 green. Backend
`test_pricing.py` 96 -> 104 (+8 `TestPreambleQtyBearingGuard`: zero-qty Preamble rejected; qty-bearing Preamble accepted
[scalar AND via-area-child, exercising the child read]; zero-qty Line Item accepted [rate-only]; qty-bearing Line Item
accepted; Other rejected; zero-qty-Preamble + Other accepted with override). tsc 3175 (unchanged, 0 new); in-container Vite
build exit 0 (PWA 167). NOTE: the canonical pricing-test invocation is now `bench --site localhost run-tests --module
nirmaan_stack.api.boq.wizard.test_pricing` (raw `python -m unittest` broke post-merge -- merged `boq_ai_assist` opens a log
at import).

**Manual live-cert (pending Nitesh, on 145/150/166).** 1) zero-qty PREAMBLE (145 r4 "Note" / 150 r9 "AIR DISTRIBUTION" /
166 r4 "VARIABLE REFRIGERANT FLOW UNITS :") -> rate cells READ-ONLY. 2) qty-bearing Preamble (if any) -> editable. 3)
zero-qty LINE ITEM (166 r42 "3 TR, 1200 cfm") -> STILL editable. 4) qty Line Item -> editable. 5) override ON -> the locked
Preamble becomes editable; OFF -> locks again. 6) normal qty-bearing line: rate saves + amount computes. 7) server: with
override OFF a zero-qty Preamble cannot be priced. 8) perf intact (big sheets fast). 9) acknowledge re-arm intact. 10)
markers/annotations/lock intact. Any divergence in 6-10 = regression.

