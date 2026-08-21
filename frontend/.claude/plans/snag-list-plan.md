# Snag List — Import & Tracking

**Status:** BUILT on branch `feature/snag-list`, 2026-08-21. Not committed, not merged.
See § 10 As-built for what actually shipped and what is still unverified.
Decisions settled in a grilling session, 2026-08-21. Glossary: root `CONTEXT.md` § Snag tracking.
Decisions of record: [ADR-0016](../../../docs/adr/0016-snag-category-is-free-text.md),
[ADR-0017](../../../docs/adr/0017-snag-rows-are-standalone-documents.md).

---

## 1. What this is

A project gets a **Snag List**: defects found on a site walk, imported from the consultant's Excel,
then tracked to closure inside Nirmaan. New tab: **Project View → Snag List**.

The tracking half is modelled on the Project Design Tracker's UI. The storage half deliberately is
not (ADR-0017).

---

## 2. The source file is a report, not a table

Measured against `Food Box MEP Snags list.xlsx` — this shape drove most of the design.

| Rows | Content |
|---|---|
| 1–6 | Title, "Prepared By", "Total Snags:124", report dates |
| 7 | Header row |
| 8–44 | **Block 1** — 37 snags, S.No 1→37 |
| 45–49 | blank + "RISK SUMMARY" tally (High/13, Medium/18, Low/13) |
| 51–53 | Second section title: "FOOD BOX AREA – FIRE & LIFE SAFETY (FLS)", "Observation Date: 20-07-2026" |
| 54 | **A second header row** |
| 55–141 | **Block 2** — 87 snags, S.No restarts at 1 |
| 143–149 | "FLS RISK SUMMARY" tally + 2 stray rows |

37 + 87 = 124 = the count in the title. **A naive "map 3 columns and ingest" reads 142 rows.**

Measured by the shipped parser (`services/snag_parser`, 38 unit tests against this file): **124 rows,
25 skipped, 149 accounted for with no gaps** — 9 `summary_block`, 7 `no_description`, 7 `blank`,
2 `repeated_header`. Distinct values: **17 areas, 10 categories**, top category
*Fire & Life Safety* × 79. An earlier draft of this doc said 19/11 — that count wrongly included
the header row and the summary-block rows.

Columns: `S.No | Area / Location | Category | Snag Description | Risk Level | Status | Remarks`.

**Imported:** Area, Category, Description, Remarks (→ `source_remarks`).
**Not imported:** S.No (restarts per section, so it identifies nothing), Risk Level (owner decision),
the file's own Status column (its vocabulary — *Open* / *Pending* — is not ours; every imported Snag
starts at *Pending*).

---

## 3. Data model

### `Project Snag Batch`
| Field | Type | Notes |
|---|---|---|
| `project` | Link → Projects | |
| `batch_name` | Data | pre-filled `<filename> — <sheet name>`, editable |
| `source_sheet` | Data | the worksheet this batch came from |
| `source_file` | Attach | the original workbook, downloadable |
| `uploaded_by` / `uploaded_on` | Link / Datetime | |
| `snag_count` | Int | |
| `column_mapping` | JSON | what was mapped to what — audit of the import |

### `Project Snag`
| Field | Type | Notes |
|---|---|---|
| `project` | Link → Projects | |
| `batch` | Link → Project Snag Batch | empty for a Manual Snag |
| `area` | Data | free text, verbatim |
| `category` | Data | free text, verbatim (ADR-0016) |
| `description` | Text | up to ~363 chars observed |
| `status` | Select | `Not Applicable` / `Pending` / `WIP` / `Completed`, default `Pending` |
| `source_remarks` | Small Text | the source author's Remarks, imported verbatim. **Read-only after import** |
| `comments` | Long Text | our team's write-back. Editable. Starts empty |
| `source_row` | Int | the Excel row it came from, so "row 87 was skipped" is actionable |
| `status_changed_by` / `status_changed_on` | Link / Datetime | rendered in the table |

`track_changes: 1` on `Project Snag` — full version history in addition to the two fields above.

---

## 4. Import flow (synchronous — no worker, no socket)

The dialog is a **mini-wizard**:

1. **Upload** — `.xlsx` / `.xlsm`. Read the bytes at the endpoint into a `NamedTemporaryFile`;
   never construct a local path from `file_url` (S3 trap, root `CLAUDE.md`).
2. **Pick sheets** — checkbox per non-empty worksheet.
3. **A tab per ticked sheet**, each a complete unit:
   - **Column mapping** — Area / Category / Description / Remarks, auto-guessed from header text
     ("Snag Description" → description) and pre-selected. Asked fresh every upload — never
     remembered per project, because the next file is from a different consultant.
   - **Parsed preview** — the rows we read, plus the rows we **skipped with a stated reason**
     (blank / repeated header / summary block / no description). Skipped rows are visible and
     re-tickable; ticked rows can be unticked.
   - **Distinct-values summary** — "17 areas, 10 categories" listed out, so typos
     ("Puller" vs "Piller") are caught before ingest. Nothing is auto-merged.
   - **Duplicate warning** — "18 of these look identical to snags already in this project
     (same area + description)". A warning, never a block: a defect can genuinely recur.
4. **Confirm** — one press. **One Batch per ticked sheet.** Per-sheet failure isolation: a sheet that
   yields nothing reports its reason and the others still import; the result screen shows
   `{imported, failed}` per sheet, loudly.

**Row detection rule:** a row is a Snag if its mapped Description cell is non-empty, it is not a
repeat of the header, and it is not inside a summary block. There is no manual first-row/last-row
picker — the row ticks already cover a wrong call, and two controls doing one job is worse than one.

---

## 5. The tab

Flat `DataTable` (the app's standard `useServerDataTable` + `DataTable` pattern):

- Facets: **Area, Category, Status, Batch**. Search on description. CSV export via `exportMeta`,
  respecting current filters, sort and column order.
- A **stats strip**: Total / Pending / WIP / Completed.
- Inline status change per row; **bulk status change** for ticked rows.
- **Add Snag** button (manual entry). **No single-row delete** — a wrong row goes to *Not Applicable*.
- Per-batch: rename, download original file, delete batch.
- Empty state when the project has no batch yet → straight to the import dialog.

---

## 6. Permissions

| Action | Who |
|---|---|
| See the tab | everyone with project access **except Accountant** (mirrors Design Tracker) |
| Import / delete batch / add manual snag | Admin, Project Lead, PMO |
| Change one row's status | Admin, Project Lead, PMO, **Project Manager** |
| **Bulk** status change | **Admin only** (mirrors Design Tracker's `bulk_update_task_status`) |

---

## 7. Endpoints (all under `nirmaan_stack/api/snags/`, snake_case)

| Endpoint | Does |
|---|---|
| `parse_preview` | file + per-sheet mapping → parsed rows, skipped rows with reasons, distinct values, duplicate hits. **Writes nothing.** |
| `ingest_batches` | confirmed per-sheet row sets → creates Batches + Snags. Per-sheet isolation. |
| `update_snag_status` | one row |
| `bulk_update_snag_status` | many rows, admin-gated |
| `delete_batch` | `frappe.delete_doc` per snag — **document layer only**, so `Deleted Document` is written |
| `add_manual_snag` | one row, no batch |

Parse logic lives in a pure module (`services/snag_parser/`) with real unit tests against a fixture
copy of the Food Box file — not in the endpoint.

---

## 8. Open risks (stated, accepted)

1. ~~`remarks` is one field doing two jobs~~ — **RESOLVED 2026-08-21 (owner):** split into
   `source_remarks` (imported, read-only) + `comments` (our write-back, editable). The consultant's
   text can no longer be overwritten.
2. **Batch delete is unguarded** (owner decision, ADR-0017 Consequences). Recovery = a developer
   reading `Deleted Document` in a bench console.
3. **Merging both sections of a file loses the walk they came from.** In this file it is recoverable
   because block 2 is entirely *Fire & Life Safety* — that is luck, not design. Only bites when one
   worksheet holds two dated walks.
4. **No Risk Level** means the High/Medium/Low tally the Excel maintains by hand is not replaced.
5. **Free-text Area and Category** will show near-duplicate facet values from typos. Mitigated by the
   preview's distinct-values list, not prevented.

---

## 9. Explicitly NOT in v1

Closure photos / evidence attachments · assignee per snag · due dates · comment threads · notifications ·
Excel round-trip (export → edit statuses → re-import) · rolling snags up by Work Package ·
cross-project snag reporting · single-row delete · a background worker for large files.


---

## 10. As-built (2026-08-21, branch `feature/snag-list`)

### Verification actually run

| Check | Result |
|---|---|
| `services/snag_parser` unit tests | **38 pass** — `cd nirmaan_stack/services && python3 -m unittest snag_parser.test_snag_parser` |
| `api/snags` tests | **15 pass** — `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.snags.test_snag_api` (in-container) |
| Backend end-to-end on the REAL file | 124 previewed -> 124 ingested, all `Pending`; re-preview flags 124 duplicates; status move stamped; stats correct; delete wrote **124 `Deleted Document` rows**; test rows cleaned up |
| All 10 endpoints resolve + whitelisted | yes |
| `npx tsc --noEmit` | **zero errors under `src/pages/SnagList/`** (repo baseline elsewhere ~3.2k pre-existing, untouched) |
| `npx vite build` (in-container) | succeeds; `SnagListTab-*.js` chunk emitted |
| `scripts/residence_check.py` | B1/B2/B3 hold. **This feature adds ZERO new F2/F5 violations** (measured by removing `SnagList/` and re-running: identical counts). The standing F2 +13 / F5 +3 over baseline are PRE-EXISTING on `develop` — the baseline JSON is stale. **Not re-baselined — that would hide another change's debt.** |

### Measured facts that corrected this document
- The fixture yields **17 areas / 10 categories**, not the 19/11 an earlier draft claimed (that count wrongly included the header row and the summary-block rows).
- `ProjectSnag.source_row` is a Frappe `Int`, so an unset one reads back as **`0`, never `null`**. A Manual Snag has `source_row === 0`. `types.ts` says so at the field; test falsiness, never `=== null`.

### Deliberate deviations from §1-§9, all accepted
1. **`api/snags/snags.py` was renamed `tracking.py`.** The dotted path is
   `nirmaan_stack.api.snags.tracking.<fn>`, which pairs with `...snags.import_wizard.<fn>`.
   The original name gave the ugly and confusing `snags.snags`. Renamed while it was still cheap.
2. **Status attribution moved OUT of the API into a controller** —
   `integrations/controllers/project_snag.py` `before_save`, wired in `hooks.py`. Stamping in the
   endpoints would leave a Desk edit / bulk edit / Data Import unstamped, and the field would then
   read as authoritative while being wrong. Endpoints therefore MUST write status through
   `frappe.get_doc` + `doc.save()` (the bulk path loops `save()`); `frappe.db.set_value` or raw SQL
   would bypass the hook — the standing lifecycle trap in root `CLAUDE.md`.
3. **Repeated-header detection is `min(2, columns mapped)`, not a literal `>= 2`.** A
   description-only mapping is legal and could never reach 2, so the header row ingested itself as
   a snag. Identical behaviour for any mapping with 2+ columns; the fixture is byte-unaffected.
4. **Distinct-values list renders ALPHABETICALLY**, though the backend sorts count-desc. Its stated
   job is spotting typos, and alphabetical puts "Piller" next to "Puller"; count order scatters them.
5. **The `Batch` FACET's option labels are batch doc names** (`SNAGB-26-00001`), because
   `useFacetValues` returns raw field values with no label seam. The Batch **cell** shows the
   friendly `batch_name`. A blank bucket labelled "Manual (no batch)" makes Manual Snags filterable.
6. **Both agents reinvented Frappe error unwrapping**; both now delegate to the app-wide
   `utils/frappeErrors.getFrappeError`. Do not reinstate a local copy.
7. **No batch rename** shipped (mentioned in §5, never specified). Listed under Not Yet Done.

### A repo doc bug found and fixed on the way
`frontend/CLAUDE.md` documented a CSV-export API called **`exportMeta`** with `header` / `value` /
`exportFileName` keys. **It does not exist and never did** — 0 hits in `src/`, against 69 files
using `meta.exportValue` / `meta.exportHeaderName` / `meta.excludeFromExport`, which is what
`utils/exportToCsv.ts` actually reads. Corrected in place.

### NOT yet verified — the honest gap
**Nothing has been clicked.** There is no DOM test environment in this repo (a deliberate choice
recorded in `frontend/CLAUDE.md`), so every UI claim here rests on type-checking and a successful
build, NOT on the screens having been driven. Specifically unproven: the upload -> sheet-pick ->
per-sheet-tab flow end to end in a browser, the row-tick / skipped-row re-tick interaction, facet
behaviour, bulk selection across paging, and the batch-delete confirm. **A live browser pass on a
real project is the next step and should happen before this branch is considered done.**

### Also not done
Not committed. Not merged. `bench build` for deployed assets not run (the dev build was).
Batch rename. Everything in §9 remains out of scope.

---

# Revision 2 — owner change set, 2026-08-21 (PLAN ONLY, no code written)

Nine changes, settled over three grilling rounds. Two analysis passes over the shipped code produced
the couplings below; **several of the changes do not mean what they appear to mean**, and one of them
uncovered a live bug. Read § R2.1 first.

## R2.1 — A LIVE BUG, found while analysing change 2. Fix it WITH that change.

**A re-ticked skipped row is silently dropped at import.** Reproduced on the real fixture:

```
RE-TICKING skipped row 1 (no_description)
USER TICKED:     125      SERVER IMPORTED: 124      LANDED IN DB: False
```

Cause — `api/snags/import_wizard.py:259`:
```python
rows = [r for r in (parsed.get("rows") or []) if r.get("source_row") in accepted]
```
The server re-parses and filters against `parsed["rows"]` — the ACCEPTED list. `parsed["skipped"]` is
never read in `_ingest_one_sheet`. A re-ticked row is not in the list being filtered, so it vanishes:
no error, no report; `imported` just comes back lower than the footer promised.
Worst case: re-ticking ONLY skipped rows raises `"No accepted rows were found in sheet ..."` and rolls
the whole sheet back with a message that reads like a parser failure.

**The UI actively promises the opposite** — `PreviewPanel.tsx:372` says *"Tick any row the parser got
wrong — it will be imported with the rest."* Change 2 puts unticked rows inline, one click from being
ticked, so this stops being obscure. **No test covers it** (`_StubParser` never returns a skipped row
that is then accepted). The regression test is owed.

## R2.2 — Settled decisions

| # | Change | Decision |
|---|---|---|
| 1 | Header row override | Input field, pre-filled with the guess. **Overriding also excludes every row AT or ABOVE it from import** (Q7b) |
| — | on override | **Reset the mapping and re-run the auto-guess** against the new header row's labels (Q8a) |
| 2 | Merge the two preview tables | ONE table; skipped rows present but **unticked**, each showing its **skip reason** (Q6a) |
| — | rows that cannot become a Snag | A row with no description is rendered **un-tickable**, greyed, with the reason (Q9b) |
| 3 | Sheet selector label | **"Current Sheet"**, on the **tab strip** in the preview step (Q10) — it has no label at all today |
| 4 | Batches button | becomes an **Import History icon** |
| 5 | That button group | Admin / PMO / Project Lead. **PM keeps per-row status + remark editing** (Q4a) |
| 6 | `comments` | **deleted** from doctype and table |
| 7 | `Batch` column | **column removed, the Batch FILTER stays** (Q5) |
| 8 | `source_remarks` | renamed **`remark`** — SINGULAR (Q11b). UI label stays "Remarks" |
| 9 | remark editing | editable on every status change **except Not Applicable, which shows no remark box at all** (Q2a); the edit is **OPTIONAL** (Q3); it **OVERWRITES** (Q1a) |
| — | bulk status change | **takes no remark** (Q12a) — it would overwrite N different remarks with one sentence |
| — | `get_snag_stats` | **gains the missing permission guard** (Q13) — today any logged-in user can read it |

Decision of record for 6+8+9: **ADR-0018**. Glossary term: root `CONTEXT.md` § Snag tracking, *Remark*.

## R2.3 — What the changes actually mean (each of these surprised the plan)

1. **Change 5 is almost a no-op as written.** Of the three controls in that group, *Add snag*
   (`SnagListTab.tsx:236`) and *Import* (`:248`) are ALREADY gated to Admin/PL/PMO. Only the Batches
   trigger (`SnagBatchesPanel.tsx:81-87`) is ungated. **Change 5 == gate the Import History icon.**
   It does NOT touch the per-row status control, which is gated separately by `perms.canEditStatus`
   (`SnagListTab.tsx:119`) — matching Q4a. Tightening PM would mean editing
   `snagPermissions.SNAG_ROW_EDIT_PROFILES` + the backend `STATUS_ROLES`, and would break
   `test_a_project_manager_may_change_one_status_but_not_bulk`. NOT DOING THAT.
2. **The header row does not currently affect parsing AT ALL.** `parser.py` never calls
   `find_header_row`; it classifies every row independently and keys its summary-block / repeated-header
   logic off `all_header_rows` (a different concept). Rows above the header are excluded only
   INCIDENTALLY, because their description cell happens to be empty. Q7b therefore requires NEW code —
   a positional filter in `parse_grid` — and gives the feature a rule it has been faking.
3. **`columns` and `mapping_guess` are computed ONCE, inside `inspect_sheet`**, and `inspect_workbook`
   cannot be re-called (it is multipart and re-`save_file`s). A header-row override needs a new
   read-only re-inspect path, or the recomputed columns must ride `parse_preview`'s response.
4. **`mappingSignature` (`importState.ts:122`) is the ONLY preview-invalidation key.** `header_row` MUST
   be folded into it or the preview never refreshes AND the in-flight response guard
   (`SnagImportDialog.tsx:191`) accepts stale data. Single highest-risk line in change 1.
5. **`reconcileTabStates` deliberately preserves an existing tab's state** (`importState.ts:185-203`),
   so a re-guess after a header change will NOT reach an already-created tab — `state.mapping` must be
   overwritten explicitly.
6. **A mapped column letter is never validated against `columns`.** Radix `Select` renders the
   placeholder for an unmatched value while `isMappingValid` still passes — the UI shows "(not mapped)"
   while the wire sends a real letter. A header change makes this reachable; add the validation.
7. **A skipped row carries only `{source_row, reason, preview_text}`** — no area/category/description.
   The data IS in hand at classification time (`parser.py:158-190`), so widening the skip dicts is
   mechanical. `preview_text` is the first non-empty cell truncated to 80 chars — NOT the description.
8. **The Batch facet is declared ON the Batch column** (`snagColumns.tsx:182-187`, the `meta.facet`
   self-fetching pattern), and `new-data-table.tsx:289-333` renders facets inside the column-header
   loop. **No column ⇒ no facet.** Keeping the filter (Q5) means re-siting it onto another column's
   header. `batch_display_name` + its link-fetch become dead and must be removed with it.
9. **Removing `comments` needs a DB patch, not just a migrate.** `bench migrate` syncs the definition
   and leaves the physical column. Precedent: `patches/v3_0/remove_commission_report_zones.py`
   (`[post_model_sync]`, explicit `DROP COLUMN IF EXISTS`).
10. **The `source_remarks` -> `remark` rename goes THREE layers deep** — the parser's output key
    (pinned by `test_snag_parser.py:204`), the `ParsedSnagRow` wire shape (pinned by
    `test_snag_api.py:333`), and storage. It crosses the IMPORT wizard's preview API, not just the tab.
11. **The status stamp still fires correctly** when a save changes both status and remark — the
    controller's only gate is `previous.status == doc.status` (`project_snag.py:34`). Confirmed.
12. **URL-persisted state is not migrated.** `urlSyncKey: snags_${projectId}` persists the selected
    search field and column filters. A bookmark holding `comments` as the search field, or a `batch`
    column filter, will fail HARD or apply invisibly after these changes. Needs a stale-key guard.

## R2.4 — Test coverage hole created by 6 + 9 (must be answered in the same change)

`test_update_snag_status_stamps_attribution_and_a_later_save_does_not_move_it` proves the controller
leaves the status stamp alone on a save that did NOT change status. Its probe is
`update_snag_comments` — which change 6 deletes. After change 9, every remark save also moves the
status. **Line `project_snag.py:34`'s early-return branch would end up with nothing exercising it, and
the test would still pass.** Replacement probe: save the doc directly with only a `remark` change
(a bare `doc.save()` in the test, no endpoint), and assert the stamp did not move.

## R2.5 — Work breakdown

**Parser (`services/snag_parser/`)** — widen the four `skipped.append` dicts (`parser.py:161-180`) to
carry area/category/description/remark; add the `header_row` positional filter to `parse_grid`; rename
the output key to `remark`; thread `header_row` through `parse_sheet`. Update the two key-set pins.

**Backend (`api/snags/`)** — `_ingest_one_sheet` must select from rows + skipped (**the R2.1 fix**) and
refuse a description-less row with a NAMED reason in the result, never a silent drop; `parse_preview` /
`ingest_batches` / `_shape_skipped` gain `header_row` + the widened skip shape; duplicate flagging and
`_distinct` must decide whether re-ticked rows count (they do not today); a new read-only re-inspect
endpoint for recomputed columns; delete `update_snag_comments`; add the `get_snag_stats` guard.
Two patches: `rename_field` for `source_remarks`->`remark` (with the both-columns recovery branch) and
`DROP COLUMN comments`. Both registered in `patches.txt` (the wiring line is added by the maintainer).

**Import wizard UI** — merge the two tables into one (the ticked `Set<number>` is already keyed by
`source_row`, so tick state needs no reshape); un-tickable rows; header-row input + reset-and-re-guess;
fold `header_row` into `mappingSignature`; validate mapped letters against `columns`; "Current Sheet"
label on the tab strip; one `SelectAllNone` instead of two.

**Tracking tab UI** — Batches -> icon (keep an `aria-label`; the count badge loses its home); gate it
to Admin/PL/PMO; delete `SnagCommentsCell` + the comments column/field/search-entry/mutation; remove the
Batch column and re-site its facet; rename to `remark` and make it editable; add the remark step to the
single status change (NOT bulk), suppressed entirely for *Not Applicable*; stale URL-state guard.

## R2.6 — Still true from Revision 1

**Nothing has been clicked.** No DOM test environment exists in this repo. Every UI claim rests on
type-checking and a build. A live browser pass is owed on BOTH revisions.

## R2.7 — As-built (Revision 2, 2026-08-21)

### Verification run

| Check | Result |
|---|---|
| `snag_parser` tests | **59 pass** (was 38) |
| `api/snags` tests | **29 pass** (was 15) |
| **The R2.1 bug, on the real fixture** | ticked 126 -> **125 imported + 1 refused = 126.** Re-ticked skipped row LANDED (was `False`). Nothing unaccounted for. |
| `header_row=7` (explicit) vs auto-detect | **FULL response dict equal** — the new input cannot change a file that already parsed right |
| `header_row=54` (wrong) | 87 accepted, 53 rows `above_header` — proves the param reaches classification, not just labels |
| Merged rows | 149 rows, ordered, no gaps, no duplicates, covers 1..149 |
| Remark on status change | writes; `Not Applicable` **rejects even `""`**; omitting it preserves the text |
| `npx tsc --noEmit` | **zero errors under `src/pages/SnagList/`** |
| `npx vite build` | succeeds; `SnagListTab-*.js` emitted |
| `scripts/residence_check.py` | **feature adds ZERO violations** (220/119 with and without `SnagList/`). Standing +13/+3 is pre-existing on `develop`; NOT re-baselined. |

### Deliberate deviations from the R2 plan, all accepted

1. **The parser dropped its `skipped` list entirely** — one merged `rows` only. Keeping both would
   re-create the exact R2.1 shape (two lists, one of which a caller forgets to read). A caller still
   reaching for `parsed["skipped"]` now fails LOUDLY instead of silently importing less than promised.
2. **`parse_grid`/`parse_sheet` also return the RESOLVED `header_row`** — `ParsePreviewResponse` needs
   it and only the parser knows which row was actually used.
3. **`Not Applicable` rejects an explicit `""`, not just non-empty text.** A clear is still a remark
   WRITE; accepting it would let a client that always sends the field destroy the imported text while
   appearing to honour a rule meant to leave it alone. **The client must OMIT the key** — it does
   (`remark === undefined ? {snag,status} : {snag,status,remark}`).
4. **The Batch facet could NOT be re-sited onto Area/Status as the plan instructed.**
   `DataTableFacetedFilter` writes through `column.setFilterValue()`, so the `columnFilters` entry is
   keyed by the HOST column's id, and `convertTanstackFiltersToFrappe` turns that id straight into the
   queried FIELD name. Hosting on Area would have shown the right options and then sent
   `["area","in",["<batch doc name>"]]` — **a silently wrong query.** Built instead as a hidden,
   display-only filter-host column (`id: "batch"`, no `accessorKey`, header/cell `null`), with the
   funnel rendered by the page in `toolbarActions`. Still the self-fetching facet path. No accessor
   means it cannot be re-enabled from the column-visibility menu.
5. **`require_read_access` is the one tier written as a DENY-list** (Accountant, Accountant Lead), so a
   role added later is not silently locked out of a read-only view.
6. **The URL filter codec is now EXPORTED from `useServerDataTable`** (`encodeFiltersForUrl` /
   `decodeFiltersFromUrl`, additive) and the snag URL-state sanitizer routes through it. The page had
   re-implemented base64 + parse locally — a second copy of a format the hook owns, free to drift and
   then silently mangle live filters. This also took the feature's residence count back to zero.
   ⚠️ `scripts/residence_check.py` matches the token in COMMENTS too — a comment naming the banned
   call trips the rule.
7. **The status stamp attribution comment in `integrations/controllers/project_snag.py`** was corrected
   (2 lines, no logic): its example was "a comment edit", and comments no longer exist.

### Measured facts worth keeping

- **The fixture's Remarks column (G) is EMPTY on all 124 accepted rows.** Every imported remark starts
  blank on this file. The mechanism works; this sheet simply carries nothing.
- **23 rows are un-tickable** (no description). Rows 7 and 54 are skipped-but-tickable — their
  description cell holds the literal text "Snag Description", so a user *could* tick a header row and
  import a snag called "Snag Description". `tickable` keys on description only, by design; the
  "Repeated header row" reason is displayed right beside it. Left as-is, flagged not fixed.
- The **`test_..._a_later_save_does_not_move_it`** stamp test got its replacement probe: a bare
  `doc.save()` changing ONLY `remark`. Without it, deleting `comments` would have left the test
  passing while exercising nothing (R2.4).

### Known behaviour worth a second opinion

**If `parse_preview` returns `mapping_guess: null` for an overridden header row** (the user pointed at
a row with no recognisable labels), the mapping resets to EMPTY and the preview blocks until Description
is mapped by hand. That follows Q8a literally. The alternative — keep the previous mapping, since the
column LETTERS are still valid — would often be more useful. Not changed unilaterally because Q8a was
answered explicitly. Owner's call.

### Still NOT verified

**Nothing has been clicked, in either revision.** No DOM test environment exists (deliberate, per
`frontend/CLAUDE.md`). Unproven: the header-row input under fast typing (each keystroke = new signature
-> debounced refetch -> mapping re-guess; terminating and correct in theory, churn unproven), the
merged preview table's tick/re-tick interaction, the disabled-checkbox tooltip, the status+remark
dialog across all four statuses, the toolbar Batch funnel filtering AND clearing, and the Import
History icon gating. **A live browser pass is owed.**
