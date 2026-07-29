## Build slice G1 (relocate the qty-bearing test to the service layer) COMPLETE

BACKEND-ONLY, NO migrate, BEHAVIOUR BYTE-IDENTICAL. Branch `feature/boq-pricing-helper`, base tip
`96bf96f1`.

**Why.** The coming category gate (G2) needs to count blank categories on the RATE-EDITABLE row
population (Line Item always; Preamble only when qty-bearing). That counting helper lives in the
SERVICE layer (`persist.blank_category_eligible_rows`). The qty-bearing test lived in the API layer
(`pricing.py`). Service->api at module top is against convention, so the test moves DOWN and pricing.py
imports it UP (api->service, legal) -- ONE definition, shared, not a second copy that drifts.

**Home chosen: `services/boq_category/persist.py`.** No node-level service module exists (surveyed
`services/`: boq_category, boq_parser, boq_revision, extraction -- none is a node-priceability home).
The spec's node-module preference is explicitly conditional ("preferable to persist.py IF ONE ALREADY
EXISTS"); none does, and "do NOT create a new module unless no existing home fits". persist.py fits both
import constraints (pricing.py imports it api->service; the G2 count uses it in-module) AND already reads
committed `BOQ Nodes` since Slice 1a (`blank_category_eligible_rows`, `_ELIGIBLE_NODE_TYPES`,
`_BOQ_NODES`, `_current_sheet_doc`) -- so a node-qty test is consistent with the node-reading role
persist.py already has. A new node module was considered and rejected per the "don't create unless
nothing fits" rule.

**What moved.** `_is_nonzero_qty` -> `persist.is_nonzero_qty`; `_node_is_qty_bearing` ->
`persist.node_is_qty_bearing` (both now PUBLIC -- they stopped being private the moment they are
shared). Logic verbatim (parenttype uses persist's `_BOQ_NODES` = "BOQ Nodes", byte-identical value).
`pricing.py` now `from ...persist import node_is_qty_bearing` and `_node_priceable_without_override`
calls it; the now-dead `import math` was removed from pricing.py (its only use was the moved function).
`_node_priceable_without_override` / `save_cell_price` signatures unchanged.

**Byte-identical proof.** The end-to-end priceability behaviour is pinned by the UNCHANGED
`TestPreambleQtyBearingGuard` (zero-qty Preamble rejected; scalar-qty + area-child Preambles accepted;
zero-qty Line Item accepted; Other rejected) -- all still green through `save_cell_price`. The new
`TestQtyBearingRelocation` pins the relocation SEAM: an `is` identity assert that `pricing.node_is_
qty_bearing IS persist.node_is_qty_bearing` (+ the old private names are GONE, so there is exactly one
definition), the `is_nonzero_qty` truth table, and the predicate `_node_priceable_without_override`
still rejecting a qty-less Preamble / accepting a qty-bearing Preamble + a zero-qty Line Item.

**The client mirror stays.** `isRowQtyBearing` in `PricingGrid.tsx` is NOT touched -- it is a DELIBERATE,
accepted duplication across the JS<->Python language boundary, not the same code, and out of scope here.

**No circular import** -- proven by running the suites (not by reasoning): persist.py imports only
`frappe`+`math`; pricing.py -> persist.py -> frappe. **Tests (bench-verified):** `test_pricing` 189 ->
**193** (+4 `TestQtyBearingRelocation`; no other test moved). Regression `test_classify` **62** unchanged.
Files: `api/boq/wizard/pricing.py`, `services/boq_category/persist.py`, `api/boq/wizard/test_pricing.py`.

**Known harmless stale reference (deferred, out of scope):** a COMMENT in `review_screen.py:831` names
`pricing._is_nonzero_qty` (descriptive prose, not a call/import) -- editing it is outside G1 scope; the
convention it describes still exists, relocated. Flagged for a future touch.

**Stack restart:** R1-R6 ritual run; `frappe.ping` -> 200 (:8000), Vite -> 200 (:8080), single healthy
instances. **Browser live-cert RUN + PASSED** (owner logged the session in mid-slice; precondition i).
Sheet `BOQ-26-00106 | ELECTRICAL BOQ` cv1 (formula-complete, classified, has both a rate-editable Line
Item and qty-less Preambles): C1 root+sheet loaded; C2 a Line Item rate cell took focus (blue ring, value
1800, NOTHING typed); C3 a qty-less Preamble rate cell was read-only plain "0" with Price-any-row OFF; C4
Price-any-row ON made that Preamble cell an editable input, OFF returned it to read-only; C5 the Category
column rendered values ("Point Wiring"). NO rate saved ("240 of 240 priced / All changes saved" unchanged
throughout). Behaviour byte-identical post-relocation. This unblocks the rate-editable population count in G2.


