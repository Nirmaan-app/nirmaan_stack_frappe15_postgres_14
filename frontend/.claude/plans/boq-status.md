# BoQ status

Where BoQ work stands now. Rewrite this file in place; keep it under 200 lines. What was built goes in
the commit message, not here.

## Active work

The last recorded slice is **DU-3**, the fix slice from the DU-2 review of the Ducting rows. Its record
is the last `## Slice DU-3` section of `boq-upload-plan.md`.

Nothing newer is recorded. The session that starts the next slice replaces this section with: the
slice's name, what it must deliver, and what is left.

## Open and owed items

Not yet moved out of the closed record. Find them there with
`grep -n -i -E '^#+ .*(owed|open items|deferred|parked|not built)' frontend/.claude/plans/boq-upload-plan.md`,
and open a GitHub issue for each one that is still open.

## The closed record

`boq-upload-plan.md` holds the design spec and every as-built record up to slice DU-3. It takes no new
text, and `.claude/hooks/guard_claude_md.py` refuses an edit to it. List its headings with
`grep -n '^#' <file>`, then read one range.
