# Definition of Done: an agent task

An agent's work is done when the code is proven, not when the agent says so. Every check below reads a proof that
the tool which ran the check wrote itself. `scripts/devenv/dod.py` runs the check, and a Claude Code Stop hook runs
it at the end of every turn, so an agent cannot finish a task that fails it.

The check applies only to a worktree where the task was started with `dod.py start`. Ordinary sessions are untouched.

## The task's life

1. **Start.** On the dev box, in the task's own worktree and env:
   ```bash
   scripts/devenv/devenv.sh create <task> --on <branch>     # or: --branch <new branch>
   cd <the worktree it prints>
   python3 scripts/devenv/dod.py start                      # base = HEAD now; prints the report's path
   ```
2. **Work.** Build the change with the usual rules (`CLAUDE.md`, `CODING_STANDARDS.md`). Commit as you go.
3. **Prove** (each tool stamps its own proof for the exact code it ran on):
   - backend changed (`nirmaan_stack/`): `scripts/devenv/devenv.sh test --affected $(python3 scripts/devenv/dod.py base)`
   - frontend changed (`frontend/src/`): `scripts/devenv/devenv.sh typecheck`
   - a screen changed (`frontend/src/`, tests aside): walk each changed screen with the verify skill
     (`.claude/skills/verify/`), as the role that uses it
4. **Report.** Fill in the report that `dod.py start` wrote (its path is printed, under `~/claude-artifacts/dod/`).
5. **Check.** `python3 scripts/devenv/dod.py check` lists anything still missing. The Stop hook runs the same check.

## Done means all of these

| # | Rule | How it is proven |
|---|---|---|
| 1 | The work is committed on a task branch: not `master`, `main` or `develop`, not a detached HEAD, nothing uncommitted or untracked | `git status`, `git branch` |
| 2 | At least one commit since the task started | HEAD differs from the base |
| 3 | The affected backend tests pass on HEAD's code (when `nirmaan_stack/` changed) | the `test` stamp from `devenv.sh test --affected <base or older>`: PASS, same tree as HEAD |
| 4 | No new type errors (when `frontend/src/` changed) | the `typecheck` stamp: PASS, same tree as HEAD |
| 5 | Each changed screen was walked (when non-test `frontend/src/` files changed) | a `verify` stamp from `drive.py`: PASS, same tree as HEAD, screenshots saved |
| 6 | The report is complete | sections Status, What changed, Evidence, Data and Open questions are filled in, no `TODO` is left, and it names HEAD's commit |

"Same tree as HEAD" means the stamp's code fingerprint (a git tree hash of the worktree as it was tested) equals the
committed code. A change after a run makes its proof stale: run it again.

## When the task cannot be done

Set the report's `## Status` to `BLOCKED` and explain why, and what the owner must decide. Commit what you have. Rules
2 to 5 are then skipped, and the owner reads the report.

## What the hook does not check

- **A separate review.** The builder does not grade its own work. A second agent (or the owner) reads the diff and
  the evidence and writes its verdict in the report's `## Review` section. The hook cannot tell who wrote it, so the
  runner that starts agent tasks owns this step.
- **Test quality.** A green run proves the tests pass, not that they test the right thing. Review covers that.
- **Fresh data.** `devenv.sh up` and `create` print the data's age and warn past 7 days. Ask the owner for a fresh
  backup (`scripts/devenv/data.sh`); never fetch one yourself.

## Turning it off

`python3 scripts/devenv/dod.py stop` in the worktree. The owner does this to end or abandon a task. A stuck session
is also let go after 3 blocks in a row, and its report says what was missing.
