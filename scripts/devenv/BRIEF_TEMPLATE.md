# Task: <one line: build ticket #N, or what the task is>
<!-- The brief for `task.sh start <name> --brief <file>`. Copy this file outside the repo (the brief may name what
must not be published), fill every <...>, and delete each section marked "omit when". Each rule in "Rules" was
broken once by a box agent; keep them all. -->

## Goal
<What the task makes true, in one or two sentences.> Read the ticket first:
`gh issue view <N> --json title,body,comments --repo Nirmaan-app/nirmaan_stack_frappe15_postgres_14`.
<Its parent spec, and where the owner's decisions behind it are written (the ticket, a comment, a date).>

## Where
- Your branch is `box/<name>`, cut from `<ref>` at `<short sha>`. Commit only on this branch. Never switch branches.
- Your env is `<name>`. Test with `scripts/devenv/devenv.sh test --affected $(python3 scripts/devenv/dod.py base)`.
- Read `CODING_STANDARDS.md` (and `frontend/CODING_STANDARDS.md` for frontend code) before writing code, and the
  domain doc `<path>` (a large doc: list its headings with `grep -n '^#'`, then read only the part you need).
- <Data: the env's data is the backup of <date>. Say whether the owner accepts that age for this task.>

## Start from
<!-- omit when the ticket already names the code -->
- `<file>`: <what in it matters, and the commit that made it>.

## How
1. Build it test-first with the `tdd` skill. Show the first test red on the untouched code before any fix.
2. <A screen changes: walk <screen> with the verify skill as <role>. Or: no screen changes.>
3. Stay inside the ticket. Anything outside it that you find broken: list it in the report, do not fix it.
4. <STOP conditions: a choice that belongs to the owner. Set the report's Status to BLOCKED and say what it would
   change; do not decide it yourself.>

## Known failing tests
<!-- omit when none -->
These modules fail on `<ref>` for reasons outside this task, each with its own ticket: <module (#ticket), ...>.
If only these fail, set the report's Status to BLOCKED (the gate only) and list them.

## Rules for this task
- **Test fixtures use made-up names only.** The repo is public. Never copy a person's or vendor's name from real
  data into a fixture, test, comment or commit message.
- **Pages stay local.** Any checklist or report page goes in `~/claude-artifacts/` as a local `.html` file. Never
  publish anything to claude.ai or any other outside service.
- **Delete nothing** beyond what a test's own teardown removes. No bulk deletes in any DB, not even the env's.
- Never push, never open a PR, never edit, comment on or close a GitHub issue.

## Done
The Definition of Done (`docs/agents/definition-of-done.md`) passes, and the report says, per acceptance criterion
of #<N>: met (with the test name or the evidence that proves it), or not met (with why).
