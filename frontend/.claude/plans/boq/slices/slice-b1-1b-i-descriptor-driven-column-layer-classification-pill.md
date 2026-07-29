### Slice B1.1b-i -- descriptor-driven column layer + classification pill (frontend)

**Status:** COMPLETE (feat 3e846ba1; frontend only; no backend changes; no bench tests; tsc 0 wizard errors; Vite build exit 0).

**What landed:**

*`boqTypes.ts`:*
- `ColumnDescriptor` interface added (col, role, area, value_field, value_key, rate_subkey). Typed to match B1.1a backend shape exactly.
- `GetReviewRowsResponse` extended with `column_descriptors: ColumnDescriptor[]`.

*`ReviewTree.tsx` -- column layer replaced, tree mechanic preserved verbatim:*
- `ClassificationBadge` (flat Tailwind badge) REPLACED by `ClassificationPill`: small left-bordered pill using the locked §2 hex colour map. `border-left: 3px solid {color}`, `bg-muted/60` background. Hex map: preamble #888780, line_item #378ADD, note #EF9F27, subtotal_marker #1D9E75, spacer #D3D1C7, header_repeat #94A3B8 (neutral, not in locked map).
- `ReviewTreeProps` extended with `columnDescriptors: ColumnDescriptor[]`.
- `FIXED_ROLE_DEDUPE = Set(["sl_no","description"])`: these roles are excluded from the descriptor-driven column list (shown as fixed anchors instead).
- Anchor letters: `slNoLetter` + `descriptionLetter` extracted from descriptors BEFORE deduplication. Anchor headers: "Sl.No (A)", "Description (B)" when mapped; "Sl.No" / "Description" when descriptor absent.
- Table structure: [Excel Row (source_row_number, no letter)] [Sl.No (letter)] [Description (letter, tree column)] [one col per displayDescriptor].
- Descriptor column headers: `"{col} — {ROLE_LABELS[role]}{ · area}"`. Area headers tinted with local AREA_COLORS (mirror of SheetDataGrid — not exported there; re-implemented locally).
- `resolveDescriptorValue(row, d)`: walks `row[value_field]` → `[value_key]` → `[rate_subkey]`. Returns `undefined` if any level is absent. Cast via `as unknown as Record<string,unknown>` to satisfy tsc strict overlap check.
- `renderDescriptorCell(val)`: `undefined`/`null` → `""` (blank); numeric 0 → `"0"`; numbers → `fmtNum(val)`. Absent-vs-zero rule enforced.
- `fmtNum` preserved (now called by `renderDescriptorCell` for number formatting — single source of truth).
- `computeDepths`, `isVisible`, `toggleCollapse`, `hasChildrenSet`/`byIdx`, `collapsed`, `INDENT_PX`, `VISIBILITY_HOP_CAP`, chevron button + text span interior — all verbatim from B1.
- No column-subset selector, no spacer-hide toggle (those are B1.1b-ii).

*`SheetReviewPage.tsx`:*
- `const columnDescriptors = reviewData?.message?.column_descriptors ?? [];` added.
- `<ReviewTree rows={rows} columnDescriptors={columnDescriptors} />` updated.

**Files changed:**
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- ColumnDescriptor + GetReviewRowsResponse extended.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- column layer replaced; pill; anchor letters; descriptor columns.
- `frontend/src/pages/boq-wizard/SheetReviewPage.tsx` -- extract + pass columnDescriptors.

**Note:** The canonical §6.5 fold (BoQ_Review_Screen_Locked_Design_v1_0.md -> BoQ_Wizard_Design_v1_13.md §6.5) is owed on the project-knowledge (chat-Claude) side. Those docs are not in the repo and cannot be edited here.

**tsc:** 0 errors on boq-wizard files. Vite build exit 0. No backend changes, no bench tests.

