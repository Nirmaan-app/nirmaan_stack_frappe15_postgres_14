---
name: verify
description: Drive the Nirmaan Stack web app (React SPA over the Frappe backend) as a real role user on this checkout's own dev env, and save screenshot, ARIA and DB evidence. Use to prove a change works on screen, to walk a ticket's acceptance criteria, or before saying a UI change is done.
---

# Verify Nirmaan Stack in the browser

The surface is the web SPA. Every user acts through it under a **role profile**, and the sidebar, pages and
counts change by role. The backend's whitelisted APIs are a second surface; drive them only when a story has no
screen.

`DEVENV` = `/Users/abhishek/work/nirmaan/deploy_setup/frappe_docker/development/devenv.sh`. It lives outside the
repo, on this machine. Without it, this skill does not apply: say so and stop. `BIN` = `.claude/skills/verify/bin`
in the checkout you are verifying. Run every command from that checkout's root.

**Never drive `localhost:8080` / `:8000` or site `localhost`.** That is the user's own site and DB. Drive only an env
this run started or the user named. Each env has its own host, DB and login, so up to 3 walks run side by side.

## Launch

1. `DEVENV up` once per checkout or worktree (about 90 s; the DB is a copy of the dev DB, so it has real data). It
   ends with `Ready. Task: <task>`. The task name is the folder name.
2. `DEVENV serve --wait`. Ready when it prints `serving t-<task>.localhost: open http://t-<task>.localhost:<port>/`.
   It also prints one user per role profile and what the env lacks (realtime, the Gemini key).
3. Pick a user the app will not lock (see Gotchas): `DEVENV script <task> BIN/free_users.py ["<role profile>"]`.
4. Give them a password on the env DB only: `DEVENV run <task> set-password <email> <pw>`.
   Administrator: `DEVENV run <task> set-admin-password <pw>`. Administrator passes every role check, so a walk as
   Administrator proves nothing about roles. Use it only for setup.
5. After a Python change: `DEVENV restart <task>`. Vite reloads the frontend by itself.

## Doctor

`BIN/doctor.sh [<task>]`. It is read-only. It checks that the env exists, that its code is this checkout, that it
is served, and that the SPA and the backend answer through its URL. It prints the URL. Run it first, and again
whenever a page looks wrong. Stop on any `FAIL` line.

## Drive

Use `BIN/drive.py` (headless Playwright on the Mac; it logs in through the real login page):

```bash
python3 BIN/drive.py login --task <task> --user <email> --password <pw>
python3 BIN/drive.py snap  --task <task> --user <email> --password <pw> /purchase-orders 01-po-list --wait-text "All POs"
```

For a flow, write a script that imports `session` and `save`. `BIN/walk_purchase_orders.py` is a working
example: sidebar, then a tab, then a row, then the page, with a DB read beside it.

```python
import sys; sys.path.insert(0, ".claude/skills/verify/bin")
from drive import session, save, sidebar
with session("<task>", "<email>", "<pw>") as (page, out):
    sidebar(page, "Purchase Orders")
    save(page, out, "01-po-list")
```

Handles that hold in this app:
- Open a sidebar entry with `sidebar(page, "<label>")`. A plain `get_by_role("button", name="Projects")` also
  matches a dashboard card of the same name.
- List tabs are `button`s whose name ends in a count (`Delivered PO 810`): match with a regex `^Delivered PO \d+$`.
- A list's rows are `row`s, and a document id is a `link` (`PO/103/00086/25-26`). In a Python regex passed to
  Playwright, escape `/` (`r"^PO\/"`); an unescaped `/` raises `InvalidSelectorError`.
- A document page shows `Loading data...` until its data arrives: wait for that text to be hidden, not for
  `networkidle`.
- The open tab and the table's page are in the URL (`?tab=Delivered+PO&po_delivered_po_pageIdx=0`).

You may also look at a page live in Chrome (the `claude-in-chrome` tools) at the env URL. Its screenshots do not
land on disk, so take the evidence with `drive.py`.

To read or seed the env DB, write a Python file and run `DEVENV script <task> <file.py> [args]`. The site is
already connected. Only an explicit `frappe.db.commit()` writes, and it writes to the env DB alone.

## Evidence

`save(page, out, name)` writes `<name>.png` (full page), `<name>.aria.txt` (the ARIA snapshot) and `<name>.txt` (the
URL and the visible text). The folder is `$VERIFY_OUT`, else `~/claude-artifacts/verify/<task>/<UTC time>/`. A
failed session also saves `FAIL.*`. Name files by step: `01-…`, `02-…`.

A proof is good when:
- It goes the way the user goes: sidebar, buttons, links, as that story's role. Typing a route is setup, not proof.
- It shows the action and the state after it, not only the last screen.
- A write is confirmed twice: on the screen, and by a DB read (`DEVENV script`) that you save beside the
  screenshots (`… > "$out/db.txt"`).
- A number on screen matches the DB for that user. Lists are filtered by the user's projects, so compare with the
  same filter, not the whole table.
- A step you could not drive is reported as *not walked*, with the reason. Never mark it seen through another path.

Uploads and submits are safe on an env: every migrate turns off mail, clears phone push tokens and keeps uploads on
local disk.

## Cleanup

- `DEVENV stop <task>` stops what `serve` started. Never kill processes by name.
- `DEVENV destroy <task>` when the folder is finished with. Do not destroy `dev`, `master` or `lab`: leave those to
  the user. Passwords set in Launch live only in the env DB and go with it.
- Evidence under `~/claude-artifacts/verify/` is never removed by cleanup.

## Gotchas

- **The app access gate locks most users.** A user who holds an asset with a declaration to sign, or an audit to
  send, sees only Dashboard and a "Finish these to continue" card. So does a procurement or project user with no
  project. `free_users.py` lists users with neither. A profile it lists as `(none …)` needs its lock cleared
  first: sign the declaration as that user (Open my assets, then Sign), which writes only to the env DB.
- **Realtime (Socket.IO) is not served.** A screen that waits for a realtime event does not refresh: reload it.
- **The serve printout's users may be locked.** Its list names one user per profile, not an unlocked one.
- **The env DB is a copy from the date `DEVENV up` prints.** Data newer than that is not there. If `up` or
  `migrate` fails on a missing column, tell the user the template is stale; do not rebuild it.

## Feature map

[`features/README.md`](features/README.md) lists the features and how to drive each. Read it before a walk. When a
feature has several ways in, walk the ones the change touches.
