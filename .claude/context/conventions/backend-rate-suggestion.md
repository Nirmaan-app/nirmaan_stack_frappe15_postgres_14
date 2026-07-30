<!-- Carved from CLAUDE.md on 2026-07-30 (structural carve).
     CLAUDE.md is a router; this file holds the detail it points to.
     Load when: Touching rate suggestion (RM-3) -- runs, events, scoring -->

## BoQ Rate Suggestion (RM-3)

The extraction engine + the REAL `wiring_cabling` pricing helper. Full as-built:
`frontend/.claude/plans/boq-upload-plan.md` ("Build slice RM-3") + `frontend/CLAUDE.md`. Load-bearing
invariants:

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
- **Extraction prompt rulings (owner, `prompts/boq_rate_attr_extraction_prompt.md`):** tolerate spelling
  variants (map to the canonical value), and — for an ARMOURED/UNARMOURED insulation attribute — a FLEXIBLE
  cable is UNARMOURED, and insulation DEFAULTS to UNARMOURED when neither armoured nor unarmoured is stated.
- **Frontend attributes are CATEGORY-SCOPED (owner):** the `Pricing sheet` helper shows the row's CATEGORY
  attributes; a category with no attribute set defined yet shows a "coming soon" note, not the wrong fields.
  A badge-less rate-editable cell exposes an always-on faint opener for manual fill. Only `wiring_cabling`
  is defined this slice.

---
