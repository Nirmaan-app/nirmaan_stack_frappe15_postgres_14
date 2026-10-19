# 33. Review flags, "Looks OK", the finalize block, and a revert that returns moved children

Date: 2026-10-13

## Status

**Accepted** (owner rulings R1-R20 and the Part A / Part B answers, 2026-10-13). Built in slice S3 on
`feature/boq-jev-integration`, backend only. Builds on [ADR-0032](0032-automatic-claude-check-after-parse.md)
(the automatic Claude check and its run log). The screens - pills, counter, filter, banner, the "Looks OK" tick,
removal of the AI buttons and columns - are S4. **S3 and S4 go to production together** (owner, Q-g): S3 blocks
finalize on flagged rows, and until S4 there is no tick on screen to clear one.

## Context

Since S2 Claude checks every parsed sheet by itself. Its answers were still shown as suggestions the reviewer
could accept, reject or ignore, and nothing stopped a sheet from being finalized with every one of them unread.
The owner wanted the opposite: the reviewer sees one parsed result, the rows that need a human look are marked,
and a sheet cannot be finalized until each marked row has been dealt with.

Two facts about the existing code shaped the design:

- **Every type or parent change goes through one function**, `review_screen._apply_and_save_row_edit`, and the
  owner ruled that nothing about how changes are made and saved may change (R4).
- **Every such change leaves an entry in the row's edit history**, with a reason. The re-mapping of a row's
  children stamps each child `parent moved: row N reclassified to X`; every revert stamps a reason that contains
  `reverted`.

## Owner rulings

- **R1:** *"claude should run automatically after heuristic run. we remove both b uttons for the Gemini and claude
  Ai run... they can only reparse the sheet if needed, in which case it will work exactly like a fresh parsing"*
  (the buttons go in S4).
- **R2:** parent doubts: *"Flag"*.
- **R3:** finalize: *"yes. correct parenting and row type is critical... so it should bloack"*
- **R4:** *"No fucntionlaity related to the checks and worflows of how changes are made and saved chould be
  changed"*
- **R5:** *"the revert to parser rule should now revert to the state with parser+ claude ouput"*
- **R6:** *"parser output for the user means (parser+claude). they dont need to go inside it"*
- **R7:** *"we are applying suto changes only in high confidence cases. then we should not flag it alos...
  however we can inmcrease the coverage beyond this"*
- **R8:** *"flag any row which has unit or qty and marked as anything but a line item"*
- **R9:** banner wording, approved: *"Many rows on this sheet need checking (63%). We recommend reviewing the
  whole sheet before finalizing."* - shown when more than 40% of rows are flagged (S3 supplies the number).
- **R10:** the percentage: *"dont count blank"*
- **R11:** "Check parent" still shows on auto-changed rows: *"yes"*.
- **R12:** the mockup's decisions, each answered *"ok"*: **P1** auto-apply only High-confidence "Preamble ->
  Item"; **D1** a failed or timed-out check: banner + "Re-parse sheet", and the sheet can still be finalized on
  the parser result (only the unit / quantity flags apply); **D2** a flagged row shows a one-line neutral reason,
  no AI suggestion, no AI name; **D3** changing a row's type / parent clears that flag; **D4** sheets still at
  Parsed with old AI suggestions: hide them, a re-parse gives them flags; **D5** rows copied unchanged into a
  revision are not re-flagged.
- **R13:** *"One row at a time - no 'clear all', the same rule as revision rows today."*
- **R14:** *"accept all 1,2 and 3 recoimmendation"*: the S2 library memory is accepted as it is; run-log records
  are kept 6 months and pruned once a day by the existing 5-minute task; the unused old library file is deleted.
- **R15:** *"i dsont want any unnecssary jobs in production"*
- **R16:** *"not onl;y agreeing withthe flag, but the user is also free to make any other change they want as
  they are able to do today."*
- **R17:** *"also check how the rows with children behave when the parent opr row trype is changes. it should
  trigger the same workflow for remapping the children also as it is today."*
- **R18:** a child moved by that re-mapping keeps its "Check parent" flag: *"ok"*.
- **R19:** *"edit values and text we can do away with cvompletely. this feature is never used..."* - recon only
  in S3; see "Answers" below.
- **R20:** *"then we need to change this.. revert should revert all changes to the row and its childrem also, if
  the children changes were done as part of th erow change. if the children change was done independently then
  dont revert the children change"*

### The owner's answers to the Part A questions (2026-10-13)

- **Q-a:** accepted - *no flags on a sheet until its current parse has a run-log record.*
- **Q-b:** accepted - option 1: the "Looks OK" mark stops counting after a later "reverted" history entry; plus
  a test that pins the "reverted" entry and the "parent moved:" prefix. An un-tick is an S4 question.
- **Q-c:** accepted - a High-confidence "Subtotal -> Line Item" is flagged "Check type", not applied.
- **Q-d:** accepted for S4 - remove the three blocks (Edit values, Edit text, Edit per-area values) from the
  screen; keep the server endpoint, the template quantity cells and the old history. Nothing is removed in S3.
  The facts behind it: 61 such edits on the 9 Oct 2026 production copy, all on 22-24 June 2026, by 3 users on 4
  BoQs, against 7,902 type changes and 6,537 parent changes in the same history.
- **Q-e:** accepted - finalize is refused while the check is running, with *"The automatic check is still
  running on this sheet. Try again when it finishes."*; sure changes are never applied to a finalized sheet.
- **Q-f:** accepted - apply P1 except when a child is a preamble; then flag "Check type" instead.
- **Q-g:** accepted - S3 and S4 go to production together.
- **The R20 loop case:** option A - refuse the whole revert, nothing changes, with *"Row 20 can't be reverted
  yet: putting row 24 back under it would create a loop. Move row 24 first, then revert again."* (Excel rows).

## Decision

### 1. Claude's sure changes become the parsed result

When a run's answers are written, every row where Claude says `line_item` at **High** confidence and the parsed
type is `preamble` gets `classification = line_item`. The parser's own type is kept in the hidden field
`parser_classification`, which is never sent to the screen. To the user this row is simply a line item with no
label, and "Revert" on it returns to parser + Claude (R5, R6).

Nothing else is ever applied: no other type change at any confidence, and no parent. A sure change is also
skipped - and so becomes a "Check type" flag - on a row with a standing human or accepted-AI change, on a row
with a child that is itself a preamble (a sub-heading under an item is a must-fix error the user did not cause),
and on every row of a Finalized sheet.

It lives in `review_flags.apply_sure_changes`, called right after `ai_assist._apply_ai_suggestions` in the same
transaction, from the worker and from the manual button's cached-result path. A superseded run is refused by
that function and so never reaches the sure changes.

### 2. Flags are worked out, never stored

A flag is computed from facts already on the row each time it is needed. No edit path writes a flag, so no edit
path had to change (R4). `review_flags.sheet_flag_state` is the single reader behind the review data, the counts
and the finalize block.

The **check status** of a sheet is read from the run-log records of its *current* parse
(`ai_run_log.check_state`): `done`, `running`, `incomplete` (only failed runs) or `not_run` (no record).

| Term | Rule |
|---|---|
| Type doubt (`type_doubt`) | the check is done, Claude named a type, and it differs from the parsed type |
| Unit / quantity doubt (`unit_qty_not_item`) | the row has a unit or a non-zero quantity and its parsed type is not `line_item` |
| Parent doubt (`parent_doubt`) | the check is done, Claude named a parent (or top level), and it differs from the row's parsed parent |
| The user changed the type | a human type is stored **and** it differs from the parsed type |
| The user changed the parent | a human parent is stored and the latest standing parent entry in the history is not a `parent moved:` entry |
| "Looks OK" holds | the mark is set and the history has no `reverted` entry later than the mark |
| **Check type is open** | (type doubt or unit / quantity doubt) and the user has not changed the type and "Looks OK" does not hold |
| **Check parent is open** | parent doubt and the row does not sit on the parent Claude named and the user has not changed the parent and "Looks OK" does not hold |

- **No record, no flags** (Q-a). A sheet parsed before S2 has no run-log record for its parse and behaves exactly
  as before, until it is re-parsed. Every parse since S2 has a record, also when Claude is switched off or fails.
- **A failed or unfinished check** leaves only the unit / quantity rule (D1).
- **Never flagged:** rows copied unchanged into a revision (D5), de-selected template rows, anything from Gemini.
- **A human type equal to the parsed type is not a change.** The screen's "Change parent" stores the row's own
  type as a human type; reading that as "the user changed the type" would clear "Check type" on a parent change.
- **A surely re-typed row has no type doubt** simply because Claude's type and its parsed type are now equal.
  "Check parent" still applies to it (R11).
- **Both doubts are measured against the PARSED values**, so a row does not stop being a flagged row when it is
  moved or re-typed: it becomes a checked one. That is what keeps the sheet's flagged count and percentage still
  while the user works.

### 3. Clearing

- Changing the type clears "Check type"; changing the parent clears "Check parent" - to any value, not only
  Claude's (R16). Nothing is written to make that happen; the rule reads the human layer.
- A child moved by the re-mapping of another row **keeps** its "Check parent" (R18): its history entry starts
  `parent moved:`. The user's own move of that child, or "Looks OK", clears it.
- **"Looks OK"** is `review_flags.mark_row_looks_ok`: one row per call, a direct column write with no edit
  history. It is refused on a Finalized sheet, while a parse is running, and on a row with no open flag. There is
  no bulk form (R13). It is a third mark, separate from `flags_dismissed` (parser advisories) and
  `revision_reviewed` (revision rows): the chokepoint clears `flags_dismissed` on any edit, which would bring
  "Check type" back when the user changed the parent after ticking.
- **Revert brings the flags back** with no change to the revert code for that purpose: the human layer is
  cleared, and the `reverted` entry the revert already writes ends the "Looks OK" mark.

### 4. The counts

`get_review_rows` adds `check_flags` to every row and `check_summary` to the reply;
`review_flags.get_check_summary` returns the same block for every sheet of a BoQ (hub, parse-done summary).
The block: rows to check, by kind (type / parent / both), checked, flagged, non-blank rows, the flagged
percentage, the heavy marker, the check status.

The **percentage** is rows with any doubt, open or already checked, over non-blank rows; blank (spacer) rows are
left out of both numbers (R10). It describes the sheet and does not fall as the user works. **Heavy** means more
than 40% (R9).

### 5. The finalize block

`mark_sheet_parsed_check_done` runs, in this order: must-fix, revision rows, quantities (template BoQs), and
then - new, last - `review_flags.guard_finalize`:

- refused while the check is still running: *"The automatic check is still running on this sheet. Try again when
  it finishes."* A dead run is failed first by the S2 health check, so this can never block for good.
- refused while any flag is open: *"Check the N flagged rows before finalizing: rows 22, 26."* - Excel row
  numbers, at most 20, then "and N more"; "the 1 flagged row ... row 22" for one.

Both are raised as errors, because the screen already shows a server error as it is and the existing three
refusal sentences are written in the screen file. S4 can grey the button out in advance from `check_summary`.
A sheet with nothing open finalizes exactly as before. Un-mark, the orphan warning and Commit are unchanged.

### 6. Revert returns the children its row moved (R20)

`revert_to_parser` on row N now also puts back every child a **restructure of N** moved, when that move is still
the child's latest standing parent change. A child the user moved again himself is left where it is. This is the
one approved change to a protected function.

- The children are found from their own history (`review_flags.plan_child_reverts`): a `parent moved: row N ...`
  entry at the end of the child's standing parent changes. Several moves by N are undone together.
- Each goes back to the parent it had immediately before the move (the entry's `from`); when that is its parsed
  parent, the human parent is cleared.
- Each returning child gets a history entry `reverted with row N (parent restore)`. Because it contains
  `reverted`, the child's "Looks OK" ends, and its revision confirmation is cleared, exactly as on a row
  reverted directly. Its flags then follow the ordinary rules.
- It is written in the same transaction as the row's own revert: all or nothing.
- **A revert that would put a child back into a loop is refused before anything is written**, with the approved
  message above.
- Children moved by an old "AI accept" keep their existing revert (from the accept's snapshot).
- **Off for a template BoQ.** Rows are inserted and deleted there, which renumbers them, so the `row N` in a
  child's history cannot be trusted. The row panel with Revert is not shown on template BoQs.

### 7. Run-log retention

`ai_run_log.heal_stale_runs_task`, the existing 5-minute task, also deletes finished run records older than 6
months, at most once a day. It remembers the last prune in the site cache with a 24-hour life; if the cache is
emptied the prune simply runs once more. `hooks.py` is unchanged: no new scheduler entry (R15).

## Where each fact lives

| Fact | Where |
|---|---|
| Claude's answer per row | `BoQ Review Row`: `ai_suggested_classification`, `ai_classification_confidence`, `ai_suggested_parent`, `ai_suggested_is_root`, `ai_suggestion_status` |
| The parsed type and parent | `classification`, `parent_index` |
| The parser's own type of a surely re-typed row | `parser_classification` (hidden; new) |
| The user's own change | `human_classification`, `human_parent`, `human_is_root`, `edit_log` |
| "Looks OK" | `ai_flags_ok`, `ai_flags_ok_by`, `ai_flags_ok_at` (new) |
| The check status | `BoQ AI Run Log` records whose `sheet_last_parsed_at` equals the sheet's `last_parsed_at` |
| A flag | nowhere - `review_flags.row_flags` |

## Consequences

- **Two history wordings are now read by code.** `parent moved:` (written by `save_review_restructure`) and
  `reverted` (written by every revert path) decide which flags are open and which children return.
  `test_review_flags.TestHistoryWordingPins` makes the real endpoints write them and fails if either changes.
- **The old AI suggestion pills still show until S4**, on the same rows that now carry flags. Rejecting a pill
  does not clear a flag.
- **A revision row can need two ticks**: the revision "Looks OK" and the new one. They are separate marks.
- **A row with only "Looks OK" cannot be reverted** (Revert refuses a row at its baseline), so the mark cannot be
  taken back until S4 offers an un-tick.
- **The unit / quantity rule is literal** (R8): it also flags subtotal rows that carry a quantity. "Change type"
  cannot produce a subtotal, so those clear with "Looks OK".
- **A plain revert of a row has no loop check of its own**, as before; a loop it creates still shows as a
  must-fix item. Only the returning children are checked.
