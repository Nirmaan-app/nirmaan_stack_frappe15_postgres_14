# Repo guard hooks

Two small, committed guards that enforce conventions which were previously prose-only
(and therefore silently ignored). Both fail open / are bypassable for genuine exceptions.

## 1. `guard_claude_md.py` — keep per-slice detail out of CLAUDE.md (Claude Code hook)

**What:** a `PreToolUse` hook (matcher `Edit|Write|MultiEdit`). When an edit to any project
`CLAUDE.md` *adds* changelog-style text (test counts, feat hashes, `Slice N` narratives, build
logs, dated slice stories), the hook returns `permissionDecision: deny` with a message pointing
the author to the right destination:

- backend slices  → `.claude/context/domain/boq-backend.md`
- frontend slices → `frontend/.claude/context/domain/boq-frontend.md`
- live status / full narrative → `frontend/.claude/plans/boq-upload-plan.md`

This is the in-session enforcement of the **DOCS-UPDATE RULE** (CLAUDE.md, 2026-06-25
context-hygiene split). The deny reason is fed back to the model, which then writes the detail
to the domain doc instead — so the hook teaches rather than just blocks.

**Registered in** both `.claude/settings.json` (app-root launches) and
`frontend/.claude/settings.json` (frontend launches), both pointing at this one script.

**Activate:** restart / resume your Claude Code session (hooks load at session start).

**Properties:**
- *Fail-open* — any error → allow (never blocks real work on a hook bug).
- *Delta-aware* — a full-file rewrite that *removes* changelog (a cleanup/dedup pass) is not
  blocked; only genuinely-new lines are evaluated.
- *Scoped* — only `CLAUDE.md`; never the user's global `~/.claude/CLAUDE.md`.

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
