## Build slice G2a (rate-editable blank-category count, surfaced) COMPLETE

BACKEND-ONLY, ADDITIVE, NO behaviour change, NO migrate. Branch `feature/boq-pricing-helper`, base tip
`4e3caeb4`.

**Why.** The coming gate (G2b) locks rate editing on a sheet until every RATE-EDITABLE row has a category.
Slice 1a built a blank-counter over the CLASSIFICATION-ELIGIBLE population (Line Item + Preamble, no qty
test); G1 relocated the qty test to the service layer. G2a adds the RATE-EDITABLE count (Line Item ALWAYS;
Preamble ONLY when qty-bearing) and surfaces it. **NO gate/lock/override ships here** -- the lock + its admin
override ship together in G2b, so no sheet is ever locked without an escape.

**Shape chosen: a `population` PARAMETER on the existing `persist.blank_category_eligible_rows`, not a
sibling.** Two populations: `"eligible"` (default, BYTE-IDENTICAL to pre-G2a) and `"rate_editable"`. Rationale:
the two share ~90% of the logic (resolve current sheet -> read nodes -> read votes -> apply the resolve
ladder), differing only in the node filter; a parameter keeps ONE source of truth for the blank-resolution.
The default preserves the sole existing caller's positional call (`get_freeze_summary` in classify.py, which
is OUT of scope and MUST NOT change) byte-identically. A sibling would have duplicated the resolve/ladder
logic. The two populations LEGITIMATELY differ (a qty-less Preamble is eligible but not rate-editable) --
owner ruling; `get_freeze_summary` deliberately keeps the ELIGIBLE population and is NOT repointed.

**Batched qty (the N-query problem).** `node_is_qty_bearing` issues a child-table query PER node; looping it
would be O(N) per sheet. G2a adds `persist._qty_bearing_node_names(nodes)`: `qty` is added to the counter's
EXISTING node `get_all` (a free column, no extra query), and the `BOQ Node Qty By Area` children are fetched
in ONE batched `parent IN (...)` query -> a set of qty-bearing node names. It reuses the shared
`is_nonzero_qty` for BOTH the scalar and the child values (one number definition; no re-inlined finite check).
`node_is_qty_bearing` is LEFT UNCHANGED -- it stays the single-row source of truth for `pricing.py`; the
batched path is an ADDITIONAL reader over the same semantics. A CONSISTENCY-PIN test asserts the batched set
and `node_is_qty_bearing` agree per node, both directions (if they diverged, the gate and the rate-edit guard
would disagree). The eligible path adds NO child query (byte-identical).

**Measured (largest committed sheet BOQ-26-00009 `ELECTRICAL WORKS` cv2, 1093 nodes on the sheet):** warm
best-of-3 -- `rate_editable` = 816 blank / **4 SQL queries / ~15 ms**; `eligible` = 939 blank / 3 queries /
~4 ms. **rate_editable adds exactly +1 query (the batched child query) -> O(1) queries, not O(N).** The
batched child query's cost scales with the IN-list size and `BOQ Node Qty By Area` LACKS a parent index (the
systemic project finding): an isolated probe over 2686 whole-BoQ parents took ~678 ms cold; within
get_priced_rows the query is per-sheet-scoped so the real cost is ~15 ms. **No index added this slice** (per
spec -- report, do not add). Live consistency pin over all 1093 real nodes: ALL AGREE.

**Surfaced keys (ADDITIVE, in `get_priced_rows`; PAYLOAD not schema; ship one slice ahead of the G3
consumer):**
- `rate_editable_blank_category_count` (int) -- rate-editable rows with a blank RESOLVED category.
- `categories_complete` (bool) -- `count == 0`.
Defaults on an uncommitted / grid-only sheet: `0` / `True` (no rate-editable rows -> vacuously complete). All
existing keys stay present + same-typed.

**Tests (bench-verified):** `test_pricing` 193 -> **204** (+11, new class `TestRateEditableBlankCount`:
(a) qty-bearing Preamble blank counted; (b) qty-LESS Preamble blank NOT counted; (c) zero-qty Line Item
counted; (d) never-classified rate-editable counted [fail-open survives]; (e) Other never counted in either;
(f) BYTE-IDENTITY of the eligible population; the populations-differ assertion; (g) CONSISTENCY PIN
batched-vs-single; invalid-population ValueError; get_priced_rows surfaces the count; categories_complete
flips true when all categorised). Regression `test_classify` **62** unchanged (the eligible byte-identity is
independently pinned by the still-green `TestFreezeSummaryResolved`). Files: `services/boq_category/persist.py`,
`api/boq/wizard/pricing.py` (get_priced_rows return only), `api/boq/wizard/test_pricing.py`.

**Browser cert RAN + PASSED** (owner session logged in; mandatory de-stale run -- 1 service worker
unregistered, storage cleared, tab closed+reopened, bare root first; the httpOnly `sid` cookie survived so no
re-login was needed). Synthetic sheet `BOQ-26-00133 | G2A CERT ` (trailing space), committed v1, rows 30-37:
30 Preamble-qty, 31 Preamble-qty-via-area, 32 Preamble-qty-less, 33 Line Item-qty, 34 Line Item-zero-qty, 35
Line Item categorised, 36 Line Item never-classified, 37 Other/Note. C1 expected 5 (stated first); C2
endpoint `rate_editable_blank_category_count`=5 + `categories_complete`=False (matches C1); C3 eligible
blank=6 > rate-editable 5 (differ by the qty-less Preamble 32); C4 categorise all rate-editable rows -> count
0 + boolean True; C5 in-browser with Price-any-row OFF, rows 33/34/35/36 (Line Items) + 30/31 (qty-bearing
Preambles) showed editable rate input boxes and 32 (qty-less Preamble) + 37 (Note) were read-only -- EXACTLY
as pre-G2a, NOTHING newly gated; C6 Category column rendered ("DB and Switchgear" on 35, amber fill on
blanks). NO rate saved. Synthetic BoQ + project DELETED and verified (0 residual nodes/sheets). (Setup note: a
transient single-editor lock left by the formula-declaration step -- save_amount_formula acquires the lock --
was cleared before the browser view; it is unrelated to G2a.)

**Next:** G2b adds the actual rate-edit gate + its admin override consuming these keys; G3 renders them. NO
gate ships until G2b.

**OWNER RULING for G2b (dated 2026-07-25, captured here so it is not lost):** the **"Price any row"
priceability override must NOT bypass the category gate.** When categories are incomplete
(`categories_complete == False`) NOTHING is rate-editable -- override or not -- exactly like the MANDATORY
amount-formula gate, which is ANDed OUTSIDE `isRateEditableRow(row, override)` (client) and enforced before
the priceability block (server `_resolve_and_guard_cell`) so the priceability override can never reach past
it. The category gate must sit in the SAME position: ANDed OUTSIDE the `override` on the client
(`categories_complete && formulasComplete && isRateDescriptor && isRateEditableRow(row, override)`) and thrown
in `_resolve_and_guard_cell` (server) alongside/after the formula gate, BEFORE the priceability block. The
category gate's OWN escape is the SEPARATE admin override (G2b), never "Price any row". Do NOT let the two
overrides be conflated.


