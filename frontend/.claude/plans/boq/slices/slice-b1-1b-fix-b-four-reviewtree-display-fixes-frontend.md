### Slice B1.1b-fix-B -- four ReviewTree display fixes (frontend)

**Status:** COMPLETE (feat pending; FRONTEND ONLY; no backend changes; no bench tests; tsc 0 wizard errors; Vite build exit 0).

**What landed (`ReviewTree.tsx` only; `boqTypes.ts` unchanged):**

**FIX 1 -- Parent column (after Sl.No):**
- New "Parent" fixed anchor column inserted between Sl.No and Description. Header: "Parent" (no Excel letter — it's a derived reference, not a mapped column).
- Value: resolves `effective_parent_index` → `byIdx.get(pIdx)?.source_row_number` (parent's Excel row number). Roots (null/negative effective_parent_index) show blank.
- Rendered as a clickable `<button>` showing `↑ {parentExcelRow}` in blue (`text-blue-600 dark:text-blue-400`), `font-mono`, `hover:underline`. Blank (null rendered) for root rows.
- Click handler (`revealAndScrollToRow(targetRowIdx)`): (a) walks the target row's ancestor chain to find collapsed ancestors, (b) removes them from the `collapsed` set via `setCollapsed`, (c) `setTimeout(50ms)` to wait for React DOM update, (d) `scrollIntoView({ behavior: "smooth", block: "nearest" })` on the target row's DOM element, (e) `setHighlightedIdx(targetRowIdx)` for a 1.5s amber flash.
- Row DOM refs: `useRef<Map<number, HTMLElement>>(new Map())` (`rowRefs`). Each `<tr>` registered via a ref callback `(el) => rowRefs.current.set/delete(row.row_index, el)`.
- Highlight: `useState<number | null>(null)` (`highlightedIdx`). `useEffect([highlightedIdx])` clears after 1500ms. Applied as `bg-amber-100 dark:bg-amber-900/40` on the `<tr>` className.

**FIX 2 -- Classification pill label no-truncation:**
- FIX 4's restructure (pill on its own line) gives the pill full horizontal room, eliminating horizontal compression. `whitespace-nowrap` + `shrink-0` preserved on the pill to prevent any text wrapping.

**FIX 3 -- isVisible ancestor-only rule:**
- Added two defensive guards to the `isVisible` loop:
  - `cur < 0` → `break`: treats -1 sentinel values (which resolve_effective should convert to null, but old pre-fix-A rows may produce stale `parent_index=0` → `effective_parent_index=0`, causing the row at index 0 to disappear when collapsed) as a root stop.
  - `cur === row.row_index` → `break`: self-reference guard (prevents a cycle-row from hiding itself when collapsed).
- Combined with the existing `cur = row.effective_parent_index` start (already walking from the parent, not the row itself), these guards ensure a collapsed row R stays visible; only its descendants hide.

**FIX 4 -- Pill-above-text in Description cell:**
- Restructured the Description cell's inner flex container: replaced flat `[chevron] [pill] [text]` horizontal layout with `[chevron] [flex-col: [pill] [text]]`.
- A `<div className="flex flex-col gap-0.5 min-w-0">` wrapper stacks pill on top and description text below. The outer `flex items-start gap-1.5` + `paddingLeft` indent remain unchanged; the chevron stays as the outer flex's first sibling.
- Preserves: depth/indent, chevron toggle, all text styles (isPreamble/isLineItem), break-words, (no description) fallback.

**New React hooks/state added:**
- `import { useMemo, useRef, useEffect, useState }` (was `useMemo, useState`; added `useRef, useEffect`).
- `useState<number | null>(null)` for `highlightedIdx`.
- `useRef<Map<number, HTMLElement>>(new Map())` for `rowRefs`.
- `useEffect([highlightedIdx])` for 1.5s highlight clear timer.
- `revealAndScrollToRow(targetRowIdx: number)` function (expand ancestors + scroll + highlight).

**Preserved verbatim:** `computeDepths`, descriptor-driven columns, anchor letters, absent-vs-zero rendering, `CLS_COLORS` / `CLS_LABELS` pill hex map, `fmtNum`, `AREA_COLORS`, `buildAreaColorMap`, `resolveDescriptorValue`, `renderDescriptorCell`, `INDENT_PX`, `VISIBILITY_HOP_CAP`, `FIXED_ROLE_DEDUPE`, `toggleCollapse`, `hasChildrenSet`, `byIdx` useMemo.

**Files changed:**
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- all four fixes.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record.
- `frontend/CLAUDE.md` -- B1.1b conventions block updated.
- Root `CLAUDE.md` -- status line bumped.

**tsc:** 0 wizard-file errors (pre-existing non-wizard errors are the standing state, agreement #16). Vite build exit 0. No backend changes, no bench tests.

**resolve_effective unchanged:** The fix is at the write boundary only. `resolve_effective` correctly treats `-1`/`None` as no-override; the human-layer logic is not touched.

---

