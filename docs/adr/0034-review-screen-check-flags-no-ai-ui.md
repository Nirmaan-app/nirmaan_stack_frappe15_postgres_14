# 34. The review screen shows check flags, and no AI or Gemini piece

Date: 2026-10-13

## Status

**Accepted** (owner rulings R1-R30, UI items U1-U17 and the Part A answers, 2026-10-13). Built in slice S4a on
`feature/boq-jev-integration`. Builds on [ADR-0033](0033-review-flags-and-finalize-block.md) (the flag rules,
"Looks OK", the finalize block, the revert cascade) and [ADR-0032](0032-automatic-claude-check-after-parse.md)
(the automatic check). **S3 and S4 go to production together** (R30). S4b follows: the over-40% banner, the
"check didn't finish" banner, the hub, the parse dialog and its summary, removing "Edit values / text", renaming
"Revert to parser".

## Context

S3 built the rules of the new review and changed nothing on screen: the reviewer still saw the old "AI Rec"
pills, two run buttons and two suggestion blocks, while the server already refused to finalize a sheet with an
unchecked flag that nothing on screen could tick. S4a puts S3's flags on the review screen and takes every AI
and Gemini piece off it.

## Owner rulings

- **R1:** *"claude should run automatically after heuristic run. we remove both b uttons for the Gemini and claude
  Ai run... they can only reparse the sheet if needed, in which case it will work exactly like a fresh parsing"*
- **R3:** finalize: *"yes. correct parenting and row type is critical... so it should bloack"*
- **R4:** *"No fucntionlaity related to the checks and worflows of how changes are made and saved chould be
  changed"*
- **R6:** *"parser output for the user means (parser+claude). they dont need to go inside it"*
- **R13:** *"One row at a time - no 'clear all', the same rule as revision rows today."*
- **R16:** *"not onl;y agreeing withthe flag, but the user is also free to make any other change they want as
  they are able to do today."*
- **R17:** *"also check how the rows with children behave when the parent opr row trype is changes. it should
  trigger the same workflow for remapping the children also as it is today."*
- **R20:** *"then we need to change this.. revert should revert all changes to the row and its childrem also, if
  the children changes were done as part of th erow change. if the children change was done independently then
  dont revert the children change"*
- **R21:** flagged rows show a one-line neutral reason, no AI suggestion, no AI name: *"ok"*.
- **R22:** the mockup's "WHAT IS REMOVED" list: *"'Run AI pass' and 'Run Gemini' buttons + their running chips;
  'AI Rec' and 'Gemini' columns + their filters; Indigo / violet row tints; The 'AI suggestion' and 'Gemini
  suggestion' blocks in the row detail; All seven AI / Gemini message strips; 'Accepted - Claude' / 'Accepted -
  Gemini' labels (old rows show 'Edited')"*; and *'"AI Accepted" option removed.'*
- **R23:** the stray "Gemini suggestion" block after a revert: *"fix in s4"*.
- **R24:** *"Agree. warnings/flags should be cleared once it is acted upon. ifthe change ius reverted it should
  come bac k again"*
- **R25:** the old AI pill on re-typed rows: *"Agree"* (removed with the pills).
- **R26:** Undo for "Looks OK": *"ok"* - one row at a time, next to a ticked row.
- **R27:** the revert message: *"yes. also if some child could not be reverted, the msg should say that clearly"*
- **R28:** two S3 messages approved: *"Row 21 has no open flag to confirm."* and *"Row N can't be reverted: the
  row its child was moved from no longer exists."*
- **R29:** split S4 into S4a / S4b: *"ok if necessary"*.
- **R30:** S3 and S4 go to production together.

### The owner's answers to the Part A questions (2026-10-13)

- **Mockup facts:** column order *Excel Row | Status | Check | Sl.No | Parent | Row Type | Looks OK (revision) |
  Description ...*; the counter strip sits above the grid; the "Needs checking" block sits in the row detail
  where the AI block was.
- **Q-a:** *"Accepted as recommended (only K1 changes: hidden on a row Claude re-typed; everything else as today;
  the two "Looks OK"s stay separate)."*
- **Q-b:** *"Yes to both: R23 fix on the Gemini AND the Claude line, and the added reply key. This approves both
  changes to revert_to_parser."*
- **Q-c:** defaults accepted - the Check column sits where AI Rec was and is hidden on template BoQs; a row fixed
  by a change shows its pill struck through; "Undo" in the grid and in the row detail; on a read-only sheet the
  pills show and the buttons do not.
- **Q-d:** *"Yes: "Check both" rows appear under "Check type" and under "Check parent"."*
- **Q-e:** *"Yes: one added count of all flagged rows by kind for the green line."*
- **Q-f:** accepted - singular wording for one child; *"Row 20 reverted."* when none came back; shown in the
  reverted row's detail panel.
- **Q-g:** *"Accepted: S3's approved sentence as the hover."*
- **Q-h:** *"Accepted: "Row N has no Looks OK to undo." (U17 - APPROVED)."*
- **Q-i:** *"NO paid re-parse of BOQ-26-00156 (a real-project copy). Cert step 12 is covered by tests only and
  reported as "not seen on screen - deferred to S5", which uploads a revision."*
- **Q-j:** the parser-warning check on BOQ-26-00059 / HVAC, Excel row 12.
- **Q-k:** accepted - on a row that is both flagged and an unconfirmed revision row, the red revision edge stays.
- **Q-l:** *"Yes: add the parse-done listener."*
- **Q-m:** *"Keep the indigo panel background and Revert box border."*

## The user-visible changes (U1-U17)

Removed: **U1** the "Run AI pass" and "Run Gemini" buttons and their running chips; **U2** the "AI Rec" and
"Gemini" columns, their filters and pills; **U3** the indigo / violet row tints; **U4** the "AI suggestion" and
"Gemini suggestion" blocks in the row detail; **U5** every AI / Gemini message strip; **U6** the "Accepted -
Claude" / "Accepted - Gemini" labels (such rows read "Edited") and the "AI Accepted" status filter.

Added: **U7** the Check column with pills "Check type" / "Check parent" / "Check both", struck through once
cleared, "Checked" for a Looks OK row; **U8** a light orange tint with an orange left edge on a flagged row;
**U9** the counter strip - "[N] rows to check" / "Row type [x] - Parent [y] - Both [z] - [n] checked" / "Fix the
row type or parent, or tick Looks OK. Each row must be checked before finalizing." / "Filter to these rows", and
when all are checked "All [N] flagged rows checked" / "Row type [x] - Parent [y] - Both [z]" / "Show checked
rows"; **U10** the Check filter "Show all rows", "To check", "Check type", "Check parent", "Checked"; **U11** the
row detail's "Needs checking" block, with "Fix it with Change / Change parent below, or confirm it is right as it
is." and "Looks OK", and the grid's "OK"; **U12** Mark Finalized greyed out with the hover "Check the [N] flagged
rows before finalizing."; **U13** the reason lines "Row type may be wrong", "Has a unit or quantity but isn't an
Item", "Parent may be wrong"; **U14** "Undo" on a ticked row; **U15** the revert message "Row [r] reverted, along
with [k] child rows it had moved: rows [a, b, c]." and "Row [d] was not moved back because it was moved
separately."; **U16** the chip "Checking rows..."; **U17** the refusal "Row N has no Looks OK to undo."

## Decision

### 1. The screen holds no flag rule

Everything the screen draws for a flag comes from two things `get_review_rows` already sent since S3: `check_flags`
on each row and `check_summary` on the sheet. One pure module, `frontend/src/pages/boq-wizard/reviewCheckFlags.ts`,
turns them into the pill, the filter membership, the counter, the reason lines, the hover of Mark Finalized and
the revert message; `ReviewCheckParts.tsx` draws them. Neither decides whether a row is flagged. So the pill, the
count and the button cannot disagree with the server's refusal, which stays the last guard.

- **The pill** is the kind still OPEN; when nothing is open it is "Checked" on a ticked row, and otherwise the
  kind that was flagged, struck through.
- **The filter** reads the same fields. A "Check both" row is under "Check type" and under "Check parent" (Q-d).
- **The counter** shows the server's numbers. The green line needs the kinds of all flagged rows, which S3 did not
  send (its `by_kind` counts open flags and is all zero by then): `check_summary` gained `flagged_by_kind` (Q-e).
- **Reason lines** come from a fixed map of the three codes. An unknown code shows no line; a code is never shown.
- **Mark Finalized** is greyed in the server's own order of checks: must-fix, revision rows, quantities, the
  check still running, flagged rows.
- **The chip** shows when the sheet's own in-progress flag or the run log behind `check_summary` says the check is
  running, and the page polls for as long as either does.

### 2. "Looks OK" and its Undo

The grid's "OK" and the detail's "Looks OK" call S3's `review_flags.mark_row_looks_ok`. "Undo" calls the new
`review_flags.unmark_row_looks_ok`: one row per call, a direct column write with no edit history, refused on a
Finalized sheet, during a parse, and on a row with no standing tick ("Row N has no Looks OK to undo."). There is
still no bulk form in either direction (R13). After an Undo the row's flags follow the ordinary rules again - they
stay closed where the user has since changed the type or parent.

The three ticks stay three: the parser-warning "Looks OK" (`flags_dismissed`), the revision "Looks OK"
(`revision_reviewed`) and this one (`ai_flags_ok`) (Q-a).

### 3. Revert: the reply, and the fix

`revert_to_parser` - a protected function, changed here with the owner's approval (Q-b) for two things only:

- **Its reply names the children that did not come back** (R27): `children_not_returned`, the row indexes of the
  children a restructure of this row moved that stay where they are because a later move of the child still
  stands. `review_flags.children_left_behind` is the reader, the mirror of `plan_child_reverts`, and it is read
  BEFORE the revert writes. The screen turns `reverted_children` and `children_not_returned` into the U15 message.
- **It no longer marks a never-answered row as answered** (R23). After a revert it re-offers "any live
  suggestion" as Pending, and decided a suggestion existed when the suggested parent was `>= 0`. That column is 0
  by default on a row the model never answered, and row 0 is a real row. On the Gemini side this showed a
  suggestion block nobody made. On the Claude side it was worse: S3 read the status as "Claude answered" and the
  parent as "Claude named row 0", and opened a false "Check parent". Both tests now also require the row to carry
  a status already.

### 4. The parser's warning on a re-typed row

`_compute_advisory_flags` no longer raises the parser's "needs-review" warning on a row Claude surely re-typed
(`parser_classification` set and different from `classification`). The warning's only reason,
`priced_preamble_with_children`, is about the type the parser gave, which is no longer the row's. Nothing else
about warnings changed (Q-a): a human type still hides them, a revert still brings them back, the quantity and
amount warnings and the orphan warning are untouched, and after a revert of a re-typed row the warning stays
hidden because the revert returns to parser + Claude.

### 5. The page learns that a parse ended

The review page now listens for `boq:parse_run_done` and re-reads the BoQ, the rows and the must-fix list (Q-l).
Before, a parse that finished while the page was open changed nothing on it until the window was refocused: the
"being parsed" banner stayed and neither the chip nor the new flags appeared.

## What moved where

| Before | After |
|---|---|
| `SheetReviewPage.tsx`: two run buttons, two triggers, two polls, six message strips | one quiet listener and one poll that clear the chip; no trigger, no message |
| `ReviewTree.tsx`: AI Rec and Gemini columns, tints, accept / reject blocks, "Accepted" labels | Check column, tint, counter, "Needs checking" block; the accept / reject calls are gone |
| `GeminiAcceptBlock.tsx`, `GeminiSuggestionColumn.tsx` | deleted |
| - | `reviewCheckFlags.ts` (pure), `ReviewCheckParts.tsx` |
| `review_flags.py` | + `unmark_row_looks_ok`, `children_left_behind`, `flagged_by_kind` |
| `review_screen.py` | `revert_to_parser` (reply key, the status test), `_compute_advisory_flags` (one condition) |

Not changed: `RestructureModal.tsx`, every edit path, the commit pipeline, validation and gate, the Claude and
Gemini runs, prompts, wire rows and GUIDANCE block, every doctype.

## Consequences

- **The AI answers still travel to the browser** in the review data; nothing on the screen reads them. Trimming
  the reply would change `get_review_rows`.
- **The backend endpoints the screen stopped calling are still there**: `run_ai_pass`, `run_gemini_pass`, both
  accept / reject pairs, the `mark_*_accepted` flags of `save_review_restructure`. `RestructureModal.tsx` keeps
  its "AI set this row's position" branch; nothing opens it.
- **Two rendering choices the wording does not settle.** The counter's separators are middle dots ("Row type 1 ·
  Parent 5 · Both 0"), as everywhere else on this screen. "Needs checking" is drawn in the row detail's small
  capital label style, like "PARENT CHAIN" and "WARNINGS" beside it. One row reads in the singular ("1 row to
  check", "Check the 1 flagged row before finalizing.").
- **A failed or stalled check shows nothing on this screen** until S4b's banner. Finalize is allowed in that state
  on the parser result, with only the unit / quantity flags (D1).
- **While the check runs the counter shows the unit / quantity flags of the parse**, some of which Claude's sure
  changes then remove. On BOQ-26-00059 / FPS it read "7 rows to check" for about a minute and then 6.
- **A reverted row, and a child that returned with it, read "Edited"**: their history is kept. Unchanged.
- **Cert step 12 (a revision row needing both ticks) was not seen on screen**; it is covered by tests and deferred
  to S5 (Q-i).
- **A revert as the very first action on a freshly opened page can fail once** with "There was an error.": the
  page's own draft-lock call and the revert's collide in the database. Older than S4a (the revert handler has
  always made both calls); a second click works. Not changed here (R4).
