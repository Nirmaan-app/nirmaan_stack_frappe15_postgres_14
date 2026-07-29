## HVAC engine -- Build slice HV-2 (voter single-row-batch parse fix + harness hardening) COMPLETE

Two production fixes surfaced during the HVAC Set-1 baseline run, on `feature/boq-classification-eval`
(one feat commit + this docs commit). BOTH are shape/plumbing only -- **NO classification behaviour
changes**; electrical live behaviour is byte-identical. NO doctype change (no migrate); registry stays
OFF (HV-1 gate untouched); `scoring.json` + `routing_config.json` stay SHARED and untouched.

**Fix 1 -- voter single-row-batch parse (`services/boq_category/ai_voter.py`, permanent, ALL disciplines).**
`_extract_json_array` previously found the outer `[`/`]` and RAISED `"no JSON array in AI response"` on any
reply without them. When a batch carries exactly ONE row (eligible % 20 == 1) the model returns a bare JSON
OBJECT instead of a one-element array, so the call crashed -- and this is the LIVE electrical engine (any
sheet whose eligible count mod 20 == 1). The fix keeps the array path byte-identical (array found -> unchanged),
and when there is NO array but a balanced `{...}` object substring, parses it and wraps it as a one-element
list. Parse-shape ONLY: the id/category/confidence validation in `_ai_batch` is untouched, so a bare object and
the same object inside a one-element array produce an IDENTICAL `{id: (cat, conf, reason)}` map. A genuinely
non-JSON reply (no brackets, no braces) still raises the SAME `ValueError`; a brace substring that is not valid
JSON still raises from `json.loads` -- errors are never swallowed (isolation is the harness's job, not the
voter's). Single extraction seam only; the voter is otherwise unrestructured. (The harness keeps its OWN
`_extract_json_array` with the old single-row limitation -- deliberately NOT patched this slice per scope;
per-sheet isolation below MITIGATES it: a lone-row HVAC sheet is recorded FAILED and the run continues.)

**Fix 2 -- harness hardening (`services/boq_category/harness/electrical_classification_harness.py`).** Three
run-plumbing improvements, no scoring/output-content change on a clean run:
- **Per-sheet failure isolation** -- new pure helper `_process_all_sheets(sheet_specs, process_one)` runs each
  labelled sheet under try/except; an exception records that sheet FAILED (`{boq, sheet_name, error=repr(exc)}`)
  and the run CONTINUES to the next sheet (was: one bad batch aborted the whole run). `main()` now builds the
  ordered labelled-sheet spec list first (boq-then-sheet; unlabelled skipped -- a skip is not a failure), moves
  the per-sheet body verbatim into a `_process_one(spec)` closure, and calls the helper. End-of-run summary
  prints a `FAILED sheets=N:` block listing each failed sheet. The per-sheet CSV write + the `DONE rows=...` line
  are byte-identical for a zero-failure run (`total_ai_calls` folded into `stats['ai_calls']`, same printed value).
- **Per-batch progress** -- new pure helper `_write_progress(folder, **fields)` writes/overwrites `_PROGRESS.json`
  in the run's OWN output folder (the CLI OUTPUT arg -- NEVER `_classification_review/`) after every AI batch,
  carrying `{boq, sheet_name, batch, batches_total, rows_done, rows_total, timestamp}`; a terminal marker
  (`{status:"done", sheets_ok, sheets_failed, failed}`) overwrites it at end-of-run. Runtime artifact only.
- **Unbuffered invocation** -- all `print()` calls flushed (`flush=True`); the documented invocation now uses
  `env/bin/python -u` so progress + `_PROGRESS.json` stream live for monitoring. Recorded in the module usage
  header. Canonical form:
  `BOQ_HARNESS_INPUT=<labelled_xlsx_dir> [BOQ_HARNESS_DISCIPLINE=HVAC] env/bin/python -u
  nirmaan_stack/services/boq_category/harness/electrical_classification_harness.py <OUTPUT_FOLDER>`.

**Tests:** new module `nirmaan_stack/services/boq_category/tests/test_hv2_voter_harness.py` -- **11 tests, all
green** (pure unittest, no frappe, no live AI; a tiny Anthropic-shaped fake client returns fixed reply text).
Coverage matrix: T1 bare-object reply -> one-element list, downstream IDENTICAL to a one-element array; T2
well-formed array (and prose-framed array) -> unchanged; T3 non-JSON / unterminated / broken-object replies ->
still raise; T4 a stubbed sheet that raises -> recorded FAILED, later sheets still processed, summary names it;
T5 all-green stub run -> `(ok, [])` shape, sheets processed in order; T6 `_write_progress` emits `_PROGRESS.json`
(TEMP dir) with the expected keys, refreshed each batch, into the given folder only. **Regression:
`test_runner_electrical` 82 -> 82 and `test_runner_hvac` 21 -> 21, both green and unmodified.** Suite totals:
82 + 21 + 11 = 114.

**Test command form (VERIFIED module path -- the suites live under `services.boq_category.tests`, not
`api.boq.wizard`):**
`bench --site localhost run-tests --app nirmaan_stack --module
nirmaan_stack.services.boq_category.tests.test_hv2_voter_harness` (and `...test_runner_electrical` /
`...test_runner_hvac` for regression).

**HV-2b micro-slice (harness extractor dedupe) -- SUPERSEDES the HV-2 "harness keeps its OWN
`_extract_json_array`, deliberately NOT patched" note above.** HV-2 left the harness carrying a duplicate
extractor with the SAME pre-fix single-row bug, so the HV-2 live cert (LOWSIDE, 121 eligible rows -> a final
batch of exactly 1) would have failed by construction. This slice DELETES the harness's local
`_extract_json_array` and imports the voter's fixed one
(`from nirmaan_stack.services.boq_category.ai_voter import _extract_json_array`, a top-level import -- the
voter module is framework-free: stdlib + the pure runner, so it loads safely before `frappe.init()` in
`main()`). The harness `_ai_batch` call site (`for el in _extract_json_array(text):`) is byte-identical; the
array parse path is unchanged (electrical 82 + the HV-2 array tests are the proof). Contracts were verified
identical before the swap (both take `text`, return a list of dicts, raise `ValueError` on no-array); the
voter's is a strict superset (adds bare-object tolerance). ONE source of truth now -- do NOT reintroduce a
local copy. **Tests:** `test_hv2_voter_harness.py` +3 (T7 harness `_ai_batch` parses a bare single-row object
identically to the same object in a one-element array; a single-source-of-truth identity assertion
`H._extract_json_array is ai_voter._extract_json_array`; T8 harness parse path on a non-JSON reply still
raises). **Regression:** `test_runner_electrical` 82, `test_runner_hvac` 21, `test_hv2_voter_harness` 11 -> 14,
all green. Suite totals: 82 + 21 + 14 = 117.


