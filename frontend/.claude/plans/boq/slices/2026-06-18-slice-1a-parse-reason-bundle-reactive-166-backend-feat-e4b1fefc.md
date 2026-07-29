## Slice 1a -- parse reason-bundle (reactive #166) -- BACKEND (feat e4b1fefc, 2026-06-18)

**What this slice is.** The reactive half of issue #166 and the parse-path instance of principle P2 ("stop erasing
the why"). When a sheet that was ELIGIBLE and ATTEMPTED fails to parse, the specific REASON was computed and then
thrown away. This slice makes the per-sheet failure reason DURABLE on `BoQ Sheet Draft` so a LATER frontend slice
can render a hub-card notice (reason + datetime). **BACKEND ONLY** -- no frontend built here.

**Recon basis (the reason-erasure map, prior read-only recon).** Three IN-SCOPE erasure points: STALE (E2 empty-blob
+ E3 invalid-blob) dropped in `assemble_mapping_config`'s Rule-3 branch to a `logger.warning` + a nameless
`not_eligible` list; PARSER-FAILED (E6, worker Step 4) and INSERT-FAILED (E7, worker Step 5) coarsened to an
`error_code` / a name-only `failed_sheets` + an Error Log row with no surfaced handle. OUT OF SCOPE (not failures or
a different fix): skip/hidden/ineligible/general-specs (never attempted), EMPTY-but-marked-Parsed (E8, success-path
mis-classification -- PARKED), config staleness DETECTION (Slice 1b), payload reshape, all frontend.

**Preconditions verified before edit (P-a..P-d).** (P-a) `BoQ Sheet Draft` had NO reason field; `has_prior_parse` /
`last_parsed_at` / `parse_in_progress` exist as the recon said. (P-b) `_set_draft_status(boq,sheet,status,
extra_fields=None)` merges `{wizard_status: status, **extra_fields}` into ONE `set_value`; existing callers pass no
extra_fields. (P-c) the three failure sites still matched. (P-d) CRITICAL -- the STALE drop does NOT write the draft
at all today (only `logger.warning` + `not_eligible.append`); `assemble_mapping_config` is called ONLY by
`_run_parse_worker` + the tests (`commit_gate` does NOT call it), so a write there pollutes no read-only production
caller. STALE therefore uses a NEW fields-only helper, never the status helper.

**Core constraint -- purely additive, truthful.** The done-event payload contract
(`{status,boq_name,parsed_sheets,not_parsed_sheets,failed_sheets}` / `{status,boq_name,error_code}`) stays
BYTE-FOR-BYTE FROZEN (a test asserts the success-payload key set). `wizard_status` writes and the displayed prior
rows are UNCHANGED -- the notice's whole point is "the rows you see are from the PRIOR parse," so the rows must
remain.

**Schema (`boq_sheet_draft.json`, +3 nullable fields; `bench migrate` CLEAN; runtime columns + Select options
verified via get_meta):**
- `parse_failure_category` -- Select `""` / `Config stale` / `Parser error` / `Insert error`. The S2-8 taxonomy: the
  three IN-SCOPE failure values ONLY. Skip/Hidden/Ineligible/general-specs/empty are NOT failures and are absent by
  design (a 1b/taxonomy concern, not this field).
- `parse_failure_reason` -- Small Text. The specific why: the `SheetConfig.model_validate` exc text for STALE; a
  concise message + an Error Log handle for crashes.
- `parse_failure_at` -- Datetime, read_only.

**The three write sites (`parse_run.py`).**
- STALE -- `assemble_mapping_config` Rule-3 empty-blob + invalid-blob branches call NEW
  `_record_parse_failure(boq,sheet,category,reason)`, which writes ONLY the three failure fields via a bare
  `frappe.db.set_value`, NEVER `wizard_status` (no commit -- rides the worker's transaction). Category `Config stale`.
- PARSER error -- worker Step-4 `except Exception as exc` (now binds `exc`); the reason folds into the EXISTING
  `_set_draft_status(... "Parse failed", extra_fields={category,reason,at})` loop over `eligible_data_sheets` (same
  `set_value`, no new/changed status). `parse_boq` has no per-sheet isolation (DA-1), so every eligible sheet is
  attributed the same parser error -- matching today's coarse behaviour.
- INSERT error -- worker Step-5 per-sheet `except Exception as exc`; reason folds into the EXISTING per-sheet
  `"Parse failed"` `_set_draft_status(extra_fields=...)`.

**S2-5 traceable handle.** Verified `frappe.log_error` RETURNS the inserted Error Log doc
(`frappe/utils/error.py`: `return error_log.insert(ignore_permissions=True)`; None only under
read_only/defer_insert). NEW `_reason_with_ref(reason, error_log_doc)` appends `(ref: Error Log <name>)` when a name
is available and NEVER fabricates one.

**Clear-on-success.** All three fields are cleared (set None) folded into the EXISTING `"Parsed"`
`_set_draft_status(extra_fields=...)` write (alongside has_prior_parse/last_parsed_at), so a fixed sheet drops its
stale notice. General-specs sheets never reach that write (gated) and never carry a reason, so no clear is needed.

**Shared "reconfigure" signal (for Slice 1b).** The natural origin of a "this sheet needs reconfiguring" signal on
this path is the SAME Rule-3 blob deserialize/validate guard in `assemble_mapping_config` (empty + `model_validate`
failure). 1a surfaces it reactively as a durable reason; 1b's proactive version-stamp detection is the cousin --
do NOT design the stamp here.

**Tests (`test_parse_run`, 86 -> 93, +7, all green in-container).** New `TestParseFailureReason`: stale invalid-blob
(exc detail captured; `wizard_status` + prior rows untouched), stale empty-blob, parser error (+handle), insert
error, clear-on-success, non-failures-untouched (Skip/Hidden/Pending/general-specs stay falsy -- a never-written
Select reads as `''`, asserted falsy not strictly None), done-event payload FROZEN (captured via patched
`publish_realtime`).

**Docs.** Pure backend -> this plan + root CLAUDE.md substantive. Per the build-prompt scope, frontend/CLAUDE.md was
explicitly excluded (no frontend change this slice); the standing DOCS-UPDATE RULE's minimal-touch was flagged as a
deliberate exception in the build self-report for the owner to reconcile.

---

