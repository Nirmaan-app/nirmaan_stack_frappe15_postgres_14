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
  shoots the screen with the control it clicks next boxed, then clicks it; it stops the walk when that control
  is not found, so no step is saved as clicked without its box. It scrolls once, to that control (or the first
  pin), and measures every box on that one screen, so it also stops when a pin is off that screen: give such a
  pin its own step. `w.check(change, role, expect, seen, ok,
  kind)` records a role or number check. `w.status(change, "not_walked", reason)` marks a claim it could not drive.
- `BIN/build_page.py <walk dir> <out.html> [--terms terms.json]` builds the page. It refuses a click or pin box
  without `w` and `h` above 0, or a step that clicked with no click box, and names the step.
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

The roles this app has, and a user for each that sees all the data the walk needs. `DEVENV serve <env>` prints,
per role profile, the enabled login with the fewest user permissions and that count; in this app a user permission
names one project the user may see. Start from that list, then check what it does not say:

| Role | What the list does not say |
|---|---|
| Project Manager, Project Lead, Procurement Executive, Procurement Lead, Material Procurement Executive | These need a project. A login with none is locked on Dashboard by the app's access gate, and `serve` can print one with a count of 0. Take a user from the verify skill's `free_users.py` instead (it lists only users with a project), and pick the walk's data from that user's projects. None of them sees every project, Procurement Lead included. |
| Any role | `serve`'s login may hold an asset with a declaration to sign, which also locks it. `free_users.py` lists users who are not locked. |

Set one test password per user on both envs: `DEVENV run <env> set-password <email> <pw>`. Run `free_users.py` as
`DEVENV script <env> .claude/skills/verify/bin/free_users.py "<role profile>"`.

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

## 9. After the PR merges: graduate the walk

A PR walk runs once, on throwaway envs. Once the PR merges, each claimed change it walked becomes a walk anyone can
rerun on their own env, or gets a written reason it has none.

- Per feature the PR touched, write `.claude/skills/verify/bin/walk_<feature>.py` from the walk's *after* steps.
  It takes the env as an argument; no `pr-<n>` env is named in it. It picks its records by query, as step 5 says,
  never by fixed ids.
- It ends with `w.finish(<feature file>, stamp=<not a partial run>)`. `finish` rolls each change up from its checks and
  pins, saves `walk.json`, writes `Last walked (<script>): <date> UTC at <commit>, passed.` (or `failed.`) into the
  feature file, and exits 1 unless the walk passed. A run of some of its parts passes `stamp=False`.
- Add or update the feature file in `.claude/skills/verify/features/` per that folder's `README.md` contract, and its
  line in that `README.md` naming the walk.
- In `.claude/skills/verify/features/graduated.json`, give every claim id of `walk_pr_<n>.py` an entry:
  `{"<n>": {"<claim id>": "walk_<feature>.py"}}`, or `"skip: <reason>"` for a claim with nothing to walk again.
- Run each walk on an env until it passes, and commit the stamp it writes with the walk.

Until then, residence check W1 (`scripts/walk_graduation.py`) refuses the commit or merge that brings the merged
walk in, and CI refuses the pull request.

## Gotchas

- Sidebar sub-items use `data-sidebar="menu-sub-button"`, which `sidebar()` does not match.
- A hidden file input needs `set_input_files`; make upload files at run time, never commit a binary.
- Radix hover cards are boxed through `[data-radix-popper-content-wrapper]`; column filters open by clicking their funnel `svg`.
- The date-range picker's Apply stays disabled after a preset; press Escape instead of clicking it.
- In a Python regex passed to Playwright, escape `/` or use `.`; a bare `/` raises `InvalidSelectorError`.
- Envs have no Gemini key: a Document AI read fails by design. Mark that claim not walked.
- Env data is a copy of a production backup: figures are real, and a walk's writes stay in that env.
