## Slice 1b -- config staleness detection (proactive #166) -- BACKEND (feat 32e31a2a, 2026-06-18)

**What this slice is.** The PROACTIVE half of issue #166 (S1-1/S1-2). Slice 1a made the REACTIVE half durable (a
reason persisted when a stale config is DROPPED at parse). 1b flags a stale config ON READ -- before the user
triggers a parse -- so a LATER frontend hub-card slice can show "reconfigure this sheet" without first hitting a
parse failure. **BACKEND ONLY** -- a read-only endpoint; no frontend built here.

**Recon verdict implemented = validate-on-read (approach B), ZERO SCHEMA.** No fingerprint, no version-stamp, no
doctype change, no migration. The recon proved a field-name fingerprint MISSES the dominant real staleness
(`ColumnRole` Literal token renames + the `_AREA_COMPATIBLE_ROLES` / `model_validator` changes that actually caused
#166), and a deep fingerprint can never capture imperative validator logic -- chasing it is the balloon. Instead,
1b runs the SAME `SheetConfig.model_validate` the parser runs: an invalid stored blob is stale. This catches
everything a parse would, tracks the live model automatically (zero maintenance -- the property whose ABSENCE
caused #166), and needs NO new field/migration/backfill.

**Read-only verification before edit (reported, no drift).** Confirmed the current (post-1a) Rule-3 shape: an
empty-blob sub-branch (`_record_parse_failure(... "Config stale", "Saved configuration is empty ...")`, no
model_validate) and an invalid-blob sub-branch (`try: json.loads + inject sheet_name + SheetConfig.model_validate;
except: _record_parse_failure(... "Saved configuration is no longer valid: {exc}")`). Confirmed
`_RULE3_BASE_STATUSES = {"Config Done", "Parsed"}` exists and is the force_reparse=False data set. Confirmed
`run_parse`'s guard strings ("boq_name is required." / "BOQs '...' not found.") to mirror.

**(1) Shared validate helper + reason builders (`parse_run.py`).** `_validate_sheet_blob(blob, sheet_name) ->
Exception | None` is the SINGLE SOURCE OF TRUTH for "does this saved config still validate", used by BOTH the
reactive parse-drop path (`assemble_mapping_config` Rule 3 / 1a) and the proactive read path (`get_stale_sheets` /
1b). It injects `sheet_name` (production 6-key blobs omit it; `SheetConfig.sheet_name` has no default -- WITHOUT
injection every blob false-positives, the #1 cry-wolf trap), copies the blob before injecting (no caller mutation),
and catches a malformed/non-dict blob (returned as the exc, matching the parser's treat-as-stale behaviour).
`_stale_empty_reason(status)` / `_stale_invalid_reason(exc)` centralize the reason text so the reactive +
proactive messages are BYTE-IDENTICAL. `assemble_mapping_config` Rule 3 was REFACTORED to call the helper +
builders -- BEHAVIOR-PRESERVING for 1a: same exclusion, same `_record_parse_failure` calls with byte-identical
reason text; the success path re-validates once only to obtain the `SheetConfig` model object (a cheap pure-Python
re-parse, behaviour-identical to the prior single-validate). The empty-blob sub-branch stays its own 1a case (NOT
routed through model_validate) -- mirrored exactly.

**(2) New `get_stale_sheets(boq_name)` endpoint.** `@frappe.whitelist()` bare (READ-ONLY, GET-capable, mirrors
`get_committable_sheets`). Returns `{"stale_sheets": [{"sheet_name" [VERBATIM #152], "reason"}, ...]}`. ROUTING
PARITY with assemble (no new gating): general-specs pointer / Hidden / Skip -> never stale; status not in
`_RULE3_BASE_STATUSES` (Pending / Parse failed / Finalized / blank) -> not a data sheet here, never stale
(UNCONFIGURED != stale; Finalized is data-eligible only under force_reparse, which this normal read does not
assume); Config Done / Parsed with a non-empty invalid blob -> stale (reason = validation detail); Config Done /
Parsed with an empty blob -> stale (mirrors 1a's empty-on-done). PURE READ -- writes NOTHING (no
set_value/insert/save/commit; write-on-read was explicitly rejected by the recon). Guard mirrors `run_parse`.

**Anti-cry-wolf (recon §6 traps closed).** sheet_name injection (in the shared helper, both paths get it free);
routing parity (general-specs / Skip / Hidden / non-data statuses never validated as data sheets); unconfigured !=
stale (scoped to data-eligible statuses with a blob, plus 1a's empty-on-done). By construction `get_stale_sheets`
flags stale iff the parser would drop the sheet -- the truest anti-cry-wolf guarantee.

**Composition with 1a (no overlap, no double-write).** 1b writes NOTHING, so it cannot race or double-write with
1a's reactive `parse_failure_*` writes. They are the SAME validation at two triggers; the shared helper guarantees
identical verdicts. A test (`test_proactive_matches_reactive_invalid_and_empty`) runs `assemble_mapping_config`
(1a) then `get_stale_sheets` (1b) on the same BoQ and asserts both flag the same sheets AND the reason text is
byte-for-byte equal. (The frontend, later, will de-dupe a stored 1a reason and a computed 1b flag into ONE
"reconfigure" notice -- not this slice.)

**Tests (`test_parse_run`, 93 -> 102, +9, all green in-container; no migration).** New `TestGetStaleSheets`:
invalid-blob-stale-with-reason (the #166 core), Parsed-status parity, valid-prod-blob-not-stale (the sheet_name-
injection proof -- a valid blob OMITS sheet_name and must not flag), unconfigured-not-stale (Pending / Parse-failed;
a literally-blank wizard_status is not insertable -- `reqd=1`), Finalized-not-stale (force_reparse=False),
general-specs/Skip/Hidden-not-stale (routing parity), empty-on-done-stale, proactive-matches-reactive (shared-helper
+ reason parity vs 1a), guard (missing/unknown boq_name throws). The 1a `TestParseFailureReason` suite stays green
(the Rule-3 refactor is behavior-preserving).

**Docs.** Pure backend -> this plan + root CLAUDE.md substantive. frontend/CLAUDE.md NOT touched (build-prompt scope
excluded it; no frontend change this slice).

---

