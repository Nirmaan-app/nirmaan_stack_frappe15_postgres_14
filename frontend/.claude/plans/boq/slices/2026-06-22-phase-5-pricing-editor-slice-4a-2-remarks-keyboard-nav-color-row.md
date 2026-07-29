### Phase 5 Pricing Editor -- Slice 4a.2 -- remarks keyboard-nav + color row-apply fix (FRONTEND, fix pending, 2026-06-22)

**Goal.** Two owner-found 4a-FE issues, both FRONTEND-ONLY (the 4a.2 recon DB-proved the backend is correct:
save_cell_color freeze-and-supersedes a re-color cleanly + a whole-row apply writes all cols end-to-end).
`SheetPricingPage.tsx` / `boqTypes.ts` / backend / SheetDataGrid UNTOUCHED.

**FINDING 1 -- the trailing REMARKS cell now joins the keyboard matrix.** 4a-FE excluded it (a multi-line Textarea's
Enter conflicts with grid Enter=down); the owner now wants arrow-reachability. (a) **colCount + 1**: `remarksColIndex =
FIXED_ANCHOR_COUNT + displayDescriptors.length`, `colCount = remarksColIndex + 1`. The +1 ONLY widens nextCell's
right/Tab boundary -- no other colIndex math reads colCount (descriptor cells use `FIXED_ANCHOR_COUNT + dIdx`; anchors
0-4; `commitActiveRate` safely no-ops on the remarks cell). (b) the remarks `<td>` is the nav focus target
(`tdFocusProps(rowIdx, remarksColIndex)` + the ring). (c) **Open-state LIFTED to the grid** (`openRemarkRowIdx:
number|null`) -> `RemarkCell` is now CONTROLLED (`open` + `onOpenChange`; draft/saving/error stay LOCAL, seeded on the
open transition via `useEffect([open])`). (d) **Enter opens the editor**: a new branch in `handleGridKeyDown` BEFORE the
generic Enter->down (a READ-ONLY remarks cell -- no onSaveRemark -- skips it, falling through to Enter->down). (e) Esc
closes. (f) **Enter INSIDE the editor = save-and-move-down**: the Textarea Enter (no Shift) -> commit -> save, close,
then `onMoveDown` = `nextCell({rowIndex,colIndex:remarksColIndex}, "down", ...) + focusCell` -- REUSES the matrix path a
rate cell's Enter uses (not a reimplementation); Shift+Enter = newline; on a save error the editor STAYS open.
**The existing rate-cell nav is byte-for-byte UNCHANGED.**

**FINDING 2 -- apply-whole-row color intermittently lost (a frontend state/timing RACE).** Root cause (recon,
DB-proven): the row-apply was a fragile two-step where the SWATCH CLICK was the trigger reading a separate transient
`wholeRow` checkbox -> a "whole row" pick sometimes wrote only the one cell. **FIX (locked): DECOUPLE selection from
submission.** ColorPicker now -- a swatch click only ARMS a token (`armed` state, visibly ringed, NO save); the checkbox
only toggles `wholeRow`; an explicit **Apply** button (disabled until `armed !== null`) is the ONLY thing that saves,
reading `{armed, wholeRow}` TOGETHER at click time via `submit(armed)`; a **Clear** button sends `""`. **This kills the
race by construction** -- no moment a half-set intent is sent. The grid's `onApply(token, wholeRow)` fan-out (`wholeRow ?
rowColorCells(displayDescriptors) : [d.col]`) and the page's `handleSaveColor` (N POSTs + one mutate) are UNCHANGED.

**Tests + verification.** Vitest **80 -> 81** (+1; PricingGrid.test.ts 57 -> 58: a new nextCell test for the +1 column --
arrow-right lands on remarks, arrow-left returns, right-edge stop, Tab-wrap to next row, last-row Tab stop; the existing
4 nextCell tests UNCHANGED + green, proving the rate-cell nav matrix is intact). tsc 3178 (== baseline), 0 in touched.
Vite build exit 0 (PWA 168). The live race was NOT browser-reproduced (no browser tooling; the recon DB evidence proved
the intermittency + exonerated the backend). NEXT = 4b (computed-flag layer into the review-list seam) + the F1-F4
formula builder. (See frontend CLAUDE.md `**Status (... Slice 4a.2 ...)**`.)

