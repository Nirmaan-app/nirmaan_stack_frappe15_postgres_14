## Classifier eval -- D3a ground-truth snapshot store + corpus classify-and-label runner COMPLETE

The eval truth substrate: a new snapshot doctype + a corpus runner, on `feature/boq-classification-eval`
(one feat commit + this docs commit). Backend + a new doctype (MIGRATE -- Abhishek heads-up owed at
push). No existing classifier code touched.

**Owner decisions tonight (2026-07-11) -- the truth model:**
- **Truth = FREEZE SNAPSHOTS, not live human edits.** Live `BoQ Row Category` rows are WORKING STATE: a
  re-classify supersedes them and human verdicts intentionally do NOT carry forward. **The earlier
  carry-forward plan (D3 recon #4) is DROPPED -- stranding is now INTENTIONAL.** Ground truth is banked
  out-of-band and is PERMANENT.
- **Freeze/Unfreeze lifecycle (deferred to the eval-cockpit arc, NOT this build):** a Freeze event locks
  classification + banks the snapshot; Unfreeze is required before any re-classify; snapshots are never
  deleted (unfreeze never deletes). For NOW, Freeze would lock CLASSIFICATION ONLY; the Freeze/Unfreeze
  button + its `human_category_id` write-back-at-new-version is the cockpit arc. The button is SEPARATE
  from the pricing freeze (placement + state mitigations to be handled in that arc).
- **Labels -> snapshot (Option A):** the team's Excel labels load into the snapshot store, NOT into
  `human_category_id` (live rows untouched). Dev-DB target.

**New doctype `BoQ Category Truth Snapshot`** (`nirmaan_stack/doctype/boq_category_truth_snapshot/`): one
record per (snapshot event x row). Fields mirror `BoQ Row Category` naming -- `boq` (Link BOQs, indexed),
`sheet_name` (Data, VERBATIM #152), `excel_row` (Int), `discipline` (Data, default Electrical),
`committed_version` (Int, current AT snapshot time), `label_category_id` (Data, frozen-vocab id),
`snapshot_batch` (Data, indexed -- one shared id per freeze/load event), `source` (Select:
`Bulk-loaded ground truth` / `Frozen in product`), `snapshot_at` (Datetime), `snapshot_by` (Data). Minimal
controller: `validate` rejects an empty `label_category_id`; `on_doctype_update` adds a composite READ
index `(boq, sheet_name, excel_row, discipline, snapshot_batch)` for the cockpit join (a plain index, not a
hard unique -- logical uniqueness is enforced by the loader; migrate-safe). No workflow/submit.
**`bench migrate` run + table/columns VERIFIED present.**

**Corpus runner `services/boq_category/harness/corpus_classify_and_label.py`** -- a bench-execute tool
(reuses `decay_sweep`'s corpus parsing) with three INDEPENDENT modes; corpus via env `BOQ_CORPUS_INPUT`
or the `corpus` kwarg (never inside `_classification_review/`):
- `resolve` (DRY) -- resolve every file to its `is_current=1` committed sheet by (boq, VERBATIM sheet_name,
  TRIM fallback); print per-sheet file-LI vs committed-eligible + flag gaps. NO writes.
- `classify` -- REFUSES to start if `"BOQ Upload Review AI Settings".enabled` is OFF (else the whole corpus
  classifies AI-off: rule-only, every row Needs review). Per sheet: `orchestrator.classify_sheet_rows` +
  progress print; HARD-ASSERT `summary["ai_status"] == "ran"` else mark the sheet FAILED and CONTINUE
  (per-sheet isolation); ok/failed summary. NO snapshot writes.
- `label` -- load LINE ITEM `team_classification` into the snapshot store: validate the whole corpus
  vocabulary FIRST (abort on out-of-vocab, no writes), ONE `snapshot_batch` per load,
  `source="Bulk-loaded ground truth"`, `snapshot_by="ground-truth-bulk"`, `committed_version` = the sheet's
  current version, one commit per sheet; SKIP a label whose `excel_row` has no current eligible node (prints
  a skip report -- expect ~12 on `BOQ-26-00007`, which re-committed v3 with 261 committed LI vs 273 file
  LI); idempotent -- refuses a second bulk load covering a sheet unless `force_new_batch=True`.
- **VERBATIM fix (found in test):** the snapshot stores the COMMITTED `BoQ Sheet.sheet_name` (authoritative,
  from the DB), not the file's column, so a snapshot row's `sheet_name` is byte-identical to Row Category's
  and the durable-address join holds (trailing-space #152).

**Resolve smoke (in-session, no writes):** all **61 files resolve, 0 misses**, file LineItems **4,335**,
committed eligible **5,367**; the `BOQ-26-00007` gap prints. classify/label NOT run in-session (AI cost /
operational, owner-gated).

**Tests:** new DB module `nirmaan_stack/api/boq/wizard/test_truth_snapshot.py` -- **5 tests, all green**
(seeds a committed sheet + a tiny CSV corpus + drives the real loader): load inserts eligible labels + skips
the non-eligible one + reads back fields intact; controller rejects empty `label_category_id`; out-of-vocab
aborts with NO writes; idempotence refuse + `force_new_batch` banks a second batch; a snapshot row joins to a
`BoQ Row Category` current row by `(boq, sheet_name, excel_row, discipline)`. **Regression: pure suites 129 +
DB `test_classify` 30 + `test_row_category` 26 all unchanged; runner itself has no unittest (harness-stays-thin;
its write path is exercised by the loader tests).**

**Operational note for the eventual run:** AI toggle is currently `enabled=False` on this dev DB (key
present) -- flip it before `classify` or the runner refuses (fail-fast). Recommended order: `classify` all 61
-> then `label` (so machine + human verdicts sit on the same current committed version).

**D3b (micro) -- batch-wise progress in classify mode:** the classify mode now wires
`orchestrator.classify_sheet_rows`'s `progress_cb(done, total)` (CL-2 seam, verified: done = cumulative
rows fed to the voter for the current sheet, clamped to total). Per callback it prints one line
(`sheet i/N <name>: batch done/total rows`, flushed) AND refreshes a run-level `_PROGRESS.json`
mirroring the HV-2 harness pattern: `{run_started_at, sheets_total, sheets_done, sheets_failed:[...],
current_sheet, current_batch_done, current_batch_total, rows_done_total, updated_at}`, rewritten per
batch + per-sheet terminal. `_PROGRESS.json` lives in `progress_out` (new optional `run(...,
progress_out=...)` kwarg / `--progress-out`), default a `<corpus>_classify_progress` sibling folder,
guarded against `_classification_review/`. `rows_done_total` accumulates across sheets (base += each
sheet's `eligible_classified`). resolve + label modes unchanged; additive kwarg (backwards-compatible).
Smokes: resolve still resolves 61; the AI-toggle pre-flight still fires BEFORE any classify work (no
progress dir, no writes); `_write_progress` writes valid JSON with all 9 keys. Regression 129 + 30 + 26
+ 5 unchanged.

**D3c (micro) -- sheet-subset filter + the first operational corpus run.** classify mode gains an
optional `(only_boq, only_sheet)` subset filter (`_resolve_sheets` grows two kwargs, default None = all
sheets; threaded through `_mode_classify` + `run()`; **classify-mode ONLY -- resolve + label untouched**;
empty subset throws). For a targeted re-run of one failed sheet instead of re-classifying the whole
corpus. **Operational run (dev DB, 2026-07-11):** the full 61-sheet electrical corpus classified in ~76
min (~290 opus batches over 5,367 eligible rows) -- **60/61 clean** on the first pass, with ONE sheet
(`BOQ-26-00005/Electrical`) failing on a transient `APIConnectionError` (per-sheet isolation held: it
committed 0 rows and the run continued). The subset filter then re-classified just that sheet
(`only_boq='BOQ-26-00005', only_sheet='Electrical'` -> classified=186, auto=126, review=60, `ai_status`
== ran), filling the single gap -> **final 61/61, 5,367 current Electrical Row Category rows** (all
`prompt_version=v1.3`, `model=claude-opus-4-8`). **Monitoring lesson:** the background-task stdout view
went STALE mid-run (docker-exec buffering made it look killed at sheet 51 when it had actually reached
61); `_PROGRESS.json` (written directly to the container FS per batch) + a per-sheet DB reconcile are the
AUTHORITY on run state, not the captured stdout. Second lesson: the AI toggle
(`"BOQ Upload Review AI Settings".enabled`) flipped OFF twice between runs -- always re-verify it
immediately before a classify. `bench execute` also proved flaky (a spurious `NameError`); a direct
`frappe.init` + `run(...)` invocation is the reliable driver for the retry.

**D3d (micro) -- missing read indexes (editor cold-cache lag fix).** Recon after the corpus run: the
pricing editor is FAST when warm (~54 ms total sheet-open across its 7 read endpoints, no N+1 -- all
per-sheet bulk reads; annotations are bundled into `get_priced_rows`), but the heavy run (10k Row-Category
+ 4,158 snapshot writes + a 76-min classify) CHURNED the Postgres buffer cache, so the first opens after it
hit COLD Seq Scans on the large un-indexed read tables -> `get_priced_rows` ~5.5 s cold, `get_committed_sheet_grid`
322 ms cold. Root cause = two missing indexes (NOT table growth per se -- growth added only ~a few ms; the
cache eviction EXPOSED pre-existing missing indexes). Fixed via `on_doctype_update` + `frappe.db.add_index`
(idempotent, mirroring the snapshot doctype), read-path only, no query/endpoint/schema-field change:
- **BoQ Committed Sheet Grid Row**: the standard child-table **`parent`** index (269,708 rows). EXPLAIN
  flipped Seq Scan -> **Index Scan using `parent_index`**; `get_committed_sheet_grid` warm 29 -> ~8 ms.
- **BoQ Row Category**: composite **(boq, sheet_name, committed_version, discipline, is_current)** = the exact
  `get_sheet_categories` + `set_human_verdict` filter (10,173 rows incl. 4,806 superseded). EXPLAIN flipped
  Seq Scan -> **Bitmap Index Scan**; `get_sheet_categories` warm 3.7 -> ~1.9 ms; the click-path
  `set_row_category` scans drop the same way. The cold spike (full-table scans) collapses to index lookups and
  no longer scales with the table.
- **MIGRATE GOTCHA (documented):** `bench migrate` (63 s) did NOT create the indexes -- Frappe runs
  `on_doctype_update` only on doctype SCHEMA SYNC (fresh install / JSON-hash change), and a controller-only
  change of an unchanged doctype is skipped; `bench reload-doctype` also did not trigger it. On this existing DB
  the indexes were applied by invoking `on_doctype_update()` directly (the identical, sanctioned code) + `ANALYZE`.
  On a fresh env / when these doctypes next sync, it auto-creates. Deploy note: on existing environments this
  index must be applied by a forced schema sync (or a direct `on_doctype_update` run) -- a plain migrate won't.
- **FOLLOW-UP (systemic, NOT fixed here):** the missing child-table `parent` index is site-wide -- **119 of 125
  child tables lack it** (only 6 Frappe-core tables have one; a Frappe-on-PostgreSQL behaviour). Other large app
  child tables also seq-scan by parent: Project Progress Report Work Milestones (90k), Procurement Request Item
  Detail (26k), Purchase Order Item (25k), Delivery Note Item (19k), BOQ Node Qty By Area (11k), PR Tag Child
  Table (9k), PO Payment Terms (7k), etc. A broad parent-index pass is a separate perf slice. Regression
  129 + 30 + 26 + 5 unchanged.


