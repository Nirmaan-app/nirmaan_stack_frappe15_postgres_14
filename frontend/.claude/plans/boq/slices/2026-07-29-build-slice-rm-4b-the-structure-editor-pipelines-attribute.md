<!-- Recovered 2026-07-30 from frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md.
     This record shipped in PR #1133 (2bd6032f) but was never
     distributed into the rotated plan tree: the rotation was
     computed from a 1,286,655 B plan doc and the rebase archived
     develop's 1,352,991 B version. Verbatim copy, write-once. -->

## Build slice RM-4b (the structure editor -- pipelines + attribute definitions) COMPLETE

Session 5 of the rate-master box (owner one-session extension). Branch `feature/boq-pricing-helper`.
This slice LIFTS the RM-4a "PARAM VALUES ONLY" boundary: creating/deleting params, steps, conditions, and
attribute definitions is now in scope. Admin-only (owner option (a): Estimates READ-ONLY). NO migration (no
doctype JSON changed), NO interpreter-semantics change (rendering the vocabulary in a picker is fine;
changing how a step computes is not).

### Backend -- ONE validated whole-config replace endpoint (`api/boq/rate_master.py`)
`update_rate_config(name, config)` -- `@frappe.whitelist(methods=["POST"])`, admin-gated (the IMPORTED
`pricing._is_nirmaan_admin`, gate FIRST). It replaces the WHOLE config JSON after full server-side
STRUCTURAL VALIDATION (`_validate_config`), then the audited `doc.save(ignore_permissions=True,
ignore_version=False)` -> a Version diff. Valid -> write+commit+return; invalid -> a NAMED
`frappe.ValidationError`, NO write. Validation:
- known step types ONLY (the 8-member interpreter vocabulary `_KNOWN_STEP_TYPES`); per-type required
  string fields present; every `params` dict a map of FINITE numbers (`_is_finite_number` rejects
  bool/None/NaN/Inf/strings).
- conditions are STRUCTURED PREDICATES matching the STORED + interpreter-EXECUTABLE shape: a condition
  `when` is `{attribute: scalar}` EXACT-match (the ONLY shape the pure interpreter runs -- it does
  `matchedItem.attributes[k] === v`). A `when` value that is an OBJECT (a `{in:[...]}` / `{gte/lt}`
  range predicate) is REJECTED, because the interpreter would silently never match it and extending it
  is OUT OF SCOPE. component_band bands are comparator strings (`_BAND_WHEN_RE` = `^(<=|>=|<|>)\s*-?\d+`).
- attribute_definitions well-formed (unique non-empty id; label; type in {choice, number}; choice needs a
  non-empty values list).
- REFERENCE GUARD: the union of attribute ids referenced by any apply_effective_multiplier condition
  `when` key + any component_band `band_on` must ALL be defined; a missing one is rejected with an error
  that NAMES every referencing location (`pipeline 'X' step N condition M`). This is how removing a
  referenced definition is blocked.
- no UNKNOWN top-level keys (`_KNOWN_CONFIG_KEYS`, incl. `goldens`); an identity guard rejects a config
  whose discipline/category_id does not match the stored doc (no repoint).
- goldens (optional) light-validated: each `{attrs, expect:{pipeline_id:{key:finite_number}}}`, pipeline
  ids must exist.

FLAGGED (faithful resolution, not a guess): the prompt's condition-shape list named
`{attr:{in:[...]}}` / `{attr:{gte/lt}}`, but the interpreter executes ONLY `{attr: scalar}` exact-match and
its semantics are OUT OF SCOPE. Per "match the stored shapes", the validator accepts + the editor emits
the exact-match form and REJECTS predicate objects (honest -- an editor must not produce configs the
interpreter silently fails on). Recorded here per the stopping-conditions rule.

### Goldens as config data
The config gained a `goldens` array -- the FIVE standing goldens (attrs + expected finals per pipeline:
the four RM-1 combos + the RM-2b COPPER/UNARMOURED/3C/10 630/40, with cable_bcs 469). SEEDED live in this
slice via ONE audited `update_rate_config` (cert V1; Version `1ieoo9jj16`). The vitest fixtures
(`ratePipelineInterpreter.test.ts` + `pricingSheetHelper.test.ts`) stay INDEPENDENT code-side pins.

Tests (`test_rate_master.py` 14 -> 22): valid whole-config replace audited + seeds goldens (test_15);
negatives -- unknown step type (test_16), malformed condition predicate / non-number param (test_17),
non-admin PermissionError no write (test_18), reference guard rejects removing a referenced definition
with the names quoted (test_19), unknown top-level key (test_20), identity repoint (test_21); a valid
add-step + add-param replace persists (test_22).

### Frontend -- a THIRD tab "Pipelines" (`RateMasterPipelines.tsx` + `rateMasterStructure.ts`)
- READ-ONLY structural view for EVERYONE: the attribute-definitions table + every pipeline as its ordered
  step list (params / conditions / bands rendered readably) + the stored goldens.
- ADMIN EDIT MODE (owner option (a): hide-not-disable): "Edit structure" builds a DRAFT (deep clone).
  Editors: step add (a vocabulary picker) / remove / reorder (up-down); per-step param add/remove/rename +
  condition-branch add/remove/edit (the structured `{attr: value}` predicate + params) + component-band
  add/remove/edit; attribute-definition add (choice/number) / edit id-label-type-values / remove (the
  remove button DISABLES on a referenced def -- client mirror `referencedAttrIds` -- and the server guard's
  verbatim error still surfaces on save); the brand `selector` flag is an editable "selectable" checkbox.
- THE PREVIEW GATE (`rateMasterStructure.ts` pure + vitested): before save the page computes ALL config
  goldens against the DRAFT (the SAME pure `ratePipelineInterpreter` + the live master items) and renders
  a pass/delta table (expected vs draft-computed per golden key). Unchanged -> a green "Save"; any delta ->
  the button reads "Save with N changed goldens" and opens an AlertDialog LISTING the deltas that requires
  an explicit confirm (confirm-NOT-block -- deltas impossible to miss, never forbidden). `evaluateGoldens`
  WRAPS the interpreter in try/catch so a transiently invalid draft (a param renamed a keystroke before its
  formula) reports `got=null` instead of crashing the preview -- it does NOT change the interpreter.
- Save calls `update_rate_config`; the server RE-VALIDATES (the authority) and the page refetches, so the
  Derivation + Data tabs and the pricing helper follow with no code + no AI re-run (persistence split).
- `RateMasterPage.tsx` wires the third tab + an `onSaveConfig` callback over the new endpoint.

### Gates
backend `test_rate_master` 14 -> 22; `test_pricing` 230 unchanged (no pricing code touched). Full vitest
1001 -> 1010 (+9 rateMasterStructure; zero regressions). tsc 3240 baseline, 0 new. vite build exit 0.

### Cert (live, BRCC-26-00584 / Electrical wiring_cabling, 588 items; every edit reverted)
Backend restarted (E2b) after the code change so the web workers loaded update_rate_config (the endpoint
answered with the login-required signature, not RM-4a's stale "has no attribute"). Config canonical shas:
pre-seed S0, post-seed S1 = 5e7da739...4c4bb, post-V3 S2 = decc35e6...; net config after all reverts ==
S1 (goldens kept, everything else restored).
- V1 GOLDENS SEEDED: one audited update carried the 5 goldens (g1..g5) as config data; Version
  `1ieoo9jj16` (changed ['config']); the Pipelines tab renders the read-only structural view + a Goldens
  section for a non-edit session. PASS.
- V2 PREVIEW GATE UNCHANGED: edit mode, no change -> all 20 golden checks GREEN, Save is the plain green
  "Save"; cancelled cleanly. PASS.
- V3 STRUCTURE EDIT LIVE: in one draft, RENAMED cable_boq step1's `discount` param -> `disc` on BOTH
  conditions with the coupled formula edit `(1-disc)*(1+markup)` and set the ARMOURED `disc` 0.75 -> 0.70
  (a param RENAME + formula edit, impossible under RM-4a). The preview detected exactly 2 deltas
  (g2 cable_boq.supply_per_mtr 200->240, g3 210->250); saved via the "Save with 2 changed goldens"
  AlertDialog listing both. Persisted (formula + `disc` params) + Version `9h17sj5vjq`. The Derivation tab
  for COPPER/ARMOURED/3C/2.5 then showed cable_boq supply_per_mtr = 240 (was 200), computed with `disc
  0.7`, NO AI re-run; the helper consumes the identical shared interpreter + refetched config (the
  RM-4a-certified persistence split -- Derivation and helper run the same pure interpreter, so 240 is the
  helper's value too; not re-driven through the full BoQ UI this cert to avoid a rabbit-hole). PASS.
- V4 REVERT: restored the original structure via the endpoint; DB canonical sha == S1 byte-identical;
  Version `c069jdrd8v`; Derivation/helper back to the standing values (deterministic from byte-identity).
  PASS.
- V5 ATTRIBUTE DEFINITION LIFECYCLE: added `voltage_grade` (choice [LT, HT]) -> it appeared in the
  Derivation configurator (a Voltage Grade select), the Data tab (a Voltage Grade column) AND the
  manual-fill Add-row form (a Voltage Grade select field); removed it cleanly (unreferenced -> allowed).
  Then attempted to remove `insulation` -> the REFERENCE GUARD rejected (417) verbatim: "These attributes
  are referenced by a pipeline but not defined: 'insulation' (referenced by pipeline 'cable_boq' step 1
  condition 0, pipeline 'cable_boq' step 1 condition 1, pipeline 'cable_bcs' step 1 condition 0, pipeline
  'cable_bcs' step 1 condition 1). Add the definition, or remove the references first." insulation
  untouched. PASS.
- V6 VALIDATION NEGATIVE LIVE: a draft with an unknown step type via the endpoint -> 417 "pipeline
  'cable_boq' step 5: unknown step type 'quantum_flux'.", NO write, config sha unchanged. PASS.
- V7 SUITES: bench test_rate_master 22 + test_pricing 230 green; full vitest 1010 (incl. the two golden
  files) green post-revert. The five goldens named above. PASS.
- V8 NET-ZERO: config sha == S1 (goldens KEPT -- the V1 intended change; everything else reverted); items
  588 active; Suggestion Events 2 unchanged; NO pricing writes. Intended audit residue: 5 new config
  Version docs (V1 seed, V3 edit, V4 revert, V5 add, V5 remove); the V5-insulation + V6 rejects wrote
  nothing (no Version). PASS.

### Files
MODIFIED: `api/boq/rate_master.py` (+update_rate_config + _validate_config + helpers), `api/boq/
test_rate_master.py` (+test_15..22), `frontend/.../rate-master/RateMasterPage.tsx` (+3rd tab +onSaveConfig).
NEW: `frontend/.../rate-master/RateMasterPipelines.tsx`, `.../rateMasterStructure.ts(+.test.ts)`. Docs:
this entry + `frontend/CLAUDE.md` + root `CLAUDE.md`. Out of scope (untouched): the interpreter's execution
semantics, the registry, run/persistence, wizard endpoints beyond the `_is_nirmaan_admin` import,
patches.txt, `.claude/settings.local.json`. NOTE: goldens are seeded into the DB via the endpoint, NOT the
`data/` asset -- a future benchmark re-import (`--replace`) would need them re-seeded (flagged for a later
slice, consistent with the "seed via the endpoint" instruction).
