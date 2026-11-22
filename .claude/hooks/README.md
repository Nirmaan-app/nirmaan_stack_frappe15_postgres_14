# Repo guard hooks

Small, committed guards that enforce conventions which were previously prose-only
(and therefore silently ignored). Both fail open / are bypassable for genuine exceptions.

## 1. `guard_claude_md.py` — keep per-slice detail out of CLAUDE.md (Claude Code hook)

**What:** a `PreToolUse` hook (matcher `Edit|Write|MultiEdit`). When an edit to any project
`CLAUDE.md` *adds* changelog-style text (test counts, feat hashes, `Slice N` narratives, build
logs, dated slice stories), the hook returns `permissionDecision: deny` with a message pointing
the author to the right destination:

- what was built, test counts, hashes, build logs → the commit message, and no doc
- a rule a later change must not break → that domain doc's Load-bearing invariants section
- where BoQ work stands now → `frontend/.claude/plans/boq-status.md`, rewritten in place

The hook also denies every edit to `frontend/.claude/plans/boq-upload-plan.md`. That file is a
closed record: the earlier version of this message sent every author there to append, and it
passed 4 MB.

This is the in-session enforcement of the **DOCS-UPDATE RULE** (CLAUDE.md). The deny reason is
fed back to the model, which then puts the detail in the right place — so the hook teaches
rather than just blocks. Tests: `python3 -I .claude/hooks/test_guard_claude_md.py`.

**Registered in** both `.claude/settings.json` (app-root launches) and
`frontend/.claude/settings.json` (frontend launches), both pointing at this one script.

**Activate:** restart / resume your Claude Code session (hooks load at session start).

**Properties:**
- *Fail-open* — any error → allow (never blocks real work on a hook bug).
- *Delta-aware* — a full-file rewrite that *removes* changelog (a cleanup/dedup pass) is not
  blocked; only genuinely-new lines are evaluated.
- *Scoped* — the changelog check reads only `CLAUDE.md`, never the user's global
  `~/.claude/CLAUDE.md`; the closed-record check reads only that one plan file.

**Tune** the `STRONG` / `WEAK` pattern lists at the top of the script. `STRONG` = any one match
blocks; `WEAK` = two or more together block.

**False positive?** Rephrase the convention without changelog wording, or put the note in the
domain doc (where it likely belongs).

## 2. `../.githooks/commit-msg` — conventional commit messages (git hook)

**What:** rejects a commit whose first line is not `type(scope): summary` (summary ≥ 8 chars);
types: `feat fix refactor docs chore test perf style build ci revert`. Merges / reverts /
autosquash messages are exempt. A `feat`/`fix`/`refactor` commit with **no body** gets a
non-blocking warning (point-wise description encouraged).

**Activate (once per clone):**

```sh
git config core.hooksPath .githooks
```

**Bypass a one-off:** `git commit --no-verify ...`

## 3. `scripts/devenv/dod.py hook` — Definition of Done (Claude Code Stop hook)

**What:** a `Stop` hook. In a worktree where `scripts/devenv/dod.py start` was run (an agent task), it keeps Claude from
finishing until the task meets `docs/agents/definition-of-done.md`: work committed on a task branch, the affected tests
and the type check passed on HEAD's exact code, a `verify` walk when screens changed, and the report filled in. It
returns `decision: block` with the list of what is missing, so the hook teaches rather than just blocks.

**Registered in** `.claude/settings.json` only (app-root launches; agents start at a worktree's root).

**Properties:**
- *Inert outside a task* — no `dod.json` in the worktree's git dir means it exits at once and writes nothing, so
  ordinary sessions are untouched.
- *Fail-open* — any error in the check → allow the stop, with the error on stderr.
- *Bounded* — after 3 consecutive blocks it lets a stuck session end; the report then says what is missing.
- *Proofs, not claims* — it reads stamps written by `devenv.sh test/unit/typecheck` and the verify skill's
  `drive.py`, each holding the tree hash of the code it ran on.

## 4. `guard_log_polling.py` — no foreground loops that poll a log (Claude Code hook)

**What:** a `PreToolUse` hook (matcher `Bash`). It denies an `until`/`while` loop that sleeps and reads a file (`grep`,
`tail`, `cat`, `wc`) unless the command runs with `run_in_background`. Such a loop spends the 10-minute tool limit and
ends before the work does; the deny reason tells the agent to run the long command in the background and act on its
completion notice. A box agent ran four such loops in one task with the prose rule in its context.

**Registered in** `.claude/settings.json` only (app-root launches; agents start at a worktree's root).

**Properties:**
- *Fail-open* — any parse error → allow.
- *Reads only what runs* — heredoc bodies and quoted strings are skipped, so writing a script that holds a loop is allowed.
- *Narrow* — a retry loop that reads no file (a readiness probe such as `until curl …`) is allowed.

**Test:** `python3 -I .claude/hooks/test_guard_log_polling.py`

## 5. `guard_react_doctor.py` — React Doctor only through `yarn doctor` (Claude Code hook)

**What:** a `PreToolUse` hook (matcher `Bash`). It denies any shell segment that names `react-doctor` unless
the segment's command only reads or names its arguments (an allowed list: `READERS`, the git and gh subcommands in
`GIT_READS` and `GH_READS`, plus package-manager queries such as `yarn add`/`why`). The deny reason sends the agent to `yarn doctor <args>` from
`frontend/` (`frontend/scripts/react_doctor.mjs`), which always adds `--no-telemetry --no-score --no-supply-chain`
and refuses `install`, `why` and `--supply-chain`. Without those flags React Doctor sends data to Axiom, Sentry,
react.doctor and Socket.dev; in #1698 agents ran it that way 5 times with the prose rule in their context.

**An accident guard, not a sandbox.** It stops the plain runs that happened in #1698. An agent set on getting past it
can (shell spelling has no end), so a new bypass trick is not a reason for another review round.

**Registered in** both `.claude/settings.json` and `frontend/.claude/settings.json`, so it also guards a session
started in `frontend/`.

**Properties:**
- *Fail-open:* any parse error → allow.
- *Allowed list, not a list of run forms:* a way to run React Doctor nobody thought of (npx by path, `rtk proxy`,
  `/usr/bin/env`, `npm exec -c`, `yarn node`) is denied because its command is not a reader. The command is read
  after `VAR=value`, `env`, `time`, `sudo`, `rtk`, `docker exec`, `ssh` and the like; a segment starts after `;`,
  `&&`, `||`, `|`, `(`, `` ` `` or a newline. The name counts as a whole word only (`box/react-doctor-1698` does not).
  It counts inside quoted strings and heredoc bodies too, so `sh -c '…'`, `ssh r7 '…'`, `ssh r7 <<EOF`, and a shell
  or `xargs` fed by a pipe from a command that names it are denied; `$(...)` in double quotes or an unquoted heredoc
  is checked as commands. `grep react-doctor`, `git log -S react-doctor`, a commit message and a heredoc written to
  a file with `cat` or `tee` are allowed. The name is looked for as the shell will see it: quotes, backslash escapes
  and line continuations removed, `$'…'` and `printf` escapes decoded, braces expanded, so `npx react\-doctor`,
  `npx react-{doctor,}` and `npx $'react\x2ddoctor'` are denied.
- *A command that can run its arguments is not a reader:* `awk` (`system()`), `sed` (GNU `e`), `less`, `bat`, `ag`,
  `ack`, `open` and `read` (a name `'a[$(cmd)]'` runs `cmd`) are left off the list, so `awk '/react-doctor/' f` is
  denied too (use `grep`); `command` reads only with `-v` or `-V`. A listed command stops being a reader when given an
  option that runs a command: `find -exec`, `rg --pre`, `sort --compress-program`, `printf -v`, `test -v`, `git
  -c`/`--config-env`/`--exec-path` (a `!` alias, `core.pager`), `git grep -O`, `-x`/`--exec`, also bundled (`-iO`)
  or shortened (`--open=`). git, gh and the package managers count only when the first word after them is a
  subcommand that runs nothing (`git log`, `grep`, `commit`, `merge`, …; `gh issue`, `pr`, `api`, …; `yarn why`,
  `npm view`, …), so `git bisect run`, `git rebase -x`, a git alias, `gh alias`, a gh extension and `npm --loglevel
  info exec` are denied. A prefix that names `react-doctor` (`GIT_PAGER='npx react-doctor .' git log`, `env -S '…'`) is denied.
- *Known gap:* a script file the agent writes and then runs; React Doctor started from another language (`node -e`,
  `python -c`, a Python subprocess); a name built at run time (`x=react; npx $x-doctor`). The wrapper's refusals are
  the other guard.

**Test:** `python3 -I .claude/hooks/test_guard_react_doctor.py`
