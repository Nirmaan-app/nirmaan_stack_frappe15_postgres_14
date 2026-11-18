# Background operations with N long workers

Background operations that overlap all succeed when the server runs N `long` workers (spec #1654). Production will
run N of them, 2 or more, set by instance capacity. Two operations that write rows of the same doctype at the same
time must both finish; with counted names the later one failed on the shared `tabSeries` row (ADR 0048), which is
how a two-engine Classify click lost an engine on 2026-10-17. There is no screen change to walk: the check drives
the endpoints the screens call and reads each operation's outcome where the screen reads it.

## Sub-features

- `n-worker-clone` N template clones started at once (Create BoQ from template) all finish, each BoQ with one Review
  Row per template row (#1656).
- `n-worker-classify` ceil(N/2) Classify clicks started at once, each running both engines (Electrical and HVAC) on
  its own sheet: every engine's run finishes (#1656).
- `n-worker-suggest` N rate suggests started at once, each on its own sheet: every suggest finishes with success,
  and the historical match run each one starts (when the match switch is on) ends without an error (#1657).
- `n-worker-boq-lock` the N clones' BoQ creations start at once (N users clicking Create at once), so their BoQ
  number inserts overlap on the BoQ series lock (`services/series_lock`, ADR 0048): every BoQ is created, numbers
  stay counted, and the check reports the longest wait on that lock (#1659).
- `n-worker-figures` the peak memory of each worker (its process plus the work horse it forks per operation) and the
  most Postgres connections the env DB held, the figures that set N per instance (#1672).

## How to get to it (user POV)

- A clone: Projects -> a project -> Create BoQ from template -> pick sheets -> Create. The screen waits on
  `boq:template_clone_done`, else polls `get_clone_status`.
- A Classify click: a committed sheet's pricing page -> Classify -> both engines ticked -> Start. The dialog calls
  `start_classify` once per engine; the page polls `get_classify_status` per engine.
- A rate suggest: a committed sheet's pricing page -> Suggest rates -> whole sheet -> Start. The page waits on
  `boq:suggest_sheet_done` (then `boq:match_sheet_done`), else polls `get_suggest_status` and `get_match_status`.

## Driving it with drive.py

No browser: `BIN/walk_background_operations.py --task <task> [--workers N] [--runs R] [--flows clone,classify,suggest]`
(from the checkout root, on the host) is the N-worker check. It starts N workers with
`devenv.sh run <task> worker --queue long` (the way `card-import.md` runs one), runs
`BIN/background_operations_flows.py` in the env with `devenv.sh script`, and stops the workers again, also when it
fails or is stopped. The flows run as Administrator (setup, not a role walk) through the same endpoints (10 runs
of clone and classify, 5 of suggest; `--runs` sets one count for all), and wait for each operation's status. The N
clone creates of a run start together, each on its own thread and DB connection. Clone
status success and the row count; classify status success per engine; suggest status success for that sheet, then
its match run's status without an error. A suggest whose status falls back to `idle` with no outcome (the spinning
screen of a failed suggest before #1657) is a failure. It prints a line per run, `FAILED <operation>: <status>` for
each failed one, the peak memory per worker, the most DB connections (the workers, the flows script's own one and,
for a moment, one per clone create) and the longest wait on the BoQ series lock (from the waits `series_lock` records in
the cache, `recent_waits`), and exits 1 on any failed operation, 2 when it could not run. Run it at N=2 and at the largest N planned. A new
flow is one more `<flow>_setup` / `<flow>_run` pair, with its default run count, in the flows
script's `FLOWS`.

## Gotchas

- Every flow runs with the BoQ AI setting switched off, because the env holds a real AI key: the flows read the
  setting, switch it off, and put it back when they end (also when the walk is stopped with SIGTERM or Ctrl-C). A kill -9
  leaves it off: put it back to what it was with
  `frappe.db.set_single_value("BOQ Upload Review AI Settings", "enabled", <value>)` and a commit (`devenv.sh script`).
  With the voter off, classify still writes every row's category (the rule category, flagged for review), which is
  the write that clashed. With it off a suggest writes its run with blank attributes (`ai_status` disabled), and the
  match client refuses to call a model. A classify or suggest reply that says the AI ran counts as a failure. No
  flow ever calls a real provider.
- It refuses to start while any worker already runs on the env, or while the frappe container uses over 3.5 GiB.
- The suggest flow picks N committed sheets on N different BoQs, newest first, that pass the suggest gate and hold 20
  to 300 rate-editable rows. Each run supersedes the sheet's active suggestion run (and match run) with a new one;
  the old runs are kept, as on the screen.
- The classify flow picks committed, unfrozen sheets holding 150 to 500 Electrical and HVAC category rows, newest
  BoQ first, and gives each run's rows a new category version there. Cloned BoQs go to a made-up project,
  "Background operations check", created on first use. Both stay on the env.
- A job left on the env's `long` queue (such as Frappe's own website index) runs first on the new workers.
- The clone flow needs the env's active master BoQ Template. The template tests (`test_template_admin`,
  `test_template_materialize`) delete every BoQ Template in the env DB, so after a `devenv.sh test` that ran them
  the flows stop with `clone: no active master template on this env`: `devenv.sh reset <task>` brings it back.
- The BoQ upload, the other operation that takes the BoQ series lock (for its whole length, in a worker), cannot run
  on an env: its worker fetches the workbook from the bucket only (`sheet_preview._fetch_boq_file_to_tempfile`), so
  no flow drives it. Its lock is proven by `services/test_background_row_names` (`TestBoqNumbersStayCounted`).
- Worker logs: `~/claude-artifacts/verify/<task>/n-worker-check-<time>/`.
