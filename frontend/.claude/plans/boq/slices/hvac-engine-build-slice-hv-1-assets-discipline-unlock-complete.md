## HVAC engine -- Build slice HV-1 (assets + discipline unlock) COMPLETE

Second-discipline groundwork for the rate-guidance classifier, on `feature/boq-classification-eval`
(one feat commit + this docs commit). Creates the HVAC classification ASSETS and unlocks the three
electrical-hardcoded seams so an HVAC eval run is possible. **The HVAC engine stays DISABLED in the
registry** (`engines.py` untouched, `available=False`) -- enabling it is a separate, later, GATED slice.
NO user-visible change; NO doctype change (no migrate); electrical behaviour byte-identical.

**New assets (`services/boq_category/`):**
- **`categories_hvac.json`** (`version 0.1-hv1-v0`) -- the 16 frozen HVAC categories, same shape/contract
  as `categories_electrical.json` (`category_id`, `name`, `description`, `discipline`). ids/names match the
  team labelling legend (`_classification_review/hvac_corpus_export/Categories_Legend.csv`): `hvac_ducting`,
  `hvac_adp`, `hvac_piping`, `hvac_insulation`, `hvac_valve_package`, `hvac_vav_box`, `hvac_sensors`,
  `hvac_fans`, `hvac_chw_units`, `hvac_dx_unit`, `hvac_vrf`, `hvac_cables`, `hvac_ahu`, `hvac_panels`,
  `hvac_pumps`, `hvac_misc`.
- **`rules_hvac.json`** (`version 0.1-hv1-v0`, UNMEASURED) -- HVAC ruleset v0, mirrors the electrical rule
  grammar exactly (`rule_id`, `category_id`, `signal_type` item_keyword/ancestor, `match`, `match_mode`,
  `weight`, `plain`, `source`). 35 rules across all 16 categories (per-category counts below). Weights follow
  electrical convention (strong distinctive keyword 0.55-0.6, ancestor 0.40-0.45, ambiguous/supporting
  0.30-0.45). **Collision owners encoded via `exclude_if` + weak weights** (owner-locked): ADP owns dampers
  (incl. fire dampers); Cables owns ALL HVAC cabling incl. VRF ODU-IDU control cabling (VRF-KW `exclude_if`
  cabling); cassette/hi-wall scored WEAK (0.35) in BOTH CHW and DX so a bare "1TR cassette" lands LOW not
  false-HIGH; Panels `exclude_if` double-skin/plenum (that casing is AHU/ADP); Pumps + Piping `exclude_if`
  drain-pump/drip-tray (that belongs to the unit).
- **`prompts/hvac_ai_category_prompt.md`** (`version hvac-v1.0`, `model claude-opus-4-8`, UNMEASURED) --
  the Option-B independent AI voter prompt, mirrors the electrical prompt section-for-section (role, 16
  categories, the boundary/collision discriminators, Option-B independence, identical JSON output contract
  `{id, category_id, confidence, brief_reason}`, same abstention rule).

**Seam edits (electrical behaviour unchanged):**
- **`runner.load_ruleset`** -- the raise-for-non-Electrical replaced by a `_DISCIPLINE_ASSETS` map
  (`Electrical` -> electrical files, `HVAC` -> hvac files); `scoring.json` stays SHARED; an unknown discipline
  still raises. `lru_cache` already keys per discipline.
- **`ai_voter`** -- prompt path resolved per discipline via `_DISCIPLINE_PROMPTS` (`_prompt_path(discipline)`
  + `_read_prompt(discipline)`); default arg stays `Electrical` (no signature break); `classify_rows_ai` passes
  its `discipline` through. Unknown discipline raises.
- **`harness/electrical_classification_harness.py`** -- a `BOQ_HARNESS_DISCIPLINE` env switch (default
  `Electrical`) selects `{discipline, BOQS, prompt}`. HVAC BOQS = the 12 distinct BoQs of the 22-sheet corpus
  (`_MANIFEST.csv`); sheet-level scoping stays by the labelled input. `classify_line` + `load_ruleset` +
  `PROMPT_PATH` all take the switch; with no env var the electrical run is byte-identical (verified: default
  DISCIPLINE=Electrical, same 5 BOQS, electrical prompt).

**Tests:** new module `nirmaan_stack/services/boq_category/tests/test_runner_hvac.py` -- **21 tests, all
green** (pure unittest, no frappe): assets well-formed (frozen 16, every rule targets a known category,
unknown discipline raises, HVAC+Electrical both load with disjoint ids); 6 per-category positives
(ducting / VRF ODU / valve / AHU / insulation / VAV -> expected category, non-ABSTAIN); 6 collision negatives
(bare cassette NOT HIGH; fire damper -> adp not ducting; drain piping -> piping; double-skin -> not panels;
drain pump -> pumps zeroed; VRF cabling -> cables, vrf zeroed); 2 contract (score in [0,1]; no-signal ->
blank ABSTAIN); 3 ai_voter prompt resolution (HVAC path resolves + reads `hvac-v1.0`; electrical path
unchanged incl. default arg; unknown discipline raises). **Electrical regression `test_runner_electrical`
82 -> 82 (baseline unchanged).**

**DEFERRED (gated, NOT this slice):** the `engines.py` registry flip (`hvac.available` True) is deliberately
NOT done -- it is gated on (a) a tuned/measured HVAC ruleset, (b) a certified HVAC prompt (Set-1 HVAC eval
cycle), and (c) a locked HVAC routing policy. Until the flip, `start_classify` / `set_row_category` /
`get_category_catalog` still reject `discipline="HVAC"` via `is_discipline_available` (unchanged gate). Also
still shared as-is (per the HV-1 recon): `routing.py` + `routing_config.json` (per-discipline routing is a
later optional seam -- `route_r3d` already accepts an injected config), `scoring.json`, `orchestrator.py`,
`context_builder.py`, `persist.py`, `classify.py`. `rules_hvac.json` v0 + the prompt are UNMEASURED --
certified at the HVAC eval, not before.

**Per-category rule counts (rules_hvac.json v0):** ducting 2, adp 3, piping 2, insulation 2, valve_package 2,
vav_box 2, sensors 2, fans 2, chw_units 3, dx_unit 2, vrf 3, cables 2, ahu 2, panels 2, pumps 2, misc 1 (= 35).


