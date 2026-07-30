<!-- Carved from CLAUDE.md on 2026-07-30 (structural carve).
     CLAUDE.md is a router; this file holds the detail it points to.
     Load when: Touching the Rate Master backend (RM-1) -- loader, extraction, doctypes -->

## BoQ Rate Master (RM-1)

Backend rate-master for the pricing helper (the standalone estimation data behind cable/termination
rates). Full as-built lives in the plan doc + `.claude/context/domain/boq-backend.md`.

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
  EXECUTION semantics untouched. Tests `test_rate_master` 14→22.
- **Benchmark data (owner ruling):** the committed data asset is the **28-Jul benchmark workbook**
  (`rate_master_wiring_cabling_v3.json`) — the reference going forward, superseding the earlier 25-Jul
  reference. A benchmark refresh is a `replace=True` re-import of a new asset (freeze-and-supersede: the
  prior `rmbulk-` batch goes inactive, rows retained). NOTE: `loader.DEFAULT_DATA_FILE` is version-pinned
  to the asset filename (a known wart flagged for a future de-pinning slice), so a rename forces a loader
  edit in lockstep.
- **Pipelines are STORED CONFIG, not code:** the four derivation pipelines (cable/termination × BoQ/BCS)
  live in the config JSON and are interpreted downstream — RM-1 stores them faithfully; no interpreter
  ships this slice. Owner-decoded shapes: effective = `(1-discount)*(1+markup)`; termination = lug +
  banded gland (`thickness_sqmm` < 35 vs ≥ 35); BCS = discounted product cost + 5% wastage, no install
  (electrical labour is per-sqft, added at project level). The four faithfulness goldens (e.g.
  COPPER/UNARMOURED/1C/6.0 → cable 120/20, termination 80/20, BCS 87) are the STANDING instrument any
  pipeline change must still reproduce EXACTLY.
- **Migrate obligation grows:** these two doctypes add to the pullers' migrate obligation (Abhishek
  heads-up) — pulling requires a DB migrate.
