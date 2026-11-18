# Background operations

A screen that starts work the server finishes later (a TDS export, the handover binder, a commission or bulk PDF
download, a BoQ upload or template seed) follows that **background operation** through its owner-only status record
(ADR 0047): it shows "Waiting in the queue" apart from running, picks the operation up after a reload, ends in the
file of its own operation (never another tab's), and shows the server's words when it fails or is lost. Spec #1654,
tickets #1662-#1665.

## Sub-features

- `tds` TDS export from a project's TDS tab (`Download TDS PDF`): two tabs at once, each downloads its own PDF.
- `handover` the handover binder (`Download binder`) and the Handover TDS export (row "Material Technical Data Sheet"
  -> Edit -> tick -> Download PDF; a not-Done row's Download is refused), at once in two tabs: each ends in its own file.
- `commission` Commission Report tab -> `Bulk Approved Reports` -> Export: the reports PDF.
- `bulk` Bulk Download tab -> a document type -> tick rows -> `Download N ...`: the merged PDF.
- `boq` Upload BoQ: two tabs upload at once, each shows its own outcome; the 30 s "taking a little longer" note waits
  for the parse to start running.
- `template` Admin Options -> BoQ Templates -> seed from a workbook: queued, then its own outcome.

## How to get to it (user POV)

- `tds`, `handover`, `commission`: sidebar `Projects` -> the project -> its `TDS`, `Handover Documents` or
  `Commission Report` tab. A Project Manager on the project sees all three.
- `bulk`: sidebar `Projects` -> the project -> `Bulk Download` (a Procurement Executive on the project).
- `boq`: sidebar `Upload BoQ` -> pick a project -> Continue -> drop a workbook (an Estimates Executive).
- `template`: sidebar `Admin Options` -> `BoQ Templates` (Admin or Estimates Executive).

## Driving it with drive.py

Preconditions:

- `DEVENV serve <task> --wait`. `serve` starts no RQ worker: the walk starts its own `long` worker(s) through
  `BIN/bgops_workers.py` after it has shown the operations queued, and stops them. Check `docker stats --no-stream`
  first and wait while the frappe container uses more than 3.5 GiB.
- Users from `free_users.py "<profile>"` with a password set (`DEVENV run <task> set-password <email> <pw>`): a
  Project Manager with a project that has TDS items, Done HVAC handover documents and Submitted Field commission
  reports; a Procurement Executive on a project with delivery challans; an Estimates Executive.
- The PDF renders (binder, commission, bulk) run wkhtmltopdf in the container, which fetches the print CSS from the
  site URL. An env's host (`t-<task>.localhost`) does not resolve inside the container: set the env site's
  `host_name` to its own backend first, `DEVENV run <task> set-config host_name http://127.0.0.1:<backend port>`
  (`serve` prints the port), or the render stops with `HostNotFoundError`.

- **Whole walk, one part at a time.** `python3 BIN/walk_background_operations.py --task <task> --part
  tds|handover|commission|bulk|boq|template --user <email> --password <pw> [--project <id> --project-name <name>]`
  (the four project parts need both project flags). It prints one `ok`/`MISS` line per check and exits 1 on any
  miss.
- **What it proves.** Each tab's operation id comes from the hook's `get_status?op_id=` reads. `BIN/bgops_db.py`
  reads those records from the cache Redis (saved as `db.txt`): the owner is the walking user, the kind and end state
  are the flow's, the two tabs followed two operations, and each downloaded file is exactly the size its own record
  names. Screens saved: `01-*` the tab, `02-*-queued` with no worker, `03-*` the end.
- **The load check.** `python3 BIN/bgops_nworker_check.py --task <task> --workers N` runs N TDS exports at once on N
  workers and prints peak memory per worker and peak DB connections.

## Gotchas

- A dev env serves no realtime (Socket.IO), so every screen here ends by polling alone (about every 3 s with the
  socket down). That is also the dropped-socket case.
- BoQ upload and template seed always fail on a dev env: the worker reads the workbook only from the production
  bucket. The walk drives the failure path, which is what proves each tab shows its own outcome.
- The status records live in the cache Redis for 24 hours, not in the DB; finished files are in
  `sites/<site>/private/background_ops/<op_id>.bin`, and `logs/background_ops.log` has one line per ended operation.
- The bulk download window says "Waiting for the server to start…" while queued, and the Handover TDS export only
  "Exporting..." (its ticket asks queued apart from running of the binder only).
- TDS exports and the Handover TDS export read each datasheet from the production bucket (read-only downloads); one
  item takes about a minute.
