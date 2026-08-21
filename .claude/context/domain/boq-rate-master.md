# BoQ Rate Master - full reference

**What this file holds.** Every load-bearing rule for the **BoQ Rate Master** (the priced-item
catalog, its category configs, the derivation-pipeline interpreter, the asset export/import round
trip, retirement, the CSV round trip, and the deployment freeze) and for **BoQ Rate Suggestion**
(the AI attribute-extraction engine and the pricing helper that consumes it).

**Why it exists.** Root `CLAUDE.md` loads into every session before any code is read. It is being
trimmed to a **router**: it will keep the stable conventions and point here for rate-master detail.
**This file is the full record.**

**Provenance.** Every block below was copied **VERBATIM** from root `CLAUDE.md` at commit
`30822d2b`, in source order, with only topic headings inserted between blocks. Nothing was
reworded, summarised, merged or corrected during the copy - verbatim copy is what makes the
losslessness provable, and it is what makes the later deletion from `CLAUDE.md` safe.

**Corrections owed.** Some content copied here is known to be stale - most notably the blocks
describing **goldens as ORACLES that must never be recomputed from our own interpreter**. The owner
retired the pricing sheet on 2026-08-19 and reclassified goldens as **regression canaries**,
re-banked mechanically; **Deployment Mode v1.1 is the authority.** Those blocks were copied
unchanged on purpose. Corrections ride a later slice - see the plan doc entry for this slice for
the full corrections-owed list.

---

## Rate-master invariants filed under Domain Gotchas

### Extraction matching mode - item_identity

- **`matching_mode: "item_identity"` routes a category to the composite-REFUSAL prompt (owner-locked).**
  `extraction.select_prompt_text` hands such a category `prompts/boq_rate_item_identity_prompt.md`, which
  instructs the model to return null for any row describing "MULTIPLE items or an assembled unit". It must
  NEVER be set on a category whose rows are ASSEMBLIES -- the model then refuses every row, deliberately and
  at high confidence, and the blanks look like an extraction failure rather than the instruction they are.
  Removing it means removing `identity_attribute_id` in the SAME edit (that key is read only when the mode
  is `item_identity`, so leaving it is a dangling key); `item_kinds` is SEPARATE and must stay -- it is what
  records which category OWNS a catalog kind.

### Composite assemblies - module fit, the blanker, plates and the back box

- **`switches_sockets` is a PER-COMPONENT COMPOSITE and rounds to TENS; `point_wiring` rounds to UNITS
  (owner-locked, deliberately different).** Both are sheet-faithful BY ORIGIN (the guiding sheet was
  retired 2026-08-19; the rounding behaviour described here is the standing rule): switches_sockets sums the RAW component
  lines, multiplies once, then rounds to tens; point_wiring multiplies and rounds per component. Do NOT
  "harmonise" them -- point_wiring's own notes record its unit rounding as "INTENTIONAL, per the sheet", and
  the tens convention is what keeps switches_sockets' standing golden value-identical across the rebuild.
- **The only blanker item in the catalog is `1M Blanker`, and it lives under `family: "Switch"`** -- there is
  no blanker family. Any `blank_item` slot therefore binds `values_from.where = {"family": "Switch"}`.
  **BOTH `switches_sockets` and `point_wiring` carry a blanker slot.**
- **The module count is computed in the PIPELINE, never by the model (owner-locked).** The
  `module_fit` interpreter step derives a row's module count from a weighted sum over its stated
  quantities and resolves it against the catalog. It belongs in the pipeline precisely BECAUSE a
  model-selected plate leaves no trace: the step's trace carries the arithmetic AND the ladder hop,
  and this system's design ethos is that a price shows its working. **The weighted sum is CONFIG —
  weights AND attribute ids — never hardcoded**, because `switches_sockets` has TWO socket slots and
  `point_wiring` has one, so a fixed two-attribute formula is not portable between them.
- **`module_fit` ladders derive from the CATALOG, never from a params array (owner-locked).** A ladder
  spec names an item `kind` + a `where` family and carries NO size list, so adding or retiring a plate
  size flows through with no config edit. Resolution is EXACT if the catalog carries the size, else the
  **NEXT HIGHER** one, **never a lower one** — a plate smaller than its contents cannot hold them, so
  rounding down is a wrong price, not merely a wrong size. **`"1M & 2M"` is ONE catalog item covering
  TWO sizes**: every integer in a rung's label is a covered size, so a computed 1 and a computed 2 both
  match it on the ordinary exact-match path. A count ABOVE the ladder's top is an HONEST NO-COMPUTE,
  never clamped to the largest rung; this DELIBERATELY DIVERGES from `circuit_fit`, which does fall
  back to its largest size but then re-checks with `circuits <= 0` — `module_fit` has no such second
  gate, so it refuses at the ladder.
- **THE BLANKER IS INFERRED FROM THE EFFECTIVE COUNT, NEVER SELECTED BY EXTRACTION (owner-locked).**
  A POSITIVE effective count prices `1M Blanker` in the assembly's colour whatever the model returned
  for `blank_item`; a ZERO count binds the **None sentinel** so the line reads as deliberately absent
  rather than as a blanker bought zero times. **The boundary follows the EFFECTIVE count, not the
  computed one** — editing the quantity to zero reverts the item to None. `blank_qty` is therefore
  EDITABLE again (seeded with the computed count): the earlier read-only ruling is REVERSED because
  the pipeline now genuinely reads it. **An over-count is CORRECTED to the plate's SPARE capacity
  (never its total — a blanker cannot go where a socket sits); an under-count is HONOURED with a
  warning naming the uncovered modules. Do NOT flatten that asymmetry** — one is physically
  impossible, the other merely untidy, and they carry deliberately different wording. The arbitration
  lives in `module_fit` (config keys `qty_attr` / `bind_item` / `item_when_positive`), which is the
  ONE step seeing both the spare and the stated value and which runs FIRST, so the pricing panel and
  the Rate Master Derivation screen inherit it by construction.
- **⚠️ A `ref` MUST NEVER CARRY A LITERAL THAT COULD MEAN "None" (owner-locked).** The `none_skips`
  short-circuit tests the **`@` prefix FIRST**, so a literal never reaches the sentinel comparison: it
  is taken as a **CATALOG MATCH KEY**, matches no row, and returns a **WHOLE-PIPELINE `no_match`** —
  the entire row unpriceable, wire and conduit included, not merely that line. The item is bound
  through `fitLabels` instead, exactly as a ladder binds its fitted rung, so the shared resolver and
  the shared short-circuit are both UNTOUCHED. **The bind must fire on every path that reaches a
  component, including the two absent ones** — an unbound `@` reference is a `bindMiss`, which refuses
  the whole pipeline. The COUNT still binds nothing on the no-plate path deliberately: an uncomputed
  blank count renders EMPTY, never 0.
- **⚠️ `item_when_positive` is the FIRST config value naming a catalog ITEM** rather than a `kind` plus
  a `where` filter, which is the convention ladders exist to keep. It is sound ONLY because the ruling
  is premised on the catalog carrying exactly one blanker; a second one would make this line a
  quietly wrong price, with nothing failing loudly.
- **A ZERO module count with `back_box = Yes` FITS A 3M BOX — the STATE-A fallback (owner-locked).**
  A light point wired straight to an MCB carries no switch and no socket, so nothing fits any ladder and
  the box used to vanish with the plate; a light point still needs a junction box. A ladder may declare
  `on_zero_modules`, read ONLY on the zero-count path. **It is a module COUNT, never a catalog label** —
  the catalog still names the rung, so retiring a size needs no config edit. **The PLATE ladder must
  never declare it** (with nothing on it there is no plate), and **STATE B — `plate_item: "None"` with a
  NON-ZERO count — is OUT OF SCOPE and structurally unreachable**: `on_none: "computed"` already boxes
  those rows correctly, and a wider reading would DOWNGRADE a correctly-sized box. **It does NOT re-gate
  on `back_box`** — the component's own `qty: {if_attr: {back_box: "Yes"}}` already answers that, and
  asking twice would be two definitions of one rule.
- **WIRE INSTALL STEPS IN THREES; SUPPLY AND BCS STAY LINEAR (owner-locked).** The install multiplier is
  `ceil(runs / divisor)` — three runs is three times the WIRE but one unit of LABOUR. **The divisor is
  CONFIG, never hardcoded** (the `module_fit` `terms` precedent): a `component_ref` rate stage carries
  `mult_step_divisor`, a `scale` param carries `<ident>_step_divisor`, and BOTH go through the one shared
  `stepFactor` helper so they cannot drift. **ABSENT ⇒ the raw factor, byte-identical** — which is what
  keeps every un-stepped attachment (cable supply, termination supply, both BCS, point_wiring supply and
  BCS) exactly as it was. It never softens either site's existing no-compute rule and can never yield 0.
  **`ceil(n/3)` required NEW interpreter work**: the formula language has four operators (`+ - * /`) and
  NO function-call syntax, and every existing rounding rounds a product, never a factor.
- **⚠️ TERMINATION INSTALL INHERITS RUNS THROUGH `install_as_ratio` AND MUST NEVER CARRY ITS OWN
  MULTIPLIER (owner-locked).** `install_as_ratio` sits AFTER the supply `scale` and reads the
  already-runs-multiplied supply, so the inheritance IS the multiplier. Attaching a second one gives
  `runs x ceil(runs/3)` — the runs-SQUARED shape the ext-b ruling exists to prevent. Its ordering and its
  trailing `roundup(-1)` are equally load-bearing: moving `install_as_ratio` ahead of the supply scale
  would change WHERE the rounding lands, which is a second behavioural change. Leave all three alone.
- **A ZERO module count yields NO plate and NO blanks — but must NEVER kill the pipeline
  (owner-locked).** A light point wired straight to an MCB carries no switch, socket or plate, so
  the weighted sum is 0; that is a REAL and COMMON product, not a data error. **Wire and conduit are
  unrelated to module counts**, so refusing the whole pipeline discards a `circuit_fit` that already
  succeeded. A zero count marks EVERY ladder positively absent — the same `absentLadders` mechanism
  a `"None"` plate already uses — and the trace must SAY that nothing was fitted; silence would be
  worse than the refusal it replaced. A NEGATIVE or non-finite count, and a MALFORMED step declaring
  no terms at all, both stay honest no-computes: "declared nothing to count" is not the same
  statement as "counted to zero", and collapsing them lets a broken config report a priced row.
- **A ladder marked absent must still BIND the None sentinel (owner-locked).** A ladder bind may
  have no backing attribute (`@box_item`), so binding nothing leaves that `@` reference UNBOUND —
  and an unbound `@` reference aborts the whole row. Binding the sentinel is what lets a `none_skips`
  component zero its line instead. For the same reason a blank count binds an explicit 0 rather than
  nothing: a `{from_fit}` quantity that is absent is "not provided", which also aborts the row.
- **TAKE-THE-LARGER: the plate priced is the LARGER of the STATED and the COMPUTED module count
  (owner-locked; REPLACES the earlier stated-wins rule).** A ladder's `floor_from` names the attribute
  whose stated count is a **FLOOR, never a ceiling**: a stated plate too small for its contents is
  **UPGRADED** rather than refusing the row (a BoQ typo must not kill a line), and a stated plate
  bigger than needed is what gets bought. **An UPGRADE MUST ALWAYS BE VISIBLE in the derivation trace**
  — the BoQ said one size and we price another, which is the right call only while it cannot be missed.
  **Blanks derive from the plate ACTUALLY SELECTED and CLAMP AT ZERO** (never negative, never a
  refusal); the clamp is likewise named in the trace.
- **The BACK BOX takes the SELECTED plate's module COUNT, re-fitted on its OWN ladder — never the
  plate's LABEL (owner-locked).** The box ladder is SHORTER than the plate ladder (no 9M, no 16M), so a
  9M plate pairs with a **12M** box and a 16M plate with an **18M** box. Copying the label asks the
  catalog for a box that does not exist and makes the WHOLE ROW unpriceable — that was a live defect
  before slice 2 part 2. When the plate is `"None"` the plate line stays ZERO and only the BOX takes
  the computed count, which is why a box may exist with no face plate.
- **The plate / back-box relationship is ONE-WAY (owner-locked).** A face plate present DEFAULTS the box to
  yes; a face plate set to `"None"` must leave `back_box` **STILL SELECTABLE**, because a back box can exist
  with no face plate. `plate_item.disables_when_none` therefore lists **`plate_qty` ONLY** -- never `back_box`.
  Greying the box out makes such a row UNPRICEABLE, which is a wrong answer and not merely a wrong UI.
  The back_box component's `@plate_item` binding is SEPARATE and stays: **box module = the PLATE's module
  when a plate exists**; the no-plate fallback needs the module computation and is a later slice.

### Derived attributes and the computed circuit length

- **A COMPUTED ATTRIBUTE VALUE MUST REACH THE SELECTION, because `circuit_fit` and `resolveQty` read
  there and never consult `ctx` (owner-locked).** `circuit_fit` takes its length from
  `selected[length_attr]` and a component's `{from_attr}` quantity from `selected[qty.from_attr]`,
  while every other step writes into `ctx` — so a value computed the ordinary way cannot reach either
  one. `scale` cannot bridge it: it is a RATE scaler, needing an existing finite `ctx` rate as its
  target. The `derive_attribute` step crosses the gap by writing into a **run-local overlay copy of
  the selection**, so every existing read site sees it and **the caller's object is never mutated** —
  `value` must keep meaning "what the user or extraction supplied". **Do NOT instead teach the readers
  to fall back to `ctx`**: they are shared by all 13 categories, and a `ctx` key colliding with an
  attribute id would silently re-price a shipped row. A pipeline carrying no `derive_attribute` step
  is byte-identical.
- **A STATED circuit length ALWAYS WINS over a computed one — NO floor and NO warning (owner-locked).**
  This DELIBERATELY DIVERGES from the plate's take-the-larger: the larger does not win, the STATED one
  does, whether it is bigger or smaller than the computation, and nothing warns. A pricer typing 60 for
  a long run is simply right. Stated-wins is checked BEFORE the source attributes are read, so a row
  that states its length prices even when the input the rule would have used is unreadable.
- **A `derive_attribute`'s FORMULA, its SOURCE attributes and its TARGET attribute are all named in
  CONFIG, never hardcoded** (the `module_fit` `terms` precedent) — `15 + (N-1) x 5` is one category's
  rule. A missing / blank / non-numeric / `"None"` source is an HONEST NO-COMPUTE naming the attribute,
  never a zero and never a guess; domain limits stay with the reader that owns them (`circuit_fit`
  already refuses a non-positive length). The step publishes `StepTrace.derivedAttr` as STRUCTURED
  DATA with ONE reader (`derivedAttrOutcomes`) — the `moduleFit` precedent; never parse the trace prose
  and never re-derive the arithmetic. **Both its source attrs AND its `result_attr` are validator
  `_ref`-guarded**: a typo in the TARGET would silently stop it ever finding a stated value to defer
  to, which is quieter than a no-compute and worse.
- **`point_wiring`'s CIRCUIT LENGTH is COMPUTED from the point count, and a STATED length always wins
  with NO floor and NO warning (owner-locked).** `circuit_length_m = 15 + (points - 1) x 5` — 15 m is
  correct only for a single point. It is a `derive_attribute` step that must sit **FIRST in every
  pipeline**: `circuit_fit` reads `selected[length_attr]` and the wire components read the length
  through `resolveQty`'s `{from_attr}`, so one first-position step serves both and any later position
  makes `circuit_fit` refuse the row. **⚠️ `circuit_length_m` must NEVER carry an `extraction_defaults`
  entry** — an INJECTED value is a STATED value, so a default would win on every row forever and make
  the whole derivation inert while every test stayed green.
- **`points` is the number of points a LINE COVERS, never the number of such lines in the bill
  (owner-locked).** The sheet's own `qty` is INVERSELY shaped — one line covering seven points has
  `qty 1`, and twenty-nine single-point lines have `qty 29` — so reading `qty` as the point count
  inverts the correction on exactly the rows that matter most. It is EXTRACTED (the model reads it from
  the description under R9), never derived, and it is a plain `number`: a point count has no catalog
  domain, so `number_choice` would be wrong.
- **⚠️ ADDING A REQUIRED EXTRACTED ATTRIBUTE INVALIDATES EVERY PRE-EXISTING EXTRACTION OF THAT
  CATEGORY, so the ASSET APPLY and the RE-EXTRACTION ARE ONE ATOMIC OPERATION (owner-locked).** A
  stored run that predates the attribute carries it on NO row; it is a genuine input, so the
  missing-attribute gate blocks and the category prices NOTHING in the window between the two.
  **`extraction_defaults` does NOT rescue this** — defaults are injected at EXTRACTION time and baked
  into the stored result, never applied when reading an older run. This is the "atomic set" rule
  (already recorded for goldens) landing on the stored run. **Every test surface stays GREEN while the
  category prices 0** — goldens and unit tests supply their own attributes — so the editor-path row
  count over live data is the only gate that can see it.
- **A `derive_attribute`'s `result_attr` is the THIRD derivation mechanism `derivedAttrIds` must
  collect** (beside a `{from_fit}` superseded qty and a `module_fit` ladder bind), read FROM CONFIG and
  never by id. It behaves like the LADDER BIND, not the read-only blanker quantity: a stated value IS
  read and wins outright, so the field stays **EDITABLE** and `readOnly` is never set. **The gate
  NARROWS, it does not open** — a genuinely absent input, including the SOURCE attribute the formula
  reads, must still block.

### Goldens residence and where estimator rules are read from

- **Goldens live in the asset's TOP-LEVEL `goldens` dict, keyed by category_id, and NOWHERE ELSE.**
  `loader.load_rate_master` reads `payload["goldens"]` and OVERWRITES each config's `goldens` key from it, so
  a golden written into a `category_configs[*].goldens` entry is SILENTLY IGNORED. A golden added in-system
  via RM-4b but never written back into that top-level dict is DROPPED on the next `replace=True` import.
  **Verify an apply by comparing `stored == asset` KEY BY KEY, never by golden COUNT** -- a swap can leave the
  count identical while replacing the content.
- **Estimator rules are read from the DB, not the asset:** `extraction._load_active_configs` reads `BoQ Rate Category Config`, so editing `services/boq_rate_master/data/rate_master_*.json` is **INERT at runtime** until re-imported or applied via the audited RM-4b `update_rate_config`. The asset is the record; the config row is what the model reads.

## BoQ Rate Master (RM-1)

Backend rate-master for the pricing helper (the standalone estimation data behind cable/termination
rates). Full as-built lives in the plan doc + `.claude/context/domain/boq-backend.md`.


### Storage, ingest, and the admin editing endpoints (RM-1 / RM-4a / RM-4b)

- **Two committed doctypes hold it:** `BoQ Rate Master Item` — discipline-wide priced-item master,
  addressed by `(discipline, kind)`, with a keyed `attributes` JSON (matched EXACT) + a keyed `rates`
  JSON (the raw list/base rates); and `BoQ Rate Category Config` — per-`(discipline, category_id)`, the
  whole config as one JSON blob (attribute definitions + derivation pipelines + `normalization_rule`).
  **JSON fields, not child tables**, per the app's flexible/UI-driven-data rule. Both `track_changes: 1`;
  minimal controllers each declaring a composite read index (`[discipline, kind, brand]` /
  `[discipline, category_id]`) via `on_doctype_update`.
- **Canonical-UPPERCASE normalization at ingest (owner-locked):** the loader uppercases `material` /
  `insulation` on import so messy future workbook exports self-clean at the boundary; ALL downstream
  matching is EXACT on canonical values — there is NO case-insensitive matching anywhere.
- **Batch-provenance import, freeze-and-supersede:** every row of one import carries ONE `import_batch`
  (prefix `rmbulk-`), mirroring `BoQ Category Truth Snapshot`'s gtbulk provenance. A re-run against
  existing active data for a discipline REFUSES cleanly; `--replace` deactivates the prior batch
  (`active=0`, rows retained) and loads fresh — idempotent, no duplicate active rows. Import runs
  service-side (`services/boq_rate_master/loader.py`); RM-1 ships NO write endpoint. Reads are the
  login-required, active-only endpoints in `api/boq/rate_master.py` (`get_rate_master_items` /
  `get_rate_category_config`); the editors are RM-4a (SHIPPED — see below).
- **RM-4a editing endpoints (ADMIN-ONLY, owner option (a); full as-built in the plan doc's "Build slice
  RM-4a").** Four `@frappe.whitelist(methods=["POST"])` writes in `api/boq/rate_master.py`:
  `update_rate_config_param` / `update_rate_master_item` / `create_rate_master_item` /
  `deactivate_rate_master_item`. ALL gate on the IMPORTED `pricing._is_nirmaan_admin` (never a re-minted
  copy), admin gate BEFORE any target resolution or write (`frappe.PermissionError` otherwise). **The
  AUDITED write recipe is `doc.save(ignore_permissions=True, ignore_version=False)`** (get_doc → json.loads
  → mutate the parsed dict → json.dumps → save → commit): both doctypes are `track_changes:1` with
  DICT-valued JSON only (config/attributes/rates — no BoQ-Sheet-style list-valued field), so `doc.save` is
  safe AND records a `Version` diff. **`set_value` is FORBIDDEN for these edits — it bypasses the doc
  lifecycle, so it skips the Version audit.** The explicit `ignore_version=False` is load-bearing (Frappe
  defaults `ignore_version = frappe.flags.in_test`, so without it the audit Version is suppressed under
  `bench run-tests`). **PARAM VALUES ONLY** (numeric; the addressed `config.pipelines[id].steps[i].params` /
  `.conditions[j].params` path must ALREADY exist — adding/removing a param, editing conditions, or
  attribute definitions is RM-4b → validation error, no write). A manual `create` stamps provenance
  `import_batch="manual-"+hash` / `source_sheet="Manual entry"` / `source_row=0`; `deactivate` sets
  `active=0` (RETAINED, never deleted). Frontend HIDES every affordance for non-admins (`isRateMasterAdmin`;
  the server is authoritative). The first `Version` docs for the two rate-master doctypes now exist.
- **RM-4b structure editor (ADMIN-ONLY; full as-built in the plan doc's "Build slice RM-4b").** ONE
  `@frappe.whitelist(methods=["POST"])` write `update_rate_config(name, config)` in `api/boq/rate_master.py`
  LIFTS the RM-4a param-values-only boundary — add/remove params, steps, conditions, and attribute
  definitions. Admin-gated FIRST (`pricing._is_nirmaan_admin`), then FULL server-side STRUCTURAL VALIDATION
  (`_validate_config`) before the SAME audited `doc.save(ignore_version=False)` recipe; valid → write, invalid
  → a NAMED `ValidationError`, NO write. Validation: known step types ONLY (the 8-member interpreter
  vocabulary); every `params` a map of FINITE numbers; conditions are `{attribute: scalar}` EXACT-match
  predicates (**the ONLY shape the pure interpreter executes** — a `{in:[...]}` / `{gte/lt}` predicate OBJECT
  is REJECTED, since the interpreter would silently never match it and changing its semantics is OUT OF
  SCOPE); component_band bands are comparator strings; attribute_definitions well-formed; **a REFERENCE GUARD
  rejects removing a definition any pipeline condition/`band_on` references, naming every referencing
  location**; no unknown top-level keys; an identity guard forbids repointing discipline/category_id.
  **GOLDENS-AS-CONFIG-DATA:** the config carries a `goldens` array (attrs + expected finals per pipeline)
  seeded via ONE audited endpoint call; the vitest golden files stay INDEPENDENT pins. The frontend Pipelines
  tab's PREVIEW GATE computes the goldens against a draft before save (confirm-not-block). Interpreter
  EXECUTION semantics untouched. **The `test_rate_master` count is NOT recorded here — read it from
  `nirmaan_stack/api/boq/test_rate_master.py` itself.**
- **Multi-category import + scoped supersede (owner-locked; full detail in the plan doc's "Build slice
  EA-1").** A rate-master payload may carry a `category_configs` LIST (each config a `BoQ Rate Category
  Config` row, discipline stamped from the top-level payload, per-category goldens merged in as RM-4b
  config-data); `loader.load_rate_master` branches to `_load_multi` and the single-config path is
  unchanged. **Idempotency is SCOPED to the payload's item KINDS + config category_ids, NEVER the whole
  discipline (`_deactivate_scope`): a `replace=True` supersedes only that scope, so importing the
  non-wiring Electrical categories can NEVER deactivate a wiring (cable/termination, wiring_cabling) row —
  the WIRING-UNTOUCHED invariant.** Non-wiring Electrical categories are loaded by PATH from a separate
  asset. (HISTORICAL: this line used to add "`DEFAULT_DATA_FILE` stays the wiring asset" — that constant
  no longer exists, F-20; there is no default and **every** load names its file.)

### Interpreter step vocabulary

- **Interpreter step vocabulary (owner-locked, MINIMAL — no loose-formula generalization; the asset
  normalizes every formula to `base` = the step's target value + EXACT param names).** Beyond the wiring
  set, the pure `ratePipelineInterpreter.ts` supports: `component_band` STRING-EQUALITY bands (band_on read
  from the matched item, falling back to the selection) alongside the legacy numeric comparator bands; a
  `scale` value-from-attribute multiply (a `*_from_attr` param binds the selected attribute's value;
  missing/non-numeric → HONEST no-compute, never a zero default); `match_master_row` on the
  stored-vs-selected INTERSECTION (a row matches on the keys it carries, exact where they overlap — wiring,
  whose key sets coincide, is unchanged); and a conditional `component` (params resolved by attribute
  conditions on the selection, formula may be param-only — an unmatched condition is an HONEST no-compute).
  A conditional `component` may ALSO carry a `target` (base from the matched row) together with its
  conditions (e.g. the tray `cover`, `base*factor`) — this shape needed no interpreter change.
  **EA-2b — the CORRECTED cable-tray config is FOUR pipelines** (supply/install/bcs/bcs_install):
  conditional-component adders (cover / ceiling 106 / refill 180 / cutting 200) + an install rate read
  **OFF THE TRAY ROW ITSELF** (**SUPERSEDED at F-16 2026-08-13** — this was a width-table match into the
  parallel kind `tray_install_rate` ×4; see the F-16 invariant below). The old single `tray_boq` (install = supply ×0.2, golden 280/60)
  was WRONG and is DELETED; the regression-canary goldens t1/t2/t3 (431/120/297/0, 415/120/286, 410/200) are the pins,
  machine-verified (config-data preview gate + vitest + live Derivation), so the tray is OFF the manual
  verification list. **EA-2c — `component_ref` (a NEW step): base from a SEPARATELY-REFERENCED master row**
  matched by `ref.kind` AND every `ref.attributes` (exact canonical, this discipline). UNIQUE resolution:
  zero OR multiple matches is an HONEST no-compute (never zero-by-default, never pick-first); the referenced
  row's `target` binds as `base`, then conditions/params/formula per the component contract; the trace names
  the referenced row (`StepTrace.refItem`). It is a first-class vocabulary member (client STEP_VOCABULARY +
  server `_KNOWN_STEP_TYPES`/`_validate_config`). **Owner correction: the earthing adder ADDS A BUS BAR (the
  existing Bus bar earthing_item row), NOT an earth chamber** (the chamber attempt was reverted, asset v8
  skipped v7->v9). This is ONE ROW, TWO ROLES (requirement #7, shared items stored once): the Bus bar row
  prices both as a selectable item AND as the adder; an edit to it flows into both. **component_ref is the
  ASSEMBLY PRIMITIVE's simplest form.** **EA-4a SHIPPED the assembly engine (owner-locked):** two pure-TS
  shapes — `circuit_fit` (sizes conduit + counts circuits: `overall_dia = sum sqrt(sqmm/pi)*2*core`;
  `fitted_size` = smallest usable-dia >= dia; `circuits = ROUNDDOWN(usable/dia)`; `conduit_qty =
  ROUNDUP(length/circuits)`; binds into ctx) and **`component_ref` extended** (ref attrs literal | `@attr` |
  `@fitted_size`; `rate_stages [{mult,round?:up0|up-1}]` with PER-STAGE rounding; `qty` = number |
  `{from_attr}` | `{from_fit}` | `{if_attr,then,else}`; `value = staged_rate * qty`; UNIQUE resolution else
  honest no-compute; both obey Option-C never-throws). **PER-STAGE ROUNDING is INTENTIONAL and is the
  STANDING RULE** -- it ORIGINATED in the guiding sheet, retired 2026-08-19, and the behaviour is
  unchanged (install switch `ceil(list*0.3625)` THEN `*0.2` UNROUNDED — pw1 `155*0.2=31`, pw2 White
  `131*0.2=26.2`); do NOT collapse to one final round. **`point_wiring` is LIVE** (14 defs, 3 pipelines);
  goldens **pw1 1869/735/1370** + **pw2 1823/722.2/1342** (MS→3 circuits; the fractional 722.2 pins per-stage
  rounding) are config data AND standing pins — a golden's attrs are an ATOMIC SET. **A switch-only light
  point (socket_item null) is an HONEST NON-COMPUTE — the EA-4a-r acceptance case, not a defect** (EA-4a-r
  adds a `None` socket next). **The nine `extraction_defaults` (owner-locked):** a config default is INJECTED
  into the extraction prompt and, where the row text gives no positive identification, returned with moderate
  confidence AND stamped `defaulted:true` (raceway also carries a `text_override`); ABSENT => byte-identical.
  **`values_from` is resolved in BOTH surfaces** — `RateMasterDerivation` AND the editor helper
  (`pricingSheetHelper.attributeOptions`, options from the live master by kind+where) — so an AI-extracted
  item with no static `values` still DISPLAYS in the panel select and a partial row completes from the
  catalog. **EA-4a-r SHIPPED the NONE mechanism (owner-locked):** a composite component may be POSITIVELY
  ABSENT -- the sentinel string `"None"` (distinct from blank=unknown) makes that line an EXPLICIT ZERO
  (`export const NONE_SENTINEL`). Config: an attr def carries `allow_none` + `disables_when_none` (the dependent
  attr ids greyed/cleared when it is None -- e.g. plate_item -> [plate_qty, back_box]); a `component_ref` carries
  `none_skips` (a ref @attr resolving to "None" -> the component is 0, fired BEFORE the ref lookup, so
  `socket_item="None"` doesn't abort; back_box binds @plate_item so plate=None zeroes it too); `circuit_fit`
  carries `optional_wire_when_none` (that wire is omitted from the dia -> single-wire fit). **The None affordance
  is GENERIC + input-appropriate:** a CHOICE def offers "None" at the top of its select; a NUMBER def offers a
  "None" CHECKBOX beside the numeric input (checked -> sentinel + input greys/clears) -- both in the Derivation
  AND the editor panel. `coerceForMatch`/`_coerce_value` PRESERVE "None" for an allow_none def (number included).
  Extraction injects "None" as a valid value + a guidance line ("None when the bill names no such component;
  null only when too vague"); `extraction_none_guidance` may be a custom string OR a truthy flag. Goldens: **pw3**
  (switch-only, socket="None") -> supply **1682**; single-wire (wire2="None") -> **1362**. A switch-only light
  point (socket null, no None) stays honest no-compute until the None is set. **EA-4b SHIPPED switches_point +
  the industrial_sockets paired-MCB (DATA-ONLY -- NO interpreter change; every shape is existing vocabulary):**
  `switches_point` is a 6-line switch/socket/plate/box assembly (TWO None-able socket slots; distinct from
  point_wiring -- no circuit_fit/wires; golden sp1 2320/470/1600); `industrial_sockets` gained a `paired_mcb`
  `component_ref` that is CROSS-CATEGORY (ref.kind `db_switchgear_item`) + gated by a `qty if_attr` interlocked
  rule (`{item:"...Interlocked"}?0:1`), with **`extraction_defaults={paired_mcb:"None"}` the production fix** so a
  socket-only row prices instead of refusing (absent=unknown->no_match; "None"=positive-absence->0 line -- the
  EA-4a-r distinction, owner-locked). Tray ceiling-accessories are a CONFIRMED FIXED 106 scalar (do not make
  adjustable this era). **EA-4c SHIPPED the DB build-up + the `lookup_or_ratio` interpreter step (owner-ruled
  ONE new capability -- the IFERROR install, whose ORIGIN was the guiding sheet, retired 2026-08-19; the
  behaviour described here is the standing rule):** the build-up is FIVE FIXED None-able
  MCB slots (originally mirroring the sheet's I10:I14) + a `db_shell` slot (allow_none -- **MCB-only, shell None, is a REAL
  product = the sheet's former `IF(J9=0)` branch**, the same module pricing bare MCBs) + enclosure, summed x0.495
  (supply) / x0.3 (bcs); supply + bcs are EXISTING vocabulary (`component_ref none_skips` cross-kind to the NEW
  `db_shell` kind, `sum_components`, `scale`, `roundup`), so the earlier "variable-length list step +
  extraction-payload extension" prediction was WRONG -- the scalar one-attribute-set-per-row payload carries the
  fixed slots and needed NO extension. ⚠️ **SUPERSEDED AT F-17 (2026-08-13/14): the DB install is now a PLAIN
  RATIO — `scale` (m 0.20) + `roundup` (digits -1) — and `lookup_or_ratio` HAS NO SHIPPED CONSUMER.** The
  three-way description that follows is HISTORY; the step remains in the interpreter's vocabulary but no config
  executes it. **`lookup_or_ratio` was the sheet's EXACT IFERROR three-way install**
  (owner contract, do NOT improvise): (a) `when_shell_absent.attr=="None"` -> `ROUNDUP(ratio.of x ratio.mult)`
  [shell-absent]; (b) else the unique install-table lookup (`kind`+`item`==`@attr`) resolves -> `ROUNDUP(matched
  [target] x mult)` [table-hit]; (c) lookup MISS -> `ROUNDUP(ratio.of x ratio.mult)` [IFERROR fallback]. A ratio
  branch with an uncomputed `ratio.of` is an HONEST no_match; a malformed shape NEVER throws (Option C ->
  `unsupported`); the trace NAMES the branch. Pass-through in `rate_master._KNOWN_STEP_TYPES` (no deep
  validation; its `@db_shell_item` is reference-guarded via the supply `component_ref`s). Goldens dbu1 (VTPN
  fallback 24360/3660/14760) / dbu2 (TPN 8WAY table-hit install 1500) / dbu3 (MCB-only shell None 23840/3580/
  14450). **This CLOSES the assembly-category arc (point wiring, switches point, industrial-socket pairing, tray
  accessories [fixed], DB build-up all live).** A discarded v16b data-only attempt (shell REQUIRED, no
  none_skips) was reverted for this owner ruling.
  **EA-4d (owner-locked) supersedes the db_switchgear extraction + install-rounding invariants (asset v17,
  sha `c41ba8e7ce2e0b8b`):** (1) the DB SINGLE-ITEM path is REMOVED -- `db_boq`/`db_install_nondb`/
  `db_install_db`/`db_bcs` pipelines + the `family`/`item` attrs are GONE (they had NO sheet-cell basis; the
  whole guiding DB block IS the build-up). db_switchgear carries ONLY the 3 build-up pipelines; the 137
  `db_switchgear_item` master rows stay (the build-up slots reference them). (2) db_switchgear is the FIRST
  `matching_mode: "composite_decomposition"` category -- a GENERAL extraction mode driven ENTIRELY by
  `composite_slots` (shell / repeatable `{prefix,count,...}` -> enumerated slot attrs / fixed) +
  `decomposition_rules`, with NOTHING db-specific in `extraction.py`; **a second composite (switches_point /
  industrial sockets / future HVAC) opts in by config alone -- zero code change** (seam = `select_prompt_text`
  + `build_slot_spec`; prompt asset `prompts/boq_composite_decomposition_prompt.md`). Owner resolution rulings
  (in the prompt + `decomposition_rules`): CURVE BoQ-stated->UPS-context-D->default-C; AMP exact-or-NEXT-HIGHER
  (never lower), range takes highest; PARTIAL pricing (un-cataloguable components -- ATS, standalone bus bar,
  weatherproof enclosure, module-flexi shell, bespoke DB -- left out, never a wrong pick; whole-row no-match ->
  all null). (3) `lookup_or_ratio` now honors `round_lookup` (table-hit) + `round_ratio` (ratio branches)
  SEPARATELY; v17 sets `round_lookup: null` (table-hit UNROUNDED `VLOOKUP*1.5`, sheet-faithful BY ORIGIN -- the
  sheet was retired 2026-08-19 and the behaviour stands) + `round_ratio:
  -1`; the legacy single `round` stays the fallback for both. Goldens: dbu1 fallback 24360/3660/14760, dbu2
  table-hit 1500, **dbu4 TPN-6WAY table-hit install 1275 UNROUNDED** (the fix; the EA-4c 1280 was the drift);
  d1/d2 removed.
  **A functional config with a RED preview gate is exactly what the gate exists to surface -- even when the miss
  is in the golden, not the pipeline (two i1 golden defects caught + fixed by regenerated assets at EA-4b).**
  **The wiring + point_wiring + switches_sockets goldens are the standing regression pins (`switches_point` was RETIRED 2026-08-08 and its `sp1` golden went with it); the wiring-asset
  invariant sha is `645a81d6841254e4` (2026-08-09, the install step function -- was `76e09bba0d7affa1` at ext-b 2026-08-05, and `dcc9b2ea69f072bb` before that; the owner ACCEPTED each break. The earlier `c10509…` was a stale carry-error).** The Rate Master category selector is
  REGISTRY-driven (`rateMasterRegistry.ts`), not config-read. The pricing-sheet helper stays wiring-only
  and shows its category coming-soon note for other categories (honest no-compute). A `scale` step whose
  TARGET RATE is missing (`null`/`NaN`) SKIPS that output (renders absent, never invented as 0) while the
  pipeline's other outputs still compute — the HONEST-PARTIAL rule (a source row with supply but no install,
  or vice-versa, prices only what exists).

### The guiding-sheet authority rule, and retirement by declaration

- **RETIRED 2026-08-19 -- THE GUIDING-SHEET AUTHORITY RULE.** A standing law (2026-07-29) required a
  rate-master category to have a block on the **ALL ITEM WISE RATE** sheet before it could get
  FINALIZED rules; no block meant no rules. The owner RETIRED it with the sheet on 2026-08-19.
  **NOTHING replaces it: a category needs no external authority to get finalised rules.**
  **Corollary:** where the guiding block carries its rates DIRECTLY, the block IS the table (no background-sheet dependency) — **miscellaneous** is the first such
  case (its items carry `boq_supply`/`boq_install` that ARE the BoQ rates; `misc_boq` is direct factor 1.0,
  `misc_bcs` = `boq*0.8` with install 0). The EA-1 "UPS" decode was a misread **Floor BOX** block: UPS is
  removed (excluded-by-ruling) and **popup_boxes** is the corrected decode (per-module, the
  value-from-attribute shape). A category may be committed DATA-ONLY (empty `pipelines: {}` — attribute
  definitions + items, no derivation) when its ruleset is not yet authored; **lighting_mgmt_system** is the
  first, to be authored in-system later (the loader + all four surfaces + the preview gate tolerate empty
  pipelines honestly — no derivation output, no crash). **EA-2 SHIPPED the in-system authoring path:**
  `_validate_config` now ACCEPTS empty `pipelines: {}` (a non-empty pipelines object is still fully
  validated), and the RM-4b Pipelines tab has an **Add-pipeline affordance** (id + output keys -> a
  validator-minimal `{output, [match_master_row]}` via `blankPipeline`, then edited via AddStep).
  `_KNOWN_CONFIG_KEYS` also gained FOUR pass-through keys (`identity_attribute_id`, `matching_mode`,
  `notes`, `pipeline_labels`) stored VERBATIM and NOT structurally validated (like `item_kinds`) —
  REQUIRED because RM-4b resubmits the whole config, so an item-identity config (or the wiring
  `pipeline_labels` edit) would otherwise be rejected as an unknown key.
- **Retired-scope supersede (loader, owner-locked).** A multi-config payload may declare `retired_kinds` /
  `retired_category_ids` — kinds/categories dropped from THIS payload that a `replace=True` must ALSO
  deactivate (a second scoped-supersede beyond the payload's own kinds/categories), so a retired
  kind/category left active from a prior batch (e.g. ups after the Floor BOX correction) is superseded rather
  than left orphan-active. Freeze-and-supersede (rows retained), logged in the load summary; the
  wiring-untouched invariant is unaffected.
- **⚠️ A CATEGORY IS RETIRED VIA `retired_category_ids`, NEVER BY OMISSION FROM AN ASSET (owner-locked).**
  `_load_multi` computes its supersede scope from the PAYLOAD, so a category simply DROPPED from the
  asset is never touched by a `replace=True` and stays **ORPHAN-ACTIVE** — still `active = 1`, still
  served by every active-only reader, while the asset that is supposed to define it no longer mentions
  it. Naming it in `retired_category_ids` is the only thing that deactivates it. **There is NO delete
  path** — not in the loader, not in any admin write endpoint (the item-level one is even named
  `deactivate_…` and RETAINS the row); the whole module is freeze-and-supersede, so "delete this
  category" always means "retire it", and a hard delete would be a manual DB operation outside every
  audited path.
- **The Rate Master category picker is REGISTRY-driven, not config-driven, so a retired category must
  leave `rateMasterRegistry.ts` in the SAME change.** The list the picker renders comes from the
  registry; retiring the config alone leaves the category on offer and renders
  "No active config found for …" when it is chosen.

### The asset is exported from the database

- **⚠️ THE ASSET IS EXPORTED FROM THE DATABASE — `services/boq_rate_master/exporter.py`
  (owner-locked).** The DB is the source of truth and the asset is BOOTSTRAP-AND-SNAPSHOT only.
  Running the export is what keeps a re-import safe: the file provably matches the DB, so a load can
  only replay what is already there. `build_asset(discipline)` returns the dict `_load_multi`
  consumes; `serialize_asset` is the ONE serialisation (`indent=1`, `ensure_ascii=False`, **no
  `sort_keys`** — ordering is deterministic by construction and re-sorting would reorder the verbatim
  blobs). **Two exports of an unchanged database are BYTE-IDENTICAL** — nothing in the payload is a
  timestamp, a batch id or a hash.
- **⭐ CONFIG BLOBS ARE EMITTED VERBATIM — never enumerate keys, never rebuild, never filter
  (owner-locked).** No two configs share a key set, 15 keys have NO screen control and 8 reach the AI
  prompt, so a fixed-schema export would silently drop the 21st key the day someone adds one — and
  `_validate_config`'s allowlist has already had to widen six times, so that day comes. `attributes`
  and `rates` are emitted whole for the same reason. Pinned by a test that plants a key nothing in the
  codebase knows about and proves it survives export AND re-import.
- **WHAT THE EXPORT EMITS AND DROPS.** Per item, exactly 7 keys in order: `kind`, `brand`, `unit`,
  `attributes`, `rates`, `source`, `item_uid` — ⚠️ `source` MUST be a dict on every item or
  `_validate_items` throws. Top level: `discipline`, `items`, `category_configs`, `goldens`,
  `source_workbook`, `retired_kinds`, `retired_category_ids`, and (F-19) `retirement_reasons`.
  **NEVER emitted:** `name`,
  `import_batch`, `creation`, `modified`, `owner`, `active` — row identity regenerates on every
  import by design, which is exactly why `item_uid` exists and IS emitted. **Deliberately dropped as
  archaeology (owner-ruled, do NOT preserve or merge from the previous file):** `sha256_prefix`,
  `extracted_at`, `provenance`, `excluded_categories`, `slice_note`, `merged_from`, and `source.col`
  on the 27 db_shell items.
- **⚠️ RETIREMENT COMES FROM THE TABLE, NEVER A FILE HEADER.** `retired_kinds` /
  `retired_category_ids` are read through `retirement.get_retirement_lists`. A discipline with no
  retirement rows exports two EMPTY lists — inheriting a header would make a fresh discipline claim
  retirements it never made.
- **⚠️ REMOVING ITEMS FROM AN ASSET DOES NOT DEACTIVATE THEM — `retired_kinds` is the ONLY mechanism,
  and the list is ADDED to, never replaced (owner-locked, F-16 2026-08-13).** `_load_multi` computes
  its supersede scope from the PAYLOAD's OWN kinds, so a kind merely dropped from an asset is never
  named by `_deactivate_scope` and its rows stay **ORPHAN-ACTIVE** — still served by every active-only
  reader, while the asset meant to define them no longer mentions them. This is the kind-level twin of
  the category rule above, and it is SELF-SUSTAINING once declared: the exporter rebuilds the list from
  the retirement TABLE, so every later export carries it. **Replacing rather than appending would
  silently UN-RETIRE an existing entry.** The retirement row is minted with a BLANK reason — see F-19.

### The parallel-row pattern (F-16 / F-17)

- **✅ THE PARALLEL-ROW PATTERN IS CLOSED (F-16 + F-17). The governing principle STANDS AS DESIGN LAW
  for every future kind: adding ONE item must never require a second, hidden row for that item to price
  completely.** The census was EXHAUSTIVE and both instances are now fixed — `tray_install_rate` (F-16,
  moved on-row) and `db_install_rate` (F-17, replaced by a ratio). `popup_box_module` remains a
  rate-table row by the boundary test but carries **both** rates on its one row — NO ACTION.
- **db_switchgear INSTALL IS A PLAIN RATIO OF THE CALCULATED SUPPLY (owner-locked, F-17):**
  `ROUNDUP(supply x 0.20, -1)` for **all 27 shells**, where `supply` is the WHOLE assembly
  (shell + 5 MCB slots + enclosure, x0.495). It replaced `lookup_or_ratio`'s 8-row `db_install_rate`
  table (x1.5, 8 shells) and 0.15 fallback (19 shells). **A flat per-shell figure could not see the
  MCBs — that is the whole point.** A DELIBERATE REPRICING that moves **both ways**: on a bare shell
  install rises on 21 and **falls on 6** (table-path shells whose flat figure exceeded 20% of a bare
  supply); loaded with four MCBs it rises on all 27.
  **⚠️ THE STEP IS `scale` + `roundup`, NOT A TRIMMED `lookup_or_ratio` — and the alternative was
  MEASURED, not assumed.** Deleting only the step's `lookup` key is **FATAL**: the interpreter reads
  `s.lookup.item` unconditionally, so Option-C degrades the pipeline to `unsupported` and **every DB
  install blanks**. Keeping the step with `ratio.mult 0.20` is numerically identical but leaves a
  dangling reference to a retired kind and a trace saying *"table miss"* about a table that no longer
  exists. `round_ratio: -1` is retained as BEHAVIOUR by the explicit `roundup` step.
  **`lookup_or_ratio` now has NO shipped consumer** — it stays in the interpreter vocabulary, executed
  by nothing (a fact, not a problem; a substring search still finds it in `db_switchgear`'s `notes`,
  which is archaeology and is meant to stay — assert over STEP TYPES, never over serialized config).
- **A `db_shell` PRICE AND A `db_switchgear_item` PRICE FOR THE SAME PRODUCT NAME ARE DIFFERENT ROWS IN
  DIFFERENT CATALOGS (F-17 / Finding B).** The v30 merge deduplicated **`db_switchgear_item`** and
  completed correctly; the 12,133 that survived afterwards was the **`db_shell`** catalog's own row for
  the same product — a different kind with a different rate key (`shell_rate` vs `list_price`), never
  part of that dedup. The "the merge missed a twin" framing was a **MISREAD**. Owner ruling (F-17 R1):
  the shell adopts **12,881**, the higher figure, for safety — **a new pricing decision, not a repair.**
  26 of the 27 shells have no `db_switchgear_item` counterpart at all, so "these two numbers differ" is
  not by itself evidence of a defect.
- **A CATEGORY'S INSTALL RATE BELONGS ON THE ITEM ROW, NOT IN A PARALLEL RATE TABLE (owner-locked,
  F-16).** Governing principle: **adding ONE item must never require a second, hidden row for that item
  to price completely.** Cable tray's install was a second `match_master_row` into `tray_install_rate`
  ×4, so a width absent from those 10 rows priced supply, skipped install and warned about nothing.
  Each `cable_tray` row now carries an `install_rate` holding the FINAL effective per-metre figure (the
  ×4 **baked in — never multiply it again**), read verbatim off the row the supply match already found;
  the kind is retired and `item_kinds` is `["cable_tray"]`. **A ratio was REJECTED FOR TRAY ON
  MEASUREMENT** (implied ratio spans 0.1083–1.3077 across all real combinations, a 1107% spread) — do
  not propose one. The parallel-row census is EXHAUSTIVE: exactly TWO instances existed,
  `tray_install_rate` (silent no-compute, fixed here) and `db_install_rate` (fails safe to a 0.15
  ratio; **fixed at F-17**); `popup_box_module` is a rate-table row by the boundary test but carries both
  rates on its one row — NO ACTION. Boundary test: *could the referenced row plausibly appear on a BoQ line?*

### Export fidelity, the mint gate, snapshots, and the export endpoint

- **⚠️ `source_row` IS ALWAYS EMITTED, INCLUDING 0.** The 27 db_shell items hold `source_row = 0` in
  the database and 0 is what the database says; omitting it to reproduce the old asset's absent `row`
  would be the export inventing an absence, and it would conflate a genuine row 0 with "no row" —
  which matters because `create_rate_master_item` stamps `source_row = 0` on every manually created
  item. It is also the option with no special case, so byte-stability comes for free.
- **⚠️ A RE-EXPORT LEGITIMATELY DIFFERS FROM THE PREVIOUS ASSET IN TWO WAYS, AND NEITHER IS A
  DEFECT.** Verbatim blobs GAIN `discipline` on 11 configs and `goldens` on `switches_sockets`,
  because the loader stamps both at ingest and the export reproduces what is stored. Expect exactly
  that; anything else is a real difference and must be classified.
- **⚠️ THE MINT GATE CANNOT VALIDATE THIS EXPORT.** Its atom vocabulary is `kind:<k>` — blind below
  the kind level (it missed a dropped item in slice 1 and a per-item key in slice 2). Run it (#187),
  but **the ROUND TRIP is the real gate**: export, load into a scratch discipline, compare axis by
  axis including `item_uid` and the retirement entries.
- **`BoQ Rate Master Snapshot` retains every export — KEEP THE NEWEST 10 PER DISCIPLINE
  (owner-ruled), pruned on write.** `payload` is **Long Text, not JSON**, deliberately: a snapshot
  exists to be RESTORED, so byte-fidelity of the stored text is the point and Frappe must never
  hydrate and re-serialise it — which also sidesteps the list-valued-JSON wall that forces
  `Pricing Workbook Version`'s prune to use a raw `frappe.db.delete`. `version` is `(max existing) + 1`
  and is **never reused after a prune**, so a version number identifies one snapshot for the life of
  the site. `track_changes: 0` — a snapshot is already immutable evidence.
- **⚠️ THE EXPORT ENDPOINT IS ADMIN-GATED, UNLIKE THE SHAPE IT CLONES.**
  `rate_master.export_rate_master_asset` copies `export_priced_workbook`'s
  `{filename, content_type, content_base64}` download shape but **NOT its bare login-only gate** — it
  uses the existing `_require_rate_admin` (`pricing._is_nirmaan_admin`), because an export hands over
  the whole priced catalog. **A web request cannot write into the repo and nothing tries**; the file
  is returned for download and retained as a snapshot, and committing it stays a human act.

### BoQ Rate Master Retirement - the retirement table

- **⚠️ RETIREMENT STATE LIVES IN `BoQ Rate Master Retirement`, BECAUSE IT CANNOT BE DERIVED
  (owner-locked).** One row per retired thing: `discipline` + `scope_type` (`kind` | `category`) +
  `scope_value`, with OPTIONAL `retired_at` / `retired_by` / `reason`. `retired_kinds` and
  `retired_category_ids` are the ONLY two loader inputs consumed to drive behaviour and never
  persisted — the whole effect is `active = 0`, which is **INDISTINGUISHABLE from an ordinary
  supersede** — so an export built from rows alone would drop them silently.
- **⚠️ THE DERIVATION "a kind/category with rows but none active" WAS MEASURED, MATCHED, AND
  REJECTED.** It matches the known entries exactly on a populated database and is still unusable: it
  returns **EMPTY on a fresh bootstrap database**, so the lists would vanish in precisely the case the
  asset exists to serve. It is also coupled to history retention (archiving superseded rows would
  silently shrink it) and cannot tell "deliberately retired" from "happens to have no active rows just
  now". Do not reintroduce it.
- **⚠️ PAYLOAD IS THE INSTRUCTION, TABLE IS THE RECORD.** `_load_multi` records a retirement as a
  SIDE EFFECT of a payload declaring one (`retirement.record_retirements`, riding the loader's single
  commit). **The table is NEVER read to drive deactivation** — `_deactivate_scope` still takes its
  scope from the payload alone, and mixing the two would change import semantics. Pinned by a negative
  test: a retirement recorded for a kind the payload does NOT retire must leave that kind active.
- **⚠️ THE HAZARD THIS GUARDS IS REACHABLE, and it is `switches_point`.** Its config still exists in
  the `v22` asset ON DISK: load v22, then load an export that has lost `retired_category_ids`, and it
  stays **ORPHAN-ACTIVE** — active in the database, absent from the asset meant to define it. Three of
  the four retired things cannot be re-activated by any asset on disk; that one can, with two commands.
  Separately, the mint gate treats these lists as its **ONLY machine-readable retirement declaration**
  (`retkind:` / `retcat:` atoms), so losing them makes every FUTURE retirement surface as an
  undeclared, unexplained loss.
- **⚠️ UNIQUENESS IS STRUCTURAL, NOT CHECKED.** `autoname` is
  `format:{discipline}::{scope_type}::{scope_value}`, so the tuple IS the primary key and a duplicate
  is a PK collision rather than a validation that could race or be skipped (the deterministic-PK
  precedent the pricing lock already sets). **No unique index and no duplicate-checking validate hook
  is needed, and none exists.** ⚠️ A PK violation ABORTS the postgres transaction, so any test probing
  it must wrap the probe in a savepoint or every later statement in that transaction fails.
- **⚠️ PROVENANCE IS DELIBERATELY EMPTY ON BACKFILLED ROWS.** The loader never recorded when, by whom
  or why; the only signal is a batch `creation` timestamp, which is approximate. **A field asserting a
  precision it does not have is worse than an empty one** — never back-infer `retired_at` /
  `retired_by`.
- **⚠️ KNOWN GAP (not fixed): the SINGULAR-config loader path ignores the retirement lists entirely.**
  `retired_kinds` / `retired_category_ids` are read only inside `_load_multi`; `load_rate_master`'s
  singular `category_config` branch never reads them and therefore never records them. No shipped
  asset takes that branch, but the gap is real and is pinned by an assertion in the cert.

### item_uid - the stable item identity, and its backfill

- **⚠️ `item_uid` IS THE STABLE ITEM IDENTITY, AND `name` STRUCTURALLY CANNOT SERVE (owner-locked).**
  `BoQ Rate Master Item.item_uid` (`Data`, `search_index`) is the durable handle a CSV round trip
  (download -> edit -> upload) matches on — "matched ids replace, blank ids add" is undefined without
  it, and content matching turns every rename into a silent duplicate. **`name` cannot be reused for
  this:** every import INSERTS fresh documents, and freeze-and-supersede **RETAINS** the superseded
  row, so its `name` stays OCCUPIED — a new row reusing it is a primary-key collision. A separate
  field has no such constraint, and **MANY ROWS SHARING ONE UID IS THE POINT**: every historical
  version of an item can carry the same uid.
- **⚠️ THE UID IS STAMPED, NEVER CONTENT-DERIVED (owner-locked).** Form: `rmi-` + 12 lowercase hex
  (16 chars — opaque, prefix-consistent with the module's `rmbulk-` / `manual-` provenance prefixes,
  and short enough to sit in a CSV cell). **A content hash is EXCLUDED and the reason is decisive:**
  the id would CHANGE when an attribute is edited, so an edited row would return carrying a different
  id, be read as an insert, and leave the original active — a silent duplicate on every rename, which
  is the exact failure the uid exists to prevent.
- **⚠️ THE UID IS NOT UNIQUE ON THIS TABLE — do NOT add a UNIQUE constraint.** It is unique only among
  `active = 1` rows; superseded rows legitimately share a uid with their successor, and that sharing is
  what would make history traceable. The field carries a **plain btree `search_index` only**. A partial
  unique index over `active = 1` is possible but is NOT applied.
- **⚠️ THE BACKFILL IS ACTIVE-ROWS-ONLY, AND HISTORY IS DELIBERATELY EXCLUDED (owner-locked).** A
  superseded row has **no reliable key to its successor** — the only handle is content, and content is
  exactly what changes between versions, so a historical backfill could only ever be approximate.
  `scripts/backfill_rate_master_item_uid.py` is a one-off maintenance script (NOT a patch — it seeds
  data, it does not migrate structure), it is idempotent, and it **REFUSES and writes nothing unless
  every active row pairs to EXACTLY ONE asset item** on `(kind, brand, attributes)`. **`brand` is
  load-bearing in that tuple**: several `lms_item` pairs are identical on `(kind, attributes)` and
  differ only by brand, at materially different prices, so pairing without it mis-assigns their uids.
  **The asset and the DB are stamped in the same run with the same value**, so a re-import reproduces
  the identity rather than minting a new one; the loader carries `item_uid` through at both insert
  sites exactly as it carries `brand`/`unit`. A legacy asset carrying no uid still loads, with the
  field left BLANK — never a fabricated value.

### The CSV round trip - upsert, preview, and the interim config procedure

- **⚠️ THE CSV UPLOAD UPSERT IS UID-KEYED, AND ABSENT ITEMS ARE LEFT UNTOUCHED (owner-locked).**
  `services/boq_rate_master/csv_importer.py` reads back the CSV `csv_exporter` emits: a row whose
  `item_uid` MATCHES an active item **REPLACES** it, a row with a **BLANK** `item_uid` is **ADDED**
  with a freshly minted uid, and **an active item ABSENT from the file is LEFT UNTOUCHED**. That last
  is the safety property of the whole feature — a partial upload can never delete anything. A uid
  present in the file but matching NO active item is an **ERROR named in the preview**, never an
  insert: it means a stale file or a hand-typed id, and inserting it would mint the silent duplicate
  `item_uid` exists to prevent. **⚠️ THE UPLOAD MUST NEVER BE ROUTED THROUGH `loader.py`** — a
  `replace=True` supersedes an entire SCOPE (every active row whose KIND is in the payload) and would
  wipe every item the file omitted. **Freeze-and-supersede is intact and is what makes "replace"
  safe:** a matched row is not mutated in place; its document is flipped `active = 0` (RETAINED) and a
  NEW document is inserted carrying the SAME uid. The only difference from the loader is the SCOPE of
  the supersede — matched UIDS, not payload KINDS — which is precisely why absent items cannot be
  touched. The MODE (`category` vs the `category`-column-bearing `all`) is INFORMATIONAL: items carry
  no category, so the upsert is mode-independent and both shapes give the same result.
- **⚠️ THE UPLOAD IS TWO STEPS, AND A SNAPSHOT IS WRITTEN BEFORE ANY WRITE (owner-locked).**
  `preview_rate_master_csv` is READ-ONLY (it opens no transaction and is safe to run against live
  data); `apply_rate_master_csv` is the only writer and **RE-BUILDS the plan from the live catalog**
  rather than trusting anything posted back, so a doctored plan cannot be applied. The preview's
  `digest` fingerprints the decision AND the rows it was computed from, and a stale one is REFUSED —
  the honest answer when the catalog moved between the two steps; an unrelated edit elsewhere is
  deliberately NOT in the fingerprint. The apply takes a slice-4 **SNAPSHOT FIRST, in the SAME
  transaction** — that is the rollback path, and `apply_plan` never commits, so the endpoint's single
  `frappe.db.commit()` makes the whole thing ALL-OR-NOTHING: a malformed row rejects the WHOLE file,
  and the snapshot can never exist for an upload that did not land. A plan with nothing to apply
  writes no snapshot (nothing to roll back to, and it would evict a real one from the keep-10).
- **⚠️ THE PREVIEW IS THE DEFENCE AGAINST EXCEL, AND NOTHING IS SILENTLY REPAIRED (owner-locked).**
  Expanded by default: **every new item, and every rate move of 10% or more IN EITHER DIRECTION**
  (₹26,100 for ₹2,610 is invisible in a count; ₹261 for ₹2,610 quotes catastrophically low — so the
  threshold is on the ABSOLUTE move). A move a percentage cannot describe — a rate appearing,
  disappearing, or leaving zero — counts as major too. Everything else collapses behind a count and is
  one click from open: **collapsing is about attention, not access.** Changed-ness is decided by
  comparing the value that WOULD BE STORED against the value that IS stored, **type-strictly**
  (`json.dumps`, so a stored `2.0` and a typed `2` are told apart), never by comparing display text —
  which is what stops a mangled value slipping through as "unchanged". A value we cannot read
  (`1,234.50`, a currency symbol) is REJECTED BY NAME rather than "helpfully" fixed. **A blank cell
  means "empty or absent", and where the stored value is ALREADY empty or absent nothing changes** —
  which is what makes an unedited download/upload round trip a genuine no-op; a cleared ATTRIBUTE is
  REMOVED (attributes have no live null convention) while a cleared RATE becomes `None` (they do).
- **⚠️ THE UPLOAD'S ATTRIBUTE SPACE IS DECLARED ∪ OBSERVED, UNLIKE THE RM-4a ITEM ENDPOINTS.** Three
  live keys (`family`, `location`, `pricing_mode`) are carried by real items and declared by NO
  config, so a declared-only space would reject a faithful round trip of those rows;
  `update_rate_master_item` / `create_rate_master_item` validate against the declared set alone and
  would indeed refuse them. Measured: the attribute and rate key spaces are DISJOINT, and a name in
  both is refused outright — the export emits ONE column per name, so the FILE would be ambiguous and
  an import cannot repair an export that cannot represent the data.
- **⚠️ INTERIM CONFIG PROCEDURE (owner ruling 2026-08-13, until a config authoring surface exists):**
  a config change is made by **exporting the asset, editing it, and reloading it**. **STANDING RULE:
  NEVER LOAD AN ASSET THAT WAS NOT EXPORTED MINUTES EARLIER.** A load is `replace=True` and supersedes
  everything in scope, so a stale file wipes every change made since it was exported; and any asset
  older than the `item_uid` slice carries no `item_uid`, so loading one would BLANK every id — which
  breaks the CSV round trip outright, since a blank uid reads as "add this item".

### One Electrical asset - the merge, its rulings, and the benchmark

- **⚠️ A TEST IS UPDATED TO MATCH A RULING, NEVER A RULING TO MATCH A TEST (owner-locked).** An
  asset-pinned test that disagrees with the live asset is asserting the shape a ruling REPLACED — i.e.
  a defect — so the assertion moves and carries an INLINE COMMENT naming the ruling it now encodes and
  why the old shape was wrong. **A test that silently changed its mind is worse than a stale one.**
  Corollary: **every current-asset pin in `test_rate_master.py` reads the ONE module-level
  `CURRENT_EALL_ASSET` constant.** Pins that are DELIBERATELY historical (`cls.eall`, the two v17 reads,
  and `LEGACY_WIRING_ASSET`) name their version explicitly and must NOT follow it — `LEGACY_WIRING_ASSET`
  in particular is the ONLY coverage the discipline-wide `_deactivate_prior` path has, because that path
  is reachable only through the SINGULAR `category_config` key.
- **⚠️ THERE IS ONE ELECTRICAL ASSET, AND THE SPLIT THAT PRECEDED IT WAS A LIVE HAZARD (merged
  2026-08-13, owner ruling).** The ONE merged Electrical asset — **named by `CURRENT_EALL_ASSET` in
  `nirmaan_stack/api/boq/test_rate_master.py`, the one authoritative pin** — carries every Electrical
  item and every category config, wiring included; **read the counts from the asset that constant
  names, never from here.** The two-asset split was **SEQUENCING, NOT DESIGN** — wiring was built
  first as a trial — and it must not be reintroduced "for safety". **THE REASON IT HAD TO GO: the two
  assets took DIFFERENT loader paths with DIFFERENT supersede semantics.** The wiring asset carried the
  **SINGULAR `category_config`** key, which routes to `load_rate_master`'s single-config path, whose
  `_deactivate_prior` runs `UPDATE "tabBoQ Rate Master Item" SET active = 0 WHERE discipline = %s AND
  active = 1` — **DISCIPLINE-WIDE**. Importing wiring with `replace=True` therefore deactivated **every
  E-ALL item**, and the live catalog survived only on an **undocumented ordering rule** (wiring first,
  E-ALL second). The batch timeline records it happening on 2026-08-09: E-ALL 22:20:33, wiring 22:20:43
  wiping it, E-ALL re-loaded 22:21:20 to repair. **The merged asset uses the LIST form, so it takes
  `_load_multi`'s SCOPED supersede and the discipline-wide `UPDATE` is never reached.** The singular
  path still EXISTS in the loader and is still dangerous — it is simply no longer reachable from a
  shipped asset, and `test_24b`'s negative half pins that (`category_config` must be ABSENT).
- **⚠️ `rate_master_wiring_cabling_v3.json` STAYS ON DISK — do NOT delete it.** It is a mint-gate
  **self-test operand** (`scripts/mint_completeness_check.py`, `do_history(WIRING)`, T4 — the wiring
  asset is the only one-filename-many-commits asset, so it is the ONLY thing that exercises the history
  walk), and it is the singular-shape fixture the ~30 single-config loader tests still need
  (`test_rate_master.LEGACY_WIRING_ASSET`). It is a **retired artefact, not a live asset.**
- **ONE ITEM WAS DROPPED AT THE MERGE, BY OWNER RULING (2026-08-13), AND NO DELETE PATH WAS ADDED.**
  `db_switchgear_item` / `TPN FLEXI DB 4 ROW 14M (DOUBLE DOOR IP 43)` existed **twice** with two prices;
  the **12,881 copy (source row 17) is KEPT**, the **12,133 copy (source row 14) is DROPPED**. It is
  simply **absent from the asset** and is superseded naturally on import — this module has never had a
  delete and the merge did not introduce one. The dropped copy is therefore absent from the asset's
  item count — **read that count from the asset `CURRENT_EALL_ASSET` names, never from here.** ⚠️ **The
  mint gate CANNOT see this**: its item vocabulary is `kind:<k>`, so a dropped *individual item* is
  below its resolution and it reported "No atoms disappeared". An `intentional_removals` entry is
  therefore inapplicable — the gate never emits an atom string for it.
- **Goldens at the merge:** wiring's five (`g1`–`g5`) are carried **BOTH** on the config **and** in the
  top-level `goldens` dict — which is what **9 of the 11** pre-existing E-ALL configs already do.
  `_load_multi` lets the top-level entry win and the two agree exactly, so `test_72`'s equality half
  holds. ⚠️ **`CLAUDE.md`'s "top-level and NOWHERE ELSE" wording is STRONGER than the code**: the
  overwrite fires **only when the top-level dict has an entry for that category**, so a config-level
  copy with no top-level twin survives untouched. Code is authoritative.
- **`wiring_cabling` deliberately carries NO `item_kinds`.** Its kinds derive from the pipelines'
  `match_master_row` (`cable`, `termination`) and the derivation is byte-equal to a declared list, so
  adding one is behaviour-neutral — but it would make the stored config differ from the live DB for no
  gain. Left absent; `test_24b` pins both the absence and the derivation.
- **Benchmark data -- CORRECTED 2026-08-19. PRODUCTION is the authority for item rates.** Deployment
  Mode made production the source of truth: **v41** adopted production cable prices (2026-08-18) and
  **v43** adopted production asset wholesale (2026-08-19). The committed asset is the one
  **`CURRENT_EALL_ASSET`** names in `nirmaan_stack/api/boq/test_rate_master.py` -- read it there,
  never from here. HISTORICAL: this entry used to name the **28-Jul benchmark workbook**
  (`rate_master_wiring_cabling_v3.json`) as the reference going forward, superseding the earlier
  25-Jul reference; **its content now lives inside the merged asset** (above). A refresh is still a
  `replace=True` re-import of a new asset (freeze-and-supersede: the prior `rmbulk-` batch goes
  inactive, rows retained).

### F-20 - no default asset; the version pin, the filename shape, the bootstrap ground

- **✅ F-20 — CLOSED (2026-08-14). THERE IS NO DEFAULT ASSET, AND A SOURCE-LESS LOAD REFUSES BY NAME.**
  `loader.DEFAULT_DATA_FILE` is **DELETED**. It named a FIXED filename, so it went stale on every mint:
  it still pointed at **v30** after F-16 shipped v31, and a path-less `load_rate_master(replace=True)`
  would have **silently reverted the WHOLE v30 scope** (12 categories, 15 kinds) — re-activating the 10
  retired `tray_install_rate` rows and stripping `install_rate` from all 450 trays — **while reporting a
  successful load**. Note the shape: it was a **scope-wide REVERT through the SCOPED multi path**, never
  a catalog wipe. **The danger was the INVITATION, not the traffic:** nothing in the repo ever opened it
  (all 68 callers pass `payload=`, `path=` was passed by nobody, and no hook / patch / fixture / migrate
  step / CI job / endpoint could reach it — strictly human-invoked), but an optional argument documented
  as *"defaults to the committed data asset"* reads like a safe convenience. `_load_payload` now refuses
  when BOTH inputs are absent, with a message that **teaches** — it names the two valid call shapes,
  warns that a file must have been exported minutes earlier because a load is a supersede, and points at
  the admin export endpoint. **The "reload BY EXPLICIT PATH" interim rule is RETIRED — the loader
  enforces it now.** ⚠️ The export endpoint still emits a differently-named file
  (`rate_master_electrical_v5.json`) from the on-disk lineage (`..._all_v<N>.json`); the two names never
  converge on their own, which is exactly why a load must always name its file.
- **⚠️ ONE AUTHORITATIVE VERSION PIN: `CURRENT_EALL_ASSET` (in `api/boq/test_rate_master.py`).** The
  loader now carries none, and the F-20 sweep fixed the third one
  (`scripts/backfill_rate_master_item_uid.py`, v30 → v31). **Any new file naming an asset version must
  justify itself against this line** — three independent pins had already drifted apart once.
- **⚠️ THE E-ALL ASSET FILENAME SHAPE IS LOAD-BEARING — A RENAME IS INVISIBLE, NOT LOUD.**
  `scripts/mint_completeness_check.py` compiles the series regex
  `^rate_master_electrical_all_v(\d+)([a-z]*)\.json$` and `uninspectable_versions()` matches **every
  file in the data directory** against it to derive which mints cannot be inspected. A file named
  outside that shape — an environment marker such as `..._dev_v43.json`, a discipline rename, any
  decoration — **does not match, so the gate never sees it**: the series appears to stop at the last
  conforming file, and that mint plus every later one silently drops out of the census. Nothing
  fails; the report is simply wrong. **A proposal to re-shape these filenames must change the regex
  in the same edit, or be declined.** Declined once already, on 2026-08-19, when a dev/prod
  environment-marker convention was proposed and the conventional name was kept instead.
- **⚠️ A VERSION MAY BE LEGITIMATELY ABSENT FROM THIS REPO, AND THE GATE IS RIGHT TO SAY SO.**
  PRODUCTION mints into the same numeric series (a rate re-entry there is exported and adopted here —
  v41 and v43 both originate in production's database, not in a dev mint), so a version production
  minted and dev never received is **genuinely uninspectable** and belongs in that report. Do NOT
  "close the gap" by renumbering an adopted asset to fill the hole: the number would then name a file
  whose content is not what production called by that name, which is worse than an honest absence.
- **⚠️ THE BOOTSTRAP GROUND (measured by the F-20 recon; do not re-derive it).** The
  *empty-check + explicit-force* contract **ALREADY EXISTS** one layer down: `_load_multi` counts the
  active scope and **refuses a non-replace load over a populated scope**, so `replace=False` IS the
  empty check and `replace=True` IS the force. A future bootstrap command is therefore a **WRAPPER, not
  a new guarantee.** And a fresh site can only bootstrap from the **REPO asset** — there is no database
  to export from — so **the committed asset's currency is a CORRECTNESS property, not housekeeping.**
  This qualifies the "the on-disk file is stale but harmless while the DATABASE is the source of truth"
  framing: true for an established site, **false for a new one**. The mint-and-bump-the-pin discipline
  applies to every future change that moves the catalog.

- **⚠️ A PRODUCTION DATA REFRESH CAN ROLL THE DEV DATABASE *BELOW* ITS OWN COMMITTED EXPORT
  (measured 2026-08-19/20; the restore is recorded in the plan doc).** The bullet above qualifies the
  "stale but harmless" framing for a NEW site. This is the third case, and the one that actually
  happened: on an ESTABLISHED dev site, refreshing the data from production replaced the whole
  rate-master scope with production's, which sat at **v43** - one mint BEHIND the asset dev had itself
  exported and committed as **v44**. The asset was not stale; it was AHEAD, and the database - the
  source of truth - was the thing that had regressed. **The runtime reads configs from the DATABASE, so
  every behaviour v44 shipped silently reverted while the repo still claimed v44 and
  `CURRENT_EALL_ASSET` still named it.** Nothing failed loudly: the app ran, priced, and looked
  correct.
- **WHAT MAKES IT DETECTABLE, AND WHAT DOES NOT.** `track_changes` is useless here - a refresh restores
  rows wholesale rather than editing them, so **zero `Version` rows** are written and an audit shows an
  untouched catalogue. The reliable instrument is the one the export already gives you: run
  `exporter.export_asset_text(discipline)` and compare its sha256 against the committed asset. Two
  exports of an unchanged database are byte-identical, so a mismatch is proof and a match is proof.
  Uniform `modified` timestamps across every config plus a single import batch corroborate a
  wholesale restore rather than a human edit.
- **THE RESTORE IS AN ORDINARY LOAD, NOT A DEPLOYMENT.** Re-loading the committed asset by explicit
  path with `replace=True` is the fix, and it is exactly the standing procedure - the file was exported
  from this same database, so the load can only replay what was already there. Back the live scope up
  to a file first, and re-verify the pre-load sha against the version you believe you are on rather
  than trusting an earlier recon: if it does not match, something moved in between and the load must
  not run. **Production is not touched by any of this** - it is the source the refresh came from, and
  it stays on its own version.
- **THE DB-READING TESTS ARE THE PROOF, AND ONLY THEY CAN FAIL.** A suite that reads the ASSET FILE
  cannot see this class of regression at all - it passes throughout, because the file was never wrong.
  Only the tests that read live DB values go red (here: the two switches_sockets / point_wiring golden
  tests), which makes the before-and-after suite run the honest instrument for a restore: capture the
  failures BEFORE loading, and require exactly those to turn green after.

### F-21 - the 10% major-change boundary

- **✅ F-21 — CLOSED (2026-08-14). THE ≥10% "MAJOR" BOUNDARY ROUNDS BEFORE COMPARING, AND THE
  THRESHOLD HAS EXACTLY ONE DEFINITION.** `_rate_change_pct` is `(new - old) / abs(old) * 100.0`, and
  `abs(pct) >= 10.0` turned binary rounding error into a wrong answer whenever the result landed a
  hair **SHORT**: an exactly −10% edit computed `−9.999999999999993` and was classified **not major**,
  folding the row behind a count. Measured on integer rupee rates 1..20000: **11,999 of 20,000 (60%)
  downward, 0 of 20,000 upward** — `×1.10` lands a hair ABOVE, where the error is harmless against a
  `>=` test, so it bit only in the direction that **quotes LOW**. Now
  **`round(abs(pct), 6) >= MAJOR_RATE_CHANGE_PCT`** — six decimals is far finer than any real rate
  move and far coarser than float noise (~1e-14), and it is the module's own idiom (the same value is
  rounded one line below for display). **Never restore the bare comparison**; the docstring's "AT OR
  ABOVE" is inclusive and this is what makes it true.
- **⚠️ THE THRESHOLD LIVED IN TWO PLACES, AND THEY DISAGREED ON SCREEN (F-21, the finding).**
  `RateMasterUploadDialog.tsx` decided the percentage's COLOUR from its own `Math.abs(f.pct) >= 10`,
  reading the **ROUNDED** percentage while the server classified from the raw one. At the boundary a
  row therefore rendered **RED while sitting COLLAPSED** — "big move" and "not worth showing", about
  the same row. **The server now emits `major` PER RATE FIELD beside `pct`; the change-level flag
  stays "any rate field major" and still drives grouping; the dialog RENDERS the flag and computes
  nothing.** Non-rate fields carry **no** verdict — a percentage, and therefore the verdict, is
  meaningless on a `kind` rename or an attribute edit. The module's doctrine (*"a second client-side
  copy of the 10% rule would be free to disagree with the write that actually happens"*) was an
  ASPIRATION until this slice; it is now enforced by the payload. **The digest is unaffected and that
  is PROVEN** — `_digest` fingerprints `(row, kind, uid, name, (column, old, new))`, so a display
  addition cannot invalidate an in-flight preview.
- **⚠️ `_picks_measurable_at_ten_percent` IS NOW VALUE HYGIENE, NOT A WORKAROUND.** F-16 added it to
  route around the F-21 boundary; with F-21 fixed its live-behaviour half is inert (every non-zero row
  qualifies). It is KEPT because the **zero exclusion** is still load-bearing — `×1.05` leaves a zero
  UNCHANGED, so such a row never reaches `plan["changes"]` and the lookup would `KeyError`, and its
  percentage would divide by zero. The `>= 10.0` comparisons inside it are a FIXTURE FILTER and must
  not be read as the product's rule.

### F-19 - retirement reasons

- **✅ F-19 — CLOSED (2026-08-14). A RETIREMENT CAN CARRY THE REASON IT HAPPENED.** The asset gains
  ONE optional top-level key — **`retirement_reasons: {"kinds": {…}, "categories": {…}}`** — read by
  the loader and stored on the minted row. **TWO sub-maps, not one flat map:** a kind and a category
  can share a name, which is exactly why `retired_kinds` / `retired_category_ids` are two lists, and
  a flat map would reintroduce that ambiguity. `retirement.reason_map` is the ONE place that knows
  the shape. **The entries themselves stay PLAIN STRINGS and must** — `_deactivate_scope`
  interpolates them straight into SQL, so an object-shaped entry is a broken query, not a style
  choice.
- **⚠️ A REASONLESS RETIREMENT IS LEGAL AND RECORDS BLANK (F-19 R2).** Refusing one would have been
  tidier and was REJECTED: every asset up to and including v32 declares retirements and carries no
  reasons, so the shipped catalog would have stopped loading — the trap class F-20 removed. The lever
  against forgetting is VISIBILITY, not refusal: the load summary reports
  **`retirements_without_reason`**.
- **⚠️ A REASON NAMING SOMETHING THE PAYLOAD DOES NOT RETIRE REFUSES BY NAME (F-19 R3).** The map
  **ANNOTATES** a declaration; it must never **MAKE** one. `retired_kinds` stays the single
  instruction — the standing *payload is the instruction, table is the record* rule — and without the
  refusal a typo'd key would sit in the asset looking effective while doing nothing.
- **⚠️ THE EXPORT EMITS `reason` ONLY — NEVER `retired_at` / `retired_by` (F-19 R4).** A timestamp in
  the payload would break the two-consecutive-exports-are-byte-identical guarantee the moment two
  exports straddled a new retirement, and `retired_by` would record an actor the table never
  observed. A reason is authored text: stable, and the half worth self-documenting. Both sub-maps are
  emitted **sorted**; a blank reason contributes nothing, so a discipline with none exports two empty
  maps.
- **⚠️ AN EXISTING RETIREMENT ROW IS NEVER UPDATED, NOT EVEN TO ADD A REASON (F-19 R5).**
  `record_retirements` SKIPS an entry that already exists — that skip is what makes a re-load safe —
  so it is **structurally unable** to fill a row minted blank. Turning it into an upsert would trade
  a load-safety guarantee for two historical fields. The two rows F-16 and F-17 minted blank were
  filled by the one-off **`scripts/backfill_retirement_reasons.py`** (dry-run default, idempotent),
  from text recorded verbatim in commits `77f54f4f` and `6e0af13a`. **That is copying recorded fact,
  not inventing history:** the original refusal is about BACK-INFERENCE and still stands where it
  bites — `retired_at` would timestamp the LOAD rather than the decision, and `retired_by` would name
  an actor the table never saw, so **neither is ever written**.
- **OPTION C IS RETIRED GOING FORWARD.** F-16 and F-17 put their reason in the commit body because
  the channel did not exist. It does now: a future retirement declares its reason **in the asset**,
  and the commit body is a copy rather than the only record.

### RMF-1 - the deployment freeze

- **⚠️ THE DEPLOYMENT FREEZE GUARDS THE **WRITE SUBSET ONLY**, AND MUST NEVER BE FOLDED INTO
  `_require_rate_admin` (owner-locked, R3 2026-08-18).** That gate covers **NINE** endpoints, **THREE
  of which are READS** — `export_rate_master_asset`, `export_rate_master_csv`,
  `preview_rate_master_csv`. **THE EXPORT IS THE ACTION THE FREEZE EXISTS TO PROTECT**: Deployment
  Mode is freeze-*then*-export, so a freeze that blocked the export would make the feature
  self-defeating — and silently, because the export button and the upload button sit in the SAME
  dashed panel on the Rate Master screen. Guarding the shared admin gate is the one refactor that
  must never happen here, however tidy it looks. `build_plan` stays unguarded for the same reason
  (the preview shares it). Pinned by `test_rmf_04` (reads succeed while frozen) and `test_rmf_14`
  (the guard is absent from `_require_rate_admin` and from each read).
- **⚠️ A RATE-MASTER GUARD MUST BE APPLIED TWICE, BECAUSE `csv_importer` BYPASSES `doc.save`
  (owner-locked).** Two independent write mechanisms reach the catalog: the audited
  `doc.save(ignore_permissions=True, ignore_version=False)` endpoints in `api/boq/rate_master.py`,
  and `services/boq_rate_master/csv_importer.apply_plan`, which is freeze-and-supersede via **RAW
  SQL** plus fresh inserts and never touches `doc.save` at all. **A guard placed only on the audited
  path misses the entire CSV upload — the largest blast radius in the module**, and the exact shape of
  the 2026-08-18 incident. The predicate therefore lives in `services/boq_rate_master/freeze.py`, not
  in `api/`: `csv_importer` is a service and may not import from `api/` (the
  `services/boq_bcs/readiness.py` precedent). ONE definition, two call sites, pinned by identity in
  `test_rmf_13`. A controller-level `validate` guard is NOT a substitute — it would miss the raw-SQL
  supersede in both `csv_importer` and `loader`.
- **⚠️ THE FREEZE IS WRITTEN THROUGH `doc.save`, NEVER `frappe.db.set_single_value` (owner-locked).**
  `set_single_value` is a raw UPDATE: it bypasses the doc lifecycle and writes **NO `Version` row**.
  That audit is the ONLY thing that makes owner ruling R6 safe — **any admin may lift any other
  admin's freeze**, with no check on who set it, and the record of who lifted it is what makes
  granting that safe. The live `frozen_by` / `frozen_at` fields say who SET the current freeze; the
  Version log is the only place a LIFT is attributable. `ignore_version=False` is EXPLICIT because
  Frappe defaults it to `frappe.flags.in_test`, which would suppress the audit under exactly the test
  runner that asserts it. **Lifting is MANUAL ONLY** — no expiry, no timeout, no automatic lift on
  deploy; there is deliberately no staleness concept anywhere in the module. Re-freezing an
  already-frozen catalog is a **no-op that preserves `frozen_at`**, because the banner renders it as
  ELAPSED time and a second click would otherwise silently restart the clock.
- **⚠️ THE FREEZE COVERS THE APP SURFACE AND **NOT** FRAPPE DESK OR THE GENERIC REST API — AN ACCEPTED
  OWNER DECISION OF 2026-08-18, NOT AN OVERSIGHT.** The doctype permissions on the rate-master
  doctypes grant write to **`System Manager`** (30 users at the time of the ruling, of whom **22 are
  NOT rate-master admins**), while every app gate resolves `Nirmaan Users.role_profile ==
  "Nirmaan Admin Profile"` (7 users) — so Desk and `/api/resource/...` bypass the freeze entirely.
  **Do NOT "close the gap"** by changing doctype permissions or adding a controller guard: both were
  considered and ruled out. A future reader must not read this as a defect.
- **⚠️ THE FREEZE STATE READ FAILS *OPEN*, DELIBERATELY REVERSING THE `ai_settings` CONVENTION.** An
  absent doctype (pre-migrate) or a transient error reads as **NOT frozen**, so the feature is INERT
  on such a database — byte-identical to pre-freeze, the standing preference for a new gate. Failing
  CLOSED would refuse every rate-master write while displaying a message naming a deployment nobody is
  doing. `ai_settings.get_boq_ai_settings` fails closed because there inaction is the safe outcome;
  here **inaction IS the block**, so the safe direction reverses. ⚠️ `tabSingles` values are **TEXT**,
  so the reader uses `cint`, never `bool` — `bool("0")` is `True`.

### F-18 - no non-finite number is ever labelled ok

- **✅ F-18 — CLOSED (2026-08-14). NO NON-FINITE NUMBER IS EVER LABELLED `"ok"`, AND THE THREE-PART
  CONTRACT IS NOW STATED (owner-locked).** `status: "ok"` used to mean only *"the step loop ran to the
  end without an early return and without throwing"* — it made **no claim about the numbers**, while
  every consumer reads it as *"these numbers are good"*. It now means: **(1)** a missing rate on a row
  we DID match **REFUSES** (`no_match`); **(2)** an output that could not be computed is **ABSENT,
  never zero and never NaN**; **(3)** an **`undefined` final remains the honest-partial contract** and
  is untouched. The guards copy `component_ref`'s existing idiom — its check AND its message shape —
  so this adds no concept, only its missing applications.
- **⚠️ F-18 WAS FIVE ENTRY POINTS, NOT ONE — a fix framed around the identifier guard could not have
  covered it.** `component` and `component_band` bound `undefined` past `evalFormula`'s `in` test
  (which checks KEY PRESENCE: `"base" in { base: undefined }` is TRUE); **`apply_effective_multiplier`
  multiplies OUTSIDE the formula**, so no evaluator guard was ever on its path; `roundup` turned
  `roundUp(undefined, d)` into NaN; and **`install_as_ratio` did not FAIL into NaN, it ASSIGNED one**
  (`const base = supplyKey ? ctx[supplyKey] : NaN`). `sum_components` was the propagator, never an
  origin.
- **⚠️ `roundup` IS AN HONEST PARTIAL, NOT A REFUSAL — THE ONE DELIBERATE ASYMMETRY (owner-locked).**
  The absence it reads is almost never its own fault: an upstream `scale` that honestly declined to
  write its result leaves exactly that hole, and refusing would discard a SIBLING output that computed
  correctly (`conduit_boq`'s `supply_per_mtr` is right even when `install_per_mtr` was never
  produced) — the over-wide action the PW-FIX ruling reversed for `module_fit`. **This kills the
  conduit_boq / conduit_bcs asymmetry: the same missing key used to give an honest partial in one and
  a NaN in the other, so absence-honesty depended on which step happened to come NEXT.** The four
  guards that DO refuse (`component`, `component_band`, `apply_effective_multiplier`,
  `install_as_ratio`) refuse because their value feeds `sum_components` — losing it makes the SUM
  wrong, not merely shorter, which is why `component_ref` has always refused in the same situation.
- **⚠️ THE TAIL BACKSTOP'S PREDICATE IS `typeof v === "number" && !Number.isFinite(v)` — A NUMBER THAT
  IS NOT FINITE, NEVER A MISSING VALUE (owner-locked).** It is the only mechanism that does not depend
  on config being well-formed (**the loader does not validate; only `update_rate_config` does**), so a
  bad value reaching `stageRate` is caught here. **A backstop written as "no non-value may pass with
  ok" would BREAK the four live `miscellaneous` CEIG / AS Built honest partials while fixing nothing
  that was ever broken.** Absent means *"this row has no such rate"*; NaN means *"we computed
  nonsense"* — never collapse them.
- **⚠️ `applyRate`'s MISSING FINITENESS CHECK IS A KNOWN, DELIBERATELY DEFERRED HARDENING (F-18 R6).**
  `PricingGrid.applyRate` would write `String(NaN)` into a draft rate cell if any caller reached it;
  today the ONLY thing stopping that is `RateHelperPanel`'s `Number.isFinite` on the override input,
  which disables "Use this value" — a guard that exists to reject a user typing nonsense and catches
  this by coincidence. Post-F-18 no NaN can leave the interpreter as `ok`, so the gap is closed at
  source rather than in depth. Do NOT treat the absence of a second check as evidence it is unneeded.

### The 29-Jul truth-file cycle, and estimator rules

- **29-Jul truth-file cycle (EA-DIFF, owner-locked; the E-ALL benchmark of THAT cycle was
  `rate_master_electrical_all_v12.json` — for the CURRENT asset read `CURRENT_EALL_ASSET` in
  `nirmaan_stack/api/boq/test_rate_master.py`, the one authoritative pin; asset lineage v9->v12,
  v10/v11 skipped. ⚠️ This line has twice carried a stale version + sha256 prefix — write NEITHER
  here; the pin is the only place a version belongs):** four
  data changes + two owner-ruled invariants. (1) **Synonyms** — a config may carry top-level `synonyms`
  `{attr_id:{variant:canonical}}` (conduit `{conduit_type:{GI:MS}}`); consumed TWICE (defence in depth) — the
  extraction prompt INJECTION (`extraction._extract_batch`, `.md` assets untouched) AND `_coerce_value`
  variant->canonical mapping BEFORE the allowed-values check. ABSENT => byte-identical. (2) **GI conduit rows
  EXCLUDED** (`conduit_type` now [PVC,MS]); a GI row prices at MS via the synonym. (3) **point_wiring** — a
  DATA-ONLY category (`pipelines:{}`, `item_kinds:[]`) with a banked EA-4 regression canary `1869/735/2604` in
  `config.notes`; it is the FIRST kind-less category. (4) **DB install three-way split** (db_switchgear): kind
  `db_install_rate` + pipelines `db_install_db` (DB-family, scale x1.5) / `db_install_nondb` (switchgear+enclosure,
  15% of BoQ supply). ⚠️ **HISTORICAL — BOTH PIPELINES WERE DELETED AT EA-4d** (the DB single-item path had no
  sheet-cell basis; the whole guiding DB block IS the build-up), **and the `db_install_rate` KIND ITSELF WAS
  RETIRED AT F-17.** Kept only for the reasoning below, which is still live: **`scale` binds only top-level
  `params`, so conditional params require `component`** (the interpreter's `scale` does NOT bind `conditions`,
  only `component` / `apply_effective_multiplier` do; a `scale`+conditions ships an unbound identifier that
  throws). Do not read this entry as describing anything that ships. (5) **Interpreter robustness (Option C, owner scope-add):** `runPipeline`'s "never throws on data
  shape" contract is ENFORCED — a data-shape formula throw (unbound identifier / malformed) DEGRADES to the honest
  `unsupported` status, page + helper NEVER hit the error boundary. The Data-Viewer **empty-scope** rule
  (`rateMasterStructure.isCategoryDataScopeEmpty`): a kind-less category renders an honest empty state (0 rows,
  note, no Add-row), NEVER the discipline-wide all-items list; LMS (declares `item_kinds`) is unchanged.
- **Estimator `rules` (EA-4 ext-a, owner-authored config data; full as-built + the four rules verbatim in
  the plan doc's "Build slice EA-4 ext-a"):** a category config may carry a top-level `rules` array
  (`{id, label, applies_to, guidance}`) of OWNER-AUTHORED estimator guidance. It is a `_KNOWN_CONFIG_KEYS`
  pass-through key, read into the extraction context **UNGATED** (unlike `slot_spec` /
  `decomposition_rules`, which are composite-only — R7 lands on `cabletray_raceway`, an ordinary
  attribute category) and injected as an `ESTIMATOR_RULES` prompt block beside SYNONYMS / DEFAULTS.
  **NO interpreter change; absent key => byte-identical prompt.** The guidance text is the contract —
  it is passed through VERBATIM and nothing in the app rewords it. Rendered read-only on the Derivation
  tab, with an explicit "No rules configured for this category." empty state (that tab had no
  empty-state precedent). Live: `db_switchgear` R2/R3/R4, `cabletray_raceway` R7.

### Runs, cores, and item matching

- **Cable RUNS and CORES are SEPARATE and are NEVER multiplied together (owner-locked).**
  `wiring_cabling` carries BOTH a `runs` and a `core` attribute, each defaulting to **1** via
  `extraction_defaults`. **The core count IDENTIFIES the cable in the catalog; the run count
  MULTIPLIES its price** — collapsing them would match the wrong cable. This is the OPPOSITE of
  `point_wiring`, which records runs INTO its wire-core value (`wire1_core`/`wire2_core`, labelled
  "Wire N - runs (Core)", both defaulting to 1): point wiring is single-core in the ordinary case, so
  a stated run count IS the core value and a line stating both records the PRODUCT. **Two categories,
  two deliberately opposite rules — do not "harmonise" them.**
- **All four wiring pipelines multiply by runs, at FIVE points not six (owner-locked).** A `scale`
  step carrying `runs_from_attr` (existing vocabulary; precedent `popup_boxes`
  `module_count_from_attr`) attaches AFTER each output's `roundup`, so runs multiplies a ROUNDED
  per-unit rate: `cable_boq` supply + install, `termination_boq` **supply ONLY**, `cable_bcs`,
  `termination_bcs`. **⚠️ `termination_boq` install is NOT multiplied — `install_as_ratio` derives it
  from the already-multiplied supply, so a second multiplier would make install runs-SQUARED.** The
  supply multiplier MUST stay BEFORE `install_as_ratio` for that inheritance to hold. `cable_boq`
  install IS multiplied because it scales the raw `install_base_per_mtr`, not supply.
- **A golden's attrs are an ATOMIC SET — a new attribute must be added to every stored golden.**
  Introducing `runs` made all five wiring goldens no-compute (`attribute 'runs' missing or
  non-numeric` — the interpreter's honest no-compute) until each golden's `attrs` gained `runs: 1`;
  the expected VALUES are untouched, since the goldens are invariant at runs=1 by construction.
  ⚠️ **CORRECTED by the owner ruling of 2026-08-19: multi-run goldens (runs > 1) ARE banked from
  our own interpreter.** A golden is a REGRESSION CANARY -- a snapshot of what the system currently
  produces, whose job is to answer "did this config edit change something I did not intend". It must
  be STABLE, not CORRECT, so re-banking one from our own interpreter is CORRECT rather than circular.
  This REVERSES the earlier rule, which said such a value was OWED from the owner and must NOT be
  computed from our own code because the guiding sheet carried no runs concept; that premise went
  when the sheet was retired.
- **`rules` remains an UNGATED `_KNOWN_CONFIG_KEYS` pass-through** reaching every category regardless
  of `matching_mode`; an absent/empty array yields a byte-identical prompt. Rule text is owner-authored
  and passes through VERBATIM — nothing in the app rewords it.
- **point_wiring records RUNS and CORES SEPARATELY, and they are NEVER multiplied together
  (owner-locked).** `wire1_runs`/`wire2_runs` are per-WIRE attributes, each defaulting to 1 beside
  `wire1_core`/`wire2_core`. **CORES is the CATALOG MATCH KEY** (the `ref.core` binding), **RUNS drives
  the conduit GEOMETRY and the WIRE RATE.** One attribute serving both purposes is exactly what broke
  the previous rule: folding runs into cores wrote a core count with no catalog row behind it, and the
  row stopped computing. ⚠️ This is the OPPOSITE of `wiring_cabling`, where runs and cores are also
  separate but the core count is itself a match key with no geometry — do not unify the two categories.
- **`circuit_fit`'s third `wire_spec` element is OPTIONAL and ABSENT MEANS 1.** A wire spec is
  `[core_attr, thickness_attr]` or `[core_attr, thickness_attr, runs_attr]`; the dia sum becomes
  `sqrt(sqmm/PI) * 2 * cores * runs`. Absence must never change behaviour — every pre-existing config
  carries 2-tuples, so a non-optional third element would break all of them on ship. The same
  absent-means-1 rule governs a rate stage's optional `mult_from_attr`, which folds its attribute in
  BEFORE that stage's rounding (`x runs then round`). **This DELIBERATELY DIVERGES from `scale`'s
  `<ident>_from_attr`, which hard-fails to an honest no-compute** — a run count is a multiplier whose
  neutral element is 1, not a missing measurement. Both sites share one helper so they cannot drift.
- **CONDUIT is runs-aware through the GEOMETRY ALONE and must never carry a second runs multiplier.**
  `conduit_qty` derives from `circuits`, which derives from the runs-scaled diameter. Adding a
  multiplier to the conduit component would charge runs-squared. Switch, socket, plate and back box
  never multiply by runs at all.
- **ITEM MATCHING IS STRICT IDENTITY, so a dropdown over a NUMERIC catalog column needs the
  numeric choice type (`number_choice`), NEVER a plain `choice` (owner-locked).** `matchMasterRow`
  compares with `===`, so a `choice` emits the string `"3"` against a stored `3` and matches
  NOTHING -- silently, and with no error. Making the matcher numeric-aware was REJECTED: it changes
  how every category matches every attribute and its failure mode is a WRONG match, a price that
  looks right and is not. The type is contained by construction -- a config that does not carry it
  is byte-unaffected. `coerceForMatch` (the ONE place an attribute value becomes a match key) lives
  in `rateMasterStructure.ts`; the two type axes are `isNumericAttributeType` /
  `isDropdownAttributeType`, one definition each, read by BOTH rendering surfaces.
- **AN ATTRIBUTE VALUE IS COERCED IN MORE THAN ONE PLACE, AND A NEW TYPE MUST BE TAUGHT TO EVERY
  ONE (owner-locked).** The two that decide whether a value survives are the FRONTEND match path
  (`rateMasterStructure.coerceForMatch`, value -> catalog match key) and the SERVER EXTRACTION path
  (`extraction._coerce_value`, model reply -> stored value); the config validator and the Derivation
  form carry the same type knowledge. **`number_choice` compares NUMERICALLY at every site, never by
  string** — its domain is resolved from the catalog and is therefore FLOATS, so a string comparison
  can never match and silently discards every correct answer. Membership is still ENFORCED: like
  with like, not no check at all. This has now been missed TWICE (the frontend twin, then the
  server); **when you touch a coercion, sweep the whole stack — both halves — before believing the
  list is complete.**
- **THE GOLDENS BYPASS `coerceForMatch` ENTIRELY, so a coercion change must be proven through the
  PRICING-EDITOR path as well.** Goldens call `runPipeline` with values directly; a coercion that
  matches nothing leaves every golden green while the editor prices nothing. Measured once already:
  the naive flip took point_wiring from pricing most of its rows to pricing none, with all goldens
  green throughout. The editor-path count is a GATE, not a formality.
- **A category's dropdown domain is the family ITS OWN component refs pin, not the union across
  families (owner-locked).** `values_from.where` on a `point_wiring` wire attribute pins
  copper/unarmoured because that is what its component refs price; offering the cross-family union
  would put values on screen with no catalog row behind them. **The resulting domain need not be
  rectangular** -- core x thickness offers pairs the catalog does not carry, which is an honest
  no-match; constraining one dropdown by another's selection is the dependent-`where` mechanism
  cables are deferred for and is deliberately NOT built.
- **POINT WIRING CARRIES THREE CONDUCTORS -- phase, neutral and earth -- so the run counts across
  wire 1 and wire 2 sum to three unless the line explicitly states otherwise (owner-locked, R9).**
  A closing sentence naming an earth wire describes a conductor already counted, not an extra one.
  A number before a size is a RUN count, never a core count; wire 2 is recorded only where the line
  describes two distinct wires, and is `"None"` otherwise -- which is why `wire2_thickness_sqmm`
  must keep `allow_none` + its `disables_when_none` targets.

### Config validation, wholesale replace, and mint comparison

- **`_validate_config` must not be stricter than the interpreter (EA-4 ext-a).** Three shapes the
  interpreter explicitly executes are valid config and must stay accepted: a `component` with **no
  `params`** (a conditional component carries them per-condition), a `component` with **no `target`**
  (a param-only formula reads no price off the matched row; present-but-blank is still an error), and a
  **`*_from_attr` param holding a STRING** (an attribute-id binding — scoped to that suffix ONLY; any
  other param carrying a string still raises). Before this, `cabletray_raceway` and `popup_boxes` could
  not be saved through RM-4b at all.
- **⚠️ THE LOADER DOES NOT VALIDATE, THE EDITOR DOES.** `_validate_config` has exactly ONE caller
  (`update_rate_config`); `load_rate_master` / `_load_multi` validate nothing of the sort. **So an
  un-validatable config imports cleanly and only fails later, at the editor** — a whole-config RM-4b
  save. This asymmetry has now bitten TWICE in one slice (an unregistered top-level key, and step
  shapes). **Closing it is BANKED as its own future slice — do not attempt it inside a feature slice.**
- **⚠️ A `replace=True` IS WHOLESALE, so the losable set is a config's ENTIRE KEY SPACE — not a short
  list (owner-locked).** `_load_multi` flips the prior row `active = 0` and INSERTS a new document
  from the payload alone; nothing is merged, nothing is diffed, and the prior config is never read.
  **Any key absent from the asset is gone from the active config — intended or not, and with no signal
  of any kind.** `pipelines` is the sharpest case: an EMPTY `{}` is LEGAL, so a mint that empties one
  imports cleanly and that category silently stops pricing. `rules`, `extraction_defaults`,
  `synonyms`, `matching_mode` and an `attribute_definitions[].default` all reach the AI prompt, so
  losing any of them is a BEHAVIOURAL regression no test can see. **Comparing COUNTS cannot detect
  this** — the original instance left the count unchanged while replacing the content, which is why
  any verification must compare KEY BY KEY.
- **⚠️ AN IN-SYSTEM EDIT NOT WRITTEN BACK TO ITS ASSET IS DROPPED BY THE NEXT IMPORT (owner-locked).**
  An audited config write lands on the config ROW; the asset is a separate artefact that no write
  updates. The `Version` audit is FORENSIC, not preventive — nothing consults it before a replace, and
  the new row starts a fresh history, so the edit's own trail stays attached to a now-inactive row.
  **Any in-system edit must be mirrored into its asset in the same change**, or the next `replace=True`
  erases it silently. This is what makes deferred in-system authoring (e.g. `lighting_mgmt_system`)
  fragile until its result is written back.
- **⚠️ A MINT COMPARISON MUST READ COMMITS, NEVER WORKING-COPY FILES (owner-locked).** An asset edited
  IN PLACE hides the very loss a later commit repaired: comparing the two files as they sit on disk
  shows the repaired item merely CHANGED, while comparing the asset AS ORIGINALLY COMMITTED shows it
  LOST. A file-based comparison would have missed the one loss on record. The wiring asset has no
  version chain at all — one filename across several commits — so for it, git history is the ONLY
  record. `scripts/mint_completeness_check.py` is the invoked gate: it reports every disappeared atom
  down to an `expect` key inside a golden, warns when an operand is a working-copy file carrying more
  than one commit, and names the asset versions absent from disk and therefore uninspectable.
  **Intent is machine-readable ONLY at category/kind granularity (`retired_category_ids` /
  `retired_kinds`); `slice_note` and `excluded_categories` have ZERO code consumers, and a note nobody
  verifies is not a declaration.**

### The EA-7 extraction payload

- **The extraction payload is TIERED, LABELLED and NEVER DEDUPED (EA-7, owner-locked; SUPERSEDES the
  banked EA-6 note, whose boundary sat one level higher).** The rate-extraction payload
  (`extraction._ai_item`) keeps its four top-level keys (`id` / `description` / `notes` /
  `ancestor_chain`) but their VALUES are labelled: `notes` is a map keyed by note KIND (`own` /
  `attached` / `appended`, the last a `{column-header: value}` map so the source COLUMN is part of the
  provenance), and each `ancestor_chain` entry is an object carrying `relation` + `distance` + `tier` +
  `node_type` + `description` + its own kind-keyed note block, root-first, with the sheet name as an
  outermost LABEL entry (no distance/tier/notes — it is not a node). **An empty kind is OMITTED, never
  sent as an empty container**, so absence is unambiguous. **THE TIER (owner-locked 2026-08-04): self
  (distance 0), immediate parent (1) and GRANDPARENT (2) carry every note kind; great-grandparent (3)
  and every ancestor above carries description + APPENDED ONLY.** The boundary is the named constant
  `extraction._FULL_TIER_MAX_DISTANCE`, never a magic number. The flat `notes` field rides the FULL tier
  with `attached` (it is node-borne body text, and the lean-tier ruling names only description +
  appended). **PER-ROW, NEVER DEDUPED** — a shared ancestor's text is repeated in full on every row
  beneath it; the repetition was MEASURED and the cost accepted in exchange for each row being
  independently readable inline, so do NOT add dedup, reference-passing or a shared-ancestor block. The
  model is told how to read the labels by `_ROW_CONTEXT_SHAPE_GUIDANCE`, appended in `_extract_batch`
  following the existing SYNONYMS / DEFAULTS / ESTIMATOR_RULES convention — **the `.md` prompt ASSETS
  stay untouched.** EXTRACTION ONLY; the CLASSIFIER is NOT in scope and its input is byte-identical.
- **⚠️ `context_builder._notes_text` is SHARED with the classifier voter — changes there must be
  ADDITIVE (EA-7).** EA-7 needed the three self note-kinds separately and added `own_notes_raw` to the
  row dict AND to each entry of the `ancestors` struct **without touching `_notes_text` or any existing
  key**; `notes` still carries the identical `' | '`-joined string. Byte-identity of the voter's
  assembled payload is PROVEN, not asserted — a hand-written golden test (`TestEA7PayloadShape.
  test_p5_...`) plus a measured before/after hash over the live corpus. Any future change here owes the
  same proof.
- **The extraction payload shape is TEST-PINNED (EA-7).** `TestEA7PayloadShape` in
  `api/boq/test_rate_suggest.py` pins the key set, the labelled ancestor objects, the kind-keyed self
  notes, the tier boundary (both halves — the grandparent MUST carry every kind, the great-grandparent
  MUST NOT), the no-dedup rule, and the omit-empty-kinds rule. Before EA-7 this builder was pinned by
  NOTHING. **Pin first, change second** — the pins were proven green against the unchanged code, then
  updated in the same commit, so the test diff shows what the payload carried before and after.

### Stored-config pipelines, numeric attributes, and known behaviour

- **Pipelines are STORED CONFIG, not code:** the four derivation pipelines (cable/termination × BoQ/BCS)
  live in the config JSON and are interpreted downstream — RM-1 stores them faithfully; no interpreter
  ships this slice. Owner-decoded shapes: effective = `(1-discount)*(1+markup)`; termination = lug +
  banded gland (`thickness_sqmm` < 35 vs ≥ 35); BCS = discounted product cost + 5% wastage, no install
  (electrical labour is per-sqft, added at project level). The four RM-1 goldens (e.g.
  COPPER/UNARMOURED/1C/6.0 → cable 120/20, termination 80/20, BCS 87) are REGRESSION CANARIES and the
  STANDING instrument any pipeline change must still reproduce EXACTLY.
- **Migrate obligation grows:** these two doctypes add to the pullers' migrate obligation (Abhishek
  heads-up) — pulling requires a DB migrate.
- **⚠️ A NUMERIC CATALOG ATTRIBUTE IS STORED AS A FLOAT, AND THE CSV ROUND TRIP IS WHY (owner-locked,
  F-3 2026-08-15).** The CSV emits a value AS STORED and the importer parses the cell to `float`, while
  changed-ness is decided **type-strictly** — so a stored INT reads back as a change and an unedited
  download → upload stops being a no-op. Every numeric attribute in the Electrical catalog is a float
  (`conduit.size_mm 50.0`, `cable_tray.width_mm 100.0`, `cable.core 1.0`) for exactly this reason.
  F-3's first mint used ints and three CSV round-trip tests caught it. **Never reintroduce one.** Floats
  are otherwise inert: server `float(raw)`, client `Number()`, `===` on a JS number (JSON `100.0` parses
  to `100`), and a dropdown still renders `100`.
- **`junction_box_raceway` PRICES BY `face_mm`, A NUMBER — the composite `size` string is RETIRED
  (owner-locked, F-3).** A BoQ line is three-dimensional (`300 mm x 300 x 60 mm`) and the catalog's old
  two-dimensional `"300x50mm"` could not be matched against it, so **all 12 live rows extracted blank**.
  `face_mm` is a `number_choice` with `values_from {kind: junction_box, attr: face_mm}` — it MUST be
  `number_choice`, because `matchMasterRow` compares with `===` and a plain `choice` emits `"150"`
  against a stored `150` and matches nothing, silently. **The DEPTH does not price**; estimator rule
  **R11** carries that reading instruction, and its coverage sentence is deliberately voiced in
  `_ROW_CONTEXT_SHAPE_GUIDANCE`'s own vocabulary (`description` / `notes` / `ancestor_chain`). `size`
  was REMOVED from the six rows rather than left alongside: the matcher would ignore it, but the CSV
  attribute space is **declared ∪ observed**, so it would render an editable column with no effect.
- **⚠️ A SCOPED RE-EXTRACTION CANNOT COMPLETE AGAINST A PRE-SR-1 RUN — KNOWN BEHAVIOUR, NOT A BUG
  (owner ruling 2026-08-15).** SR-1's migrate backfilled `status` to `"complete"` but left
  `attempted_rows` NULL; the later SELROW carry seeds `acc_attempted` from that field
  (`rate_master.py:532`), so `complete = ... and not (population - acc_attempted)` (`:754`) can never be
  satisfied and the pass strands in an `active=0` partial (`:548`, R-SUPERSEDE). **Runs predating
  2026-08-10 are test-era, no production BoQ depends on them, and the sanctioned remedy for any such
  sheet needed in testing is a FULL re-extraction** — a fix slice was proposed and WITHDRAWN. Proven by
  a full-table gate: 8 NULL rows all predate 2026-07-31 20:11, the oldest populated row is 2026-08-03
  00:10, and **every state and shape created after that boundary carries `attempted_rows`** (including
  partial+scoped and partial+whole), so **no run created today can reproduce it**. Related and separate:
  a sheet's POPULATION grows when a new category goes live, so an old "complete" run can also be
  genuinely short of today's rows — the same full re-extraction is the remedy.

## BoQ Rate Suggestion (RM-3)

The extraction engine + the REAL `wiring_cabling` pricing helper. Full as-built:
`frontend/.claude/plans/boq-upload-plan.md` ("Build slice RM-3") + `frontend/CLAUDE.md`. Load-bearing
invariants:


### Doctypes, the extract/compute split, endpoints, and SR-1 run resilience

- **Two more migrate-carrying doctypes** (fresh sync creates their composite indexes; NO patches.txt
  line, but they GROW the pullers' migrate obligation): `BoQ Rate Suggestion Run` (freeze-and-supersede
  via an `active` Check — a new run deactivates the prior active one, retained not deleted) and
  `BoQ Rate Suggestion Event` (immutable Use telemetry, `track_changes:0`; field is `event_user`, NEVER
  `user` — PG reserved word).
- **Server EXTRACTS, client COMPUTES (owner-locked):** `services/boq_rate_master/extraction.py` runs the
  AI attribute extraction (mirrors `ai_voter` wholesale — `ai_settings`, 20-row batches, 3x retry,
  fail-closed `ai_status` envelope; reuses `ai_voter._extract_json_array`) and persists only the extracted
  ATTRIBUTES; the rate itself is computed CLIENT-SIDE via the RM-2 interpreter UNCHANGED, so a rate/param
  change flows in live with no AI re-run. The regex corroborator is DISPLAY-ONLY and never overrides AI.
- **Endpoints** (`api/boq/rate_master.py`, long-job pattern): `start_suggest` / `_suggest_worker` /
  `get_suggest_status` / `get_active_suggestion_run` / `record_rate_suggestion_event` /
  `get_suggestion_events`, gated by the shared D8 chain (not locked + formulas complete + category gate,
  REUSING the `pricing.py` predicates). Marker + terminal payload live in Redis keyed by (boq, sheet_name).
- **SR-1 run resilience (owner-locked, MIGRATE-carrying; full as-built in `.claude/context/domain/boq-backend.md`):**
  a run is NO LONGER all-or-nothing. **The run doc IS the partial store** (never Redis — its TTL is the wrong
  lifetime): created up front at `status=running`/`active=0` and updated per completed batch via a
  `checkpoint_cb` that mirrors the existing `progress_cb` injection (the service layer still performs NO
  `frappe.db` writes). Three fields: `status` (`running|partial|complete|failed`, **`default: "complete"`** so
  pre-SR-1 rows backfill on migrate and never retroactively lock Use), `attempted_rows` (the per-row
  done-marker), `halt_reason`. **`ai_status` is NOT widened** — it keeps its own `ran|disabled|no_key`
  vocabulary, which the doctype and frontend treat as a contract. **`attempted_rows` is load-bearing:** a blank
  row is byte-identical whether never-asked, asked-and-null, or fail-closed, so the marker is explicit and is
  set **only AFTER a batch returns** — a FAILED batch's rows are never marked and stay pending. **R-SUPERSEDE:**
  a partial NEVER supersedes a prior COMPLETE run; `active` flips to 1 ONLY at `complete` (so
  `get_active_suggestion_run` also returns the newest resumable partial under a separate additive `partial_run`
  key). **R-RESUME-SAME-RUN:** a resume completes the SAME doc/`run_id`, never a second; it re-checks the D8
  gate AND the committed-version keying. **R-USE-GATE:** "Use this value" requires `status=complete`. Writes use
  `set_value(update_modified=False)`, never `doc.save` — this doctype is `track_changes:0` (no audit to bypass)
  AND its list-valued JSON hits the documented `doc.save()`/`delete_doc` wall. **`ExtractionHalted` splits
  terminal from transient — and the DEFAULT DIRECTION IS LOAD-BEARING: an UNRECOGNISED error must keep the
  pre-SR-1 retry behaviour** (a positive-terminal test, adopting `boq_ai_assist._TRANSIENT_MARKERS` for the
  transient signals). Classifying unrecognised errors as terminal turned a truncated reply into an instant halt
  — worse than the behaviour replaced; caught by the browser cert, not by the tests. A graceful halt still
  `log_error`s the provider's own words, so handling it never makes the cause unknowable.
- **`_extract_json_array` is STRICTLY MORE PERMISSIVE (SR-1):** it takes the FIRST BALANCED array span
  (string-aware) and ignores trailing data, fixing the production `Extra data: line 1 column 845`. It never
  rejects a previously-accepted shape (prose-wrapped array, element order, HV-2 bare object), and still RAISES
  on genuine garbage and on a TRUNCATED array (which must NOT degrade to its first element). **Shared by three
  production consumers BY DESIGN** — the classifier voter (def site), the certified harness (by import
  identity), rate extraction. ⚠️ The same-named function at `services/boq_ai_assist.py:431` returns a `str` and
  is a DIFFERENT function — do not confuse them.

### SR-2 - the reply ceiling

- **The reply ceiling (SR-2, owner-locked, EXTRACTION ONLY):** `extraction._AI_MAX_TOKENS` is an EXPLICIT
  constant and is deliberately **NOT** the configured `ai_settings.max_tokens` — the call is NON-STREAMING
  with a fixed timeout and the higher configured region is UNTESTED, so extraction still does not read the
  setting. **The classifier voter and the offline harness keep their own lower constant deliberately**: the
  voter's reply is one small object per row (a wide margin that does not bind) and it is a CERTIFIED surface
  whose corpus is spent, so raising it is all risk and no benefit — changing it belongs in its own slice with
  a fresh harness run. A `stop_reason == "max_tokens"` cut raises the distinct **`ReplyCeilingExceeded`**
  BEFORE the reply text is parsed, so it can never degrade into the generic truncated-JSON `ValueError`, and
  it is **NEVER retried** — a ceiling cut is DETERMINISTIC for a given batch, so retrying is guaranteed waste
  (a garbled reply is the opposite case and keeps the SR-1 default-to-retry rule). **The special-case is
  NARROW: every other `stop_reason` keeps its pre-SR-2 behaviour byte-identical.**
  `_extract_with_ceiling_split` halves a cut batch (`_MAX_SPLIT_DEPTH`), triggers ONLY on
  `ReplyCeilingExceeded` — never on a transient error or a garbled reply — and composes with SR-1 unchanged:
  `attempted` advances and checkpoints per HALF, so a halt mid-split keeps the halves already done. Batch size
  is unchanged. **The trigger was ANY high-attribute-count category at the full batch size, NOT
  `composite_decomposition` specifically** — the failing batch was a non-composite assembly category, so a fix
  scoped to composite mode would have missed it.

### Scoped runs, byte-identical carry-forward, and the count that drives the work

- **A PARTIAL-SCOPE SUGGEST RUN SCOPES THE PROCESSING, NEVER THE POPULATION (owner-locked).**
  `start_suggest`/`run_extraction` take a POSITIVE `only_rows` (a tick box says "do these";
  `skip_rows` is the resume's done-marker lever and says the opposite — inverting it on the client
  would force the client to reproduce the server's population definition). **`assemble_population`
  is UNTOUCHED and `population_rows` is ALWAYS the whole sheet**, because it is the completeness
  yardstick `complete = ... and not (population - attempted)` tests against. **Narrowing the
  population instead is the DESTRUCTIVE implementation** — `complete` becomes reachable with only
  the selected rows present, the run flips `active=1`, the prior run is deactivated, and every
  unselected row silently loses its extraction, its badge and its "Use this value". `only_rows` is
  validated server-side and **REJECTED, never silently narrowed** (a row outside the population
  means the client's eligible set is stale and the count the user just confirmed is no longer true).
  **ABSENT or EMPTY `only_rows` is byte-identical to the whole-sheet path.**
- **EVERY SUGGEST RUN WRITES A NEW DOCUMENT CARRYING THE UNTOUCHED ROWS FORWARD BYTE-IDENTICALLY —
  nothing is edited in place (owner-locked).** A merged run's `run_at` and `ai_status` stop
  describing the rows and start describing the last touch, and the previous values are destroyed;
  the rest of the module already supersedes rather than mutates. **BYTE-IDENTITY is the
  requirement, not "still present"** — a carry that re-serialised and dropped a `defaulted` flag
  would pass a parsed-value check and still be a silent regression. `serialize_run_results` is THE
  single serialisation for every writer and its three properties are load-bearing: `json.dumps`
  with DEFAULT separators (no `indent`/`sort_keys`), `sorted` by excel_row, and row dicts passed
  through UNTOUCHED (never re-derived — `_corroborate`/`_row_result` run only for rows the pass
  actually extracts). The `results` column is postgres **`json`, NOT `jsonb`**, so submitted text
  is stored verbatim and the guarantee survives the round trip. **⚠️ The skip set must EXCLUDE the
  scope or NOTHING runs**: a scoped pass seeds `acc_attempted` from the carried COMPLETE run, which
  already contains the ticked rows, so `pending_skip = acc_attempted - scope` is what makes
  "re-run these" mean re-run. Carry-forward is scoped to `only_rows` deliberately — seeding a
  whole-sheet run would make a halted run silently inherit the old rows instead of reporting them
  pending. A scoped run is refused when AI is off (it would blank the picked rows and mislabel the
  document), when a resume is also requested, and when there is no completed run to carry from.
- **A SCOPED RUN PERSISTS ITS SCOPE, AND A RESUME HONOURS IT (owner-locked).** `only_rows` is a
  REQUEST parameter: it dies with the request, so a resume that re-derives the scope from it finds
  nothing and silently falls back to the population — the run forgets it was ever scoped. The scope
  lives on the run document (`scope_rows`, holding the rows STILL TO DO; NULL = whole-sheet) and is
  resolved in ONE place, `_open_run_doc`, which returns it for a fresh run and for a resume alike.
  **It is not recoverable from anything else**: `attempted_rows` is seeded with the carried run's
  rows so it holds the whole population, and in `results` an unfinished scoped row is byte-identical
  to the carried row it came from. **A stored EMPTY list means "scoped, nothing left" and must never
  collapse to None** — that reinstates the fallback. A NULL scope keeps the whole-sheet path
  byte-identical.
- **A BANNER'S COUNT AND THE WORK IT TRIGGERS MUST DERIVE FROM ONE VALUE (owner-locked).** Two
  independent computations over different data is how a control comes to promise one number and
  deliver another; it is not a wording problem and cannot be fixed by rewording. Where a control
  offers to do N things, the N it displays and the set the worker processes read the SAME stored
  field.
- **A RUN'S `attempted_count` IS DOCUMENT-LEVEL AND CANNOT DESCRIBE ONE PASS (owner-locked).** On a
  carried scoped run `acc_attempted` is SEEDED with the carried run's rows, so `attempted_count`
  counts every row the DOCUMENT has results for — the right number for the completeness test and
  the resume's skip set, and the wrong one for "how much did this pass do". Subtracting it from the
  population then yields 0, which reads as "nothing missed" precisely when ticked rows were left
  unfinished. The pass's own set is `env["attempted_rows"]`, published as `pass_attempted_count`;
  anything reporting what a PASS did must read that. Keep the two names distinct — they answer
  different questions and collapsing them re-creates the defect silently.

### Extraction capture, non-determinism, and prompt rulings

- **Extraction capture is ALWAYS-ON and is the ONLY way a DROP is distinguishable from an ABSENCE
  (owner-locked).** `_coerce_value` returns `None` for every failure and discards the raw value, so
  a value the model RETURNED and we then dropped is byte-identical, in storage, to one it never
  returned — which made three defect classes indistinguishable: sent-and-nothing-returned,
  genuinely-ambiguous row text, and returned-then-dropped. `extraction._extract_batch` therefore
  writes ONE JSONL record per batch to `<bench>/logs/boq_rate_extraction_capture.jsonl` carrying the
  **assembled prompt**, the **raw reply** (+ `stop_reason` + `usage`), the per-row payload items, and
  the **per-attribute `raw` -> `coerced` + `reason`** mapping, plus eight named DROP classes
  (`ids_not_in_batch`, `unknown_container_rows`, `attributes_absent`, `coercion_failures`,
  `confidence_unparseable`, `surplus_attributes`, `rows_omitted`, `defaulted_lost_to_coercion`).
  **`_coerce_value` is the value-only WRAPPER over `_coerce_value_ex(defn, raw, syn) -> (value,
  reason)`** — ONE implementation, so the value and the why can never drift; re-deriving the checks
  at a call site to explain a `None` is exactly the coercion-twin duplication this codebase has been
  bitten by three times. **A `defaulted` value that FAILS coercion loses the value AND the evidence
  it was a default** — hence its own drop class. **THERE IS NO FLAG, and that is load-bearing:** the
  retired EA-7 dump was gated by a module-level constant, and a long-lived RQ worker imports the
  module ONCE at process start and never hot-reloads, so a constant flipped afterwards was silently
  ignored and a completed run produced no dump at all (#171). Nothing to flip means nothing can be
  stale. A **run-header record is written UNCONDITIONALLY**, including for a run that extracts
  nothing — it is the anti-silence device, so "the code never ran" stays distinguishable from
  "nothing happened". Retention is self-bounded (`CAPTURE_MAX_BYTES` 8 MB x `CAPTURE_KEEP` 5;
  Frappe's `RotatingFileHandler` belongs to `logging` and does NOT apply to a plain append).
  Capture is OBSERVATION ONLY — the stored `results` shape is byte-identical with it active.
  **⚠️ KNOWN BLIND SPOT: this is a SERVER capture.** The frontend
  `rateMasterStructure.coerceForMatch` turns a stored value into a catalog match key and a mismatch
  silently matches NOTHING, so capture proves a value reached STORAGE — a row that captures cleanly
  and still does not price is a FRONTEND question, not a contradiction.
- **⚠️ EXTRACTION IS NON-DETERMINISTIC BY CONSTRUCTION.** `client.messages.create` sets **no
  `temperature`, `top_p`, `top_k` or seed** at any of the four AI call sites, so it runs at the
  API's default sampling. Measured 2026-08-11 on two whole-sheet re-runs with identical code and
  inputs: **22 of 146 rows (15%) and 31 of 175 rows (18%) changed at least one attribute value,
  while row counts and non-blank counts stayed IDENTICAL** — the drift is invisible to any aggregate
  check. A re-run is therefore never a neutral act on a sheet under review; scope it with
  `start_suggest(only_rows=[...])`, which carries every untouched row forward byte-identically.
- **Extraction prompt rulings (owner, `prompts/boq_rate_attr_extraction_prompt.md`):** tolerate spelling
  variants (map to the canonical value), and — for an ARMOURED/UNARMOURED insulation attribute — a FLEXIBLE
  cable is UNARMOURED, and insulation DEFAULTS to UNARMOURED when neither armoured nor unarmoured is stated.
- **⚠️ `decomposition_rules` IS PROSE SENT TO THE MODEL, NOT CODE.** It has exactly ONE consumer:
  `extraction.py:1325` reads it (gated on `matching_mode == "composite_decomposition"`) and
  `_extract_batch:905-906` serialises it into the prompt as a `RESOLUTION_RULES` block. **Nothing
  executes `exact_or_next_higher` / `take_highest_first` / `default_C`.** A category needing a real
  ladder uses `catalog_fit`; do NOT point a new category at `decomposition_rules` expecting
  deterministic resolution. db_switchgear's own migration onto `catalog_fit` is BACKLOG.

### Deterministic resolution steps - map_attribute and catalog_fit

- **THE MODEL READS FACTS; EVERY SUBSTITUTION / LADDER / CONVERSION / FIT IS DETERMINISTIC CODE
  (owner-locked standing principle).** Two generic steps carry it: **`map_attribute`** (resolve one
  STRING attribute — stated wins, else a config table, else a default; `derive_attribute` cannot
  serve, its formula language is arithmetic) and **`catalog_fit`** (fit a stated NUMBER onto a
  ladder derived FROM THE CATALOG and bind the chosen row's label). Both are generic: slice 3a's tray
  width rides `catalog_fit` (it needed ONE additive param, `fit_into` — see below; the earlier "ZERO
  new capability" prediction was wrong), F-10's SWG→mm rides `map_attribute`.
  **A ladder can only filter on STORED attributes** — that is why the 106 `family: Switchgear` rows
  were minted with `device`/`pole`/`amp_a`/`curve`, and why a discriminator living inside an item
  NAME must become an attribute before any ladder can use it.
- **⚠️ A `catalog_fit` REACHES `match_master_row` ONLY THROUGH `fit_into`, AND THE REASON IS A TYPE
  (owner-locked, slice 3a).** `bind` publishes the fitted rung's LABEL into `fitLabels`, which is
  `Record<string, string>` and stringifies through `String(label)` — right for `industrial_sockets`,
  whose ladder binds a catalog `item` NAME consumed by a `component_ref` "@ref". `match_master_row`
  is a DIFFERENT consumer: `matchMasterRow` reads **`selected` and nothing else** and compares with
  `===`. Cable tray stores `width_mm` as a NUMBER, so a bound `"100"` matches nothing — **silently,
  with a green suite.** `fit_into` writes the fitted SIZE (a number) into the run-local selection
  overlay, on the FITTED path ONLY: never on stated-wins (the selection already holds the stated
  value), never on a positive absence, never on a miss — nothing was fitted there, and writing a
  size would MANUFACTURE a match. **Deleting it does not fail loudly; it un-prices every fitted row.**
  Exactly two steps write into `selected` (`derive_attribute`, `map_attribute`) and this is the
  third — **do not "tidy" a fitted value back onto `fitLabels` alone.**
- **⚠️ A STEP THAT FILLS AN ATTRIBUTE A LATER STEP READS THROUGH `@` MUST RUN BEFORE IT, AND NOTHING
  DECLARES THAT (owner-locked, slice 3b).** Cable tray's `map_attribute` (SWG → mm) must be FIRST in
  every pipeline, ahead of the `catalog_fit` that filters its width ladder on
  `where: {thickness_mm: "@thickness_mm"}`. Run the fit first and the `@` ref is unresolved, so the
  fit BAILS and the row dies **before `match_master_row` is ever reached** — with every fact needed
  to price it present. **The dependency is invisible in config** (two steps, no declared link) and
  **silent when wrong** (an ordinary `no_match`, indistinguishable from a genuine one). Pinned by a
  test that runs the SAME inputs in both orders. This generalises: any step whose output another
  step reaches through `@` owes it position, and reordering a pipeline is never cosmetic.
- **⚠️ EVERY MECHANISM THAT RESOLVES A VISIBLE ATTRIBUTE OWES A BRANCH IN `applyDerivedDisplay` —
  THE PANEL SHOWS WHAT PRICING USED (owner-locked; this defect has now shipped TWICE).**
  `derivedAttrIds` membership exempts an attribute from the missing-input gate, but it does NOT fill
  its `derivedValue`; with no branch the field falls through to `{...a, derived: true}` and renders
  **EMPTY beside a correctly priced row**. Slice 2c hit it on `catalog_fit` (row 98's paired MCB read
  "— select —" beside a priced 25A MCB); slice 3b hit the identical shape on `map_attribute` (a tray
  pricing off a gauge-converted 1.6 mm showed a blank Thickness). **A mechanism is not finished when
  it prices correctly — it is finished when the panel can say what it used**, which also means the
  outcome type must CARRY the resolved value, not merely report that one was substituted. Read it
  through the step's own structured reader; never parse the trace prose, never re-derive.

### Catalogue-fed pick-lists for conduit size and wiring core/thickness (F-1 / F-8)

- **⚠️ A `values_from` LIST IS GLOBAL AND THERE IS NO ROW-FILTERING SUPPORT (owner ruling R3,
  owner-locked).** `where` accepts LITERAL constants only -- all three resolvers
  (`extraction.values_from_catalog`, the panel's `attributeOptions`, the Derivation screen's
  `valuesFromOptions`) compare `a[k] === v`. **There is no `@attr` indirection anywhere**, so a list
  cannot be narrowed by the row's own other attributes. `conduit_piping.size_mm`,
  `wiring_cabling.core` and `wiring_cabling.thickness_sqmm` therefore carry **NO `where` key at all**,
  and a test asserts that absence. point_wiring's equivalents DO carry one (`{material: COPPER,
  insulation: UNARMOURED}`) -- **that asymmetry IS the ruling, not an oversight**: those constants are
  correct for every point_wiring row, whereas wiring_cabling spans four material/insulation
  combinations. A "consistency" pass adding a `where` to the three would silently hide catalogue
  values the owner ruled must be offered; one removing point_wiring's would widen its wire lists to
  every cable in the catalogue, armoured ones included.
- **KNOWN AND ACCEPTED CONSEQUENCE of R3: a COMBINATION gap is invisible.** `3.5` core and `150` sqmm
  are both in their global lists while `COPPER / UNARMOURED / 3.5 / 150` has no cable row -- so the
  pricer can pick two offered values and the row still refuses, with nothing on screen explaining why.
  Surfacing it needs row-filtered lists, i.e. `@attr` support in all three resolvers. **A separate
  finding, deliberately out of scope.**
- **⚠️ WIRING'S LISTS COME FROM THE `cable` KIND, NEVER `termination` (owner ruling R2, owner-locked).**
  The two kinds' domains DIFFER: `cable` carries cores to 24 and thicknesses 0.5/0.75/1.0 that
  `termination` (cores to 4 only) does not. **Accepted consequence: a termination-shaped row can be
  offered a value termination cannot price** -- e.g. an 8-core row keeps displaying 8 and keeps
  refusing. Pinned by the DISCRIMINATORS `core 8` and `thickness 0.75`, because the two domains
  overlap heavily and a list built from the wrong kind still looks entirely plausible.
- **`number_choice`, never `choice`, for a numeric column.** `matchMasterRow` compares with `===`, so
  a plain `choice` emits the STRING `"25"` against a stored `25.0` and matches nothing, silently.
- **The server half of "the catalogue is the boundary" is `_coerce_value_ex`'s
  `COERCE_OUTSIDE_DOMAIN` branch**: on a FRESH extraction a value outside the resolved domain is
  discarded before storage -- no message, no near-miss substitution -- and the row arrives blank.
  ⚠️ **The shipped attribute-extraction prompt still describes the type vocabulary as
  `type (choice|number)` and scopes its allowed-values instruction to `choice` only** -- the model is
  handed a `values` list it was never told to obey, and the domain is enforced server-side after the
  reply. That has been true since the first `number_choice` shipped; it works, but do not mistake the
  prompt for the guarantee.

### Sentinels, coercion, hidden attributes, and how an extraction rule is certified

- **⚠️ THE `"None"` SENTINEL IS TREATED DIFFERENTLY BY `map_attribute` AND `catalog_fit`, AND THE
  ASYMMETRY IS DELIBERATE (owner-locked, test-pinned).** `map_attribute`'s stated-check EXCLUDES the
  sentinel (a "None" pole is not a pole, so the mapping still runs); `catalog_fit`'s INCLUDES it (a
  stated "None" is a DECISION to defer to — it STICKS and zeroes the line). Letting a ladder
  overwrite a stated "None" would make a valid panel selection silently do nothing, the trapdoor this
  codebase disqualifies. **Never "harmonise" the two predicates.** The layers also differ in meaning:
  a FACT attribute (`mcb_present = "No"`) corrects what the row SAYS and is evaluated BEFORE the
  ladder; the bind attribute (`paired_mcb = "None"`) overrides the DECISION.
- **⚠️ CORRECTED F-3 RULE — a numeric catalog attribute is a FLOAT *and is DECLARED in the same
  mint*, with `selector: false` when it is not an extraction input.** F-3's float rule holds only for
  a DECLARED attribute: `csv_importer.coerce_attribute` floats a cell ONLY for a declared numeric
  type, and an undeclared key keeps the text verbatim — so an undeclared numeric attribute stores a
  float, reads back a string, and **breaks the unedited-CSV-round-trip no-op** (measured: all 106
  minted rows reported as changed). `column_spaces` reads every definition and does NOT filter on
  `selector`, so `selector: false` types it for the importer while keeping it out of the prompt, the
  panel and the Derivation configurator. Undeclared STRING attributes (`family`, `location`,
  `pricing_mode`, `device`, `curve`) are unaffected. Teaching the importer to infer type from the
  stored value would retire the hazard class — DECLINED as out of scope, recorded as backlog.
- **⚠️ A NULL IS NOT THE `"None"` SENTINEL, AND THE DIFFERENCE COSTS THE WHOLE ROW (owner-locked).**
  `none_skips` zeroes a component whose ref `@attr` resolves to the STRING `"None"`; a **null** —
  which is what `_coerce_value` returns when the model's answer fails validation — matches nothing,
  so the `@` reference stays UNBOUND and `component_ref` refuses the **entire pipeline**, socket line
  and all. A rule that leads a model toward names outside its allowed values therefore does not
  merely lose that component: it makes rows unpriceable that priced before. When a config asks the
  model to CONSTRUCT a catalog key, the instruction must lead with *the answer must be a name from
  the allowed values list*, and the fallback for "nothing fits" must be `"None"`, never a near-miss.
- **⚠️ `text_overrides` HAS NO SERVER-SIDE MATCHER — the MODEL does the matching (owner-locked).**
  An `extraction_defaults` entry of the form `{default, text_overrides: [{contains, value}]}` is
  serialised WHOLE into the prompt and interpreted by the model (`extraction._extract_batch`); no code
  ever evaluates `contains`. So nothing normalises spacing or case: **spelling variants must each be
  listed** (`IP67` AND `IP 67`; `waterproof` AND `water proof`). Entries are a LIST, so multiples are
  free. A single entry relying on the model to equate two spellings is a silent assumption.
- **⚠️ `panel: false` IS NOT `selector: false`, AND THE DIFFERENCE IS THE POINT (owner-locked, 2d).**
  `selector: false` hides an attribute from ALL THREE surfaces **including the AI prompt**
  (`extraction.py` skips it). `panel: false` hides it from the **PRICING PANEL ONLY** — it is still
  extracted and still drives the pipeline. That is what lets the four `industrial_sockets` MCB FACTS
  (`mcb_present`, `mcb_amp_a`, `mcb_pole_stated`, `mcb_curve_stated`) leave the pricer's screen while
  ONE field, `paired_mcb`, carries the whole answer. ⚠️ **It narrows the RENDERED LIST, never the
  definition walk**: `pricingSheetHelper`'s single loop builds the panel list, the `selected` map
  handed to `runPipeline`, AND the missing-attribute gate from the same defs — so filtering the WALK
  strips the facts from `selected`, `absent_when` never fires, and every socket row is silently
  mispriced. The filter belongs on the push, and the gate EXEMPTS a hidden attribute, because a field
  the pricer cannot see is not missing user input.
- **⚠️ AN MCB MENTION MAY COME FROM AN ANCESTOR, AND R12 SAYS SO DELIBERATELY (owner ruling A, 2d).**
  R12 step (1) is a **literal-mention test** — the word MCB (or MCCB / RCBO / RCCB / ELCB / "miniature
  circuit breaker" / "circuit breaker") must actually appear in the row's `description`, its `notes`,
  **or an `ancestor_chain` entry**; an incomer, a current figure, or a distribution context is NOT a
  mention, and the default is No. Steps (2)–(4) describe the MCB **only when (1) is Yes** — *a current
  figure in the text is never evidence that an MCB exists*, which is the sentence that stops the model
  reasoning backwards from "I can find a current" to "therefore there is an MCB".
  ⚠️ **A ROW WHOSE PARENT NAMES AN MCB THEREFORE ANSWERS YES, AND THAT IS CORRECT** — the one live
  case (BOQ-26-00106 row 589, a trolley under a *"9 Nos. 40 amp DP MCB"* preamble) reads its amperage
  from the parent's MCB rather than borrowing the socket's incomer rating, which is the improvement.
  **Do not "fix" it by excluding ancestors without a ruling**; measured on the live corpus, 21 of 23
  socket rows carry the word in their OWN text, 1 only in an ancestor, and 1 nowhere.
- **AN EXTRACTION-SIDE RULE IS CERTIFIED BY RE-RUN + CAPTURE, NEVER BY TEST (owner-locked).** No unit
  test can see what the model returns, so a green suite says nothing about a prompt/rules change. The
  evidence is a scoped re-extraction (`start_suggest(only_rows=[...])`) plus the always-on JSONL
  capture, which preserves the RAW value per row beside its coerced result and its drop reason — that
  pairing is what turns "the rows came back blank" into a named cause. Treat any `rules` /
  `extraction_defaults` / prompt wording change as UNVERIFIED until re-run on live rows.

### The pricing-sheet helper - category scoping and the N-category runner

- **Frontend attributes are CATEGORY-SCOPED (owner):** the `Pricing sheet` helper shows the row's CATEGORY
  attributes; a category with no attribute set defined yet shows a "coming soon" note, not the wrong fields.
  A badge-less rate-editable cell exposes an always-on faint opener for manual fill.
- **EA-2 -- extraction + helper are N-CATEGORY (owner-locked).** The runner is no longer wiring-only: the
  population spans EVERY category on the sheet whose active config has BOTH non-empty pipelines AND
  attribute definitions (an empty-pipelines DATA-ONLY config like `lighting_mgmt_system` is excluded
  automatically -- NO special case); batches are SINGLE-CATEGORY (each carries its category's defs +
  prompt), and results carry `category_id` per row. **MODE SWITCH** (config.`matching_mode`): an
  `item_identity` category injects the SECOND prompt asset
  (`prompts/boq_rate_item_identity_prompt.md`) and flags the identity attribute (`identity_attribute_id`)
  `identity:true` with its allowed values := the LIVE item catalog (distinct identity-attr values across
  the category's active master items -- NEVER hardcoded); `_coerce_value` enforces catalog membership, so
  an out-of-catalog value -> null. The identity prompt's REFUSE-COMPOSITES rule (an assembly / multi-item
  row -> null) is owner-locked. The helper (`pricingSheetHelper.ts`) resolves the config PER row category
  (`configsByCategory`, all 11 registry categories fetched via a child `RateConfigFetcher`); a category
  with no eligible config -> "coming soon". Groups render ONE per NON-BCS pipeline (ids containing "bcs"
  are NEVER surfaced -- owner deferral), labelled `config.pipeline_labels?.[id]` (CONFIG DATA, added to
  wiring by an audited RM-4b edit) else a prettified id. **The `wiring_cabling` paired Cable+Termination
  display is a TEMPORARY owner special-case (Decision 2) with a NAMED SUCCESSOR: EA-4 designs the generic
  pairing/assembly mechanism and wiring migrates onto it then -- do NOT extend the named-category branch.**
- **CLASSIFICATION-VOCABULARY GAP (standing):** `popup_boxes` + `lighting_mgmt_system` are rate-master
  categories the Electrical CLASSIFIER does not emit yet, so ZERO production rows resolve to them; the
  helper is ready but they need a classifier vocabulary update first.

---

## Per-SKU module width, the container split, and the popup composite (slice 5, v45)

### The width fact lives on the ITEM, and `weight_from` reads it

**`module_fit`'s occupancy used to be a constant PER SLOT** - "a socket occupies 2 modules" held for
every socket in the catalogue. It is not true of the catalogue we have: a telephone outlet and a USB
charger occupy one, a 2M switch occupies two. The width belongs to the SKU.

Every `switch_socket_item` row carries a numeric `modules` attribute, and a `module_fit` term may
declare `weight_from: {from_attr, kind, where, match_attr, value_attr}` to take its weight from the
matched SKU instead of the declared constant.

- ⚠️ **ABSENT => byte-identical.** `point_wiring` - the only other `module_fit` caller - carries no
  `weight_from` and is therefore untouched BY CONSTRUCTION, not by measurement. (Measured anyway:
  0 of 95 live rows change, because every SKU it uses has a width equal to its slot weight.) Same
  gating discipline as `size_from`, `decay`, `matching_surface` and `routing_policy`.
- ⚠️ **THE LOOKUP IS BY DISTINCT VALUE, NEVER A UNIQUE ROW.** One SKU label spans a row per colour,
  so "find the one matching row" would refuse every time. Colour is deliberately NOT part of the
  match: width does not vary by colour, and `USB Charger - C+C Type` exists in White only - matching
  on colour would make its width unresolvable on a Grey assembly.
- ⚠️ **A SEEDING GAP FAILS LOUDLY.** Zero distinct values (an unseeded SKU) or more than one (a
  catalogue disagreeing with itself) is an HONEST NO-COMPUTE naming the SKU - never a silent fall
  back to the slot weight, which is precisely the wrong answer the mechanism exists to prevent. A
  BLANK item slot keeps the declared weight, so the "row too vague to name an item" path is
  byte-unchanged and still fails downstream at the component ref exactly where it always did.
- **`modules` is DECLARED but INVISIBLE**, and both halves are load-bearing. Declared
  (`type: "number"`) because `csv_importer.coerce_attribute` returns a float only for an id carrying
  a numeric type - an UNDECLARED key (the state `family`, `location` and `pricing_mode` live in)
  round-trips as TEXT, so one export-edit-import cycle silently retypes every width and leaves
  `weight_from` reading strings. Invisible (`selector: false` + `panel: false`) because nobody PICKS
  a width: it is a fact OF the SKU, not a choice about the row. Precedent: the `industrial_sockets`
  MCB facts.

### Containers carry a width too - DATA ONLY

Plates and back boxes carry `modules` as well, but **nothing reads it**: the occupied-space sum reads
OCCUPANT widths only (switch + the four sockets), and plate capacity for the fit still comes from its
existing source - the label, parsed by `moduleSizesFromLabel`. A container's width must NEVER enter
the occupancy sum.

### The `1M & 2M` SPLIT

The three combined containers (`Grid and Face Plates` White + Grey, `Back Box`) were **split** into
single-size `1M` and `2M` SKUs at IDENTICAL rates, and the combined ones retired. Consequences:

- **The owner-locked "every integer in a rung's label is a covered size" rule is SATISFIED by the
  split, not violated.** `buildModuleLadder` expands labels, so `1M`->[1] and `2M`->[2] rebuild
  exactly the rungs the combined label produced by expansion. The mechanism is untouched; only the
  data now states one size per row.
- **Every container name states exactly one size, so the completeness rule is unconditional** and
  the earlier two-size exception clause is deleted.
- Price identity is guaranteed by the rates being byte-identical on both new SKUs, not by a per-row
  proof: **zero live rows currently resolve to that rung.**

### `display_attr` is NOT `bind_item`, and keeping them apart is the point

A `blanks` block now carries both:

- **`bind_item: "blank_fit_item"`** - the key the fitted blanker is published into for the component
  ref to read. It is **deliberately NOT a declared attribute**, and that is what makes the ref
  STRUCTURALLY incapable of resolving to the row's own extracted value. Four pins in
  `test_rate_master.py` guard it, and one of them records the ref being moved OFF `@blank_item` when
  the blanker stopped being selected by extraction.
- **`display_attr: "blank_item"`** - the DECLARED field the computed blanker is SHOWN on. Read by
  `blanksBindItemAttr` and `derivedAttrIds`, so the panel displays it and the missing-input gate
  stops flagging it.

⚠️ **Pointing `bind_item` at the declared attribute instead was tried and REJECTED.** It reverses the
earlier decision above AND downgrades a structural guarantee (no such attribute exists) into a
behavioural one resting on `resolveAtRef` checking `fitLabels` before `selected`.

### THREE FLAGS, THREE SURFACES - do not collapse them

| Flag | Hidden from | Still |
|---|---|---|
| `extract: false` | the AI prompt | on the pricing panel AND the Derivation configurator |
| `selector: false` | the AI prompt AND the Derivation configurator | on the pricing panel |
| `panel: false` | the pricing panel | extracted, and derivable |

`blank_qty` is the first `extract: false`: `module_fit` arbitrates it against the plate's computed
spare, so asking the model produced quantities for blankers no row ever named - but it must stay
visible and editable on BOTH screens, which rules the other two out.

### Slot-paired extraction defaults (`requires_named`)

A quantity default belongs to a component slot and dies with it. `extraction_defaults` may carry
`{"default": 1.0, "requires_named": "<item attr>"}`; `scrub_unpaired_slot_defaults` enforces it
server-side after coercion.

⚠️ **IT KEYS ON THE "None" SENTINEL, NOT ON "not named", AND THE DIFFERENCE IS LOAD-BEARING.** "None"
is POSITIVE ABSENCE; BLANK is "unknown, the pipeline will work it out". Scrubbing blanks too would
clear `plate_qty` on every row whose plate the LADDER computes - 94 of 122 live rows - and a null qty
makes `component_ref` refuse the WHOLE pipeline, so those rows would stop pricing entirely.

⚠️ **The prompt sentence is guidance; the scrub is the enforcement.** The 84 phantom quantities it
removes were themselves produced by a model following default guidance.

### The ADDITION PRIMITIVE (`scale` `<ident>_from_ctx`)

`scale` binds exactly one `ctx` value as `base`, so a pipeline could scale, round or take a ratio of
a figure but could never ADD two independently computed ones. `<ident>_from_ctx: "<ctx key>"` binds
another computed value into the formula env.

- **ABSENT => byte-identical**; no pre-slice-5 pipeline carries one.
- A missing or non-numeric ctx value is an HONEST NO-COMPUTE naming the key. **Its message is
  deliberately DISTINCT from the missing-ATTRIBUTE one**: an attribute the row never stated is the
  pricer's gap, a ctx key never computed is a pipeline ORDERING problem, and pointing the reader at
  the wrong half of the system wastes the message.
- ⚠️ **The server validator must know about it.** `_validate_params` requires numeric params, so
  `_FROM_CTX_SUFFIX` carries the same scoped string exemption `_from_attr` has. Without it the
  config cannot be saved or validated AT ALL - the exact failure the `_from_attr` exemption was
  written for.

### The popup composite

`popup_boxes` now carries the switch/socket module set (four sockets) **MINUS the back box** (R7 - a
pop-up box IS the enclosure, so a second one behind it would be a fabricated line), plus a
`has_modules` fact. **The attribute set is DUPLICATED from `switches_sockets` by ruling** - there is
no shared-attribute concept in this config format - and a drift-guard test holds the two in step.
Every module attribute is VISIBLE: a `panel: false` on any of them re-creates F-2.

**Price = the box + the modules, each rounded by its OWN rule.** The box keeps its unrounded
per-module rate; the modules follow the `switches_sockets` convention exactly (sum the RAW component
lines, multiply ONCE by 0.3625, round to TENS; install = that x0.2, rounded to tens). The two are
then added through the primitive. **Folding everything into one `sum_components` bucket was rejected**:
it forces box and modules to share one multiplier and one rounding, which loses the double rounding
and is not "the rules of the switch socket module".

Measured: without modules **10800/1200** (the p1 golden, unchanged); with modules **5760/680** =
box 5400/600 + modules 360/80.
