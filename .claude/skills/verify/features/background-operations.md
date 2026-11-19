# Background operations

A screen that starts work the server finishes later (a TDS export, the handover binder, a commission or bulk PDF
download, a BoQ upload or template seed, a BoQ hub parse and its automatic checks) follows that **background operation** through its owner-only status record
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
- `bulk` Bulk Download tab -> a document type -> tick rows -> `Download N ...`: the merged PDF. While it waits, the
  window says "You can leave this page. The download carries on and picks up again when you come back." (no "Keep
  this page open"); leaving for the home page and coming Back in the same browser tab shows the same download's
  window again, and it still ends in its file (#1664).
- `boq` Upload BoQ: two tabs upload at once, each shows its own outcome; the 30 s "taking a little longer" note waits
  for the parse to start running.
- `template` Admin Options -> BoQ Templates -> seed from a workbook: queued, then its own outcome.
- `clone` Upload BoQ -> a project -> Create from Template -> Create BoQ: "Waiting in the queue…" with no worker,
  "Building your BoQ…" once one runs, then the hub of the record's BoQ; record `boq_template_clone`, the walker's,
  finished (#1669).
- `snag` Snag List tab -> a batch's tab (`Download` is hidden on "All") -> `Download` -> the dialog's `Download`: the
  toast says "Waiting for the server to start on it..." with no worker, then "Building the PDF..." (or "Built i of n
  sections..."), then the file saves and a Success toast shows; record `snag_pdf`, file size equal to the record's.
  A different user (`--other-user`) gets HTTP 403 from `get_status` and `collect_result` for that op id (#1669).
- `commission-second` a commission bulk download left queued (no worker), then a second from `--project2`'s
  Commission Report tab in a second browser tab: the `Failed` toast names the first ("Your commission reports
  download for <project> is still being prepared. ..."), and the refused operation's record reads failed and never
  started. A worker then finishes the first, which ends in its own file (#1664).
- `binder-second` the same for the handover binder: a second tab's `Download binder` shows "Your handover binder
  for <project> (<system>) is still being prepared. ..." while the first waits; then the first ends in its file
  (#1663).
- `document-beside-binder` a handover binder left queued, then a second tab's row `Download` of one from-app document
  (`--document`, default `commissioning_report`, which `BIN/bgops_hod_document.py` first sets Done with its first
  record selected, env DB only): no refusal toast, its own `hod_document` record reads queued, and once two workers
  run each tab ends in its own file (#1671).
- `classify` a committed sheet's pricing page -> `Classify sheet` -> Electrical and HVAC -> `Classify 2 engines`: one
  `boq_classify` operation per engine, the modal "Waiting in the queue" with no worker, then a summary that names both
  engines (#1666).
- `suggest` two sheets on two BoQs, `Suggest rates` -> `Run all N rows` at once in two tabs, on one worker: each tab
  follows its own `boq_rate_suggest` and shows its own sheet's run; each suggest's match (`boq_rate_match`, the id
  its result names) shows "waiting in the queue", then its outcome (#1667).
- `hub` a BoQ hub -> a sheet's `Re-parse Sheet` -> `Re-parse 1 sheet` (-> `Re-parse anyway` on a Finalized sheet):
  "Waiting in the queue..." with Parse and Re-parse disabled, then the parse's end dialog says what its own record
  says (Parse complete naming the sheet, or Parse error in the server's words), the BoQ's parse flags are released and
  Re-parse is enabled again (#1668).
- `review` the review screen of that sheet (hub -> `Review`), opened while the hub's re-parse waits in another tab:
  the "This sheet is being parsed" banner shows, and clears when the parse ends (#1668).

The N-worker check (`walk_background_operations.py --workers N`, no screen: it drives the endpoints the screens call
and reads each operation's outcome where the screen reads it):

- `n-worker-clone` N template clones started at once (Create BoQ from template) all finish, each BoQ with one Review
  Row per template row (#1656).
- `n-worker-classify` ceil(N/2) Classify clicks started at once, each running both engines (Electrical and HVAC) on
  its own sheet, each engine its own background operation: every engine's operation ends finished (#1656, #1666).
- `n-worker-suggest` N rate suggests started at once, each on its own sheet, each its own background operation:
  every suggest's record ends finished with success, and the match operation each one's result names (when the match
  switch is on) ends finished for that same run (#1657, #1667).
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
- `classify`, `suggest`, `hub`, `review` (an Estimates Executive): sidebar `Projects` -> the project (the `Tendering
  Projects` tab for a pre-Won one) -> `BOQs` -> the BoQ's row (a pre-Won project's row opens the hub) -> the hub. The
  pricing page: the hub's `Tendering` (the first committed sheet) -> the sheet's tab. The review screen: the sheet's
  `Review` on the hub.
- A clone: sidebar `Upload BoQ` -> pick a project -> Create from Template -> pick sheets -> Create BoQ (an
  Estimates Executive). `create_from_template` starts the operation `boq_template_clone` (#1669); the screen follows
  its status record with the shared hook: "Waiting in the queue…", then "Building your BoQ…", then the BoQ's hub, or
  the error card with the server's words (a failed or lost clone) or the template-changed sentence.
- A snag PDF: sidebar `Projects` -> the project -> `Snag List` tab -> `Download` (or `Download All`) -> the dialog's
  Download (a Project Manager on the project). `start_snag_pdf` starts the operation `snag_pdf` (#1669); the
  "Generating PDF..." toast says "Waiting for the server to start on it..." while queued, then "Building the PDF..."
  or "Built i of n sections...", then the file saves and a Success toast shows (or an Error toast with the server's
  words). Only the user who started it reads its status or collects its file; a second start while one is queued
  or running is refused ("A snag PDF is already being prepared for you").
- One per user, the same rule (`background_ops.start(..., one_per_user=...)`, #1663 #1664): a second commission
  bulk download (`Commission Report` tab -> the tracker -> `Bulk Approved Reports` -> `Export`) while the user's first is queued
  or running fails with a `Failed` toast naming the first: "Your commission reports download for <project> is still
  being prepared. Wait for it to finish, then try again." A second handover binder fails with a `Download failed`
  toast: "Your handover binder for <project> (<system>) is still being prepared. ..."; a second one-document download
  likewise ("Your <document> download for ..."). The limits are apart, one per kind: a running commission download
  never holds back a binder, and a queued binder never holds back a one-document download (`hod_document`, #1671).
  The screen disables its own button while one runs, so reach the second start from ANOTHER project's commission tab
  (commission) or a second browser tab (binder, whose tab slot is one per browser tab).
- A Classify click: a committed sheet's pricing page -> Classify -> both engines ticked -> Start. The page starts
  each engine as its own background operation (`start_classify` with a browser-made `op_id`, one shared hook per
  engine, slot `boq_classify:<boq>::<sheet>::<engine>`) and follows each through its status record (#1666). The
  progress modal shows "Waiting in the queue" until an engine starts running, and its summary names every engine's
  outcome, a failed one with the server's words.
- A rate suggest: a committed sheet's pricing page -> Suggest rates -> whole sheet -> Start. The page starts the
  suggest as a background operation (`start_suggest` with a browser-made `op_id`, slot `boq_rate_suggest:<boq>::<sheet>`)
  and follows its status record; the modal shows "Waiting in the queue" until it runs. A complete suggest's result
  names the match operation it queued (`match.op_id`, made by the server); the page then follows that one (slot
  `boq_rate_match:<boq>::<sheet>`), whose phase in the modal reads "waiting in the queue" until it runs (#1667).

- The hub parse: a BoQ's hub (`/upload-boq/hub/<boq>`, reached from `Upload BoQ` -> the BoQ) -> `Parse workbook`
  (or `Re-parse`) -> confirm. The hub starts the parse as a background operation (`run_parse` with a browser-made
  `op_id`, slot `boq_parse:<boq>`): the button reads "Waiting in the queue..." until it runs, then "Parsing..."; a
  failed or lost parse ends the wait with the server's words. The finished result names the automatic check started
  for each parsed sheet (`checks`, server-made ids); the hub follows each (slot `boq_ai_check:<boq>::<sheet>`) and
  the card chip reads "Waiting to check rows…" until it runs, then "Checking rows…" (#1668).
- The review-screen check: a parsed sheet's card -> `Review` (`/upload-boq/hub/<boq>/review/<sheet>`). In the tab
  that parsed, the page picks the check up from the same slot; otherwise it asks `ai_assist.get_check_operation` for
  the caller's own live check and follows it. Its chip reads "Waiting to check rows…" while queued (#1668).

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
  reports; a Procurement Executive on a project with delivery challans; an Estimates Executive. For `snag` and
  `commission-second`, a Project Manager with two projects that have commission trackers, one of them with snag
  batches (on the 2026-11-17 backup few free PMs qualify; query `User Permission` x `Project Commission Report` x
  `Project Snag`). `clone` needs the env's active master BoQ Template (see Gotchas).
- **Whole walk, one part at a time.** `python3 BIN/walk_background_operation_screens.py --task <task> --part
  tds|handover|commission|bulk|boq|template|clone|snag|commission-second|binder-second|document-beside-binder|
  classify|suggest|hub|review
  --user <email> --password <pw> [--project <id> --project-name <name>] [--sheet '<BoQ title>::<sheet name>' ...]`
  (every part but `boq`, `template` and `clone` needs both project flags; `commission-second` also `--project2 <id>
  --project2-name <name>`, a second project of the same Project Manager with Submitted Field reports; `snag` also
  `--other-user <email> --other-password <pw>`; `binder-second` and `document-beside-binder` take `--hod-system`, default HVAC, and the latter `--document`; `classify`,
  `hub` and `review` one `--sheet`, `suggest` two, on two BoQs of the project, each sheet verbatim). It starts its
  operations with no worker running, saves the screen showing them queued, then starts the worker(s) it needs
  through `BIN/bgops_workers.py`. It prints one `ok`/`MISS` line per check, a `NOT WALKED <what>: <why>` line for a
  step the env cannot drive, and exits 1 on any miss.
- **The BoQ parts' data.** `classify`: a committed, unfrozen sheet with Electrical and HVAC rows (the N-worker
  check's `classify_sheets` query finds them). `suggest`: two committed sheets on two BoQs that pass the suggest gate
  (`suggest_sheets`); the match switch (`BOQ Upload Review AI Settings.match_enabled`) on, else each match is
  reported not walked. `hub`, `review`: a parsed sheet of an uploaded BoQ. **The re-parse is real**: where the env
  can read the workbook (it could on the `air` box, 2026-11-19) it rebuilds the sheet's rows and a Finalized sheet
  becomes Parsed, on the env DB only (`devenv.sh reset` restores it); where it cannot, the parse fails at the fetch
  before it writes anything, and the part checks that path instead. These four parts switch the BoQ AI setting off
  and put it back (`BIN/bgops_boq_state.py`), as the N-worker flows do. Pick the sheets on the env with a
  `devenv.sh script` query (real project and BoQ names stay out of this file: the repo is public).
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
  result; each suggest's record finished with success for that sheet, then the record of the match operation its
  result names finished for that run; each TDS export's record finished and its
  collected PDF holding its own marker (`NWC<i>X<run>`, read with pypdf) and no other tab's. It prints
  a line per run, `FAILED <operation>: <status>` for each failed one, the peak memory per worker, the most DB
  connections (the workers, the flows script's own one and, for a moment, one per clone create) and the longest
  wait on the BoQ series lock (from the waits `series_lock` records in the cache, `recent_waits`), and exits 1 on any
  failed operation, 2 when it could not run. Run it at N=2 and at the largest N planned.
- A new flow is one more `<flow>_setup` / `<flow>_run` pair, with its default run count, in the flows script's
  `FLOWS`.

## Gotchas

- The review screen learns of a parse started in another tab only when it is opened (no realtime on a dev env):
  the `review` part reloads it after the hub's parse is queued.
- A dev env serves no realtime (Socket.IO), so every screen here ends by polling alone (about every 3 s with the
  socket down). That is also the dropped-socket case.
- So work that runs under about two status reads (a small clone, one snag batch's PDF: about 3 s each on the
  2026-11-17 backup) can go from queued straight to finished on screen, never showing "Building...". The `clone`
  and `snag` parts then print a `note` line with the run time from the record instead of a `MISS`; a run of 6 s or
  more that never showed it is a `MISS`.
- BoQ upload and template seed always fail on a dev env: the worker reads the workbook only from the production
  bucket (`sheet_preview._fetch_boq_file_to_tempfile`). The screen walk drives the failure path, which is what proves
  each tab shows its own outcome, and no N-worker flow drives the upload, the other operation that holds the BoQ
  series lock for its whole length. Its lock is proven by `services/test_background_row_names`
  (`TestBoqNumbersStayCounted`).
- The status records live in the cache Redis for 24 hours, not in the DB; finished files are in
  `sites/<site>/private/background_ops/<op_id>.bin`, and `logs/background_ops.log` has one line per ended operation.
- A parse starts its sheets' automatic AI checks only with the BoQ AI setting on, which would call a real provider,
  so the walks keep it off and the parse's result names no check (`checks: {}`): the hub's check chip ("Waiting to
  check rows…" / "Checking rows…") and the review screen's check (`get_check_operation`) are reported not walked.
- A suggest with the AI off takes about 1.5 s, so a match waits in the queue for less than one of the screen's ~3 s
  polls. The `suggest` part queues Frappe's own 20 s sleep job (`background_jobs.test_job`, `bgops_boq_state.py
  hold-queue`) behind the two suggests, so each match visibly waits behind it.
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
