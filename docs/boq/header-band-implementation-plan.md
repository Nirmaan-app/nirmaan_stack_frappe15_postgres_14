# Implementation Plan — "Data starts on the next row" fix + redesigned Skip-rows field

**Branch:** `boq-header-config` (off `develop`)
**Status:** PLAN (revised after stakeholder re-scope) — awaiting review. No code written yet.
**Supersedes:** the earlier multi-row "header band" version of this plan (dropped — Section 1 layout stays as-is).
**Design artifacts:** `docs/boq/header-skip-analysis.html` (analysis), `docs/boq/section1-prototype.html` (skip-field + panel prototype), `CONTEXT.md` (glossary: *Header row*, *First data row*, *Data region*, *Excluded rows (manual)*).

---

## 1. Goal (stakeholder re-scope, grill-confirmed)

1. **Keep Section 1 — Rows layout UNCHANGED** (Single/Double header type, Header row, Top header row). No control changes.
2. **Fix "Data starts at row"** so data begins on the **row after the declared header** (`header_row + 1`), not `header_row + header_row_count`.
3. **Redesign the "Skip rows after header" field** into a list of skip definitions (Single Row / Multiple Rows) + a unified yellow summary panel — the primary tool for removing extra header tiers below the header row and mid-sheet junk.

## 2. Root cause (investigation result)

The "Data starts at row 4 skips a row" bug is a **three-way inconsistency**, where the skip logic is the odd one out:

| Piece | Says the 2nd header row is… | cite |
|---|---|---|
| UI label "Top header will be row `header_row − 1`" | **above** `header_row` | `SheetConfigPanel.tsx:957` |
| Parser area-detection (reads `header_row − 1`) | **above** `header_row` | `orchestrator.py:246` |
| **Skip logic** (`if count==2: skip header_row+1`) | **below** `header_row` ❌ | `orchestrator.py:175–176` |
| "Data starts" formula (`header_row + count`) | **below** `header_row` ❌ | `SheetConfigPanel.tsx:470` |

If the 2nd header row is *above* (as the label + area-detection say), then `header_row + 1` is the **first data row**, and skipping it is the defect. **Fix = make the skip logic + the display agree with the label/area-detection: data starts at `header_row + 1`.**

## 3. Locked decisions (grill results)

| # | Decision |
|---|---|
| D1 | **Data starts at `header_row + 1`** always (Single or Double). The Single/Double + Top-header controls keep their role: a 2nd header tier *above* is read for area names; data is unaffected by it. |
| D2 | **Extra header tiers *below* `header_row`** (rate splits, area tiers) are removed via the **redesigned Skip field**, not Section 1. |
| D3 | **Skip field** = list of skip definitions (Single Row / Multiple Rows). Keep the label "Skip rows after header". Flatten → `skip_top_rows_after_header` (backend, unchanged) + structured `skip_row_definitions` (UI round-trip). |
| D4 | **Unified yellow panel** "Rows excluded from data": `Header row: N (+ top header: M)` · `Skipped rows: …` · `→ First data row: K` (numbers only; First data row = `header_row+1` stepped past leading skips). |
| D5 | **Existing Double sheets re-parse with one fewer skip** (the old `header_row+1` row is no longer auto-removed). **Accepted, no shim** — committed data is frozen; the classifier tags the leaked row as a spacer; the Skip field handles the rare real case. |
| D6 | Validation: hard-validate only `end ≥ start` / `row ≥ 1`; dedupe overlaps; redundant/out-of-bounds allowed (no-op). |

## 4. Backend change (tiny — 2 lines)

| File | Change |
|---|---|
| `services/boq_parser/orchestrator.py:175–176` | **Remove** `if sheet_config.header_row_count == 2: skip_rows.add(header_row + 1)`. Header skip becomes just `{header_row}` (+ user skips). Data = rows `> header_row` minus user skips → starts at `header_row + 1`. **Add a comment** explaining the 2nd header tier lives *above* (handled by the `>= header_row` guard + area-detection). |

**Unchanged:** `config.py` (Single/Double `Literal[1,2]` stays — Section 1 unchanged); `orchestrator.py:239` area-detection branch (`count==2` still reads the row above); `commit_pipeline.py`, `pricing.py`, `export_writeback.py`. **No migration.**

## 5. Frontend changes

| File | Change | Size |
|---|---|---|
| `boqTypes.ts` | Add `SkipDefinition` type (`{kind:'single',row} \| {kind:'range',start,end}`). | S |
| **new** `boq-wizard/skipRows.ts` (pure, unit-tested) | `resolveSkipDefinitions(defs): number[]` (flatten+dedupe+sort); `firstDataRow(header_row, skips): number` (header_row+1 stepped past leading skips); `defsFromLegacyList(int[]): SkipDefinition[]` (round-trip for old flat lists). | M |
| `boq-wizard/SheetConfigPanel.tsx` | (a) **"Data starts at row"** → `header_row + 1`, relabel "(the row after the header)". (b) Replace the single skip text-input with the **skip-definitions list** (Single/Multiple per row, add/remove) + the **unified yellow panel** (D4). (c) Rewire `buildConfigPayload` (write `skip_top_rows_after_header` flattened + `skip_row_definitions`), the init `useEffect` (read `skip_row_definitions` else `defsFromLegacyList`), `SAVE_ALL_FIELDS`, sparkle keys. **The Single/Double + Header row + Top-header controls are untouched.** | **M–L** |
| `boq-wizard/SheetDataGrid.tsx` + `SheetSpokePage.tsx` | **Freeze the real header rows, not `header_row+1`.** SheetSpokePage computes the freeze set = `{header_row}` ∪ (Double → the top header row: `top_header_rows_override[0] ?? header_row−1`) and passes it; the grid freezes that set. Stops the preview from highlighting the first data row as a header. | S–M |

UI: skip-list + yellow panel follow `docs/boq/section1-prototype.html` (the Single/Multiple toggle, add-list, and amber-box are all existing panel patterns). shadcn/ui + token classes only.

## 6. Backward compatibility

- **Single-header sheets:** zero change (already `data = header_row + 1`).
- **Double-header sheets:** on **re-parse**, the row formerly at `header_row+1` is no longer auto-skipped → appears (classified as spacer in the common case). Committed/Finalized BoQs are **frozen** (commit pinned the rows) — unaffected until re-parsed. Fixable by adding that row to the Skip field.
- **Old `skip_top_rows_after_header` flat lists** → reconstructed into single-row skip definitions on load (`defsFromLegacyList`). New `skip_row_definitions` key is additive + frontend-only (verified ignored by `SheetConfig`, pydantic `extra='ignore'`). **No migration.**

## 7. Out of scope (unchanged)

Multi-row "header band" UI (dropped per stakeholder); multi-tier area auto-detection; classification heuristic changes.

## 8. Tests

- **Backend** (`test_parse_run` / parser tests): a Double-header fixture now yields data from `header_row + 1` (the old `header_row+1` row is present, not skipped); Single-header unchanged. Run the BoQ suite (`bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_parse_run`).
- **Frontend** (vitest): `skipRows.ts` — `resolveSkipDefinitions` (flatten/dedupe/sort/range), `firstDataRow` (leading-skip stepping, gaps), `defsFromLegacyList` round-trip. `tsc` clean.
- **Browser (chrome-devtools)**: HVAC Low side → set `header_row = 2`, Skip `3–5` → panel shows `Header row: 2`, `Skipped: 3,4,5`, `→ First data row: 6`; "Data starts" line reads the row after the header. Re-parse → first item row 7 preserved. **Regression:** a Single-header sheet's data-start unchanged.

## 9. ADR

Create `docs/adr/0008-data-starts-next-row.md` (hard-to-reverse parse-semantics change + a real trade-off). Records: data starts at `header_row + 1`; the removed `header_row+1` skip was inconsistent with the UI label + area-detection; extra tiers below handled by manual excluded rows; the accepted re-parse behavior change for Double sheets (D5). Cross-linked from `CONTEXT.md` (`[[adr-data-starts-next-row]]`).

---

## Execution Strategy

Execute via the Plan-to-Parallel workflow (see `~/.claude/CLAUDE.md`). TaskCreate → TaskUpdate (dependencies) → parallel subagents per wave.

- **Wave 1 (parallel, independent):**
  - **T1 Backend** — remove the `header_row+1` skip in `orchestrator.py` (+ comment) + backend test (Double yields data from `header_row+1`). *(isolated)*
  - **T2 Frontend pure core** — `skipRows.ts` helpers + `SkipDefinition` type + vitest. *(blocks T3)*
  - **T3-docs** — ADR `0008` + finalize `CONTEXT.md`. *(no code dep)*
- **Wave 2 (after T2):**
  - **T4 Panel** — `SheetConfigPanel.tsx`: data-start = `header_row+1`, skip-definitions list + yellow panel, payload/init rewiring (Section 1 controls untouched). *(blocked by T2)*
  - **T5 Freeze** — `SheetDataGrid` + `SheetSpokePage` freeze-the-real-header-rows fix. *(independent of T4)*
- **Wave 3 (after T1, T4, T5):**
  - **T6 Verify** — `tsc` + backend test run + chrome-devtools E2E on HVAC Low side + a Single-header regression.
