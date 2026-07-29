### Slice B1.1b-ii -- column-subset selector + classification-visibility toggles (frontend)

**Scope:** `ReviewTree.tsx` only (no boqTypes.ts changes needed). View-filter only -- no data edit, no backend changes.

**Feature A -- Column-subset selector:**
- Popover trigger button (SlidersHorizontal icon + "Columns") in controls bar above the table. Shows "(N hidden)" amber badge when any column is hidden.
- PopoverContent: one Checkbox per `displayDescriptor` (post-FIXED_ROLE_DEDUPE). Label: `"{col} — {ROLE_LABELS[role]}{ · area}"`. All ticked by default.
- State: `visibleCols: useState<Set<string>>` lazy-initialized to all descriptor col letters on mount. `useEffect([displayDescriptors])` re-syncs to all cols when descriptors change (new sheet). `toggleCol` functional updater (new Set from prev, delete/add).
- Fixed anchor columns (Excel Row, Sl.No, Parent, Description) NOT in the selector — always render.
- Both `<th>` and `<td>` for descriptor columns gated: `if (!visibleCols.has(d.col)) return null`.

**Feature B -- Three independent annotation-row visibility toggles:**
- `showSpacers`, `showNotes`, `showSubtotals` — three independent booleans, default `true`.
- `classificationVisible(row)`: returns `false` when `effective_classification` matches a toggled-off type; `true` otherwise.
- Compose with `isVisible`: `if (!isVisible(row)) return null; if (!classificationVisible(row)) return null;` — two separate gates, each readable in isolation.
- **Children-of-hidden-annotation edge case:** handled for free. `computeDepths` pre-runs over all rows (unfiltered). `classificationVisible` never touches `collapsed` Set. `isVisible` only checks `collapsed` → children of a hidden note/spacer/subtotal render at their original computed depth with correct indent.

**Controls bar structure:**
- Outer wrapper: `<div className="rounded-md border border-border overflow-hidden">` (new; border moved from scroll div).
- Controls bar: `<div className="flex items-center gap-4 px-3 py-2 border-b border-border bg-muted/20 flex-wrap">`.
- Table scroll div: `max-h-[calc(100vh-16rem)]` (was 14rem; 2rem added to account for controls bar height).
- Popover trigger: compact `inline-flex` button, `border-primary text-foreground` variant when any col hidden.
- Classification toggles: three `<label htmlFor> + <Checkbox>` rows in `<div className="flex items-center gap-3">` with "Show:" prefix.

**No boqTypes.ts changes.** No backend changes. No bench tests.

**tsc:** 0 wizard-file errors. Vite build exit 0.

**Files changed:**
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- both features.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record.
- `frontend/CLAUDE.md` -- B1.1b conventions block updated.
- Root `CLAUDE.md` -- status line bumped.

---

