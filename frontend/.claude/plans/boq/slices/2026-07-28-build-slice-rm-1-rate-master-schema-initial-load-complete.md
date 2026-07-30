<!-- Recovered 2026-07-30 from frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md.
     This record shipped in PR #1133 (2bd6032f) but was never
     distributed into the rotated plan tree: the rotation was
     computed from a 1,286,655 B plan doc and the rebase archived
     develop's 1,352,991 B version. Verbatim copy, write-once. -->

## Build slice RM-1 (rate-master schema + initial load) COMPLETE

Backend rate-master box, session 1 of 4. Migrate-carrying (two new doctypes). Branch
`feature/boq-pricing-helper`. feat `bc997eeb` + docs (this entry).

### The two doctypes (modelled on BoQ Category Truth Snapshot's recipe)
- **`BoQ Rate Master Item`** (`BRMI-.YY.-.#####`, `track_changes:1`) -- discipline-wide priced-item
  master. Fields: `discipline` (stamped from the payload's `category_config.discipline` -- source items
  carry no discipline of their own), `kind` (cable/termination), `brand`, `unit`, `attributes` (JSON),
  `rates` (JSON), `source_sheet`, `source_row`, `import_batch` (search_index), `active` (Check, default
  1). Controller: minimal `validate` (discipline+kind required) + `on_doctype_update` composite index
  `[discipline, kind, brand]`. Addressed by `(discipline, kind)` -- NOT by category_id (the config is the
  per-category home).
- **`BoQ Rate Category Config`** (`BRCC-.YY.-.#####`, `track_changes:1`) -- per-`(discipline,
  category_id)`. Fields: `discipline`, `category_id`, `config` (JSON, reqd), `source_workbook`,
  `import_batch` (search_index), `active` (Check, default 1). Controller: minimal `validate` +
  `on_doctype_update` composite index `[discipline, category_id]`. `config` holds the whole blob:
  `attribute_definitions` (material/insulation/core/thickness_sqmm/brand), the four `pipelines`, and
  `normalization_rule`.
- **JSON-field rationale (the app's stated rule):** `attributes`/`rates`/`config` are flexible,
  UI-driven, read-whole data -> JSON fields, NOT exploded columns or child tables (mirrors
  `BoQ Committed Sheet Grid Row.cells` / `BoQ Sheet.column_role_map`; the recon confirmed the app has NO
  keyed-attribute child-table precedent -- keyed maps are always JSON fields here).

### Import loader (`services/boq_rate_master/loader.py`, service-side, no endpoint)
- `load_rate_master(payload=None, path=None, replace=False)`. Reads the committed data asset
  (`services/boq_rate_master/data/rate_master_wiring_cabling_v2.json`, byte-identical to the owner's
  Desktop `rm1_import_wiring_cabling_v2.json`, sha256 `633233cd...`) or an in-memory payload (tests).
- **Normalization at ingest (owner ruling):** `material`/`insulation` uppercased to canonical
  (`_canonicalize_attributes`); numbers untouched, `brand` untouched. All downstream matching is EXACT
  on canonical values -- no case-insensitive matching anywhere.
- **Batch provenance:** `import_batch = "rmbulk-" + generate_hash(12)`, ONE id on every item + the config
  of a run (mirrors gtbulk).
- **Idempotency (freeze-and-supersede, never delete):** a re-run against existing ACTIVE data for a
  discipline raises `frappe.ValidationError` (clean refuse, writes nothing). `replace=True` sets
  `active=0` on the prior active items (discipline) + config (discipline, category_id) via a quoted-table
  SQL UPDATE, then inserts a fresh active batch. Result: exactly the new batch active, old inactive, no
  duplicate active rows. Returns a summary (`batch`, `items_by_kind`, `items_total`, `config_loaded`,
  `items_deactivated`, `configs_deactivated`).

### Read endpoints (`api/boq/rate_master.py`, login-required, active-only)
- `get_rate_master_items(discipline, kind=None)` -> `{discipline, kind, count, items[]}` with
  attributes/rates parsed to objects, ordered by `kind, source_row`.
- `get_rate_category_config(discipline, category_id)` -> the active config row (config parsed) or
  `config=None`. Both call `_require_login()` (Guest -> `PermissionError`). Deliberately avoids
  `from frappe import _` (translator-shadowing hygiene). No write endpoint -- editors are RM-4.

### The four pipelines are STORED CONFIG, not code (owner-decoded)
RM-1 persists them faithfully; no interpreter ships. Decoded shapes: `effective = (1-discount)*(1+markup)`
(cable BoQ supply, ROUNDUP to tens; install = `base*(1+install_markup)` ROUNDUP to units); termination =
lug + banded gland (`thickness_sqmm` < 35 -> band1, >= 35 -> band2), each `list*(1-discount)*(1+markup)`,
summed + ROUNDUP to tens, install = 25% of the rounded supply ROUNDUP to tens; BCS = discounted product
cost + 5% wastage, no install (electrical labour is per-sqft, added at project level). The **four
faithfulness goldens** are the standing instrument (V5 below) any pipeline change must still reproduce.

### Tests (baseline unchanged; new module green)
- Baseline `test_pricing` 230 -> 230 (regression clean, nothing moved).
- New module `nirmaan_stack.api.boq.test_rate_master`: 8 tests, all pass. Each loads under its own
  synthetic `TEST_RM_<hash>` discipline (isolated from the real Electrical import on the LIVE DB) and
  purges only what it created. Coverage: counts 292/296/1 + one batch + provenance + 106.04 lug rows;
  mixed-case -> canonical UPPERCASE + zero mixed-case survivors; idempotency refuse (counts unchanged) +
  replace supersede (old inactive/new active/1176 total/no dup); endpoint shape + kind filter +
  active-only + Guest denied; config integrity (four pipelines + attribute defs + normalization_rule
  survive a store->load round trip).
  - A test-authoring bug (double-`json.loads` on a JSON field frappe.get_all already parses to a dict)
    surfaced on first run and was corrected in the test only (`_obj` tolerant reader); no product code
    changed, no assertion weakened.

### CERT (CC-driven, server-side) -- ALL PASS
- **V1** migrate clean; both doctypes exist; PG composite indexes present: `discipline_kind_brand_index`
  `(discipline, kind, brand)` on `tabBoQ Rate Master Item`, `discipline_category_id_index`
  `(discipline, category_id)` on `tabBoQ Rate Category Config` (+ single-col `discipline` / `import_batch`
  from search_index).
- **V2** real load into `Electrical`: 292 cable + 296 termination + 1 config, one batch
  `rmbulk-c57cfe18194e` on every row, provenance populated (0 missing source_sheet), the three cleaned
  lugs (Termination rows 117/217/228) read 106.04.
- **V3** non-replace re-run REFUSES cleanly (active unchanged at 588); replace proven on a throwaway
  discipline (old batch 0 active / new 588 active / 1176 total / 588 deactivated), then purged so
  Electrical stays a single clean batch.
- **V4** endpoints: items count 588 with dict attributes/rates, kind=cable -> 292, config returns the
  four pipelines; Guest denied on both.
- **V5 GOLDENS (crown check)** -- interpreter reads the pipeline JSON from the DB config and interprets
  its steps (arithmetic NOT hardcoded); every value EXACT:
  COPPER/UNARMOURED/1C/6.0 -> cable 120/20, termination 80/20, BCS 87;
  COPPER/ARMOURED/3C/2.5 -> cable 200/28, termination 70/20, BCS 150;
  ALUMINIUM/ARMOURED/4C/16.0 -> cable 210/44, termination 130/40, BCS 160;
  COPPER/ARMOURED/3C/50.0 -> termination 940/240 (>=35 gland band). Zero mixed-case attribute values
  (239 canonical ALUMINIUM rows, 0 'Aluminium').
- **V6 CLEANUP** (the deferred U1 V12): deleted `BOQ-26-00144` + project `None-PROJ-00929`. Zero residual
  across all 12 checked doctypes (cell pricing 6->0, amount formula 4->0, row category 7->0, nodes 8->0,
  sheets 2->0, plus grid/remark/color/dismissal/recon/lock/review all 0); BOQs total 137->136 (delta 1);
  `BOQ-26-00142` untouched.
- **V7** end git status clean apart from the pre-declared standing noise.

### Migrate heads-up (Abhishek)
The two new doctypes GROW the pullers' migrate obligation -- pulling requires a DB migrate. The RM-1
migrate also cleared sessions (owner relogin expected).

### Files
NEW doctypes `boq_rate_master_item/` + `boq_rate_category_config/` (json/py/__init__), service
`services/boq_rate_master/` (loader.py + data asset), endpoints `api/boq/rate_master.py`, tests
`api/boq/test_rate_master.py`. Docs: this entry + root CLAUDE.md (new "BoQ Rate Master (RM-1)" section).
Out of scope (untouched): all frontend, existing endpoints, freeze/classify/pricing code, patches.txt,
.claude/settings.local.json.
