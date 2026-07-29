## Phase 5 Slice 2 — the commit gate (eligibility) (BACKEND, feat b93ec41c, 2026-06-16)

**What this slice is (and is NOT).** Builds the GATE that answers one question for a BoQ: "which sheets are
eligible to COMMIT right now?" It is a READ-ONLY eligibility check — it computes + returns a list. It does NOT
commit anything, does NOT write the DB, does NOT change any wizard_status, does NOT call the parser or
`get_sheet_preview_full`, and does NOT touch `assemble_mapping_config` / parse-eligibility. The commit pipeline
(Slice 3) and the hub commit UI (Slice 4) will both call this gate; building + unit-testing it in isolation first
means the eligibility rule is locked before anything depends on it.

**THE parse-vs-commit distinction (load-bearing).** "What is eligible to COMMIT" is NOT "what is eligible to
PARSE." `assemble_mapping_config` treats "Finalized" as `not_eligible` BY DEFAULT (it re-parses Finalized only
under `force_reparse`). The COMMIT gate is the OPPOSITE for Finalized — Finalized is precisely what we want to
commit. So this gate is a SEPARATE, narrower rule keyed on Finalized + general-specs; it does NOT import, reuse,
or consult `assemble_mapping_config` / `force_reparse`. T5 is the regression guard that the two gates stay
distinct.

**Slice-0/verify-first findings (confirmed before build):** V1 — wizard_status options are blank / Pending /
Hidden / Config Done / Skip / General specs / Parse failed / Parsed / Finalized; "Committed" is NOT among them
(not added here). V2 — sheets read via `frappe.get_doc("BOQs", boq_name).sheet_drafts` (sheet_name +
wizard_status); read endpoints use bare `@frappe.whitelist()` + `frappe.db.exists` + `frappe.throw` (template:
`get_review_rows`). **V3 (decisive) — general-specs is POINTER membership in `BOQs.general_specs_sheets`
(`source_sheet_name` set), NOT `wizard_status == "General specs"`** (the option string carries that token but
`assemble_mapping_config:160-166` + its comment confirm the draft's wizard_status is NEVER literally set to
"General specs"; a designated sheet can carry any stored status, e.g. Skip). So the gate's general-specs test
keys off the pointer. V4 — no pre-existing commit-eligibility function to collide with.

**Eligibility rule (the ONLY two dispositions that commit, per PHASE 5 LOCKED INPUTS):**
- general-specs-designated (pointer membership) → eligible, disposition **`general_specs`**;
- else `wizard_status == "Finalized"` → eligible, disposition **`finalized`**;
- else NOT eligible (blank, Pending, Hidden, Config Done, Skip, Parse failed, Parsed).
The disposition tells Slice 3 which write path to use (faithful general-specs grid vs. line-item nodes).

**PRECEDENCE (overlap).** A sheet can be BOTH Finalized AND general-specs-designated (the designation is a pointer
overlay that never writes wizard_status, and the hub checklist can tick a Finalized sheet). When both apply,
**`general_specs` WINS** — mirroring `assemble_mapping_config` Rule 1, where the general-specs pointer is checked
FIRST and outranks wizard_status. Tested in T6.

**Chosen location + API.** `nirmaan_stack/api/boq/wizard/commit_gate.py` (beside `parse_run.py`, matching the
established wizard-endpoint convention — every BoQ whitelisted endpoint lives under `api/boq/wizard/`; placing the
commit gate next to the parse gate makes the deliberate distinction physically adjacent. `api/boq/commit/` was
rejected as premature for a single read function). Public API:
- `compute_committable_sheets(sheet_drafts, general_specs_sheet_names) -> list[dict]` — PURE helper, no DB,
  accepts Frappe child docs / `frappe._dict` / plain dicts via a `_get` shim; preserves input order; returns
  `[{"sheet_name", "disposition"}]`.
- `get_committable_sheets(boq_name) -> {"committable_sheets": [...]}` — `@frappe.whitelist()` READ-ONLY endpoint;
  loads `BOQs.sheet_drafts` + the `BOQs.general_specs_sheets` pointer (same read pattern
  `assemble_mapping_config` uses) and applies the pure helper. Missing/unknown BoQ → `frappe.throw`.

**Verification (in-session, real bench run).** `test_commit_gate` **13/13 green** in-container: 7 pure-helper
(T1 Finalized→finalized; T2 general-specs-pointer-as-Skip→general_specs; T3 every ineligible status incl. blank
""; T4 mixed exact subset; T5 parse-vs-commit distinction regression guard; T6 overlap→general_specs precedence;
#152 verbatim pointer match) + 6 endpoint end-to-end against a real mixed BoQ (exact subset, finalized,
general_specs, ineligible excluded, overlap, unknown-BoQ throws). Parser suite **597 UNCHANGED**. **NO doctype
JSON change → no migration required** (pure read logic over existing fields; verified no `.json` in the diff).

**Files (feat b93ec41c):** two NEW files only — `nirmaan_stack/api/boq/wizard/commit_gate.py` +
`…/test_commit_gate.py`. 2 files, +353 lines, 0 deletions. NO parser / `assemble_mapping_config` / BOQ Nodes /
BoQ Sheet / Slice-1 general-specs doctype / status-write / frontend change. Docs commit separate (this plan doc +
root CLAUDE.md substantive; frontend/CLAUDE.md minimal-touch). **NEXT = Slice 3** (the commit pipeline that calls
this gate, routes Finalized→line-item nodes via the P4-3 mapping + general_specs→the Slice-1 faithful-grid
doctype, and enforces one-current) **+ Slice 4** (hub commit UI).

