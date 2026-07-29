## §9 #164 Slice A3-backend — per-sheet parse-lifecycle state + double-fire guard + self-heal + write guards (BACKEND ONLY, feat 004f80a8, 2026-06-13)

**Goal.** A sheet under active parse / re-parse must not be edited while the worker is concurrently
deleting + rebuilding its `BoQ Review Row`s. This slice is the BACKEND floor: per-sheet in-flight state,
a real double-fire guard, dead-worker self-heal, and write guards on every sheet-mutating endpoint. The
frontend parse-lock UI + the wiring of `check_parse_status` are a SEPARATE later slice (S5 backend-only
lock; `frontend/CLAUDE.md` deliberately NOT touched here).

**Recon basis.** Read-only Recon #1 + #2 (2026-06-13): the only prior in-flight signal was BoQ-level
`BOQs.parse_in_progress`; no per-sheet state; no real double-fire guard (status-based eligibility only);
the flag sticks on hard worker death; the nine config/review write endpoints had no parse guard;
eligibility resolves only inside the worker (not at enqueue). Recon-ref correction applied: wizard tests
live at `nirmaan_stack/api/boq/wizard/test_*.py`, NOT a `tests/` subdir.

**SCHEMA (CHANGE 1).**
- `BoQ Sheet Draft.parse_in_progress` — Check, default 0, read-only. The per-sheet in-flight marker.
- `BOQs.parse_job_id` — Data, hidden, read-only. The RAW (un-namespaced) RQ job id.
- `BOQs.parse_enqueued_at` — Datetime, hidden, read-only. Enqueue timestamp for staleness.
- `BOQs.parse_in_progress` (BoQ-level, pre-existing) — UNCHANGED.
- `bench migrate` landed all three columns; `get_meta` verified (fieldtype/default/read_only/hidden +
  `has_column=True` for each).

**run_parse (CHANGE 2, parse_run.py).** Before enqueue, in order:
- **Double-fire guard + self-heal:** if `BOQs.parse_in_progress==1`, call `_maybe_self_heal_parse_state`.
  `"running"` -> `frappe.throw("A parse is already running for this BoQ. ...")`; `"cleared"`/
  `"cleared_stale"` -> the stuck state was wiped, fall through and start fresh.
- **Raw job id:** `raw_job_id = frappe.generate_hash(length=32)`, passed as `job_id=` to `frappe.enqueue`,
  stored RAW in `parse_job_id`. CRITICAL (Recon #2 Q4): `frappe.enqueue` namespaces ids to `{site}::{id}`
  and `get_job_status` re-namespaces on read, so storing the returned `job.id` (already namespaced) would
  double-namespace and always read None. `parse_enqueued_at = frappe.utils.now()`.
- **Superset marking:** set `parse_in_progress=1` on the sheets that COULD parse this run — the named
  subset if `sheet_names` given, else every draft whose `wizard_status` is Rule-3-admissible
  (`{"Reviewed","Parsed"}`, plus `"Parsed Check Done"` only under `force_reparse` — mirrors
  `assemble_mapping_config` via `_rule3_admissible_statuses`). All in the one commit with the BoQ flag/job
  fields.

**Worker + clear (CHANGE 3, parse_run.py).**
- **Reconcile (3a):** after `assemble_mapping_config` succeeds and `eligible_data_sheets` is resolved
  (post subset-narrowing), `_clear_all_sheet_parse_markers(boq)` then `_set_sheet_parse_markers(boq,
  eligible_data_sheets, 1)` + commit — clears the enqueue-time superset entries that turn out ineligible
  (general-specs / skip / bad-blob / not-admissible / outside the named subset) and marks the truly-
  eligible set, visible to the UI DURING the parse.
- **Blanket clear (3b):** `_publish_parse_event` (the single choke-point all completion paths funnel
  through) now, alongside the existing post-rollback BoQ-flag clear, blanks `parse_job_id`/
  `parse_enqueued_at` AND `_clear_all_sheet_parse_markers(boq)` (filter on parent/parenttype — ALL rows).
  Blanket, not a passed list, so it is correct on every one of the seven exit paths — including the
  top-level-exception path whose `frappe.db.rollback()` discarded the in-loop status writes (the publish
  clear runs in its own fresh transaction after the rollback).

**Self-heal helper + endpoint (CHANGE 4, parse_run.py).**
- `_maybe_self_heal_parse_state(boq) -> str` (assumes flag==1 on entry): reads `parse_job_id` +
  `parse_enqueued_at`; `status = frappe.utils.background_jobs.get_job_status(raw_id)`.
  None / `finished` / `failed` -> clear, return `"cleared"`. `queued`/`started` within
  `_STALE_PARSE_SECONDS` (1200) -> return `"running"` (NO mutation). Past 1200s, or a legacy flag-set-but-
  no-job-id state -> clear, return `"cleared_stale"` (or `"cleared"` for legacy-without-timestamp). A clear
  ALWAYS sets the BoQ flag 0, blanks `parse_job_id`+`parse_enqueued_at`, and clears every per-sheet marker.
- `check_parse_status(boq)` — `@frappe.whitelist()` bare (GET). `parse_in_progress!=1` -> `{state:"idle"}`
  (no self-heal); else `{state: _maybe_self_heal_parse_state(boq)}`. Ships UNWIRED (no caller yet — the
  hub-mount call lands in the frontend slice).

**Write guards (CHANGE 5).**
- `_guard_sheet_not_parsing(boq, sheet)` — canonical home `update_sheet_draft.py` (the leaf module;
  `review_screen.py` already imports from it, and the reverse would be a circular import). Throws "This
  sheet is being parsed. Wait for the parse to finish." iff the draft's `parse_in_progress==1`; a missing
  draft row -> `get_value` None -> pass-through (safe). sheet_name VERBATIM (#152).
- review_screen.py: called AFTER each existing `_guard_sheet_not_frozen` in `save_review_edit`,
  `save_review_restructure`, `save_review_remark`, `dismiss_row_flags`.
- update_sheet_draft.py: called after the child-exists check in `set_sheet_status`, `set_sheet_label`,
  `set_sheet_config`, `set_sheet_work_packages`; and per-named-sheet inside `set_general_specs_sheet`'s
  validate-all loop (so a parsing sheet anywhere in the list rejects the whole call — no partial write).

**Tests (CHANGE 6) — +27, full gate green in-session.**
- `test_parse_run` 69 -> 85: `TestParseEnqueueMarking` (double-fire rejected with a live job + enqueue not
  called; superset marking for a named subset AND `None`=all-admissible; stored job id has no `"::"`);
  `TestSelfHealParseState` (None/finished -> cleared; queued-within-window -> running + non-mutation;
  stale-past-1200s -> cleared_stale; legacy-no-job-id -> cleared / cleared_stale; `check_parse_status` idle
  when flag 0; `check_parse_status` running leaves ALL flags+job fields+markers untouched);
  `TestPerSheetParseMarkersWorker` (reconcile clears a marked-but-ineligible Skip sheet [publish patched
  to isolate reconcile]; markers cleared on success / global parse_failed / top-level-exception paths).
- `test_update_sheet_draft` 66 -> 72: `TestParseInProgressGuard` (5 rejections — one per writer incl.
  `set_general_specs_sheet` list-member; 1 pass-through control).
- `test_review_screen` 147 -> 152: `TestParseInProgressWriteGuard` (4 rejections — one per write endpoint;
  GuardSheet is `Parsed`+in-flight so only the parse guard can fire, not the frozen guard; 1 pass-through).
- Parser suite 588 unchanged (fixtures restored post-run per agreement #55).

**Files changed (feat 004f80a8):** `parse_run.py`, `review_screen.py`, `update_sheet_draft.py`,
`boq_sheet_draft.json`, `boqs.json`, `test_parse_run.py`, `test_review_screen.py`,
`test_update_sheet_draft.py`. No frontend file touched.

**DEFERRED (next slice):** the frontend parse-lock UI (hub card + spoke config panel + review screen
disable for a parsing sheet) + wiring `check_parse_status` on hub mount; `frontend/CLAUDE.md` update.

---

