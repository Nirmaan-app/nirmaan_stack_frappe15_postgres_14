# 35. Check banners, the hub and the parse summary, a soft suggestion, and the revert fixes

Date: 2026-10-14

## Status

**Accepted** (owner rulings R4-R36, UI items U1-U14 and the Part A answers, 2026-10-13). Built in slice S4b on
`feature/boq-jev-integration`. Finishes the review work of [ADR-0034](0034-review-screen-check-flags-no-ai-ui.md)
(S4a, the flags on the review screen) on top of [ADR-0033](0033-review-flags-and-finalize-block.md) (the flag
rules, "Looks OK", the finalize block) and [ADR-0032](0032-automatic-claude-check-after-parse.md) (the automatic
check). **S3, S4a and S4b go to production together** (R30). S5 is the end-to-end trial on real BoQs.

## Context

After S4a the review screen showed the flags, but four things were still missing or wrong:

- Nothing said that a sheet was heavily flagged, or that the check never finished.
- The hub said nothing about the check at all.
- The reviewer could not see what the check thought a flagged row should be.
- A revert as the very first action after a page load failed with "There was an error.". The page's
  draft-lock call (`acquire_draft_lock`) and the revert's own server lock (`review_screen.py`) ran at the same
  time under REPEATABLE READ, and the lock-row refresh in `pricing_lock.py` raised a 500.

S4b is frontend-only. Every number it shows already came from S3's `review_flags.get_check_summary`, and the
check's answers (`ai_suggested_classification`, `ai_suggested_parent`, `ai_suggested_is_root`) already travelled in
the review reply. No Python file, doctype or migration changed.

## Owner rulings

- **R4:** *"No fucntionlaity related to the checks and worflows of how changes are made and saved chould be
  changed"*
- **R9:** banner wording approved: *"Many rows on this sheet need checking (63%). We recommend reviewing the whole
  sheet before finalizing."* Shown when MORE THAN 40% of rows are flagged.
- **R10:** banner percentage: *"dont count blank"*
- **R12-D1:** *"if the AI check fails or times out on a sheet: banner + 'Re-parse sheet', and the sheet can still be
  finalized on the parser result (only the unit/qty check's flags apply)"* - owner *"ok"*.
- **R16:** *"not onl;y agreeing withthe flag, but the user is also free to make any other change they want as they
  are able to do today."*
- **R19:** *"edit values and text we can do away with cvompletely. this feature is never used."* Remove the three
  blocks from the screen; keep the server endpoint, the template quantity cells and the old history.
- **R31 (soft suggestion):** *"wpuld like a sofy suggestion, but theuser is still free to decide what they want to
  select"*, then *"ok"* to: (a) on a row with an OPEN flag only, the check's type at the top of the Change list
  marked "Suggested", and its parent offered in the parent picker marked "Suggested"; nothing pre-selected; no AI
  name anywhere; the mark goes once the flag is cleared; unflagged rows show none; (b) a row flagged only for "Has a
  unit or quantity but isn't an Item" gets "Item" as its Suggested type; (c) the mark may be added inside
  `RestructureModal.tsx` - a VISUAL change only. This replaces the "no AI suggestion" part of S4a's D2 for these two
  pickers only.
- **R32:** hide the counter strip while the check is running ("Checking rows..." shows instead).
- **R33:** fix the revert that fails as the first action after a page load. This approves the smallest change to
  the draft-lock code needed for that fault ONLY.
- **R34:** middle dots, "NEEDS CHECKING" in the panel's capitals, singular wording, message persistence and the red
  revision wash over the orange one, all as built in S4a.
- **R35:** *"in th enext slice lets record a few diofferent type of actions which give me full understanding of the
  workflow"*.
- **R36:** "[object Object]" in a quantity cell is an intentional loud failure for a wrong column set-up:
  *"nothing to be done here"*.
- **R30:** S3, S4a and S4b go to production together.

### The owner's answers to the Part A questions (2026-10-13)

- **Q-a:** keep Review open while the check runs (as S4a).
- **Q-b:** the check's type is "Suggested" when both doubts apply.
- **Q-c:** the "Parse complete" summary opens once, after the parse AND every sheet's check have finished; at once
  if nothing is being checked. N = rows to check, M = non-blank rows, P = the server's %.
- **Q-d:** the revert waits for the page's lock call, then runs.
- **Q-e:** (1) the fallback text *"Could not revert this row. Please try again."* - APPROVED as U14; (2) leave both
  server sentences.
- **Q-f:** "Suggested" is worked out in the browser from the reply's fields; no backend change.
- **Q-g:** inside `RestructureModal.tsx` only, with ONE change: the line *"Suggested parent: row [N] -
  [description]"* (or *"Suggested: Top level"*) in the "This row's position" block, visible as soon as the dialog
  opens. Clicking it selects "Move this row under a new parent" and that row, exactly as the user could by hand; the
  user still presses Save. Nothing pre-selected. Not in the children's pickers; not when the row is itself, a
  descendant or missing. `ReviewRowParentPicker.tsx` stays untouched.
- **Q-h:** "Re-parse sheet" goes to the hub and opens today's dialog for that sheet, unchanged.
- **Q-i:** the card wording table approved as written (below).
- **Q-j:** remove the empty "Edit Row" toggle and the "Confirm value change" dialog with the three blocks.
- **Q-k / Q-l / Q-m:** the certification sheets, the AI-off window on dev2, the recordings and a second paid run.
- Footer wording ("checked" next to "rows to check"): leave as is for now.

## Decision

### UI items (exact wording)

- **U1** heavy-sheet banner: *"Many rows on this sheet need checking ([P]%). We recommend reviewing the whole sheet
  before finalizing."* when `check_summary.heavy` (flagged share of non-blank rows over 40%). Advice only.
- **U2** check-incomplete banner: *"The automatic row check didn't finish on this sheet. Only rows with a unit or
  quantity that aren't Items were flagged. Re-parse the sheet to run the full check again."* with a "Re-parse sheet"
  button (Q-h). The sheet can still be finalized once its unit / quantity flags are checked (D1).
- **U3** hub card while checking: chip *"Checking rows…"* and *"Parsed · check in progress"*.
- **U4** *"[N] rows to check"* (*"1 row to check"*) under the Review step; *"all flagged rows checked"* when every
  flag is checked (Parsed or Finalized).
- **U5** *"check incomplete"* and *"The automatic row check didn't finish on this sheet. Only the quantity / unit
  check ran. Re-parse to try again."* (the sentence on a Parsed sheet only).
- **U6** footer: today's footer plus *" · [N] rows to check"*, summed over Parsed sheets whose check is not running.
- **U7** parse dialog, both steps: *"Each sheet is parsed and then its rows are checked automatically. This runs in
  the background and can take up to ~15 minutes on large workbooks. You can keep working; you'll see a summary here
  when it's done."*
- **U8** summary: *"Parse complete"* / *"Parsed and checked: [sheets]"* / *"Rows to check before finalizing"* with
  *"[sheet] [N] of [M] rows ([P]%)"* plus *" - review the whole sheet"* when heavy / *"Check didn't finish: [sheet] -
  only the quantity / unit check ran. Re-parse the sheet to try again."*
- **U9** *"Revert to original"* with *"Restores this row (and any moved children) to how it was after parsing. Its
  check flag comes back."*
- **U10** *"Suggested"* on the Change list of a row with an open flag (top entry, not pre-selected) and the
  *"Suggested parent: ..."* line in the restructure dialog (Q-g).
- **U11** "Edit values", "Edit text", "Edit per-area values", the empty "Edit Row" toggle and the "Confirm value
  change" dialog removed from the row detail. Template quantity cells unchanged.
- **U12** counter strip hidden while "Checking rows…" shows.
- **U13** no "There was an error." on a first-click revert.
- **U14** fallback text *"Could not revert this row. Please try again."* when the revert fails with no server
  message.

### How

- **The hub reads only S3's counts.** `BoqHubPage.tsx` fetches `review_flags.get_check_summary` once per BoQ,
  polls every 4 s only while a check runs, and re-reads on a parse end and a check end. The pure
  `hubCheckSummary.ts` turns those counts into the card lines, the footer piece and the summary lines. Nothing is
  counted on the client, so the hub, the review counter and the finalize block cannot disagree.
- **The summary is held until the checks end** (`summaryReady`), then built from the server's counts.
- **"Suggested" is derived in the browser** (`reviewCheckFlags.ts`: `suggestionFor`, `orderWithSuggestion`,
  `suggestedParentLine`) from the row's open flag and the check's answer in the reply; for a unit / quantity-only
  flag the type is Item (R31b). It disappears with the flag.
- **The revert waits for the lock call** (`editIntent.ts`: `afterEditIntent`). The page's `ensureLockAcquired` now
  returns its promise, and the revert starts only after it settles. No other edit path and no server code changed
  (R33).
- **The counter strip is hidden while the check runs** (`checkCounter(summary, checkRunning)` returns null), and
  the hub footer leaves out a sheet whose check is running, for the same reason: until the check ends, its count is
  the raw parse's unit / quantity flags.

## Consequences

- No backend change: the review reply and the AI / Gemini endpoints are as S4a left them.
- `RestructureModal.tsx` gained one optional prop and one clickable line, placed BELOW the Keep / Move radios.
  Above them it was the dialog's first focusable control and took the opening keyboard focus, so it looked
  selected.
- The "Edit values" server endpoint (`save_review_edit`) and old history entries stay. Nothing on the screen calls
  the endpoint any more except the template quantity cells.
- Existing behaviour seen during certification and left alone (R4): a reverted row's Status reads "Edited"; its
  history line reads "Reclassified: Note -> — —"; a "moved parent" reason names the internal row index.
