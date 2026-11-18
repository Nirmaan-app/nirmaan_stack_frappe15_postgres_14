# Background operations

A screen that starts work the server finishes later (a TDS export, the handover binder, a commission or bulk PDF
download, a BoQ upload or template seed) follows that **background operation** through its owner-only status record
(ADR 0047): it shows "Waiting in the queue" apart from running, picks the operation up after a reload, ends in the
file of its own operation (never another tab's), and shows the server's words when it fails or is lost. Production
runs N `long` workers, 2 or more, set by instance capacity, so operations overlap: two that write rows of the same
doctype at the same time must both finish. With counted names the later one failed on the shared `tabSeries` row
(ADR 0048), which is how a two-engine Classify click lost an engine on 2026-10-17. Spec #1654: the screens are
tickets #1662-#1665, the N-worker check #1656, #1657, #1659 and #1662.

## Sub-features

The screens (`walk_background_operation_screens.py --part <name>`):

- `tds` TDS export from a project's TDS tab (`Download TDS PDF`): two tabs at once, each downloads its own PDF.
- `handover` the handover binder (`Download binder`) and the Handover TDS export (row "Material Technical Data Sheet"
  -> Edit -> tick -> Download PDF; a not-Done row's Download is refused), at once in two tabs: each ends in its own file.
- `commission` Commission Report tab -> `Bulk Approved Reports` -> Export: the reports PDF.
- `bulk` Bulk Download tab -> a document type -> tick rows -> `Download N ...`: the merged PDF.
- `boq` Upload BoQ: two tabs upload at once, each shows its own outcome; the 30 s "taking a little longer" note waits
  for the parse to start running.
- `template` Admin Options -> BoQ Templates -> seed from a workbook: queued, then its own outcome.

The N-worker check (`walk_background_operations.py --workers N`, no screen: it drives the endpoints the screens call
and reads each operation's outcome where the screen reads it):

- `n-worker-clone` N template clones started at once (Create BoQ from template) all finish, each BoQ with one Review
  Row per template row (#1656).
- `n-worker-classify` ceil(N/2) Classify clicks started at once, each running both engines (Electrical and HVAC) on
  its own sheet, each engine its own background operation: every engine's operation ends finished (#1656, #1666).
- `n-worker-suggest` N rate suggests started at once, each on its own sheet: every suggest finishes with success,
  and the historical match run each one starts (when the match switch is on) ends without an error (#1657).
- `n-worker-tds` N TDS exports by one user at once, heavy (200 rows) and light (1 row) mixed: every export ends
  finished and the PDF each tab collects holds its own rows and no other tab's (#1662). Before #1662 the heavy tab
  took the light tab's PDF.
- `n-worker-boq-lock` the N clones' BoQ creations start at once (N users clicking Create at once), so their BoQ
  number inserts overlap on the BoQ series lock (`services/series_lock`, ADR 0048): every BoQ is created, numbers
  stay counted, and the check reports the longest wait on that lock (#1659).
- `n-worker-figures` the peak memory of each worker (its process plus the work horse it forks per operation) and the
  most Postgres connections the env DB held, the figures that set N per instance (#1672).

## How to get to it (user POV)

- `tds`, `handover`, `commission`: sidebar `Projects` -> the project -> its `TDS`, `Handover Documents` or
  `Commission Report` tab. A Project Manager on the project sees all three.
- `bulk`: sidebar `Projects` -> the project -> `Bulk Download` (a Procurement Executive on the project).
- `boq`: sidebar `Upload BoQ` -> pick a project -> Continue -> drop a workbook (an Estimates Executive).
- `template`: sidebar `Admin Options` -> `BoQ Templates` (Admin or Estimates Executive).
- A clone: Projects -> a project -> Create BoQ from template -> pick sheets -> Create. The screen waits on
  `boq:template_clone_done`, else polls `get_clone_status`.
- A Classify click: a committed sheet's pricing page -> Classify -> both engines ticked -> Start. The page starts
  each engine as its own background operation (`start_classify` with a browser-made `op_id`, one shared hook per
  engine, slot `boq_classify:<boq>::<sheet>::<engine>`) and follows each through its status record (#1666). The
  progress modal shows "Waiting in the queue" until an engine starts running, and its summary names every engine's
  outcome, a failed one with the server's words.
- A rate suggest: a committed sheet's pricing page -> Suggest rates -> whole sheet -> Start. The page waits on
  `boq:suggest_sheet_done` (then `boq:match_sheet_done`), else polls `get_suggest_status` and `get_match_status`.

## Driving it with drive.py

Preconditions, for both scripts:

- `DEVENV serve <task> --wait`. `serve` starts no RQ worker: each script starts its own `long` worker(s) and stops
  them, also when it fails or is stopped. Check `docker stats --no-stream` first and wait while the frappe container
  uses more than 3.5 GiB.
- The PDF renders (TDS export, binder, commission, bulk) run wkhtmltopdf in the container, which fetches the print
  CSS from the site URL. An env's host (`t-<task>.localhost`) does not resolve inside the container: set the env
  site's `host_name` to its own backend first, `DEVENV run <task> set-config host_name http://127.0.0.1:<backend
  port>` (`serve` prints the port), or the render stops with `HostNotFoundError`.

The screens, as their roles:

- Users from `free_users.py "<profile>"` with a password set (`DEVENV run <task> set-password <email> <pw>`): a
  Project Manager with a project that has TDS items, Done HVAC handover documents and Submitted Field commission
  reports; a Procurement Executive on a project with delivery challans; an Estimates Executive.
- **Whole walk, one part at a time.** `python3 BIN/walk_background_operation_screens.py --task <task> --part
  tds|handover|commission|bulk|boq|template --user <email> --password <pw> [--project <id> --project-name <name>]`
  (the four project parts need both project flags). It starts its operations with no worker running, saves the
  screen showing them queued, then starts the worker(s) it needs through `BIN/bgops_workers.py`. It prints one
  `ok`/`MISS` line per check and exits 1 on any miss.
- **What it proves.** Each tab's operation id comes from the hook's `get_status?op_id=` reads. `BIN/bgops_db.py`
  reads those records from the cache Redis (saved as `db.txt`): the owner is the walking user, the kind and end state
  are the flow's, the two tabs followed two operations, and each downloaded file is exactly the size its own record
  names. Screens saved: `01-*` the tab, `02-*-queued` with no worker, `03-*` the end.

The N-worker check, one command:

- `python3 BIN/walk_background_operations.py --task <task> [--workers N] [--runs R] [--flows clone,classify,suggest,tds]`
  (from the checkout root, on the host). It starts N workers with `devenv.sh run <task> worker --queue long` (the
  way `card-import.md` runs one), runs `BIN/background_operations_flows.py` in the env with `devenv.sh script`, and
  stops the workers again, also when it fails or is stopped. The flows run as Administrator (setup, not a role walk)
  through the same endpoints (10 runs of clone and classify, 5 of suggest, 3 of tds; `--runs` sets one count for
  all), and wait for each operation's status. The N clone creates of a run start together, each on its own thread
  and DB connection; the N TDS exports start back to back as N tabs of one screen would.
- **What it proves.** Clone status success and the row count; each classify engine's record finished with a success
  result; suggest status
  success for that sheet, then its match run's status without an error; each TDS export's record finished and its
  collected PDF holding its own marker (`NWC<i>X<run>`, read with pypdf) and no other tab's. A suggest whose status
  falls back to `idle` with no outcome (the spinning screen of a failed suggest before #1657) is a failure. It prints
  a line per run, `FAILED <operation>: <status>` for each failed one, the peak memory per worker, the most DB
  connections (the workers, the flows script's own one and, for a moment, one per clone create) and the longest
  wait on the BoQ series lock (from the waits `series_lock` records in the cache, `recent_waits`), and exits 1 on any
  failed operation, 2 when it could not run. Run it at N=2 and at the largest N planned.
- A new flow is one more `<flow>_setup` / `<flow>_run` pair, with its default run count, in the flows script's
  `FLOWS`.

## Gotchas

- A dev env serves no realtime (Socket.IO), so every screen here ends by polling alone (about every 3 s with the
  socket down). That is also the dropped-socket case.
- BoQ upload and template seed always fail on a dev env: the worker reads the workbook only from the production
  bucket (`sheet_preview._fetch_boq_file_to_tempfile`). The screen walk drives the failure path, which is what proves
  each tab shows its own outcome, and no N-worker flow drives the upload, the other operation that holds the BoQ
  series lock for its whole length. Its lock is proven by `services/test_background_row_names`
  (`TestBoqNumbersStayCounted`).
- The status records live in the cache Redis for 24 hours, not in the DB; finished files are in
  `sites/<site>/private/background_ops/<op_id>.bin`, and `logs/background_ops.log` has one line per ended operation.
- The bulk download window says "Waiting for the server to start…" while queued, and the Handover TDS export only
  "Exporting..." (its ticket asks queued apart from running of the binder only).
- The screen walk's TDS exports and Handover TDS export read each datasheet from the production bucket (read-only
  downloads); one item takes about a minute. The N-worker check's TDS rows carry no datasheet, so nothing is fetched.
- Every N-worker flow runs with the BoQ AI setting switched off, because the env holds a real AI key: the flows
  read the setting, switch it off, and put it back when they end (also when the check is stopped with SIGTERM or
  Ctrl-C). A kill -9 leaves it off: put it back to what it was with
  `frappe.db.set_single_value("BOQ Upload Review AI Settings", "enabled", <value>)` and a commit (`devenv.sh script`).
  With the voter off, classify still writes every row's category (the rule category, flagged for review), which is
  the write that clashed. With it off a suggest writes its run with blank attributes (`ai_status` disabled), and the
  match client refuses to call a model. A classify or suggest reply that says the AI ran counts as a failure. No
  flow ever calls a real provider.
- The N-worker check refuses to start while any worker already runs on the env, or while the frappe container uses
  over 3.5 GiB.
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
- Worker logs: the screen walk's in the env bench's `logs/nworker-<i>.log`; the N-worker check's in
  `~/claude-artifacts/verify/<task>/n-worker-check-<time>/`.
