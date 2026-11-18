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
- `n-worker-figures` the peak memory of each worker (its process plus the work horse it forks per operation) and the
  most Postgres connections the env DB held, the figures that set N per instance (#1672).

## How to get to it (user POV)

- A clone: Projects -> a project -> Create BoQ from template -> pick sheets -> Create. The screen waits on
  `boq:template_clone_done`, else polls `get_clone_status`.
- A Classify click: a committed sheet's pricing page -> Classify -> both engines ticked -> Start. The dialog calls
  `start_classify` once per engine; the page polls `get_classify_status` per engine.

## Driving it with drive.py

No browser: `BIN/walk_background_operations.py --task <task> [--workers N] [--runs 10] [--flows clone,classify]`
(from the checkout root, on the host) is the N-worker check. It starts N workers with
`devenv.sh run <task> worker --queue long` (the way `card-import.md` runs one), runs
`BIN/background_operations_flows.py` in the env with `devenv.sh script`, and stops the workers again, also when it
fails or is stopped. The flows run as Administrator (setup, not a role walk) through the same endpoints, 10 runs
each, and wait for each operation's status: clone status success and the row count; classify status success per
engine. It prints a line per run, `FAILED <operation>: <status>` for each failed one, the peak memory per worker
and the most DB connections (the workers plus the flows script's own one), and exits 1 on any failed operation,
2 when it could not run. Run it at N=2 and at the largest N planned. A new flow (rate suggests on N sheets, the BoQ
lock's wait) is one more `<flow>_setup` / `<flow>_run` pair in the flows script's `FLOWS`.

## Gotchas

- Classify runs with the BoQ AI voter switched off, because the env holds a real AI key: the flows read the setting,
  switch it off, and put it back when they end (also when the walk is stopped with SIGTERM or Ctrl-C). A kill -9
  leaves it off: put it back to what it was with
  `frappe.db.set_single_value("BOQ Upload Review AI Settings", "enabled", <value>)` and a commit (`devenv.sh script`).
  With the voter off, classify still writes every row's category (the rule category, flagged for review), which is
  the write that clashed. A reply that says the AI ran counts as a failure.
- It refuses to start while any worker already runs on the env, or while the frappe container uses over 3.5 GiB.
- The classify flow picks committed, unfrozen sheets holding 150 to 500 Electrical and HVAC category rows, newest
  BoQ first, and gives each run's rows a new category version there. Cloned BoQs go to a made-up project,
  "Background operations check", created on first use. Both stay on the env.
- A job left on the env's `long` queue (such as Frappe's own website index) runs first on the new workers.
- The clone flow needs the env's active master BoQ Template. The template tests (`test_template_admin`,
  `test_template_materialize`) delete every BoQ Template in the env DB, so after a `devenv.sh test` that ran them
  the flows stop with `clone: no active master template on this env`: `devenv.sh reset <task>` brings it back.
- Worker logs: `~/claude-artifacts/verify/<task>/n-worker-check-<time>/`.
