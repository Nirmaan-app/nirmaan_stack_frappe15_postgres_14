# Pricing Module + Rate Master - frontend reference

**What this file holds.** The FRONTEND detail for the three pricing surfaces: the **rate-helper
panel's attribute semantics** inside the BoQ pricing editor, the standalone **Pricing Module**
(the HVAC / Electrical / ELV workbook pages), and the **Rate Master (RM-2)** screens - the Data
Viewer, the derivation surface, and the RM-4a / RM-4b admin editors.

**Why it exists.** `frontend/CLAUDE.md` loads into every session before any code is read. It is being
trimmed to a **router**: it keeps the working rules - commands, conventions, don't-touch, testing, and
the invariants that are invisible in the code - and points here for domain detail that only matters
when working on these screens. **This file is the full record for that detail.**

**Its backend twin** is `.claude/context/domain/boq-rate-master.md`, which holds the catalog, the
category configs, the derivation-pipeline interpreter, the asset round trip and the deployment
freeze. Several rules here are the frontend half of a rule recorded there.

**Provenance.** Every block below was copied **VERBATIM** from `frontend/CLAUDE.md` at commit
`fce408db`, in source order, with only topic headings inserted between blocks. Nothing was reworded,
summarised, merged or corrected during the copy - verbatim copy is what makes the losslessness
provable, and it is what makes the later deletion safe.

**Corrections owed.** Some content copied here is known to be stale - in particular blocks that treat
GOLDENS as ORACLES. The owner retired the pricing sheet on 2026-08-19 and reclassified goldens as
**regression canaries**, re-banked mechanically; **Deployment Mode v1.1 is the authority.** Those
blocks were copied unchanged on purpose. See the plan doc entry for this slice for the full
corrections-owed list.

---

## Rate-helper panel and attribute semantics (from the Pricing editor section)

### The rate-helper panel - attribute state, defaults and overrides

- **The rate-helper panel's three-way attribute state (owner-locked).** `ExtractedAttr` and
  `WorkingsAttribute` both declare `defaulted?: boolean` (it always arrived on the wire; it is no longer
  read through a cast), and the pure `isAttrBlank` / `isAttrDefaulted` in `rateHelperTypes.ts` are the
  ONE definition of the render rule: **BLANK (`value === ""`) -> red border; DEFAULTED -> the amber
  attention token; POSITIVELY ABSENT (the `"None"` sentinel, or `disabled` because its controller is
  None) -> NEITHER.** `"None"` is a DECISION, not a gap, and must never render as missing. ONE condition
  in `pricingSheetHelper` drives both the structural flag and the prose derivation line, so they cannot
  disagree; the prose line is a separate surface and is KEPT. Neither highlight holds state -- a human
  override recomputes the helper, which clears the mark at source, so a highlight can never outlive the
  correction.
- **User-facing text says "Row Type"; every field stays `classification` (U3, owner-locked).** The
  rename is WORDING, not a migration: `classification` / `human_classification` /
  `effective_classification` / `new_classification`, the AI prompt constants, the review CSV export
  headers, and `data-colkey="a3"` are all UNCHANGED. Strings naming the CATEGORY-CLASSIFICATION RUN
  (the classify modal, the Freeze/Unfreeze Classification family) are a DIFFERENT concept that shares
  the word and must NOT be renamed. Both screens render the ONE shared constant
  `reviewRender.ROW_TYPE_LABEL` (and the derived `ROW_TYPE_FILTER_LABEL`), which is what makes a
  half-rename structurally impossible rather than merely caught; `reviewRender.test.ts` pins it.
- **An `attribute_definitions[].default` is NOT display-only -- it reaches the AI.**
  `extraction.build_attribute_defs` copies it into the per-attribute definitions sent to the model, and
  it also seeds the Rate Master Derivation screen ahead of the goldens fallback. It is DISTINCT from the
  top-level `extraction_defaults` map. Treat adding one as a behavioural change, and prove the
  whole-config RM-4b round-trip -- the loader does not validate, only `update_rate_config` does.
- **`coerceForMatch` lives in `rateMasterStructure.ts` and is THE single point where an attribute
  value becomes a match key.** It is not a page helper: `matchMasterRow` compares with `===`, so the
  JS type produced here decides whether a catalog row is found at all. Two shared predicates, one
  definition each, carry the two type axes -- `isNumericAttributeType` (`number` | `number_choice`)
  and `isDropdownAttributeType` (`choice` | `number_choice`) -- and BOTH rendering surfaces (the
  pricing-editor panel's `options`, the Rate Master Derivation configurator) read them rather than
  testing the type string. An unknown / future type answers NO to both and degrades to a plain
  String input. The Derivation screen keeps its OWN `coerceSelected` because that form clears to
  `""` ("the field is empty") where the match coercion yields `null`; only the TYPE decision is
  shared.
- **A PANEL OVERRIDE BELONGS TO ONE ROW AND NEVER SURVIVES A ROW CHANGE (owner-locked).**
  `RateHelperPanel` is ONE mounted component that swaps `excelRow`, and its edit maps were keyed by
  HELPER ID alone — with a single helper (`pricing_sheet`) serving EVERY category, an override typed
  on one row rode along to the next and reached any category declaring an attribute of the same id.
  **The row is carried INSIDE the state and checked on READ (`overridesForRow`), never cleared by an
  effect:** an effect leaves a window — the render after the row changes but before it runs still
  computes with the old row's edits — and **"Use this value" writes a rate PERMANENTLY**, so a click
  in that window banks a number computed from another row. Any new panel-session state (a final-value
  override, a future per-attribute note) must be row-scoped the same way.

### Derived attributes - the missing-input gate, the display, and its refusals

- **AN ATTRIBUTE THE PIPELINE DERIVES IS NEVER MISSING USER INPUT (owner-locked).** The helper's
  missing-attribute gate must exempt every attribute the config COMPUTES: a blank one means "not
  stated", not "row incomplete". Five mechanisms make an attribute derived (see `derivedAttrIds`
  below for the full list and the conditional case) — a component taking
  `qty: {from_fit}` supersedes its `<name>_qty`, and a `module_fit` **ladder BIND** names the
  attribute the fitted rung binds to — and `derivedAttrIds` is the ONE predicate over both (it
  reuses `derivedQtyAttrs` rather than repeating it; #179 is why). **⚠️ `bind` IS NOT `floor_from`,
  and one attribute can be BOTH:** `plate_item` is its own ladder's floor (a stated plate is a
  FLOOR, the take-the-larger rule) AND its bind. **Being a bind WINS** — the pipeline can always
  compute it — while a `floor_from` that is not a bind stays a genuine input and must still block.
  A stated derived value is still passed to the pipeline, where the ladder reads it as the floor.
  **Read the derived set FROM CONFIG, never by hardcoded attribute id.**
- **A NO-OP MEASURED BEFORE A DEPENDENCY LANDS IS NOT A NO-OP AFTERWARDS.** This gate fix was
  dropped once as a measured no-op, correctly: the only derived attribute then was never blank.
  Wiring `module_fit` into a category later made another attribute derived, and the dropped fix
  became a live defect. A decision resting on a measurement inherits that measurement's expiry date.
- **A DERIVED ATTRIBUTE DISPLAYS ITS COMPUTED VALUE AND IS NEVER FLAGGED AS MISSING
  (owner-locked).** Exempting it from the helper's missing-attribute gate stopped it REFUSING a
  row; it did not make the field show anything, so the form still rendered a blank in a red border
  while the pipeline priced a plate behind it. **The screen is the authority** -- "the arithmetic
  underneath is correct" describes that defect rather than defending it. `isAttrBlank` is the ONE
  predicate carrying the exemption, so the gate and the red border cannot disagree about the same
  field. **The computed value is carried in `derivedValue`, NEVER written into `value`**: `value`
  means "what the row supplied", and collapsing the two makes a computed number indistinguishable
  from a stated one to every later reader.
- **A DERIVED DISPLAY REFUSES TWICE, AND BOTH REFUSALS ARE PINNED CONTRACTS (owner-locked).** A
  derived attribute publishes NO `derivedValue` when a value was **STATED** (the pipeline deferred to
  it, so claiming a computed value would credit the pipeline with the pricer's own choice) and when
  the component is **POSITIVELY ABSENT** (`"None"` / an `absent_when` gate -- a DECISION, not a value;
  inventing a size for a component that is not there is confidently wrong, which is worse than
  visibly absent). Same reason in both cases: **nothing was computed.** Neither is `isAttrBlank`, so
  neither draws the red border, and the three states (blank / defaulted-amber / showing-derived) stay
  MUTUALLY EXCLUSIVE.
  ⚠️ **SLICE 2d AMENDED THE ABSENCE HALF BY RULING: a CONCLUDED absence now renders `None
  (computed)`, not empty.** The premise changed, which is why the test moved rather than the code
  being wrong before: a step that fired `absent_when` **reached a verdict**, and a concluded absence
  is a verdict rather than the lack of one. Rendering it empty was tolerable only while the facts
  behind it were on screen to explain the blank; once they leave the panel the field has to speak for
  itself. **A HUMAN-stated `"None"` still renders PLAIN** -- their decision, not ours.
- **OPTION B -- THE MARKER MEANS "SOMETHING WAS SUBSTITUTED OR INFERRED", NOT "THE ROW LEFT THIS
  BLANK" (owner-locked, slice 2d).** PLAIN when the fitted item matches the stated facts with nothing
  substituted · `(computed)` when anything was substituted or inferred · `None (computed)` on a
  concluded absence · plain `None` when a human stated it · the amber `default` badge unchanged.
  ⚠️ **NO SINGLE STEP CAN ANSWER IT, AND THAT IS THE WHOLE DESIGN.** A `catalog_fit` can hit its
  ladder EXACTLY and still rest on a pole we inferred or a curve we defaulted -- so the verdict is
  composed from the step's own `substituted` flag **and** the `map_attribute` outcomes its `whereRefs`
  point at. Building it from the fit alone marks such a row PLAIN and claims the row specified a fact
  it never mentioned (live case: row 474, exact 32 A hit, defaulted curve -- correctly `(computed)`).
  ⚠️ **A stated value the pipeline SUBSTITUTED shows WHAT WAS BOUGHT** (take-the-larger's upgrade),
  narrowing the older "a stated value is never overwritten on screen" to *a stated value the pipeline
  USED is never overwritten*. The upgrade NOTE is kept, so it is corrected AND explained.
- **A SESSION EDIT IS UNDONE PER FIELD, AND UNDOING DELETES THE OVERRIDE (owner-locked, slice 2d).**
  A hover-revealed reset icon renders beside an attribute **only while that attribute carries a
  session override**, and clicking it **DELETES the override** rather than writing `""`. The two are
  different and it matters: writing `""` overrides the extracted value with empty and yields the
  COMPUTED value, while deleting restores what EXTRACTION actually read. "Undo my edit" means the
  latter. ⚠️ Its render guard reads `attrOverrides[helper.id]?.[a.id]` -- the map is keyed **by helper
  id THEN attribute id**, and keying it by attribute id alone makes the control **structurally
  unreachable on every row** (shipped exactly that way for one cert cycle; see below). The row-level
  Revert is unchanged and remains the all-at-once escape.
- **⚠️ MACHINE VOCABULARY DOES NOT APPEAR IN A PRICER-FACING CONTROL (owner-locked, slice 2d).** The
  2c `— use computed —` placeholder and the Rate Master Derivation `— not stated —` sentinel are both
  **RETIRED**: every placeholder is the plain disabled `— select —`, and the Derivation screen offers
  no empty option at all. The clear-back affordance is the reset icon above, which carries **no text**
  -- so there is no wording to get wrong. ⚠️ **The COST is recorded deliberately:** no attribute on the
  Derivation screen can be unset any more, so that screen can no longer answer *"what does this
  category do when this attribute is not stated?"*. That was accepted as a vocabulary decision, not
  overlooked.
- **THE FACE PLATE STAYS EDITABLE, AND A TOO-SMALL ENTRY WARNS RATHER THAN BEING SILENTLY
  OVERRIDDEN (owner-locked).** A stated value keeps the screen and still feeds the pipeline as the
  take-the-larger FLOOR. When the computation overrides it, the panel must SAY so, naming the
  stated capacity, the contents and the size actually priced -- a silent override is
  indistinguishable from a field that ignores the user. **The warning belongs IN THE PANEL, not
  only in the derivation trace**: the trace is a separate surface a pricer may never open.
- **THE BLANKER QUANTITY IS COMPUTED-ONLY AND READ-ONLY -- the NAMED EXCEPTION (owner-locked).**
  Its component takes `qty: {from_fit}`, so the pipeline never reads the attribute; an editable
  field would promise an effect it cannot have. **A ladder BIND is the opposite case and must stay
  editable** -- its stated value IS read, as the floor. The two are told apart FROM CONFIG
  (`derivedQtyAttrs` = fully superseded, a `module_fit` ladder bind = still an input), never by
  attribute id.

### Structured step outcomes, the row-count gate, and where a value is coerced

- **THE PRICING PANEL AND THE RATE MASTER DERIVATION SCREEN ASK DIFFERENT QUESTIONS ABOUT THE SAME
  FIELD, and are kept apart BY CONSTRUCTION (owner-locked).** On Derivation, `plate_item` is the
  stated FLOOR a user sets; in the panel it is "what did the assembly come to?". Derivation reads
  `derivedQtyAttrs` (the superseded-qty half only) and the panel reads `derivedAttrIds` (both
  halves), so collapsing the two predicates would freeze a field that is genuinely editable there.
  Pinned by test -- do not "unify" them.
- **A `module_fit` STEP PUBLISHES ITS OUTCOME AS STRUCTURED DATA (`StepTrace.moduleFit`), and a
  consumer must READ IT rather than parse the trace prose or re-derive the fit.** The prose
  `matchedCondition` is a human sentence that gets reworded; making it a parsing contract fails
  SILENTLY. Re-deriving the fit would be another copy of the catalog-resolved, take-the-larger
  module rule -- the drift #179 exists to prevent. The field is ADDITIVE AND OPTIONAL (absent on
  every other step, and on a `module_fit` that bailed -- nothing fitted, nothing claimed), and it
  is written ALONGSIDE the prose at the identical points so the two can never disagree.
- **THE PRICING-EDITOR ROW COUNT IS THE GATE FOR ANYTHING THE GOLDENS BYPASS.** Goldens call
  `runPipeline` directly and never touch the helper's gate or `coerceForMatch`, so a change there
  can leave all 26 green while the editor prices nothing. Measure rows-producing-a-value per
  category, before and after.
- **AN ATTRIBUTE VALUE IS COERCED IN SEVERAL PLACES, AND A NEW TYPE MUST BE TAUGHT TO EVERY ONE.**
  Three of them decide whether a value can ever match: the frontend MATCH path
  (`rateMasterStructure.coerceForMatch`, value -> catalog match key), the SERVER EXTRACTION path
  (`extraction._coerce_value`, model reply -> stored value), and the MASTER-ITEM EDITOR
  (`RateMasterDataViewer.coerceAttributeForStorage`, typed value -> the item's stored `attributes`).
  A fourth, the config validator, decides what may be authored at all. **`number_choice` is NUMERIC
  at every site, never a string** — an item row written with `"1"` where every other row carries `1`
  can never be matched, and nothing errors. All sites key on the ONE shared predicate
  `isNumericAttributeType` / `isDropdownAttributeType` so they cannot drift apart. **This defect was
  missed THREE times — the frontend twin, the server twin, then the editor — so a coercion change
  means sweeping the whole stack, both halves, before believing the list is complete.**
- **`coerceForMatch` IS NOT THE ONLY COERCION — the server has its own, and a new attribute type
  must be taught to BOTH.** The frontend turns a value into a catalog match key; the backend
  (`services/boq_rate_master/extraction.py::_coerce_value`) turns the model's reply into the stored
  value, and a type it does not know falls through to STRING semantics and is nulled against a
  numeric domain. `number_choice` compares NUMERICALLY at both sites — never by string — while still
  enforcing domain membership. Teaching only this side is what broke production once; **sweep both
  halves of the stack whenever a coercion changes.**
- **A DROPDOWN over a numeric catalog column must be `number_choice`, never `choice` (owner-locked).**
  A `choice` emits the string `"3"` against a stored `3` and silently matches nothing. Making the
  matcher numeric-aware was rejected -- it changes every category's matching and fails as a WRONG
  match rather than a visible one. **The goldens cannot catch this class of break**: they call
  `runPipeline` directly and never touch `coerceForMatch`, so a coercion change has to be proven
  through the pricing-editor path (the count of rows actually producing a value), not by a green
  suite.

### Computed attributes reaching the selection, stated-wins, and derivedAttrIds

- **A COMPUTED ATTRIBUTE VALUE MUST REACH THE SELECTION -- `circuit_fit` and `resolveQty` read
  there and never consult `ctx` (owner-locked).** `circuit_fit` takes its length from
  `selected[length_attr]` and a component's `{from_attr}` quantity from `selected[qty.from_attr]`,
  while every other step writes into `ctx`, and `scale` cannot bridge it (it is a RATE scaler needing
  an existing finite `ctx` rate as its target). The `derive_attribute` step crosses the gap by writing
  into a **run-local overlay copy of the selection** inside `runPipeline`, so every existing read site
  sees it and **the caller's object is never mutated** -- `value` must keep meaning "what the user or
  extraction supplied". **Do NOT instead widen the readers to fall back to `ctx`**: they are shared by
  all 13 categories, and a `ctx` key colliding with an attribute id would silently re-price a shipped
  row. A pipeline with no `derive_attribute` step is byte-identical.
- **A STATED value ALWAYS WINS over a computed one for this attribute -- NO floor, NO warning
  (owner-locked).** DELIBERATELY unlike the plate's take-the-larger: the STATED value is kept whether
  it is larger or smaller than the computation, and nothing warns. It is checked BEFORE the source
  attributes are read, so a stated length prices even when the input the rule would have used is
  unreadable. The field therefore behaves like a LADDER BIND, not like the blanker quantity -- it must
  stay **EDITABLE** (`readOnly` false) on every surface.
- **A `derive_attribute`'s FORMULA, SOURCE attributes and TARGET attribute are all CONFIG, never
  hardcoded** (the `module_fit` `terms` precedent). A missing / blank / non-numeric / `"None"` source
  is an HONEST NO-COMPUTE naming the attribute -- never a zero, never a guess -- and a MALFORMED step
  keeps its own distinct refusal. It publishes `StepTrace.derivedAttr` as STRUCTURED DATA with ONE
  reader, `derivedAttrOutcomes` -- the `moduleFit` precedent: never parse the trace prose, never
  re-derive the arithmetic.
- **THE CIRCUIT LENGTH IS COMPUTED FROM THE POINT COUNT, AND A STATED LENGTH ALWAYS WINS -- NO FLOOR,
  NO WARNING (owner-locked).** `circuit_length_m = 15 + (points - 1) x 5`, as a `derive_attribute` step
  that must sit **FIRST in every pipeline** (both `circuit_fit` and the wire components read the length
  off the selection). **⚠️ `circuit_length_m` must NEVER carry an `extraction_defaults` entry** -- an
  injected value is a STATED value, so it would win on every row forever and make the derivation inert
  while every test stayed green.
- **`points` is the number of points a LINE COVERS, never the number of such lines in the bill
  (owner-locked).** The sheet's `qty` is INVERSELY shaped, so reading it as the point count inverts the
  correction on exactly the rows that matter most. EXTRACTED, not derived; a plain `number` (a point
  count has no catalog domain, so `number_choice` would be wrong).
- **`derivedAttrIds` collects FIVE mechanisms** -- a `{from_fit}` superseded qty, a `module_fit`
  ladder bind, a `derive_attribute`'s `result_attr`, a `catalog_fit` bind, and a `map_attribute`'s
  `result_attr` -- read FROM CONFIG, never by id. All but the first behave like the LADDER BIND, not
  the read-only blanker quantity: a stated value IS read and wins outright, so those fields stay
  **EDITABLE** and `readOnly` is never set. **The gate NARROWS, it does not open** -- a genuinely
  absent input, including the SOURCE attribute a formula reads, still blocks.
- **⚠️ THE GATE EXEMPTION IS CONDITIONAL FOR A `map_attribute`, AND MUST NOT BE FLATTENED
  (owner-locked).** `derivedAttrIds` answers *"could the pipeline EVER fill this?"* at CONFIG level;
  for the first four mechanisms that is also the ROW-level answer -- a ladder, a fit and a formula can
  always run. **A `map_attribute` is the first that cannot**: it fills from a SOURCE attribute, so on
  a row where the source is blank it fills nothing. Exempting its target wholesale replaces
  *"Complete the missing attributes to price"* -- an instruction the pricer can act on -- with a
  no-match refusal they cannot. The helper therefore builds a PER-ROW fillable set in the existing
  `disabledByNone` idiom and the gate reads that; **`derivedAttrIds`' signature never changed**, so
  its other consumers are untouched, and `applyDerivedDisplay` takes the row-level set as an OPTIONAL
  4th param (absent ⇒ byte-identical).
- **⚠️ EVERY MECHANISM ADDED TO `derivedAttrIds` OWES A BRANCH IN `applyDerivedDisplay` -- THE PANEL
  SHOWS WHAT PRICING USED (owner-locked; this has shipped broken TWICE).** Membership exempts an
  attribute from the missing-input gate but does NOT fill its `derivedValue`; with no branch the field
  falls through to `{...a, derived: true}` and renders **EMPTY beside a correctly priced row**. Slice
  2c hit it on `catalog_fit`, slice 3b on `map_attribute`. The step's OUTCOME TYPE must therefore
  carry the resolved VALUE, not merely a flag saying one was substituted -- and the branch reads it
  through that step's structured reader, never the trace prose and never by re-deriving.
- **⚠️ ADDING A REQUIRED EXTRACTED ATTRIBUTE INVALIDATES EVERY PRE-EXISTING EXTRACTION OF THAT
  CATEGORY, so the ASSET APPLY and the RE-EXTRACTION ARE ONE ATOMIC OPERATION (owner-locked).** A run
  that predates the attribute carries it on no row, the missing-attribute gate blocks, and the category
  prices NOTHING in between. `extraction_defaults` does not help -- defaults are baked in at EXTRACTION
  time, not applied when reading an older run. **Every test surface stays green while the category
  prices 0**, so the editor-path row count over live data is the only gate that can see it.

### Attribute domains, bound values, and losable types

- **A category's `values_from.where` pins the family ITS OWN component refs price, not the union
  across families.** The resulting core x thickness grid is deliberately NOT rectangular -- a pair
  the catalog does not carry is an honest no-match, and constraining one dropdown by another's
  selection is the dependent-`where` mechanism cables are deferred for.
- **A `<Select>` MUST NEVER BE BOUND TO A VALUE IT CANNOT OFFER (owner-locked).** A control whose
  `value` is absent from its own option list is a TRAPDOOR: it displays nothing, and one interaction
  overwrites the value with something the list CAN represent -- irreversibly, because the original was
  never on offer. Where the options enumerate a declared union, DERIVE them from an exhaustive
  `Record<Union, true>` presence map rather than hand-listing them in the JSX, so a new union member
  becomes a COMPILE ERROR instead of a silent omission. This is not a styling rule: the type picker on
  the Rate Master Pipelines tab hand-listed two of the three attribute types, and the four live
  `number_choice` definitions rendered blank against it. **A placeholder is NOT a fix** -- it makes the
  gap look intentional while leaving the overwrite reachable.
- **AN ATTRIBUTE'S TYPE MUST NOT BE LOSABLE BY A SINGLE INTERACTION (owner-locked).** `coerceForMatch`
  keys the catalog match on the TYPE, so a wrong type matches NOTHING, silently -- and the server
  accepts it (`_validate_config` only requires a dropdown type to carry `values` OR `values_from`; it
  never checks the type against the source column's). **The editor may only change what it can express
  end to end:** a definition whose values come from `values_from` has its type ENTANGLED with a source
  column the editor can neither see nor set, so that type is READ-ONLY there. A static-`values` or plain
  number definition keeps its full reach. Reopening the lock is the authoring slice's job -- authoring a
  `values_from` means authoring its source column first, and only then is the type safely settable.
- **THE ATTRIBUTE TABLE MUST SHOW WHERE A DEFINITION'S VALUES COME FROM, not only a static list it may
  not carry (owner-locked).** Rendering `d.values` alone reads as EMPTY on every `values_from`
  definition, and empty is a WRONG picture rather than an incomplete one -- a catalog-resolved dropdown
  with a None sentinel and dependent fields showed as a blank cell. Name the source (`<kind>.<attr>`),
  keep the `where` PAIRS (the pair is what distinguishes two otherwise identical specs), and mark
  None-ability. **Do NOT resolve the values there:** the resolution already exists in three places
  (server extraction, the Derivation tab, the pricing helper), and a fourth copy is the drift this
  codebase keeps paying for. Describe the spec; do not execute it.

### Pricing Module (HVAC / Electrical / ELV Pricing) -- Frontend Conventions

Standalone estimation-pricing pages (SEPARATE from the BoQ wizard/pricing editor). Lives in
`src/pages/pricing/` (`PricingWorkbookPage.tsx` + `pricingWorkbooks.ts` + local `pricingLibs.ts`). Live
status / decisions: `frontend/.claude/plans/pricing-module-plan.md`.

- **`pricingWorkbooks.ts` is THE single source of truth (PW-1).** One `PRICING_WORKBOOKS` registry entry per
  workbook page (`{ path, title, label }`) feeds all three consumers: the generic page (identity), the route
  entries in `routesConfig.tsx` (paths), and the sidebar spread in `NewSidebar.tsx` (keys + labels). Adding a
  workbook page = one registry entry + one route object + nothing else in the sidebar (its four touches are
  registry-driven: the role-gated item spread, `allKeys`, `groupMappings`, and the flat-label discriminator Set).
  Two rules are load-bearing: (1) **`title` must match the Pricing Workbook doctype's unique `title` exactly** —
  it is both the selection key and the import title; (2) **`path` must stay a SINGLE top-level segment**, because
  the sidebar's active-item matching is single-segment (`pathname.slice(1).split("/")[0]`, then
  `` `/${selectedKeys}` === subitem.key ``) — a nested `/pricing/hvac` would never highlight.
- **ONE generic page, one route object PER workbook (PW-1) — do NOT collapse them into `/pricing/:key`.**
  `PricingWorkbookPage` resolves its own entry from `useLocation().pathname` via `workbookForPath`; an
  unregistered path renders a visible "Unknown pricing workbook" state, never a blank page. Separate route
  objects are deliberate: they guarantee a real UNMOUNT on workbook switch, which is what destroys the
  Luckysheet **global singleton** and fires the `releaseBeacon` that frees the server-side checkout lock. A
  single param route reuses the element (no remount) and would strand the lock for 30 min — live-verified in
  PW-1: switching away mid-edit left `checked_out_by` NULL with zero stale sheet content.
- **Selection is BY TITLE, never by list position (PW-1).** `list_workbooks` is unfiltered and ordered
  `modified desc`, so the old `rows[0]` pick silently changed which workbook opened as people saved. Select with
  `rows.find(r => r.title === entry.title)`. Likewise the empty state is **per-title** (`!match`), NOT
  "zero workbooks in the system" (`!rows.length`) — the latter made Import unreachable for every page once any
  one workbook existed, so workbooks #2/#3 could not be created through the product at all. Import creates with
  `entry.title`, giving each page an independent empty → import → ready lifecycle.
- **Import + save pipeline (FR-1 -> FR-6), in order.** Import: `decodeSheetNames` (LuckyExcel escapes sheet
  NAMES but not formula text) -> `normalizeFormulas`. Save: `reenterNormalizedFormulas` (push corrected
  formulas back through the engine so it recomputes a real value — **pass the plain STRING**; the object form
  `setCellValue(r,c,{f:"..."})` silently leaves the cell empty) -> `serializeSheets` (compaction + a final
  normalize guard that drops stale `v`/`m` on any cell it still has to fix). Transport for BOTH
  `create_workbook` and `save_workbook` is **gzip + `multipart/form-data`** (file field `workbook_json_gz`);
  the nested-JSON body is GONE, there is no fallback. Rationale: nesting the workbook as a JSON string escaped
  every quote (1.23x -> 25.91 MB) and 413'd against the 25 MiB `max_file_size`; gzip is ~0.7 MB.
- **Dropdowns are re-attached at import (DV-2), because LuckyExcel DROPS every `<dataValidation>`.**
  `pricingValidations.ts` re-reads the same .xlsx with the **vendored `window.JSZip` global** (never an npm
  import — that would bundle it), parses `<dataValidation>` **and the `x14:` extLst variant**, and attaches
  `sheet.dataVerification`. Schema: a flat map **`"<row>_<col>" -> record`, 0-indexed, PER CELL** — a
  multi-cell `sqref` expands to one record each. `value1` is polymorphic: a range reference (cross-sheet
  works, including quoted names with spaces and `&`) or a literal comma list. Range sources are **clamped to
  the source sheet's data extent +5** — the engine re-walks the whole range on every dropdown open, so an
  unclamped 50k-row source is 50k iterations per click. Runs AFTER `decodeSheetNames` (matching uses decoded
  names) and never blocks an import. `serializeSheets` keeps the key, so dropdowns survive round-trips.
  **`prohibitInput` is false everywhere (advisory red-flag, owner-vetoable) — and NOTE: validation only
  guards TYPING; programmatic writes bypass it entirely, so a dropdown is a convenience, not a constraint.**
- **ENGINE CAUTIONS (owner-locked, both proven by minimal repro).** (1) **Never emit `INDEX` in composition** —
  `=INDEX(r,2)` is fine but `=INDEX(r,2)*2` returns **0**; use `VLOOKUP` against a key-first helper pair.
  (2) **Never leave `<operator><space>(`** — even `=2 * (1+2)` yields `#NAME?` for the whole cell; a space
  BEFORE the operator is harmless. `normalizeFormulaText` strips it quote-aware (string literals untouched).
  (3) The engine **never evaluates formulas at load** — it renders the cached value, which is why save-time
  re-entry (not just text fixing) is required.
- **Browser-measurement guard:** assert `document.visibilityState === "visible"` before any timing or render
  measurement. Hidden tabs suspend `requestAnimationFrame` (Luckysheet never paints) and throttle timers to
  ~1/min — this manufactured a convincing but entirely false "render hang" that cost two slices.
- **Vendored engine, script-injected — NOT bundled.** Luckysheet / LuckyExcel / JSZip are vendored under
  `nirmaan_stack/public/pricing_libs/` and served at `/assets/nirmaan_stack/pricing_libs/`. `pricingLibs.ts`
  injects the CSS `<link>`s + `<script>`s at runtime in dependency order (plugin.js before luckysheet.umd.js;
  jszip before luckyexcel) and reads `window.luckysheet` / `window.LuckyExcel`. **Never `import` these packages**
  (that would bundle ~3 MB into the app chunk); keep them out of the import graph.
- **Lazy `Component` export (M1.59)** — the page module ends with `export { PricingWorkbookPage as Component }`.
  All three route entries lazy-import the SAME module, so they share one ~10 KB chunk.
- **Sheet init is POST-MOUNT, never synchronous (PM-3):** `luckysheet.create` must run only after the container
  div is mounted. Every create path (load / import / edit / release) calls `requestSheet(sheets, allowEdit)` (a
  nonce-bumped state request); a `useEffect` keyed on `status === "ready" && renderReq` performs the actual
  `initSheet`. NEVER call `luckysheet.create` synchronously inside an async callback — the container is rendered
  only in the non-empty branch, so a pre-`"ready"` create hits a null container (`getElementById → null →
  addEventListener` crash). Re-init (not a live toggle) is how `allowEdit` changes — `destroy()` then `create`.
- **Toolbar always on (PM-3):** `showtoolbar: true` unconditionally; `showinfobar: false`; other bars default.
  Edit-only actions stay gated by `allowEdit`, NOT by hiding the toolbar.
- **Checkout-lock flow + honest banner (PM-3):** page loads READ-ONLY; "Edit" → `checkout` → re-init with
  `allowEdit:true` + Save/Release. On a checkout FAILURE, re-fetch the true lock state: show "Locked by <holder>
  — read only (since <t> IST)" ONLY when `checked_out_by` is non-null AND ≠ current session user AND not expired;
  otherwise surface the REAL error and keep Edit available (retryable). NEVER show an "another user" fallback on a
  null holder (that phantom-lock bug is DIAG-3). unmount + `beforeunload` best-effort `release` (fetch `keepalive`
  with the CSRF header).
- **Save posts the COMPACT form via `serializeSheets(getAllSheets())` (PM-5) — the single source for the save
  shape.** `serializeSheets` (in `pricingLibs.ts`) strips the rebuilt/runtime keys (`data`, `visibledatarow`,
  `visibledatacolumn`, `jfgird_select_save`, `luckysheet_selection_range`) and keeps `celldata` + `config` +
  `calcChain` + display settings. The raw `getAllSheets()` is ~26 MB (Luckysheet rebuilds `data` for every sheet
  at load); compacting → ~14 MB so it POSTs. LOSSLESS — the engine rebuilds `data` from `celldata` on load; this
  is the same celldata-only canonical shape already stored. Any new save-shaped path MUST go through
  `serializeSheets`.
- **Save uses a raw `fetch`, NOT the SDK (PM-6, large-body precedent).** `handleSave` POSTs the compacted body via
  same-origin `fetch` to `/api/method/…save_workbook` (session cookie + `X-Frappe-CSRF-Token` from
  `window.frappe`/`window.csrf_token`), mirroring the `releaseBeacon` + wizard multipart-upload precedent — the
  SDK/axios path stalled intermittently through the Vite dev proxy on the ~18 MB body, while `fetch` completes in
  ~1.6 s (live-verified: 3 button saves + revert, all 200, no hang). Failure parses `_server_messages` for the
  real message and keeps lock + Edit state. **Everything else (checkout/release/get/list) stays on the SDK** —
  small bodies, no reason to change. Watermark opacity is **0.22** (PM-6, darker; still `#D03B45`).

### Dropdowns, access gating, the sandbox, and the import pipeline

- **Watermark** = pointer-events-none data-URI-SVG overlay in the **Nirmaan brand red `#D03B45`** (full name +
  email, tiled ~30°, font 21/weight 600, opacity 0.22 per PM-6) in BOTH read-only and edit modes; must never
  block sheet interaction. Keyed on the USER, not the workbook — it needs no per-workbook parametrization. It
  is a **React SIBLING** of the engine mount (both `absolute inset-0` inside one `relative flex-1`) — NEVER
  reparent `#pricing-workbook-luckysheet` or the watermark strands.
- **Dropdown height cap (`pricing.css`, imported once by `PricingWorkbookPage`):** a bare-ID rule
  `#luckysheet-dataVerification-dropdown-List { max-height: 300px; overflow-y: auto; }` makes long
  range-sourced data-validation dropdowns scroll INTERNALLY instead of rendering at full content height
  (unscrollable + JS-placed off-screen). Capping the height also fixes placement (the engine measures the
  capped element). Short lists are unaffected (natural height, no scrollbar). Bare-ID specificity wins over the
  vendored script-injected styles — no `!important` needed. Accepted residual: a list opened low in the
  viewport can overhang the bottom edge but stays scrollable.
- **Dropdown type-to-search (PW-DS) is an APP-LEVEL DOM augmentation (`pricingDropdownSearch.ts`), never a
  vendored change.** `installDropdownSearch()` (one `useEffect([])` in `PricingWorkbookPage`) runs a
  `document.body` `MutationObserver` that, on each dropdown open, prepends a filter `<input>` into
  `#luckysheet-dataVerification-dropdown-List`. **The input MUST carry `luckysheet-mousedown-cancel`** — without
  it the engine's global mousedown handler dismisses the popup and steals focus (recon-proven). Selection stays
  the engine's own document-delegated `.dropdown-List-item` click (filtering only toggles `display`); the module
  owns arrow/Enter/Escape nav since the engine has none. Pure `filterOptions` / `nextVisibleIndex` are
  unit-tested. NEVER move this into the vendored `pricing_libs`.
- **Full-screen (PW-FS) = root-className FLIP, NOT the native Fullscreen API, NOT a portal.** An `expanded`
  `useState` swaps the page root between `flex flex-col h-[calc(100vh-100px)]` and
  `fixed inset-0 z-50 flex flex-col bg-background` (pure `pricingRootClass`) — ONE JSX tree, nothing remounts
  (engine / lock / sandbox / watermark survive). Native API is BANNED (the Radix save/import dialogs portal to
  `document.body` at `z-50` and would be hidden behind a fullscreened node; against a `z-50` overlay DOM-order
  puts them on top). **`window.luckysheet.resize()` MUST fire on BOTH enter and exit** (a `useEffect([expanded])`
  rAF, guarded on the sheet-inited ref) — the engine's own window-resize listener does not fire on a
  container-only change. Esc-exit uses the pure co-located `shouldExitPricingFullscreenOnEsc` (bare Esc; false
  on `defaultPrevented`; false on INPUT/TEXTAREA) — do NOT import the wizard's twin (the module stays
  standalone). NOTE: Luckysheet `stopPropagation`s Escape at its grid, so Esc exits only when focus is OUTSIDE
  the grid; the toggle button is the universal exit.
- **Access strings (PM-1 DB-verified, profile side):** `PricingRoute` guard + the sidebar spread both gate on
  Administrator OR role_profile `Nirmaan Admin Profile` / `Nirmaan Estimates Executive Profile`. The backend
  (`api/pricing/workbook.py`) also accepts the `Nirmaan Estimates Executive` Role and is the real enforcement
  layer — keep the guard/sidebar strings in sync with each other, not necessarily with the backend Role set.
- **Action-bar role gating (PW-2a).** ONE derived flag drives the whole bar:
  `isPricingAdmin = user_id === "Administrator" || role === "Nirmaan Admin Profile"`, with `role` destructured
  off the EXISTING `useUserData()` call (no new fetch — `PricingRoute` already warmed that SWR key). Admins get
  Edit / Save / Release / Import / **Replace from Excel**; estimation users get **Sandbox only** and never see
  a write affordance (the empty-state Import is admin-gated too). **Gate the bar on
  `roleResolved = role !== "Loading"`** — `useUserData` returns the literal `"Loading"` while the
  `Nirmaan Users` doc is in flight, and without the gate an admin flashes the estimation bar. Client gating is
  **UX only**; the backend write gate (`_require_pricing_write_access`) is the boundary, and `PricingRoute`
  stays wide so estimation users still reach the module.
- **Sandbox pattern (PW-2a): editability WITHOUT a lock.** `requestSheet(sheets, true)` with **no** `checkout`
  call; persistent amber banner + Exit Sandbox, which RE-FETCHES from the server (the engine may mutate the
  array it was created with, so a cached array is not a trustworthy pristine snapshot). Three things keep it
  from ever writing, and all three must be preserved: (1) `releaseBeacon` hard-guards on `lockMineRef.current`,
  which only `handleEdit` sets — **do NOT replace that guard with a `sandbox` condition**, the ref is the single
  truth for "do I hold the lock"; (2) Save/Release render only under `lock === "mine"`; (3) **NEVER pass
  `allowUpdate: true` to `luckysheet.create`** (engine default is false) — with it on, the engine POSTs its own
  deltas to `updateUrl` autonomously, outside the lock, outside `save_workbook`, and outside the Sandbox
  guarantee. The engine binds no Ctrl+S and has no toolbar save item; the Save button is the ONLY save surface.
- **Replace-from-Excel is a SAVE, not a create.** Admin + lock held. Reuses the full `runImportPipeline`
  (shared with the empty-state import), confirms first, re-`checkout`s to refresh the 30-min lock before the
  POST (idempotent for the holder; a long .xlsx conversion can otherwise blow the window), then posts
  `save_workbook` with `{name}`. **Never `create_workbook`** — `Pricing Workbook.title` is `unique: 1`, and
  save preserves the prior content as a version snapshot for free. Payload shape is identical between the two
  endpoints; only the text field differs.
- **Import pipeline stage order is AUTHORITATIVE (PW-2b-i) — every position is load-bearing:**
  `decodeSheetNames -> clampRowBloat -> normalizeFormulas -> runFormulaStage (freeze -> transform ->
  materializeHelpers) -> attachDataValidations`. decode FIRST (LuckyExcel escapes sheet NAMES, not
  formula text). **clamp SECOND is a PERFORMANCE PRECONDITION**, not tidiness — raw ELV converts to
  1,819,874 cells of which 98.8% are style-only filler and every later stage walks celldata.
  normalize before the parser. **DV LAST and after the clamp** — `clampRangeSource` clamps a dropdown
  source to the sheet extent +5, so running it on the bloated grid clamps to ~50,503 instead of ~30
  and reinstates the per-dropdown cost DV-2 removed. `runImportPipeline` returns `{sheets, report}`.
- **Formula transforms are AST-based (`pricingFormulaAst.ts` + `pricingTransforms.ts`), never regex.**
  Transforms COMPOSE inside one cell (an IFS whose branches are each a multi-condition array
  INDEX/MATCH; a LET wrapping another), so one bottom-up `mapNode` pass is what makes composition
  safe — and it is why LET inlining does not duplicate an expensive lookup. **Abstain is a
  first-class outcome**: anything not understood is left UNTOUCHED and reported; the parser never
  throws into the pipeline. ⚠️ **Array formulas carry NO marker after conversion** (no `t:"array"`,
  no braces) — detect BY SHAPE (`MATCH(1,(a=x)*(b=y),0)`).
- **ENGINE CAUTIONS #3-#5 (PW-2b-i, all found only by live Tier-3, all invisible to a green suite):**
  **(3)** a boolean literal poisons the cell — `,FALSE)` returns `#NAME?`, so every generated VLOOKUP
  emits `,0)`. **(4)** **LuckyExcel emits numeric cell values as UNTYPED STRINGS** (`{v:"1.0"}` with
  no `ct.t === "n"`) which the engine normalizes to `1` on load — **never trust `ct.t` on converted
  (pre-load) celldata**; canonicalize by SHAPE (`NUMERIC_LIKE`), which is what keeps helper keys
  matching the engine's runtime key. **(5)** **the engine evaluates ALL IF branches and propagates any
  branch's error** — it does not short-circuit — so generated lookups inside IF/IFS branches are
  wrapped in `IFERROR`; standalone lookups stay bare and honest. ⚠️ **The fallback token must not be
  error-spelled**: the engine coerces the literal `"#N/A"` back into the #N/A error
  (`ISTEXT("#N/A")` is `false`), re-poisoning the very IF the wrap protects. The token is `"n/a"`
  (`ISTEXT` true, survives concatenation, still reads as a miss).

### Helper columns, criterion ranges, and save-time advisories

- **Helper columns follow the FIXED workbooks' own convention:** `_mk` marker in the header row, key
  `=A2&"|"&B2`, value mirroring the result column, pair allocated at `maxCol + 2`, hidden via
  `config.colhidden`. **Each helper cell carries `f` AND a pipeline-computed `v`** — the engine never
  evaluates at load (FR-6), so a bare formula reads blank and every lookup returns `#N/A`. A source
  cell that is itself an unevaluated formula yields an EMPTY key for that row, never a partial key
  that could match the wrong record. `_mk` is also the IDEMPOTENCY marker (snapshot which sheets have
  it BEFORE writing, or the first pair you write hides every later pair on that sheet).
- **Criterion-range harmonization (owner-directed):** when the criterion + result ranges share a start
  row and a strict MAJORITY span, an outlier whose END differs by <= `MAX_HARMONIZE_ROWS` (2) is
  pulled onto the consensus and reported as class `harmonized`. A tie, a differing start row, or a
  larger gap still abstains — those bounds are what keep it a typo-fixer rather than a guesser.
- ⚠️ **Testing lesson (PW-2b-i):** the Tier-1 tests assert the emitted formula TEXT, which is correct,
  and they structurally **cannot** see that the engine mis-reads that text at runtime. Cautions 3, 4
  and 5 were all invisible to a fully green suite. **Anything about engine SEMANTICS must be proven
  in a live Tier-3 run.**
- **Consent-based live fix (`pricingLiveFix.ts`, PW-2b-ii + PW-2d).** `[Fix]` eligibility is DERIVED, not a
  hand-kept class list: `assessFix` runs the hit through `transformFormula`; a **helper-FREE** rewrite
  (`helpers.length === 0`, or a dead-Google `freeze`) is fixed in the LIVE engine; a **helper-CLASS** rewrite
  (multi-cond INDEX/MATCH) is fixed OFFLINE at save (below). Live writes mirror FR-6 (`setCellValue` with the
  plain STRING) and go through **`withSheetActive`** — activate the hit's sheet, write, restore the prior active
  sheet. ⚠️ **ENGINE CAUTION #6 (owner-locked):** `setCellValue` on a NON-active sheet CORRUPTS it — a bulk write
  rebuilds that sheet's cell store from an incomplete grid and DROPS every unrendered row (proven: a live
  Termination table went 154 rows → 0 and the save persisted the gutted sheet). NEVER write a non-active sheet;
  `withSheetActive` is the guard (`setSheetActive` is synchronous — no render-await). The import report is a
  receipt (`ImportReportDialog.tsx`), `lastReport` session-only. ⚠️ **Backend `_prune_versions` deletes via raw
  `frappe.db.delete`, NOT `delete_doc`** — a list-shaped version doc otherwise trips the list-valued-JSON load
  wall on the 21st save; every save-shaped path on an array-`workbook_json` doc avoids `doc.save()`/`delete_doc`.
- **Save-time helper-class fix + single-action dialog (`pricingLiveFix.ts` / `pricingHitEval.ts`, PW-2d — Option 3).**
  The advisory dialog is Cancel + ONE primary action: **"Fix all & save"** when any hit is fixable (helper-free AND
  helper-class ride the same click), **"Save anyway"** when hits exist but none fixable, **"Save"** at zero hits;
  each row shows **"will be fixed"** / **"no automatic fix — saved as-is"** (`isAutoFixable` = helper-free OR
  `REASON_NEEDS_HELPER`). Helper-class hits are fixed **OFFLINE on the serialized payload** — `materializeHelpers({force:true})`
  writes the pairs into `celldata` with computed values + `config.colhidden`, each hit gets its rewritten VLOOKUP,
  then ONE save, then `requestSheet(fixedSheets,true)` re-inits so `create()` renders the stored values. **NEVER via
  live `setCellValue` on the (usually non-active) table sheet (CAUTION #6), and NEVER `refreshFormula()` — ⚠️ ENGINE
  CAUTION #7:** a global recompute force-evaluates every formula and cascades `#NAME?` (the engine renders Excel's
  cached values on load, FR-6), and a `setCellValue` re-entry of the rewritten hit THROWS (it rejects a VLOOKUP whose
  key is a `&`-concatenation). **FIXED-CELL DISPLAY (owner call):** `pricingHitEval.computeHitValueExact` stores the
  hit's value **only where it resolves EXACTLY** against the just-built helpers (VLOOKUP dict lookup, resolvable refs,
  `& + - * /`, `ROUND*` with integer digits) — anything else (IF/IFS/IFERROR/branch, unknown fn, missing ref, VLOOKUP
  miss) leaves the cell BLANK (recomputes on the next edit). **Stored `f` always correct; `v` exact-or-absent — NEVER
  an approximation** (a wrong cached `v` would display wrong until a recalc). The report labels each row **"value
  computed"** vs **"blank until recalc"**; `canonicalizeCellValue` (pricingHelpers) is the SINGLE source for the
  criterion/key canonicalization so an offline VLOOKUP key matches the materialized helper key by construction.
- **Save-time formula advisory (`pricingFormulaScan.ts`, PW-2a) is WARN-ONLY and PURE.** Scans
  `sheets[].celldata[].v.f` **after `serializeSheets`** so it sees exactly what will be persisted. Flags INDEX
  anywhere (ENGINE CAUTION #1 — `=INDEX(r,2)*2` silently returns 0), the engine-absent `XLOOKUP`/`IFS`/`LET`,
  and any name outside `window.luckysheet_function` (a plain object keyed by UPPERCASE name, 371 entries;
  `supportedFunctionsFromEngine` returns null when it is missing/implausible and the unknown-name rule is then
  **skipped — fail-OPEN**, never warn-on-everything). Detection strips BOTH `"..."` literals and `'...'`
  sheet-name references before matching `identifier(`, so `="INDEX of items"` and a sheet named
  `'Sheet (old)'` are not flagged. `handleSaveClick` scans then opens the dialog; `performSave` posts the
  ALREADY-SCANNED sheets so Continue never re-runs the 400 ms re-entry pass. Keep the module side-effect free —
  PW-2b's consent-based fixing is meant to be a caller change, not a rewrite.

### Rate Master (RM-2) -- Frontend Conventions

The pricing helper's read surface, SEPARATE from the pricing workbook pages. Lives in
`src/pages/pricing/rate-master/`. Reads the RM-1 endpoints (`nirmaan_stack.api.boq.rate_master.
get_rate_master_items` / `get_rate_category_config`) as-is -- NO backend coupling. Full as-built lives
in the plan doc.

- **The page home is owner option (a):** a `Rate Master` route (`/rate-master`) beside the pricing
  workbooks, `PricingRoute`-guarded (UI gate only; the endpoints' login requirement is the enforcement),
  lazy + `export { RateMasterPage as Component }`. `rateMasterRegistry.ts` is registry-shaped like
  `pricingWorkbooks.ts` (Electrical today); the sidebar registration is the SAME four registry-driven
  touches the pricing workbooks use (role-gated item, `allKeys`, `groupMappings`, flat-label Set).
- **⚠️ THE CATEGORY PICKER IS REGISTRY-DRIVEN, NOT CONFIG-DRIVEN, so RETIRING a category means removing
  its `rateMasterRegistry.ts` line in the SAME change (owner-locked).** The list on screen comes from the
  registry, never from which configs are active — retire the config alone and the category is still
  offered, and choosing it renders "No active config found for …". **And retirement itself is
  `retired_category_ids` in the asset, NEVER omission**: a category merely dropped from an asset is
  outside the `replace=True` supersede scope and stays ORPHAN-ACTIVE. There is no delete path in the
  loader or any admin endpoint — this module is freeze-and-supersede, so "remove a category" is always
  "retire it + drop its registry line".
- **THE TWO DOWNLOAD SURFACES ARE GROUPED BY PURPOSE, NEVER BY FILE FORMAT (owner-approved copy).**
  *Download to edit* (CSV, one row per item — a pricer edits it in Excel and uploads it back) and
  *Download a backup* (the loader-ready asset JSON — bootstrap + restore, **not** hand-editable, and
  nothing reads an edited one). Someone choosing between "CSV" and "JSON" is choosing an extension,
  not an intention, and the failure this guards against is taking the BACKUP, editing it, and finding
  nothing reads it back. All wording is single-sourced in `rateMasterDownload.DOWNLOAD_COPY` so the two
  surfaces cannot drift; a test pins that neither group label may name a file extension.
- **EVERY CSV ROW CARRIES `item_uid`, and that is what makes the round trip possible.** Without it the
  upload cannot tell an edit from a new item, and matching on content would turn every rename into a
  silent duplicate. Values are emitted **AS STORED** (a float stays `4.0`; nothing is prettified) — a
  CSV that tidies its values is not a round trip. A category with no items yields a **headers-only
  TEMPLATE**, never an error; an **unknown** category *is* an error, because absence and nonsense are
  different answers. Both download endpoints are **ADMIN-GATED, gate first** — the panel is HIDDEN for
  non-admins (never disabled) and the endpoints are the real boundary.
- **A DOWNLOAD EITHER PRODUCES A FILE OR EXPLAINS ITSELF.** Frappe puts the useful text in
  `_server_messages` / `exception`, **not** in `message`, so the pure `downloadErrorMessage` reads them
  most-specific-first and strips the `frappe.exceptions.X:` prefix. It shipped once as
  `(e as {message?})?.message ?? "…"`, which rendered a real stale-worker `AttributeError` as the
  entirely uninformative "There was an error." — never reintroduce a generic catch-all here.
- **THE UPLOAD SURFACE IS UPLOAD → PREVIEW → CONFIRM → APPLY, AND NEVER ONE STEP (owner-locked).**
  `RateMasterUploadDialog.tsx` sits IN the same dashed panel as the downloads, immediately after
  *Download to edit*, because it is the SECOND HALF of that one action — download, edit, upload.
  Pairing it with the *backup* group instead would attach it to the file nothing reads back, which is
  the exact confusion the purpose-based grouping exists to prevent. **THE DIALOG DECIDES NOTHING:**
  the server computes the whole plan (what changed, what is major, what is an error) and this only
  RENDERS it. A second client-side copy of the 10% rule or of the upsert semantics would be free to
  disagree with the write that actually happens — the one failure a preview must never have — so
  `splitChanges` reads the server's `major` flag and never re-derives the threshold.
- **THE FILE IS SENT AS BASE64 BYTES, NOT AS TEXT.** Reading it as text forces a decode in the
  browser, which silently picks UTF-8 and would mangle the cp1252 file Excel produces when the user
  chooses plain "CSV" rather than "CSV UTF-8". Sending bytes lets the SERVER report which encoding it
  actually read, and the dialog surfaces that as a warning — surfacing the problem instead of
  guessing at it. The bytes are held in a ref so **APPLY sends exactly what was PREVIEWED**; re-reading
  the file on confirm would let a file changed on disk in between be applied against the wrong preview.
- **HEADLINE COUNTS ARE THE OWNER'S FOUR, PLUS AN HONEST FIFTH ONLY WHEN NON-ZERO.** `rates changed ·
  items added · rows unchanged · errors` are the named four; `other changes` appears ONLY when a row
  moved in some way other than a rate (an attribute Excel rewrote, a renamed kind). Such a row is none
  of the four, and folding it into one of them would MISLABEL it — an honest extra count beats a wrong
  one, and it stays out of sight on the ordinary rate-edit upload. **Expanded by default: every new
  item and every rate move of ≥10% IN EITHER DIRECTION; everything else collapses behind a count that
  opens in one click.** Errors block Apply absolutely — the apply is all-or-nothing, so a partly-good
  file is not partly appliable. The copy (`rateMasterUpload.UPLOAD_COPY`) is single-sourced like
  `DOWNLOAD_COPY` and must keep naming the two facts that make confirming safe: **absent items are
  left untouched**, and **a snapshot is saved first so this can be rolled back.**

### The interpreter surface, the Data Viewer, and RM-4a admin editing

- **`ratePipelineInterpreter.ts` is THE single compute source (owner-locked) -- a PURE TS module with NO
  React imports.** It executes the stored pipeline step vocabulary (`match_master_row`,
  `apply_effective_multiplier` with conditions, `scale`, `component`, `component_band`, `sum_components`,
  `install_as_ratio`, `roundup`) and produces per-step traces + finals. **Formulas are read FROM the
  config and evaluated by a tiny safe arithmetic evaluator (no `eval()`, CSP-safe) -- never hardcode the
  arithmetic.** EXACT matching on canonical values (no case-insensitive matching anywhere). **RM-3's
  pricer-facing helper consumes this module UNCHANGED -- there must never be a second implementation of
  this arithmetic.** The four RM-1 goldens are its standing REGRESSION CANARIES (stable snapshots of
  what the system produces, not oracles).
- **Dynamic columns come FROM the config's `attribute_definitions`** (kind, brand, one column per
  definition, the rate fields present, unit, source) -- never a hardcoded column list.
- **Unknown step type = an explicit "unsupported" state, never a silent skip** (forward-compat honesty for
  future step types). A combination with no master row renders an honest no-match with zero computed values.
- **`runPipeline` NEVER throws on data shape (EA-DIFF Option C, owner-locked):** the step loop is wrapped so a
  data-shape formula throw (an unbound identifier / malformed expression -- e.g. a `scale` step carrying
  `conditions`, a shape only `component` binds) DEGRADES to the honest `unsupported` status for that pipeline;
  the Derivation tab AND the pricing helper render the honest state and NEVER hit the React error boundary. A
  well-formed pipeline is byte-unaffected. Contract enforcement, not new vocabulary.
- **Data-Viewer empty-scope rule (EA-DIFF, owner ADDENDUM):** a category whose resolved kind set is EMPTY
  (declared `item_kinds:[]` AND no pipeline-derivable kind -- `point_wiring`, the first kind-less category)
  renders an HONEST EMPTY STATE (0 items, no kind chips, no Add-row, a "no data rows of its own" note) via the
  pure `rateMasterStructure.isCategoryDataScopeEmpty(config)`. It MUST NEVER fall through to the discipline-wide
  all-items list (the pre-EA-DIFF `: items` fallback surfaced all rows with mixed columns). LMS
  (`item_kinds:["lms_item"]`, empty pipelines) resolves a kind -> UNCHANGED.
- **BCS pipelines ARE shown here** (internal transparency surface); only the pricer-facing helper defers BCS.
- **The viewer search is CASE-SENSITIVE across all displayed cell values** -- the data is canonical
  UPPERCASE, so a mixed-case query intentionally finds nothing (mirrors the RM ethos: no case-insensitive
  matching anywhere).
- **RM-4a editing is ADMIN-ONLY (owner option (a); full detail in the plan doc's "Build slice RM-4a").**
  Estimates sees everything READ-ONLY -- every edit affordance is `{isAdmin && ...}` (HIDDEN, never
  disabled), gated by the pure `isRateMasterAdmin(role, userId)` in `rateMasterEdit.ts` (mirrors
  `canAdminOverride` / the server `_is_nirmaan_admin`; false while `role` is "Loading"/"Error"). The server
  (four `api/boq/rate_master.py` write endpoints) is authoritative. **PARAM VALUES ONLY** -- pipeline
  STRUCTURE / condition / attribute-definition editing is RM-4b. **Derivation tab:** each NUMERIC param in a
  step's `detail` cell is an inline edit (`InlineParamEdit`: pencil -> input, Enter saves / Escape cancels);
  the condition `when` + string params (e.g. `kind`) stay read-only. The matched-condition path is
  re-derived by `matchedConditionIndex` (config + matched item, EXACTLY as the interpreter matches) so the
  interpreter is NEVER touched. **Data tab:** an admin ACTIONS column (inline row rate/attr edit; deactivate
  via AlertDialog confirm -- freeze-and-supersede, dropped from active view, NEVER deleted) + an `AddItemDialog`
  built from the attribute definitions + rate keys; manual rows carry "Manual entry" provenance. Each write
  refetches its collection so the derivation/viewer recompute live -- and the persistence split carries the
  edit into the next pricing-panel compute with NO AI re-run. The interpreter goldens are REGRESSION
  CANARIES: an edit-and-revert must still reproduce them, which is what makes an unintended change
  visible.
- **Data Viewer per-column-header faceted filters (`RateMasterDataViewer.tsx`):** EVERY column header
  (kind / brand / every category attribute / every rate key / unit / source sheet / row) carries a filter
  funnel opening a `ColumnFilter` Popover -- a type-to-search box over that column's DISTINCT values + a
  checkbox multi-select. A unified `columns` model (`{key, get}`) is the SINGLE source for both the
  distinct-values dropdowns (`distinctByColumn`) and the row predicate (`getForColumn`), so headers and
  filtering never drift. Composition: **AND across columns, OR within a column**; a global `Clear filters (N)`
  control shows the active-column count and resets. Purely CLIENT-SIDE over the already-loaded active items
  -- no new query, no backend change, read-only (composes cleanly with the RM-4a admin editing above).
- **Data Viewer is CATEGORY-SCOPED (`RateMasterDataViewer.tsx`, owner-locked).** The tab shows ONLY the
  selected category's items + columns. The category's kinds come from `categoryItemKinds(config)`
  (`rateMasterStructure.ts`, pure + vitested): the config's declared `item_kinds` if present, ELSE derived
  from the pipelines' `match_master_row` params (the legacy wiring config predates item_kinds ->
  {cable, termination}). `scopedItems = items.filter(kind in categoryKinds)` drives every derivation (rate
  columns first-seen over ITS items, kind chips, filters, the count badge). The KIND column + chips render
  ONLY when the category spans >1 kind. **A top-level `item_kinds` config key is accepted by the RM-4b
  `_validate_config` allowlist** (else editing an E-ALL config would break). **Actions column is FIRST and
  `sticky left-0`** (visible at any H-scroll); admin hide-not-disable is unchanged -- a non-admin renders NO
  actions column (no ghost gutter). **The always-visible horizontal scrollbar is the RM-3b PROXY pattern**
  (from `PricingGrid.tsx`, now the STANDING single-bar rule for ALL wide tables): the real scroller
  suppresses its native H-bar (a `*-hidehbar` webkit CSS class, X-scroll capability kept) and a sticky-bottom
  proxy mirrors its `scrollLeft` two-way, with the proxy's visible width == the scroller's `clientWidth`
  (V-bar leak accounted) and a spacer == `scrollWidth`, both live-measured via a ResizeObserver;
  `border-t`-only on the proxy so proxyMax == scrollerMax. The Add-row form is likewise category-scoped (its
  attribute definitions + rate keys + kind preselected read-only for one kind, a select for several).

### RM-4b structure editor - the Pipelines tab

- **RM-4b structure editor -- the THIRD tab "Pipelines" (`RateMasterPipelines.tsx` + `rateMasterStructure.ts`).**
  LIFTS the RM-4a param-values-only line: add/remove params, steps, conditions, and attribute definitions.
  READ-ONLY structural view for everyone (attribute-definitions table + each pipeline as its ordered step
  list + the stored goldens); ADMIN EDIT MODE (owner option (a): hide-not-disable) with step
  add(vocabulary picker)/remove/reorder, per-step param add/remove/rename, condition-branch + component-band
  add/remove/edit, attribute-definition add/edit/remove (a referenced def's remove button DISABLES via the
  client mirror `referencedAttrIds`; the server guard's verbatim error still surfaces on save), and the
  brand `selector` flag as an editable checkbox. **THE PREVIEW GATE (`rateMasterStructure.ts`, pure +
  vitested):** before save the page computes ALL config goldens against the DRAFT (the SAME pure
  `ratePipelineInterpreter` + live items) and shows a pass/delta table; unchanged -> green "Save", any delta
  -> "Save with N changed goldens" opening an AlertDialog that lists the deltas and requires an explicit
  confirm (**confirm-NOT-block** -- deltas impossible to miss, never forbidden). `evaluateGoldens` WRAPS the
  interpreter in try/catch so a transiently invalid draft reports `got=null` instead of crashing the preview
  (it does NOT change the interpreter). Save calls `update_rate_config` (the server re-validates -- the
  authority); the refetch flows the new structure into the Derivation + Data tabs and the pricing helper
  with no code + no AI re-run (persistence split). **Goldens are CONFIG DATA** seeded via the endpoint; the
  vitest golden files stay independent pins. Full as-built + cert: plan doc "Build slice RM-4b".
- **Interpreter step vocabulary (owner-locked, MINIMAL; full detail in the plan doc's "Build slice EA-1").**
  The pure `ratePipelineInterpreter.ts` is the SINGLE compute source; there is NO loose-formula
  generalization (that is how silently-wrong sneaks in) — the stored configs normalize every formula to
  `base` = the step's target value + EXACT param names. Beyond the wiring set it supports: `component_band`
  STRING-EQUALITY bands (`chooseBand`; band_on read from the matched item, falling back to the selection)
  alongside the legacy numeric comparator bands; a `scale` value-from-attribute multiply (a `*_from_attr`
  param binds the selected attribute — missing/non-numeric → HONEST `no_match`, never a zero default);
  `match_master_row` on the stored-vs-selected INTERSECTION (a row matches on the keys it carries, exact
  where they overlap — wiring is byte-unchanged); a conditional `component` (params via attribute
  conditions on the SELECTION, formula may be param-only — unmatched → HONEST no-compute, never a zero
  adder). **A `component` may carry BOTH a `target` (base bound from the matched row) AND `conditions`
  (params from the selection) in one step** — e.g. the tray `cover` (`base*factor`); this shape needed no
  interpreter change. **EA-2b — the CORRECTED cable-tray config is FOUR pipelines** (`tray_boq_supply` /
  `tray_boq_install` / `tray_bcs` / `tray_bcs_install`): conditional-`component` adders (cover /
  ceiling-accessories 106 / refill 180 / cutting 200) + a **width-table install match** (kind
  `tray_install_rate`, ×4). The old single `tray_boq` (install = supply ×0.2, golden 280/60) was WRONG and
  is DELETED; the regression-canary goldens t1/t2/t3 (431/120/297/0, 415/120/286, 410/200) are the standing pins (the
  dead 280/60 interpreter-test fixture was replaced). **EA-2c — `component_ref` (a NEW interpreter step):
  base from a SEPARATELY-REFERENCED master row** matched by `ref.kind` AND every `ref.attributes` (exact
  canonical, this discipline); UNIQUE resolution (zero OR multiple -> HONEST no-compute); the referenced
  row's `target` binds as `base`, conditions/params/formula per the component contract; the trace names the
  referenced row (`StepTrace.refItem`, rendered by `detailFor`). First-class vocabulary member
  (STEP_VOCABULARY + blankStep + the server validator). **Owner: the earthing adder ADDS A BUS BAR (the
  existing Bus bar earthing_item row), NOT an earth chamber** (the chamber attempt was reverted; asset
  skipped v8, v7->v9). ONE ROW, TWO ROLES: the Bus bar row prices both as a selectable item AND as the
  adder; an edit flows into both. **component_ref is the ASSEMBLY PRIMITIVE's simplest form.** **EA-4a
  SHIPPED the assembly engine (owner-locked, `ratePipelineInterpreter.ts`):** `circuit_fit` (sizes conduit +
  counts circuits, binds `fitted_size`/`circuits`/`conduit_qty`) and `component_ref` extended (ref attrs
  literal | `@attr` | `@fitted_size`; `rate_stages [{mult,round?:up0|up-1}]` with PER-STAGE rounding; `qty` =
  number | `{from_attr}` | `{from_fit}` | `{if_attr,then,else}`; UNIQUE resolution else honest no-compute;
  Option-C never-throws). **PER-STAGE rounding is faithful + INTENTIONAL** (install switch `ceil(list*0.3625)`
  THEN `*0.2` UNROUNDED — pw1 `155*0.2=31`, pw2 White `131*0.2=26.2`); never collapse to one final round.
  **`point_wiring` is LIVE**; goldens **pw1 1869/735/1370** + **pw2 1823/722.2/1342** (MS→3 circuits;
  fractional 722.2) are config data + standing pins, and a golden's attrs are an ATOMIC SET. **`values_from`
  is resolved in the editor helper too (owner Option 1):** `pricingSheetHelper.attributeOptions` (pure,
  exported) mirrors the Derivation resolution — options from the live master by `kind` + `where` — so an
  AI-extracted item with no static `values` DISPLAYS in the panel select and a partial row completes from the
  catalog (the switch/socket/plate dropdowns were empty before). **EA-4a-r SHIPPED the NONE mechanism
  (owner-locked):** the sentinel string `"None"` (`NONE_SENTINEL`, exported from `ratePipelineInterpreter`) is
  POSITIVE ABSENCE, distinct from blank=unknown -> that component line is an EXPLICIT ZERO. A `component_ref`
  `none_skips` zeroes a line whose ref binds an `@attr`=="None" (fired before the ref lookup; back_box binds
  @plate_item, so plate=None zeroes it too); `circuit_fit.optional_wire_when_none` drops that wire from the dia
  (single-wire fit). **The affordance is GENERIC + input-appropriate:** a CHOICE allow_none def offers "None" at
  the top of its select (`optionsFor`/`attributeOptions`); a NUMBER allow_none def offers a "None" CHECKBOX
  beside the numeric input (checked -> sentinel + input greys/clears) -- both in RateMaster Derivation AND the
  editor panel; `WorkingsAttribute` gained `disabled` + `allowNone`. `coerceForMatch` PRESERVES "None" for an
  allow_none def (number included). Selecting None greys+clears the `disables_when_none` targets. Goldens: pw3
  (socket="None") -> supply 1682; single-wire (wire2="None") -> 1362. **A switch-only light point (socket_item
  null, no None set) is an HONEST NON-COMPUTE — became priceable via the None sentinel at EA-4a-r.** **EA-4b
  SHIPPED switches_point + the industrial_sockets paired-MCB (DATA-ONLY, no interpreter change):**
  `switches_point` = a 6-line switch/socket/plate/box assembly (TWO None-able socket slots, distinct from
  point_wiring; golden sp1 2320/470/1600; a new registry line "Switches Point"); `industrial_sockets` gained a
  CROSS-CATEGORY `paired_mcb` `component_ref` (ref.kind `db_switchgear_item`) gated by a `qty if_attr`
  interlocked rule, with `extraction_defaults={paired_mcb:"None"}` so a socket-only row prices (absent=unknown
  ->no_match; "None"=positive-absence->0). Tray ceiling-accessories = a CONFIRMED FIXED 106 scalar. **switches_point
  has ZERO production coverage until the Electrical CLASSIFIER emits it (rows resolve to switches_sockets today) --
  a classifier-vocab gap like popup_boxes/LMS; industrial_sockets IS emitted.** **EA-4c SHIPPED the DB build-up +
  the `lookup_or_ratio` interpreter step (owner-ruled ONE new capability):** the build-up is FIVE FIXED None-able
  MCB slots (sheet I10:I14) + a `db_shell` slot (allow_none -- **MCB-only, shell None, is a REAL product = the
  sheet's `IF(J9=0)` branch**) + enclosure, summed x0.495/x0.3 -- supply+bcs are EXISTING vocabulary
  (`component_ref none_skips` cross-kind to the NEW `db_shell` kind), so the old "variable-length list + list
  extraction extension" prediction was WRONG (the scalar payload carries the fixed slots, no extension). **`lookup_or_ratio`**
  (in `ratePipelineInterpreter.ts`; `LookupOrRatioStep` in `rateMasterTypes.ts`; `STEP_VOCABULARY` in
  `rateMasterStructure.ts`) is the sheet's EXACT IFERROR three-way install: shell absent (`when_shell_absent.attr=="None"`)
  -> `ROUNDUP(ratio.of x mult)`; else the unique install-table lookup (`kind`+`item`==`@attr`) resolves -> `ROUNDUP(matched[target] x mult)`
  [table-hit]; lookup MISS -> the ratio fallback. Uncomputed `ratio.of` -> honest no_match; malformed shape NEVER throws
  (Option C -> `unsupported`); the trace NAMES the branch. Goldens dbu1 (VTPN fallback 24360/**3660**/14760) / dbu2 (TPN 8WAY
  table-hit install **1500**) / dbu3 (MCB-only shell None 23840/**3580**/14450) -- all live-verified in the Derivation. **This
  CLOSES the assembly-category arc.** A discarded v16b data-only attempt (shell REQUIRED, no none_skips) was reverted for the
  owner ruling that MCB-only is real. **EA-4d (owner-locked) SPLIT the `lookup_or_ratio` rounding: `round_lookup`
  (the install-table-hit branch) + `round_ratio` (the shell-absent + IFERROR-fallback ratio branches) round
  SEPARATELY; the legacy single `round` stays the fallback for both (backwards-compat).** v17's step sets
  `round_lookup: null` -> the table-hit is UNROUNDED `matched[target] x mult` (sheet-faithful BY ORIGIN
  -- the sheet was retired 2026-08-19 and the behaviour stands), while
  `round_ratio: -1` rounds the ratio branches to tens. This corrected the EA-4c drift: **dbu4 TPN-6WAY table-hit
  install `850 x 1.5` = 1275 UNROUNDED** (was over-rounded to 1280); goldens are now dbu1 (fallback 24360/3660/
  14760) / dbu2 (TPN-8WAY table-hit 1500) / **dbu4 (TPN-6WAY 1275)**, d1/d2/dbu3-single-item removed. **The wiring + point_wiring + switches_sockets + DB-build-up goldens are the standing regression pins for every addition** (`switches_point` was RETIRED 2026-08-08; its `sp1` golden went with it). The Rate Master
  category selector is REGISTRY-driven (`rateMasterRegistry.ts` lists all eleven Electrical categories),
  NOT config-read. **`module_fit` (owner-locked) computes a row's MODULE COUNT in the PIPELINE, never by
  the model** — a model-selected plate leaves NO trace, and the trace is the point: the step emits the
  arithmetic AND the ladder hop on one line, because a price must show its working. **Its weighted sum is
  CONFIG (weights AND attribute ids), never hardcoded** — `switches_sockets` has TWO socket slots and
  `point_wiring` has one, so a fixed two-attribute formula is not portable. **Its ladders derive from the
  CATALOG, never from a params array** (a ladder spec names a `kind` + a `where` family and carries no size
  list, so adding/retiring a plate size needs no config edit): EXACT if the catalog carries the size, else
  the **NEXT HIGHER**, never a lower one. **`"1M & 2M"` is ONE item covering TWO sizes** (every integer in a
  rung's label is a covered size), so a computed 1 and a computed 2 both match it on the ordinary exact
  path. Above the ladder's top is an HONEST NO-COMPUTE, NEVER clamped to the largest rung (a DELIBERATE
  divergence from `circuit_fit`, which falls back to its largest size but then re-checks `circuits <= 0`;
  `module_fit` has no second gate). A ladder's fitted LABEL binds for a later `component_ref` `"@<bind>"`
  exactly as `circuit_fit` binds `fitted_size`; label bindings live in their OWN scope resolved ahead of
  the selection, and every pipeline without a `module_fit` stays byte-identical.
  **TAKE-THE-LARGER (owner-locked; REPLACES the earlier stated-wins rule):** a ladder's `floor_from` names
  the attribute whose stated count is a **FLOOR, never a ceiling** — the plate priced is
  `max(stated, computed)`, so a stated plate too small for its contents is **UPGRADED** rather than
  refusing the row (a BoQ typo must not kill a line), and a stated plate bigger than needed is bought.
  **An UPGRADE MUST ALWAYS BE VISIBLE in the trace.** **Blanks derive from the plate ACTUALLY SELECTED and
  CLAMP AT ZERO**, never negative and never a refusal; the clamp is named in the trace too.
  **The BACK BOX takes the SELECTED plate's module COUNT re-fitted on its OWN (shorter) ladder — NEVER the
  plate's label:** no 9M/16M back box exists, so a 9M plate pairs with a **12M** box and 16M with **18M**,
  and copying the label made the WHOLE ROW unpriceable (a live defect before slice 2 part 2). A `"None"`
  plate keeps the plate line at ZERO while only the BOX takes the computed count — a box may exist with no
  face plate.
  **A ZERO module count with `back_box = Yes` FITS A 3M BOX — the STATE-A fallback (owner-locked).** A
  light point on an MCB has no switch and no socket, so nothing fits any ladder and the box vanished with
  the plate; a light point still needs a junction box. A ladder may declare `on_zero_modules`, read ONLY
  on the zero-count path. **It names a module COUNT, never a catalog label** — the catalog still supplies
  the rung. **The PLATE ladder must never declare it**, and **STATE B (`plate_item: "None"` with a
  NON-ZERO count) is OUT OF SCOPE and structurally unreachable** — `on_none: "computed"` already boxes
  those rows correctly and a wider reading would DOWNGRADE them. **It does NOT re-gate on `back_box`**:
  the component's own `qty: {if_attr: {back_box: "Yes"}}` is where that question is already answered.
  **WIRE INSTALL STEPS IN THREES; SUPPLY AND BCS STAY LINEAR (owner-locked).** The install multiplier is
  `ceil(runs / divisor)` — three runs is three times the WIRE but one unit of LABOUR. **The divisor is
  CONFIG, never hardcoded**: a rate stage carries `mult_step_divisor`, a `scale` param carries
  `<ident>_step_divisor`, and both resolve through the ONE exported `stepFactor` so they cannot drift.
  **ABSENT ⇒ the raw factor, byte-identical.** It never softens either site's existing no-compute rule
  (`scale` still hard-fails on a missing source attribute; a rate stage still resolves absence to 1 via
  `absentMeansOne`, which the point_wiring goldens depend on) and can never yield 0. **`ceil(n/3)` needed
  NEW interpreter work** — `tokenize` accepts `+ - * /` and `parseFactor` has no call syntax, so an
  identifier followed by `(` throws; every existing rounding rounds a product, never a factor.
  **⚠️ TERMINATION INSTALL INHERITS RUNS THROUGH `install_as_ratio` AND MUST NEVER CARRY ITS OWN
  MULTIPLIER (owner-locked).** `install_as_ratio` sits AFTER the supply `scale` and reads the
  already-multiplied supply, so the inheritance IS the multiplier; a second one would be runs-SQUARED
  (pinned by the `"never squared"` test). Its position and its trailing `roundup(-1)` are equally
  load-bearing — reordering would move where the rounding lands. Leave all three alone.
  **⚠️ A `scale` step's `matchedCondition` is NOT RENDERED by the Derivation tab.** `RateMasterDerivation`
  shows the param chips for any step carrying `params` and only falls through to `detailFor` when there
  are none, so a note attached to a step WITH params is computed and never seen. The step function's
  working is therefore visible on a `component_ref` (point_wiring wire install, where it rides the
  existing `rate N x qty M` string) but NOT on the `scale` site (wiring_cabling cable install). Live-verified.
  **THE BLANKER'S COLOUR FOLLOWS THE ASSEMBLY and is NEVER hardcoded (owner-locked).** The blank
  component's ref binds `colour: "@colour"` like every other component, so a Grey assembly prices the
  Grey blanker and a White one the White blanker — a REAL price difference, not cosmetic. A hardcoded
  colour does NOT fail at runtime; it silently prices the wrong catalog row, which is why the guard is
  a PIN (the price path, never the colour string) rather than a code check. `1M Blanker` is the only
  blanker in the catalog, so the colour is the sole free variable on that line.

### Derivation-screen field semantics - blank_qty, veto, and warnings

- **⚠️ SUPERSEDED — `blank_qty` IS EDITABLE AGAIN, SEEDED WITH THE COMPUTED COUNT (owner-locked).** The
  read-only ruling below is REVERSED: the blanker is no longer selected by extraction, and
  `module_fit` now READS the quantity and arbitrates it against the plate's SPARE capacity, so an edit
  genuinely reaches the price and a locked field would be the lie the read-only contract exists to
  prevent, pointing the other way. **An over-count is CORRECTED to the spare (never the plate's total);
  an under-count is HONOURED** — two notes, deliberately opposite in meaning, and the asymmetry must not
  be flattened. The field reuses the FACE PLATE's seeded-but-editable state (`derived` + `derivedValue`,
  `readOnly` never set); nothing new was invented for it. **Which attribute is arbitrated is READ FROM
  CONFIG** (`blanksQtyAttr`, the `blanks.qty_attr` key), never by id — a config without it keeps the
  fully-superseded read-only behaviour below, byte-identically. ⚠️ **"THE TWO SCREENS STAY APART" IS SUPERSEDED (owner ruling Q4(i), slice 2d).** It used to say the
  Rate Master Derivation screen must read `derivedQtyAttrs` (the superseded-qty half) and never
  `derivedAttrIds` (both halves). **That screen is now a PURE CALCULATOR: you state the INPUTS, and
  every attribute the pipeline DERIVES leaves its selects and appears only in the step lines.** The
  rule existed to stop a genuinely editable field being frozen; the ruling accepts that cost in
  exchange for a screen on which every control is an input.
  ⚠️ **IT COSTS THREE BENCH CAPABILITIES, and each is now pinned by a unit test instead of by that
  screen** -- take-the-larger's UPGRADE (a stated plate too small), `derive_attribute`'s STATED-WINS
  (a stated circuit length), and `catalog_fit`'s stated-`"None"` STICKING. None can be exercised there
  any more, because none of their attributes has a control.
  ⚠️ **The predicate lives in `rateMasterStructure.ts`, the leaf both screens may import** -- with
  `derivedQtyAttrs` and `blanksQtyAttr` -- because `pricingSheetHelper` already imports FROM
  `RateMasterDerivation`, so importing back the other way is a CYCLE. **Never a second copy:** two
  predicates on either side of that boundary could disagree about whether a field is an input.
- **⚠️ AN ATTRIBUTE'S `disables_when_none` CAN VETO A FIELD THAT MATTERS MORE THAN IT DOES.** Once
  `blank_item` became inert as a pricing input it still carried `disables_when_none: ["blank_qty"]`,
  so on every row where extraction answered `"None"` a DEAD dropdown greyed out the newly EDITABLE
  quantity. **No test could see it** — it is a rendering consequence of config and there is no DOM test
  environment. When an attribute stops driving the price, check what it still DISABLES.
- **A field's warnings are a LIST, not a slot (`notes?: AttrNote[]`).** The single `upgrade?` slot
  implied OVERRIDE in three places at once — its name, its ladder-shaped payload, and the `— using X`
  tail of its sentence — so a note meaning *we used your number, here is the consequence* could not be
  expressed without reading as a correction. Each kind words itself through the one `attrNoteText`;
  the `upgrade` case DELEGATES to the still-exported `upgradeWarningText` so the shipped wording stays
  byte-identical BY CONSTRUCTION rather than by copy. **Render order is DECLARED** (`ATTR_NOTE_ORDER`
  + a stable `sortAttrNotes`): size before count, because an upgrade changes WHICH rung is bought and
  the quantity notes change how many fillers go in it.
- **`blank_qty` is DERIVED and READ-ONLY — the COMPUTED count always wins and a stated one is ignored
  (owner-locked; SUPERSEDED above — retained because the MECHANISM it describes still governs any
  config that does not declare `blanks.qty_attr`).** The blank line takes `qty: {from_fit: "blank_count"}`, so the attribute is no
  longer an input and must not render as one. **The derived-ness is READ FROM THE EXISTING CONFIG, not
  a new key and never hardcoded by attribute id:** a component taking `{from_fit}` has SUPERSEDED its
  `<name>_qty` attribute, while one taking `{from_attr}` still reads it — so a config declaring the
  `{from_attr}` shape opts out AUTOMATICALLY and keeps that field editable, and hardcoding by id would
  freeze it for every config including one that genuinely reads it. (That case was live on
  `switches_point` until it was retired 2026-08-08; the RULE does not depend on an example existing.) An attribute read as an input ANYWHERE is never
  derived. **⚠️ A DERIVED DISPLAY MUST NEVER BE WRITTEN BACK INTO THE FORM'S STATE** — `selected`
  means "what the user or extraction supplied", and writing a computed value into it makes the two
  indistinguishable to every later reader. Display it from the pipeline results and leave the state
  alone; because the screen already recomputes every pipeline on every attribute change, live updating
  needs no extra machinery. An uncomputed value renders EMPTY, never 0 — with a None plate there are
  no blanks at all, and 0 would claim "zero needed" instead of "not applicable". **EA-2: the pricing-sheet helper (`pricingSheetHelper.ts`) is N-CATEGORY** — it resolves
  the config PER row category (`configsByCategory`, fetched by a child `RateConfigFetcher` for all 11
  registry categories in `SheetPricingPage.tsx`); a category with no ELIGIBLE config (pipelines + defs, so
  an empty-pipelines LMS is excluded) returns the `{kind:"none", "…coming soon."}` guard. Groups render ONE
  per NON-BCS pipeline (ids containing "bcs" NEVER surface), labelled `config.pipeline_labels?.[id]` (config
  data) else `prettifyPipelineId(id)`; `values` come from the FIRST non-BCS pipeline. **The `wiring_cabling`
  paired Cable+Termination display stays a TEMPORARY named-category special-case (owner Decision 2) — EA-4
  designs the generic pairing/assembly mechanism and wiring migrates then; do NOT extend it.** The helper
  Deps accept EITHER a single `config` (legacy RM-3 tests) OR `configsByCategory`; keep the memo shield
  (every grid input identity-stable). **HONEST-PARTIAL (owner-locked):** a `scale` step whose target rate is missing
  (`null`/`NaN`) SKIPS that output (it stays absent, renders `-`), NEVER inventing a 0; the pipeline's other
  outputs still compute — so a source row carrying supply but not install (or vice-versa; the misc CEIG /
  AS Built rows) prices only what exists. **Empty-pipelines configs render honestly with ZERO frontend
  changes:** a config with `pipelines: {}` (a DATA-ONLY category such as `lighting_mgmt_system`, authored
  in-system later) shows its data + attribute definitions on the Data / Derivation / Pipelines tabs and the
  preview gate with no derivation output and no crash. **EA-2 SHIPPED the authoring path:** the Pipelines-tab
  edit mode has an **Add-pipeline** control (validated id + output keys -> a validator-minimal pipeline via
  `blankPipeline`, seeded with `match_master_row`), so a NEW pipeline can be authored into an empty config;
  the RM-4b `distinctNumberValues` datalist makes number attributes (e.g. module_count) a free numeric input
  in the Derivation tab; and the Data-Viewer header row is sticky-top (a scoped `<style>` forces `top:0`
  because a global Ant Design table reset overrides Tailwind's `top-0`).
