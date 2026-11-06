# Task: <<FILL: one line: build ticket #N, or what the task is>>
<!-- The brief for `task.sh start <name> --brief <file>`. Copy this file outside the repo (the brief may name what
must not be published), replace every <<FILL: …>> (task.sh start refuses a brief that still holds one), and delete
each section marked "omit when". Each rule in "Rules" was broken once by a box agent; keep them all. -->

## Goal
<<FILL: what the task makes true, in one or two sentences.>> Read the ticket first:
`gh issue view <<FILL: N>> --json title,body,comments --repo Nirmaan-app/nirmaan_stack_frappe15_postgres_14`.
<<FILL: its parent spec, and where the owner's decisions behind it are written (the ticket, a comment, a date).>>

## Where
- Your branch is `box/<<FILL: name>>`, cut from `<<FILL: ref>>` at `<<FILL: short sha>>`. Commit only on this branch.
  Never switch branches.
- Your env is `<<FILL: name>>`. Test with `scripts/devenv/devenv.sh test --affected $(python3 scripts/devenv/dod.py base)`.
- Read `CODING_STANDARDS.md` (and `frontend/CODING_STANDARDS.md` for frontend code) before writing code, and the
  domain doc `<<FILL: path>>` (a large doc: list its headings with `grep -n '^#'`, then read only the part you need).
- Data: <<FILL: the backup date task.sh start printed, and whether the owner accepts that age for this task.>>

## Start from
<!-- omit when the ticket already names the code -->
- `<<FILL: file>>`: <<FILL: what in it matters, and the commit that made it>>.

## How
1. Call the Skill tool with `mattpocock-skills:tdd` before the first test, and build through it. Show the first test
   red on the untouched code before any fix. Name every skill this way, with its exact name: a box agent loads a
   skill only when told to call it, and the box may lack a plugin the laptop has.
2. <<FILL: each screen that changes and the role that walks it; or "No screen changes", and delete the rest of this
   step.>> Walk them with the `verify` skill. Write the walk as `.claude/skills/verify/bin/walk_<feature>.py` on the
   pattern of `walk_purchase_orders.py`: it asserts each screen's text and its DB row, and exits 1 on any miss.
   Commit it with `.claude/skills/verify/features/<feature>.md` and that file's line in `features/README.md`.
3. Before the report, call the Skill tool with `mattpocock-skills:domain-modeling` over this task's diff. Write each
   new or changed term to `GLOSSARY.md` and commit it. List each ADR its three tests call for in the report's Open
   questions, for the owner's yes. Change an existing term or ADR only where the code proves it wrong, and say so.
4. Stay inside the ticket. Anything outside it that you find broken: list it in the report, do not fix it.
5. <<FILL: STOP conditions: a choice that belongs to the owner. Set the report's Status to BLOCKED and say what it
   would change; do not decide it yourself.>>

## Review
Call the Skill tool with `mattpocock-skills:code-review` against the task's base, and fix its findings that are
inside the task. `dod.py check` stays red until `tdd` and `code-review` were both loaded. This task closes its own
review: every in-scope finding is fixed here, and the rest are listed in the report's Open questions. (Spec #1585's
review findings became a chain of follow-up tickets, #1601 -> #1606 -> #1611.)

## Known failing tests
`CODING_STANDARDS.md` § Writing tests, "Known failing tests", lists the modules that fail on `master` for a reason
outside any task. If only those fail, set the report's Status to BLOCKED (the gate only) and list them.

## Rules for this task
- **Test fixtures use made-up names only.** The repo is public. Never copy a person's or vendor's name from real
  data into a fixture, test, comment or commit message.
- **Pages stay local.** Any checklist or report page goes in `~/claude-artifacts/` as a local `.html` file. Never
  publish anything to claude.ai or any other outside service.
- **Delete nothing** beyond what a test's own teardown removes, and any env you made yourself in this task
  (`devenv.sh destroy <it>`, e.g. a throwaway env on the base to show a test already failed there). No bulk deletes
  in any DB, not even the env's.
- Never push, never open a PR, never edit, comment on or close a GitHub issue.

## Done
The Definition of Done (`docs/agents/definition-of-done.md`) passes, and the report says, per acceptance criterion
of #<<FILL: N>>: met (with the test name or the evidence that proves it), or not met (with why).
