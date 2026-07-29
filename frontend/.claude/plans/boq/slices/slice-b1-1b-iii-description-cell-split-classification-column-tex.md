### Slice B1.1b-iii -- Description cell split: Classification column + text-only Description (frontend)

**Scope:** `ReviewTree.tsx` only. Pure layout restructure — no behavior change to tree, collapse, filters, or data. No boqTypes.ts changes, no backend changes.

**What changed:**

Before B1.1b-iii, the Description `<td>` held: indent wrapper (paddingLeft = depth * INDENT_PX) > chevron button + flex-col[pill above, text below].

After B1.1b-iii, the cell is split into two separate columns:

**New column order:** Excel Row | Sl.No | Parent | **Classification** | Description | [descriptor columns]

**Classification `<td>` (new fixed anchor, between Parent and Description):**
- Contains: chevron button (verbatim, all aria/tabIndex/invisible-on-leaf behavior carried over) + ClassificationPill side by side.
- `w-36 border-r border-border` in both `<th>` and `<td>`.
- NO depth indent — flat-left, all rows align in this column regardless of tree depth.
- Header: "Classification" (no Excel letter — fixed anchor, not a mapped column).
- NOT in the column-subset selector (selector iterates `displayDescriptors` only; Classification is outside that loop).

**Description `<td>` (text-only):**
- Contains: only the description text span + fallback. Chevron and pill removed.
- Depth-based indent (`paddingLeft = depth * INDENT_PX`) applied on a content wrapper `<div>` inside the `<td>`. The nesting is now shown via Description column stepping.
- Per-classification text styling preserved verbatim: preamble `font-medium text-foreground`, line_item `text-foreground`, others `text-muted-foreground italic text-[11px]`.
- `(no description)` fallback preserved.

**Unchanged:** collapse mechanic, isVisible, classificationVisible, computeDepths, visibleCols subset selector, three annotation toggles, Parent column, absent-vs-zero, descriptor column rendering.

**No boqTypes.ts changes.** No backend changes. No bench tests.

**tsc:** 0 wizard-file errors. Vite build exit 0.

**Files changed:**
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- split.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record.
- `frontend/CLAUDE.md` -- B1.1b-iii conventions added.
- Root `CLAUDE.md` -- status line bumped.

---

