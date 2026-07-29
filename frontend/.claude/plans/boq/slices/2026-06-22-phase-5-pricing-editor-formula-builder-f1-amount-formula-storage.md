### Phase 5 Pricing Editor -- Formula Builder F1 -- amount-formula storage + endpoints (BACKEND, MIGRATE, feat 2026-06-22)

**Why.** A real bug: on a sheet with separate supply + install rate columns but a SINGLE total-amount column, the total
does not recompute when a rate is edited -- `PricingGrid.findPairedRateDescriptor` pairs one amount to exactly one rate,
returns null for the unpaired total, and the cell falls back to the STALE committed value. The fix is a missing
capability: an amount column needs a USER-DECLARED FORMULA. F1 builds the STORAGE + endpoints only; the evaluator is F2
(a later pure module), the builder UI is F3, the grid display swap (replacing the `findPairedRateDescriptor` seam at
`PricingGrid.tsx:1277-1300`) is F4.

**LOCKED scope (owner-settled).** AMOUNT COLUMNS ONLY are formula targets. Operands = the sheet's qty / rate / amount
columns; operators (stored, not evaluated here) = `+`, `*`, brackets; NO numeric literals; amount-refs-amount allowed
within the row (the cycle guard is an F2 concern, but the STORED shape makes operand refs first-class so F2 can build the
dependency graph without parsing). SUBTOTALS are OUT (the summary-panel rollup `pricingRollup.ts` is a SEPARATE cross-row
surface -- untouched). Display-only + fail-safe is an F2/F4 concern; F1 just stores. Per committed version.

**FORMULA GRAIN = "Option 2 with override" (owner-locked).** A LOGICAL-COLUMN DEFAULT formula is area-WILDCARD: stored
with `target_value_key = NULL`, applies to EVERY area's instance of that logical column; its area-bound operand leaves
carry `value_key = NULL` meaning "bind to the area being computed at eval time" (F2 fills it). A PER-AREA OVERRIDE is
stored with a CONCRETE `target_value_key` (the area) and WINS for that one area; its operands may name areas explicitly.
Resolution precedence (an F2/F4 concern, recorded for the model): per concrete column -> override-for-this-area if
present, else the logical default, else no formula. The DISCRIMINATOR is simply whether `target_value_key` is NULL
(default) or set (override) -- NO extra field. Scalar amount columns (value_field = a scalar amount field, value_key
NULL) have no area dimension -- their formula is just a normal formula with value_key NULL meaning "scalar."

**AREA-TEMPLATE GATE (verified before build).** The wildcard default is a template: a `rate_by_area` operand with
value_key=NULL must bind to "the current area's rate_by_area[area]". This is sound ONLY if the per-area subkey VOCABULARY
is uniform. PROVEN two ways: (1) code -- the rate-subkey set is FIXED (`_RATE_ROLE_TO_KIND` = supply_rate/install_rate/
combined_rate) and amount-kind set FIXED (`_AMOUNT_ROLE_TO_KIND` = supply/install/total), NOT area-dependent; qty_by_area
is flat (no subkey); (2) a READ-ONLY DB peek of all 5 real multi-area committed sheets (BOQ-26-00145 Electrical/HVAC/Fire
Fitting/FAS + BOQ-26-00166 VRF System) -- EVERY one carries a uniform per-area rate-subkey set (e.g. VRF: every area has
supply+install+combined; the rest: combined in every area). Per-area divergence, if it ever arose, degrades gracefully
(override or F2 fail-safe blank) -- the model is not broken by it. GATE PASS -> proceeded.

**Doctype `BoQ Cell Amount Formula`** (mirrors BoQ Cell Pricing house style: istable=0, track_changes=1, the 10-role
permission block, bare-stub controller `BoQCellAmountFormula(Document): pass`, autoname `BAMF-.YY.-.#####`). Per-COLUMN,
per-committed-version. Fields:
- IDENTITY (the unique key, ENDPOINT-enforced -- NOT in the controller): `boq` (Link BOQs, reqd) / `sheet_name` (Data,
  reqd, VERBATIM #152) / `committed_version` (Int, reqd, default 1) / `target_value_field` (Data, reqd -- the amount
  column's value_field) / `target_value_key` (Data, NULLABLE -- NULL = logical-column DEFAULT (wildcard) OR scalar; a
  concrete area string = a PER-AREA OVERRIDE; nullability IS the discriminator) / `target_rate_subkey` (Data, NULLABLE --
  the amount kind total/supply/install for per-area; NULL for scalar).
- GUARD (NOT identity): `target_col` (Data -- the Excel letter, a re-resolve guard, mirrors BoQ Cell Pricing.node) /
  `description` (Small Text -- copy-forward match guard).
- VALUE: `formula` (Long Text -- the token-tree JSON, stored verbatim).
- LIFECYCLE triple (mirror pricing): `formula_version` (Int, reqd, default 1) / `is_current` (Check, default 1) /
  `defined_at` (Datetime, read_only) + an `is_finalized` (Check, default 0) lock. One-current-per-identity is
  endpoint-enforced. MIGRATE: 13 business columns, istable=0 (information_schema-verified).

**Token-tree JSON shape (stored as-is; F1 does a STRUCTURAL check only, NOT evaluation, NOT a cycle-check).** A node is
EXACTLY one of: operator `{"op": "+"|"*", "operands": [<node>, ...]}` (operands non-empty) OR leaf `{"ref": {"value_field":
<str>, "value_key": <str|null>, "rate_subkey": <str|null>}}`. NO literal node (barred). Operand refs are FIRST-CLASS
structured leaves (NOT a stringified formula) so F2 builds the dependency graph without parsing. For a DEFAULT (wildcard)
an area-bound operand carries value_key=NULL; for an OVERRIDE operands may carry concrete value_keys.
`pricing._validate_formula_structure` rejects (frappe.throw): a non-dict node, a `literal` key, a node with BOTH op+ref
or NEITHER, an op outside {+,*}, an empty/absent operands list, a non-string value_field, a wrong-typed value_key/
rate_subkey, and over-deep nesting (`_FORMULA_MAX_DEPTH=50`). Malformed -> throw, store nothing.

**Endpoints (`api/boq/wizard/pricing.py`).**
- `save_amount_formula(boq_name, sheet_name, committed_version, target_value_field, target_value_key=None,
  target_rate_subkey=None, formula=None, target_col=None, description=None)` -- `@frappe.whitelist(methods=["POST"])`.
  Order (mirrors save_cell_price): (a) arg guards + normalize the nullable Data fields (HTTP "" -> None); (b) **AMOUNT-
  TARGET GATE** -- `target_value_field` must be in `_AMOUNT_VALUE_FIELDS` (amount_by_area / amount_total / amount_supply /
  amount_install) AND a matching descriptor must exist on the committed config (reuses the certified
  `review_screen._build_column_descriptors` on the committed BoQ Sheet's column_role_map; per-area DEFAULT needs >=1
  area's amount column of that value_field+rate_subkey, OVERRIDE needs the concrete (area,kind), scalar needs the scalar
  amount field) -- a rate/qty target throws; (c) **STRUCTURAL validation** of the token tree (or detect the CLEAR
  signal); (d) **LOCK** -- `acquire_or_refresh(...)` AFTER the target-resolve + validation, BEFORE freeze/insert, so a
  lock reject OR a validation throw mutates NOTHING; (e) freeze-and-supersede (freeze prior is_current via set_value,
  insert new at formula_version=max+1, is_current=1, defined_at=now; one commit). A blank/None formula CLEARS (freeze
  prior, insert none -- mirrors the remark/color clear). Returns `{ok, name, formula_version, is_current, froze_prior,
  cleared}`.
- `get_sheet_amount_formulas(boq_name, sheet_name, committed_version)` -- bare `@frappe.whitelist()` (GET-capable, mirrors
  get_sheet_pricing). Returns `{"formulas": [{...current records, formula PARSED to an object...}]}`.
- **MERGE into `get_priced_rows`:** a NEW top-level `column_formulas` key on the envelope (PER-COLUMN, built ONCE like the
  remark/color indexes -- NEVER stamped onto a row). Empty `[]` for an uncommitted/grid-only sheet; populated inside the
  `commit_version is not None` block. Each entry `{target_value_field, target_value_key, target_rate_subkey, target_col,
  formula(object)}`. The existing keys/shape are unchanged (additive).

**Identity NULL-filter note.** The three nullable identity slots use `["is", "not set"]` when None (Postgres NULL
semantics) in the freeze/version queries, so a default (value_key NULL) and an override (concrete area) are correctly
DISTINCT identities and never collide.

**Tests (`test_pricing.py`, +1 class `TestAmountFormula`, 63 -> 82, all green).** default-wildcard current/v1; default +
per-area override coexist as DISTINCT current records; scalar amount formula (own committed-sheet helper
`_build_scalar_amount_committed_sheet`); re-save freeze-and-supersede (exactly one current, v2); clear; JSON-string
formula accepted; amount-target gate rejects a rate target / a qty target / an amount kind not mapped on the sheet
(nothing written each); structural rejects a literal node / a bad operator / empty operands; malformed validates BEFORE
the lock (no lock acquired); lock held fresh by another user rejects + writes nothing; get_sheet_amount_formulas current/
parsed + empty; get_priced_rows surfaces column_formulas (default + override as distinct entries, parsed, per-column NOT
per-row) + empty on an uncommitted sheet; missing args throw. Regression: test_review_screen 205 green.

**F2 (the evaluator) hand-off -- MUST know.** (1) the stored token-tree shape above (operator/leaf, no literal); (2) the
default-template area-binding: a DEFAULT formula's area-bound operand leaf has value_key=NULL -> F2 binds it to the
CURRENT area being computed; an OVERRIDE may carry concrete value_keys; (3) the override precedence (per concrete column:
override-for-area > logical default > none) -- the discriminator is `target_value_key` NULL vs concrete; (4) the read
shape: `get_priced_rows.column_formulas` (per-column entries) + `get_sheet_amount_formulas`; (5) the operand read MUST
mirror `reviewRender.resolveDescriptorValue` (value_field -> value_key -> rate_subkey, absent -> null, NEVER 0) so a
missing operand renders BLANK + flag, never a wrong number; (6) the cycle guard (amount-refs-amount) is F2's -- the stored
refs are first-class so the dependency graph is walkable without parsing.

