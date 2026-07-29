## Phase 5 Pricing Editor -- Slice A context menu (right-click trigger for the clipboard ops)

**STATUS: code complete, OWNER live-cert pending.** FRONTEND-ONLY, PRESENTATIONAL (`PricingGrid.tsx` only). A right-click
CONTEXT MENU as a SECOND trigger surface for the EXISTING Slice-A `doCopy`/`doCut`/`doPaste`/`doFillDown`. **NO new clipboard
logic, NO new dependency, NO new per-row memo prop, NO backend, NO toolbar change.** A menu Copy is byte-for-byte a `Ctrl+C`
(same `doX`, same selection semantics + status strip + skip flash) -- ONE code path, no divergence. Undo/redo buttons stay Slice B.

**Primitive (no new dep -- the decision):** reuse the house `DropdownMenu` (`@/components/ui/dropdown-menu`, already a dep)
as a CONTROLLED menu (`open`/`onOpenChange`) anchored to a 0-size `position:fixed` `<DropdownMenuTrigger>` span at the
cursor (`menu.x`/`menu.y`). CHOSEN over a self-rolled absolute `<div>` because `DropdownMenuContent` **portals to `<body>`**
-- never clipped by a frozen/scrolling pane's `overflow`, and Esc + click-away + focus come for free. `@radix-ui/react-context-menu`
is NOT a dep and was deliberately NOT added (no `npm`/`yarn add`).

**`PricingGrid.tsx` changes:**
- **State:** a transient `menu` = `{open, x, y, canCopy, canCut, canPaste, canFill}` (the enabled flags are an OPEN-TIME
  snapshot, not a lifted store). NEW import of `DropdownMenu`/`Content`/`Item`/`Separator`/`Shortcut`/`Trigger`.
- **Grid-level attach (no per-row prop):** `onContextMenu={onCellContextMenu}` on ALL 3 `<table>`s (mirrors
  `onMouseDownCapture={onTableMouseDown}`). DOM resolution of the clicked cell: the row from a NEW `data-navr={rowIndex}` on
  every pane's `<tr>` (distinct from the scrolling-only `data-rowidx`), the column from each cell's EXISTING `data-colkey`
  (`a0..a4` / `d:<col>` / `remarks`) mapped by the new `colIndexFromColKey`. A non-cell target (header/gutter, no `data-navr`)
  falls through to the native menu.
- **Target-establish (Excel behavior):** right-click INSIDE the current multi-cell selection -> PRESERVE it (operate on the
  range); OUTSIDE / no selection -> COLLAPSE to the clicked cell via `focusCell` (`extendIntentRef=false` so `onCellFocus`
  reduces to a 1x1, never extends from a Shift+right-click). Done BEFORE the menu opens, so `activeRect()` is correct when a
  `doX` runs. The `doX` bodies + `onCellFocus`'s contract are UNCHANGED (S2 not hit).
- **Open-time flags (no new reactive state -- S3 not hit):** `computeMenuFlags(rect)` snapshots the enabled states, reading
  the NON-reactive `clipboardRef.current` FRESH for Paste (a render-time `disabled` prop would be stale). Reuses the SAME
  `blockFromRect`/`rateWritableAt` the `doX` fns use. Read-only = `onBatchWrite` absent: Cut/Paste/Fill disabled, Copy still
  allowed (internal) -- mirrors Slice A's withheld-`onBatchWrite` no-op.
- **Items:** Copy/Cut/Paste, separator, Fill down -- each `onSelect={() => doX()}` + a `DropdownMenuShortcut` hint
  (Ctrl+C/X/V/D) so the menu TEACHES the binding; `disabled` from the open-time flags. Rendered once as a `contextMenu` const
  included in BOTH the split + single-table returns (the portal makes tree position irrelevant).

**Tests / build:** NO new pure helper (the menu is wiring -- `colIndexFromColKey`/`computeMenuFlags`/`onCellContextMenu` are
closure-bound), so vitest is UNCHANGED at 368 (`PricingGrid.test.ts` 131); tsc 3175 (0 new, 0 in touched files); in-container
Vite build exit 0. No brittle DOM test invented -- the interaction is owner-live-cert. **OWNER live-cert OWED:** right-click a
cell -> menu at cursor; inside-selection preserves / outside collapses; Paste greyed when clipboard empty; Cut/Paste/Fill
greyed on a locked sheet (Copy enabled); a menu action === its shortcut; Esc + click-away close; works in the frozen +
scrolling panes (portal, no clip).

---

