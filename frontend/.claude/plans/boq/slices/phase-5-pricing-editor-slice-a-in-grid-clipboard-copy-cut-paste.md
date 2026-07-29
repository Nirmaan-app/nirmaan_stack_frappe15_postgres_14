## Phase 5 Pricing Editor -- Slice A: in-grid clipboard (copy / cut / paste / fill-down)

**STATUS: code complete, OWNER live-cert pending.** FRONTEND-ONLY, view-layer -- NO backend, NO new endpoint, NO
doctype, NO migrate (reuses `save_cell_price` + `save_row_remark`). Slice A of a TWO-slice arc; **undo/redo is Slice B
(NOT built)** -- but every mutation is funnelled through ONE place so a later delta-recording wrapper can tap it.

**SCOPE (built):** copy / cut / paste / fill-down for RATE + REMARK cells, an INTERNAL clipboard (React ref, NOT
`navigator.clipboard`), Shift+arrow / Shift+click range selection, per-cell kind-match + priceability skip, reject-on-
shape-mismatch, and a client-side batch write with ONE trailing `mutate()`. **DEFERRED (out of scope, named so Slice B /
later slices inherit a clean boundary):** undo/redo (Slice B), external/system paste, click-drag rectangular select,
colour-cell clipboard.

**NEW pure leaf `clipboard.ts`** (mirrors `reconcile.ts` -- imports ONLY types, so PricingGrid imports its VALUES back
with no runtime cycle). Exports + vitest (`clipboard.test.ts`, 19 cases):
- `selectionRect(anchor, focus)` -- normalize an (anchor, focus) pair into an inclusive `{top,bottom,left,right}` (order-
  independent; collapses to 1x1 when anchor===focus).
- `rowSelectionRange(rect, rowIndex)` -- the per-row `{left,right}` span (or null), the memo-safe per-row scalar
  derivation (surfaced to the row as TWO numbers, the `activeColIndex` precedent).
- `rectDims(rect)` -- inclusive `{rows,cols}` cell counts.
- `shapesMatch(a, b)` -- identical-dimensions check (the paste shape gate; NO tiling).
- `classifyPasteTarget(clipKind, targetKind, isRateWritable)` -> `WRITE | SKIP_CROSS_KIND | SKIP_NON_PRICEABLE` (kind
  checked FIRST, then the rate-writability gate). The caller distills `isRateWritable = isRateDescriptor(d) &&
  formulasComplete && isRateEditableRow(row, override)`, so the leaf needs nothing from PricingGrid.
- Types: `ClipKind` / `CellKind` / `ClipCell` (null = a SKIP hole) / `ClipboardBlock` / `SelRect` / `PasteVerdict` /
  `BatchWrite` (delta-friendly: `{kind:"rate", cell, rate}` | `{kind:"remark", args}`) / `BatchOutcome` (`{written,failed}`).

**`PricingGrid.tsx`:**
- **Range selection state:** `selectionAnchor` (grid state) + `activeCell` (focus). `selRect` derived ONCE per render,
  ONLY when it spans >1 cell. `extendIntentRef` carries "extend vs collapse" into the SINGLE anchor-setting site
  (`onCellFocus`): keyboard sets it before `focusCell` on a real move (`e.key.startsWith("Arrow") && e.shiftKey`); a
  table-level `onMouseDownCapture` (`onTableMouseDown`, on all 3 tables) sets it to `e.shiftKey` for clicks (mousedown
  precedes focus). Plain arrow / plain click collapses.
- **Memo-safe per-row props (R6):** `selLeftCol` / `selRightCol` (from `rowSelectionRange`) + `skipColsCsv` (a CSV string
  scalar for the transient amber paste-skip flash). All THREE added to `pricingRowPropsAreEqual`. `selectionRing(c)`
  (skip amber > active blue > range sky, all `ring-inset` -- a SEPARATE channel from the priced emerald/amber BACKGROUND)
  is wrapped by `cellNavClass`; the rate `<td>` + parent button (which inline their own ring) call it directly. NO shared
  mutable object is handed to a row.
- **Keybindings in `handleGridKeyDown`** (BEFORE the nav-dir mapping, each `preventDefault`): `Ctrl/Cmd+C` copy,
  `+X` cut, `+V` paste, `+D` fill-down (modifier = `e.ctrlKey || e.metaKey`). **Z/Y NOT bound (Slice B).** `nextCell` +
  the arrow/Tab/Enter nav are UNCHANGED; non-clipboard modifier combos + plain typing/the decimal guard fall through.
- **Orchestration (render-scope fns):** `doCopy` (build a `ClipboardBlock` from the active rect into `clipboardRef`),
  `doCut` (copy + clear writable sources via batch: rate "" -> 0, remark ""), `doPaste` (shape-match gate -> classify each
  target -> writes + skips), `doFillDown` (top cell of each selected column down the span). Skips flash amber (2.5s) + a
  count in a transient status strip (`clipboardMsg`); a shape mismatch shows a reject strip + writes NOTHING. Copyable
  read = the optimistic draft else the saved value; non-copyable cells (anchor/amount/qty) are SKIP holes.
- **Batch wrapper (`runBatch`):** sets optimistic rate drafts, fires `onBatchWrite`, drops the drafts after it settles.

**`SheetPricingPage.tsx`:** NEW `handleBatchWrite(writes): Promise<BatchOutcome>` -- fires each write through the SAME
`save_cell_price` / `save_row_remark` endpoints with the per-cell `mutate()` SUPPRESSED, then ONE trailing `mutate()`. On a
mid-batch failure it STOPS, surfaces `Saved X of N. <reason>`, flips the takeover banner on a takeover marker, and STILL
`mutate()`s (mixed outcome -- copy-forward partial-outcome posture; NO fake client-side atomicity). Passed as
`onBatchWrite={locked ? undefined : handleBatchWrite}` (withheld when locked -> paste/cut/fill no-op, copy still works).
**`handleSaveRate` is byte-for-byte UNCHANGED** -- `onBatchWrite` is a SEPARATE sibling (the "reshape handleSaveRate"
stop-condition was thereby avoided).

**Tests / build:** vitest 349 -> 368 (+19 NEW `clipboard.test.ts`: selectionRect, rowSelectionRange, rectDims,
shapesMatch, classifyPasteTarget all-3-verdicts); `PricingGrid.test.ts` unchanged at 131; tsc 3175 (0 new, 0 in the
touched files); in-container Vite build exit 0. ALL run IN-CONTAINER (`frappe_docker_devcontainer-frappe-1`; the win32-arm64
host can't start vitest -- linux-arm64 rolldown bindings). **OWNER live-cert OWED:** (1) copy a rate -> paste into another
priceable rate cell; (2) range-copy a block -> same-shape paste lands, (3) shape-mismatch paste rejects + writes nothing;
(4) paste a rate onto a remark / non-priceable cell -> amber skip flash + summary count; (5) fill-down a rate column over a
multi-row selection, skipping non-writable rows; (6) cut clears the source (rate -> blank/0, remark -> empty); (7) a
locked/history sheet -> paste/cut/fill no-op while copy still works; (8) an N-cell paste fires ONE network refetch (the
batch's single trailing mutate), not N.

---

