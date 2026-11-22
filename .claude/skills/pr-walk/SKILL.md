---
name: pr-walk
description: Build a PR walk page for Nirmaan Stack: one self-contained HTML page that shows every change a pull request claims, screen by screen, for each role, before and after, with the clicked control boxed and problems pinned where they show. Use for /pr-walk <PR number or URL>, "walk this PR", or before reviewing a PR that changes screens.
---

# PR walk page for Nirmaan Stack

A reviewer reads a PR by its screens. This skill turns one PR into `~/claude-artifacts/pr-<n>-walk.html`: a single file
that opens on a phone, with the evidence behind it in `~/claude-artifacts/verify/pr-<n>/walk/`.

`BIN` below means `.claude/skills/pr-walk/bin`.

- `BIN/record.py` turns a Playwright walk into `walk.json` plus one screenshot per step. Its docstring holds the
  data shape. `w.step(page, change, side, role, user, caption, click=<locator>, pins=[pin(<locator>, text, kind)])`
  shoots the screen with the control it clicks next boxed, then clicks it. `w.check(change, role, expect, seen, ok,
  kind)` records a role or number check. `w.status(change, "not_walked", reason)` marks a claim it could not drive.
- `BIN/build_page.py <walk dir> <out.html> [--terms terms.json]` builds the page. It refuses a click or pin box
  without `w` and `h` above 0 and names the step.
- `BIN/sheet.py <walk dir> <out.jpg>` tiles every screenshot with its boxes drawn, to check each box by eye.
- `BIN/walk_pr_1732.py` and `BIN/walk_pr_1731.py` are worked examples (1731 reads its numbers from the DB and handles uploads and PDFs). Copy the closest one for a new PR.

## 1. Read the PR

`gh pr view <n> --repo Nirmaan-app/nirmaan_stack_frappe15_postgres_14 --json title,body,files,headRefOid`. Read the whole description. Every claim it makes becomes one `w.change(id, title, claim)`, and every
number or rule it states becomes a `w.check`. A claim with no screen (a migration, a background job) is still listed;
walk its visible effect or mark it not walked with the reason.

## 2. Two instances: after and before

The PR's head is *after*; the merge base with its target branch is *before*.

`DEVENV` is the dev-env script named in the machine's `development/CLAUDE.md`; call it by its absolute path.

```bash
git fetch upstream pull/<n>/head develop
git branch -f pr-<n>-head <headRefOid>
git merge-base pr-<n>-head upstream/develop          # the base commit
DEVENV create pr-<n> pr-<n>-head                     # about 1 min; it migrates, so a PR with new fields works
DEVENV create pr-<n>-base <base commit>
DEVENV serve pr-<n> --wait
DEVENV serve pr-<n>-base --wait
```

If `create` or `migrate` fails because the template DB is stale, stop and tell the owner; never rebuild the template.

## 3. One user per role

The roles this app has, and a user for each that sees all the data the walk needs:

| Role | User | Why this one |
|---|---|---|
| Admin | `admins@nirmaan.app` | No project limits. Not `abhishek@nirmaan.app`: it is limited to 1 project. |
| Accountant | `swathi@nirmaan.app` | No project limits. |
| Accountant Lead | `deepa@nirmaan.app` | No project limits. |
| Procurement Lead | `sowmya@nirmaan.app` | Sees every project. Procurement Executives see only their own. |
| PMO | `deven@nirmaan.app` | No project limits. |
| Project Manager | `abdul.hannan@nirmaan.app` | Assigned to 2 projects; pick data from those. |

Set one test password per user on both envs: `DEVENV run <env> set-password <email> <pw>`. `free_users.py` marks
users holding an asset as locked; that flag does not stop a login.

Before walking, prove each user can see the records the walk uses: a `DEVENV script <env> <file.py>` that calls `frappe.set_user(<email>)` then `frappe.get_list(<doctype>, filters=...)` and prints the count. A user limited to part of
the data gets empty lists, which look like a bug in the PR.

## 4. Log in and drive

```python
import sys; sys.path.insert(0, ".claude/skills/verify/bin")
from drive import session, sidebar
with session("pr-<n>", "<email>", "<pw>") as (page, out):
    sidebar(page, "Reports")
```

The `verify` skill's Drive section has the locator handles that hold in this app.

Probe each screen first with a short script that saves screenshots, and look at them, so the walk's locators work.
Reach screens the way the role does (menus, buttons, links); typing a URL is setup, not proof.

## 5. Read the facts from the data

`DEVENV script <env> <file.py>` runs a file with the env's site connected; nothing is written without `frappe.db.commit()`. `walk_pr_1731.py` has a `db()` helper that runs one and saves the script and its output under the walk's `db/` folder.

Read every expected number at the start of the run, from the instance's own data, and pick the records to walk the
same way. A walk that writes (uploads, saves) needs fresh records on each rerun: pick them with a query for
records still in the starting state (no upload yet, field still empty) and that the screen offers the action for
(read the component's own condition, such as a status or a billing flag), never from a fixed list, which earlier
runs use up.

## 6. Write and run the walk

Copy the closest example to `BIN/walk_pr_<n>.py`. Rules:

- A failed role or behaviour check is kind `must` and fails its change. A number off by rounding is a `nit`.
- Pin what you see that is wrong, odd, or contradicts the PR: `must`, `should`, `nit` or `info`, with evidence
  `seen` or `guess`.
- A PDF is not a screen. Catch the download, render page 1 to an image, show that as a step. If that cannot be done
  cleanly, mark the claim not walked.
- Never mark a claim seen through another path than the user's.

Run it into `~/claude-artifacts/verify/pr-<n>/walk/`. A rerun goes into a new folder (`walk2`, ...); never delete a run.

## 7. Build and check the page

```bash
python3 -I BIN/build_page.py ~/claude-artifacts/verify/pr-<n>/walk <out> --terms BIN/terms_pr_<n>.json
```

Out is `~/claude-artifacts/pr-<n>-walk.html`. Before handing it over:

- `node ~/evals/page-check/pagelint.mjs <page>` must print PASS.
- Load it at 390 px and 1280 px wide: no console errors, no sideways scroll.
- Run `BIN/sheet.py` on the walk and look at the sheet: every blue click box and numbered pin sits on the
  control its caption names, and no red X (a box with no size) shows.
- Look at every screenshot that carries a pin, and at least one per change.

## 8. Clean up

`DEVENV stop pr-<n>` and `DEVENV stop pr-<n>-base`. `DEVENV destroy` drops the env's DB: it is a delete, so it waits for the owner's "yes delete".

Evidence and the page stay.

## Gotchas

- Sidebar sub-items use `data-sidebar="menu-sub-button"`, which `sidebar()` does not match.
- A hidden file input needs `set_input_files`; make upload files at run time, never commit a binary.
- Radix hover cards are boxed through `[data-radix-popper-content-wrapper]`; column filters open by clicking their funnel `svg`.
- The date-range picker's Apply stays disabled after a preset; press Escape instead of clicking it.
- In a Python regex passed to Playwright, escape `/` or use `.`; a bare `/` raises `InvalidSelectorError`.
- Envs have no Gemini key: a Document AI read fails by design. Mark that claim not walked.
- Env data is a copy of a production backup: figures are real, and a walk's writes stay in that env.
