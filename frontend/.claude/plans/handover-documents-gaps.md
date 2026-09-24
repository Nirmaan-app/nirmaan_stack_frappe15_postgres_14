# Handover Documents (HOD) — gaps, pending work and refactor list

State on 2026-09-22, branch `hod/feature` (committed, not pushed).
Design and decisions: `handover-documents-plan.md`; build steps and as-built notes: `handover-documents-execution.md`.

Legend: **Owner** = who has to act (Team = site/owner team, Dev = code change).

---

## 1. Pending actions (to finish what is built)

| # | What | Owner | Notes |
|---|---|---|---|
| P1 | ~~Paste both print formats again~~ **Done** | Team | Pasted 2026-09-22 15:00; the saved "HOD Document" and "HOD Checklist" match the repo files exactly. |
| P2 | ~~Paste the O&M table pictures~~ **Done differently 2026-09-23** | Dev | The 18 pictures were extracted from the workbooks and **transcribed into real HTML tables** in the library (17 tables, 0 images left), so they are editable on screen and print as text. Nothing has to be pasted on live — the tables travel as library content. |
| P3 | **Browser walk-through** of the tab | Dev + Team | Never seen in a browser: Actions cell + ⋮ menu, Fill Form dialogs, Select & Download pickers (all 6 From Nirmaan), progress window + polling, remove-system warning, Details guide, O&M pictures upload. Needs a test login. |
| P4 | ~~Full binder from the button~~ **Fixed + verified 2026-09-23** | Dev | It never finished on screen: `job_id` is a parameter of `frappe.enqueue` ITSELF, so the job's own id never reached `_run_binder_job` — every event and the cached status were written for job `None` while the screen polled its own id. The id now travels as `hod_job_id`. Verified through `enqueue_binder` + the 2-second poll: 73 steps, 168 pages, ready with its token. Clicking it in a browser is still unseen (P3). |
| P5 | ~~Commit~~ **Done** | Team | Committed 2026-09-22 on `hod/feature` in four commits (backend, tab, docs, print-format fixture); not pushed. |
| P6 | **Go live** | Team | `bench migrate` on live (3 doctypes; status options Pending/Form Filled/Completed); the two print formats arrive with the `Print Format` fixture; load the library with `bench --site <site> import-doc` (systems first, then content) or enter it under Packages Settings → Handover Documents — it is NOT shipped as fixtures (owner 2026-09-22); `bench start`/workers must run (binder is a background job). |

---

## 2. The O&M tables (was: pictures to paste)

The workbooks hold 18 of their O&M tables as PICTURES. All of them were extracted, transcribed and written
back into the library as real HTML tables on 2026-09-23 (owner: "all things table only"), and the picture
files were deleted — the library now has **17 tables and 0 images** (Sprinkler's two pictures are one grouped
table). So a value is corrected in the library screen, the text is searchable, and nothing has to be pasted
on another site.

| System | Tables now in the library |
|---|---|
| Electrical (Panel) | Panel Overview · Preventive maintenance schedule · Troubleshooting |
| HVAC | DX troubleshooting · Chilled Water troubleshooting (grouped) · VRF common issues |
| WLD & RRS | routine maintenance + troubleshooting, one pair per manual |
| ACS | System components · Troubleshooting |
| Sprinkler | one grouped troubleshooting table (14 rows in 5 groups) |
| VESDA | Maintenance schedule · Troubleshooting |
| CCTV · Networking | Common issues |

Writing a table into library content (learned the hard way):
- state the borders inline — the content keeps `style` attributes;
- state `color: #000` on `<th>`: Frappe's print CSS greys header text;
- **state the padding `!important`** — `.print-format td {padding: 6px !important}` beats a plain inline
  padding, which is why the first tables printed tall (`padding: 1px 6px !important`);
- put the header row in `<thead>` so it repeats when a table breaks across a page.

The extracted pictures are kept at `~/Downloads/HOD FORMATS/_images/` for comparison; the transcription was
done by eye (no OCR on this machine), so spot-check against the workbook. Two typos were corrected on the way:
"Quartely" → "Quarterly" (VESDA) and "eaking around valve connections" → "Leaking…" (Sprinkler).

---

## 3. Known gaps (behaviour today)

**Users will notice first:** G1 (repeated Commission reports), G4 (private Drive links).
**Owner decisions:** G10, G11. The rest are limits to know about, not bugs.

### 3a. Where the data comes from

| # | Gap | Effect | Possible fix |
|---|---|---|---|
| G1 | Commission tasks repeat per zone/floor with **no zone label** | Maconns Noida shows "AHU/CSU Commissioning Report" ×5 — the user cannot tell them apart in the picker | Show the zone from `response_data.zones` / task comments, or the Commission Report adds a zone field |
| G2 | **Hand-added snags** (no batch) cannot be ticked or printed | None exist today; a project with only hand-added snags would show Snag List as empty | Print format support for "no batch", or a whole-project option |
| G3 | **Snag List is project-wide**, not per system | Every system's binder carries the same ticked batches (snag categories are free text) | Map snag categories/areas to systems |
| G4 | **As Built Drive links must be shared "anyone with the link"** | A private Drive file fails; the binder names it in "could not include" | Detect + warn in the picker, or store drawings as Nirmaan files |
| G5 | ~~TDS items are filtered by package only~~ **Fixed 2026-09-24** | `tds_items` now narrows by `source_keywords` (category OR item name) where the package is SHARED -- `sources.tds_belongs` + `from_app.package_is_shared`. Only Critical Room ELV qualifies; a one-system package keeps every item, because a TDS category names the PART ("IP Cameras" holds no "CCTV"). Live check: 872 -> 838 items over 21 projects x 11 systems, all 34 removals on GSS/VESDA/WLD & RRS, nothing orphaned. | 4 unit tests |
| G6 | **Design Tracker categories have no Work Package** on this site | As Built is matched by category NAME ("Electrical", "Fire Sprinkler" → Sprinkler, "Data Networking" → Networking); ELV/BMS/Overall Project by keywords. Renaming a category breaks the match | Fill `Design Tracker Category.work_package` (the rule prefers it automatically) |

### 3b. Downloads

| # | Gap | Effect | Possible fix |
|---|---|---|---|
| G7 | **Realtime events do not reach the browser** in this setup | Progress is polled every 2 s while a job runs (works, extra requests) | Fix the socket setup; the poll can stay as fallback |
| G8 | **Binder speed** | ~46 s for 141 pages (TDS downloads + ~5 s per Commission report cold); job timeout 15 min | Cache rendered Commission reports; parallel renders |
| G12 | **One download job per user at a time** | A second binder/content download waits until the first finishes | Queue per user |

### 3c. Behaviour to decide (owner)

| # | Gap | Effect | Possible fix |
|---|---|---|---|
| G9 | **Removing a system deletes its rows and uploaded files** | Irreversible (the screen warns and needs "Remove anyway") | Soft delete / archive |
| G10 | **Checklist PDF prints YES only for Completed** | Form Filled prints blank | Owner decision |
| G11 | **Warranty and Completion keep separate commissioning dates** | Completion borrows the warranty's date only when its own is empty at save | One shared date on the system |

### 3d. Going live

| # | Gap | Effect | Possible fix |
|---|---|---|---|
| G13 | **The library is loaded by hand, not by migrate** | It is exported to `fixtures/hod_system.json` + `hod_library_content.json`, but NOT listed in the hooks `fixtures` (owner 2026-09-23), so a migrate neither imports nor overwrites it | Load it deliberately: `bench --site <site> import-doc …/hod_system.json` then `…/hod_library_content.json`; re-export after on-screen edits |

**4 Material Data Sheet opens the TDS tab's own "Confirm TDS Export" dialog (2026-09-24, owner).** HOD
builds no TDS picker any more: `MaterialTdsDialog` hands the shared `TdsExportDialog` the items the server
approved for the system (`get_from_app_sources`, i.e. package + keywords) out of the TDS tab's own list, and
the export runs the real `export_tds_report` job -- so a handover data-sheet pack is the same document, with
the same stakeholder cover, as one exported from the TDS tab. The ticks are saved to `form_data.selected` on
export and seed the dialog next time (new optional `initialSelectedIds`; absent = the TDS tab's unchanged
"every Approved item" default). The settings mapping moved to the shared `data/tds/tdsSettings`. LEFT OVER:
`forms/SourcesView.tsx`'s `meta.source === "tds"` branch is now unreachable -- delete it with R3.

**The binder's Material Data Sheet IS the project's TDS report (2026-09-24, owner).** `api/hod/tds_pack.py`
applies the screen's filters server-side -- package + `source_keywords` (`from_app.tds_items`) then the ticks
(`form_data.selected`) -- and hands them to the TDS tab's OWN renderer, `tds_report.build_tds_report_pdf`
(split out of `run_tds_export_job`, one renderer for both callers). So section 4 of a binder is the same
document the dialog downloads: stakeholder cover, its own table, the data sheets merged in. It is ONE binder
step (`kind: "tds"`) and it SKIPS the HOD "(list)" page every other From Nirmaan document gets, because the
report brings its own. Measured on KOLKATA-PROJ-00102: Electrical 141 pages, WLD & RRS 15, CCTV 15; ticking
2 of WLD's 5 gives 8 pages. Two traps: the server-side stakeholder mapping in `tds_pack._ROLES` must stay in
step with the frontend's `tdsSettings.ts` (three field names are misspelled in the doctype), and `fields=["*"]`
returns `datetime`s that the report's `json.dumps` refuses -- `report_items` round-trips through
`frappe.as_json`. A project with no TDS Repository set up cannot build the pack, and the binder names it.
The dialog also has **Save selection** beside Export PDF (`onSaveSelection`, HOD only), so the binder's
contents can be set without downloading anything.

**`status` IS the handover checklist answer now — YES / NO / NA, picked by hand (owner 2026-09-24).**
It REPLACED the derived Pending / Form Filled / Completed: `derive_status` is deleted, the doctype field
is `read_only: 0` with options `YES\nNO\nNA` and default **NO** (no blank option — with that default,
"not answered" IS NO). The controller stopped computing it and now GUARDS it: **YES is refused on a
document that has not been saved** (`checklist.can_be_yes` → `is_saved`), so a Desk edit obeys the same
rule as the screen; NO and NA are never gated. **The binder carries YES rows only**; NO and NA stay on the
printed checklist with their answer and no pages follow them. "Form Filled" survives as the derived
boolean `is_saved` — one rule for all three kinds (a form's entries, a library text's included parts, a
From Nirmaan document's ticked records), mirrored in the frontend as `hodRules.isSaved` (ADR-0010 F1).
On screen it is a PILL with an edit icon opening a small dropdown; the YES entry reads "Save <document>
first" when the row is not saved, and picking it anyway opens a refusal dialog with an "Open it now"
button. The **Remarks column left the SCREEN but stays on the PAPER** (owner): nothing on the tab fills
it, and the printed checklist prints the column so it can be written on by hand at the handover.

**No backfill script (owner 2026-09-24 — localhost only, the feature has not gone live).** Rows still
carrying the retired Pending / Form Filled / Completed HEAL themselves: the one reader
`checklist.normalise_status` turns anything that is not an answer into **NO**, and it is used at all
three places a status is read — the controller, the tab's read and the printed checklist — so such a row
shows NO at once and is written back as NO the next time it is saved. The heal lands in time only
because `run_before_save_methods` (our validate hook) runs BEFORE Frappe's own Select check
(`_validate`); pinned by test.
⚠️ **`bench migrate` is still required** — until the doctype syncs, the DATABASE still offers only the
retired options and Frappe refuses every YES / NO / NA write before our code sees it (measured: the DB
field read `options='Pending\nForm Filled\nCompleted', default='Pending', read_only=1` while the JSON
had already changed). The file's `modified` was bumped, so the sync will pick it up.

**NO handover document carries a signed upload any more (2026-09-24, owner — From Nirmaan first, then
widened to the library texts and the forms).** Every document is either read live from Nirmaan or
generated by it, so it is previewed and downloaded from this screen and then ticked off: the Actions cell
is "Download" / "Select & Download" + **"Mark as Completed"**, and the ⋮ menu offers "Mark as pending" to
undo it. A blank fillable document still leads with "Fill Form". The mark is stored as
`form_data.completed` and read by `checklist.derive_status`, so status stays DERIVED — nothing writes
`status` by hand. Ticking reports for download (`form_data.selected`) is NOT completing the document.
**A marked document stays EDITABLE** (a tick is not a signature); only an older row's uploaded copy
freezes the form behind it.
**A From Nirmaan document is marked off only AFTER its records were reviewed (owner 2026-09-24):**
"Mark as Completed" is DISABLED on those six until a selection has been saved on the row
(`Array.isArray(form_data.selected)`), and the button says what to do first. Saving IS the review, so
every From Nirmaan picker now has a **Save selection** button that costs no PDF -- `SourcesView` for the
five record documents, the export dialog's own for Material Data Sheet. A document Nirmaan GENERATES
(form / library text) has nothing to review -- the person is looking at the finished thing -- so it can
be marked straight away. ⚠️ This gate is FRONTEND-ONLY: `derive_status` completes on the mark alone, so a
Desk edit or a direct `update_row` can still mark an unreviewed From Nirmaan document.
**The whole signed-copy path is DELETED, code-side (owner 2026-09-24, in two steps: first the picker,
then the field).** Gone: the hidden `<input type=file>`, `onUpload` / `uploadSigned` / `useFrappeFileUpload`,
"Upload Signed", "Replace signed copy", "Remove signed copy", "View Signed", `HodRow.attachment`, the
`attachment` entry in `ROW_FIELDS` / `EDITABLE_FIELDS`, the binder's signed-copy branch and
`checklist.PART_UPLOAD`. **`derive_status` now takes TWO arguments** (`document, form_data`) — the old
3-argument call raises `TypeError`, pinned by test, so no caller can pass a file and have it silently
ignored.
⚠️ **PHASE 1 ONLY — the doctype still has the field.** `Project HOD Document.attachment` (Attach) is in
`project_hod_document.json` and in `field_order`, and on localhost ONE of 176 rows still holds a value
(3 `File` rows attached). Nothing reads it any more. The owner finishes it the way `Project Payments.tds`
was finished: remove the field in Desk → `bench migrate` → check Desk reports / list views → `trim-tables`
for the orphan column. HOD has not gone live, so no real signed copy exists to lose.
⚠️ A document can be marked completed while having NO content to include; the binder then refuses to
start and names it (switch it off instead). The mark is a human statement, not a content check.

Intentional (not gaps): the **Download binder button is VISIBLE** again (`SHOW_BINDER_BUTTON = true` in
`hodApi.ts`, owner 2026-09-24; hidden 2026-09-23 while the binder was unproven) — it stays DISABLED until
every switched-on document is Completed; anything left empty on the Maintenance Checklist (Result, Remarks, Comments, DATE) prints
blank to fill by hand; Inventory prints 8 blank rows when empty (fits one landscape page); a tool with no remark prints an empty
Remarks cell; Do's & Don'ts goes Pending → Completed with no "Form Filled"; status is never set by hand.

---

## 4. Not covered by automated tests

| Area | Today | Missing |
|---|---|---|
| Pure rules (`services/hod/*`) | 35 unit tests | — |
| Frontend rules (`hodRules.ts`) | 11 vitest | — |
| Endpoints (`api/hod/project_hod.py`) | manual scripts only | add_systems (all-or-nothing), remove_system (force), update_row (disabled lock, derived status) |
| Binder (`api/hod/binder.py`) | manual scripts on real data | build_plan / selection / empty reasons with fixtures |
| Print (`print_context.py` + the two formats) | manual renders through the real print path | a render smoke test (no Jinja leaks, page counts) |
| Controller | none | derived status on save, switched-off lock |

Tests run against the LIVE localhost DB: own fixtures only, rolled back — and note `frappe.get_print` COMMITS, so
print tests need their own cleanup.

---

## 5. Refactor list

| # | Item | Why |
|---|---|---|
| R1 | ~~Refresh the HOD docs~~ **Done 2026-09-22** | `handover-documents-execution.md` rewritten as one current "As built" + a superseded table; `handover-documents-plan.md` rulings, schema, build phases and decisions brought up to date |
| R2 | **Split `SystemChecklist.tsx` (554 lines)** | Header/binder buttons, the table row, and the remove dialog into their own components |
| R3 | **Split `forms/SourcesView.tsx` (510 lines)** | One table component per source (Commission, TDS, Snag, As Built) + a shared tick/footer |
| R4 | **Split `forms/TableForms.tsx` (489 lines)** | Escalation, RowsTable (Attic/Key), Inventory into separate files |
| R5 | **Split `api/hod/binder.py` (436 lines)** | `binder_plan.py` (what goes in, pure-ish) vs job/rendering/prefetch |
| R6 | **Rename `useHodBinder` → `useHodDownloadJob`** | It now runs the binder AND single-document content downloads |
| R7 | **Move `ReportPreviewDialog` to `components/common`** | HOD imports it from `pages/CommissionReport` (cross-feature import) |
| R8 | **Parity test for `dlpEnd`** | `hodRules.dlpEnd` duplicates `services/hod/dates.dlp_end` (ADR-0010 F1) with no pin between them |
| R9 | **Move `EMPTY_REASON` next to the rules** | Binder "nothing to include" reasons live in the API module |
| R10 | **Cache the design-category → system map** | `design_handover_tasks` re-reads all categories and systems on every call (6× per binder) |
| R11 | **Print formats drift** | The pasted DB copy and the repo file can differ silently (it happened today); add a check or ship them as fixtures |
| R12 | **Pre-existing residence failures** | F5 117/115 and F2 211/207 are older than HOD (HOD adds none); not part of this refactor |
| R13 | **Stale comment on `checklist.PART_SOURCES`** | Says "the HOD Document list page, then the records it lists"; the binder now includes only the records (`binder._content_steps`) |

---

## 6. Unused after the 2026-09-24 changes — to review separately

Nothing here is broken. Each one is something the code no longer uses, kept so the owner can retire it
deliberately in one pass (the `Project Payments.tds` pattern: detach the code first, drop the schema after).

| # | What | State | To finish it |
|---|---|---|---|
| U1 | **`Project HOD Document.attachment`** (Attach) | **Code AND doctype JSON done 2026-09-24** (owner asked for the JSON too). Deleted: the picker, `onUpload`, `uploadSigned`, `useFrappeFileUpload`, "Upload Signed" / "Replace signed copy" / "Remove signed copy" / "View Signed", `HodRow.attachment`, the `ROW_FIELDS` / `EDITABLE_FIELDS` entries, the binder's signed-copy branch, and the field + its `field_order` line in `project_hod_document.json`. `derive_status` takes TWO arguments now (a 3-argument call raises `TypeError`, pinned by test). **`modified` was bumped in the JSON on purpose — Frappe's doctype sync SKIPS a file whose timestamp has not moved, so the edit would otherwise be silently ignored by `bench migrate`.** | **Owner still owes the runtime side:** `bench --site <site> migrate` → check Desk list views / reports for a reference to the dropped column — the column and its data SURVIVE a migrate, so on localhost **1 of 176 rows** keeps its value and **3 `File` rows** stay attached → `bench --site <site> trim-tables` to drop the orphan column, and decide what happens to those `File` rows. HOD has not gone live, so no real signed copy exists to lose. |
| U2 | **`checklist.binder_parts`'s third element** (`PART_PAGE` / `PART_SOURCES`) | Computed on every binder build and **thrown away** — its one caller does `for sno, row, _part in parts`. `_content_steps` decides everything now. | Either consume it or reduce `binder_parts` to `(sno, row)` and delete both constants. Touches R13 (its stale comment). |
| U3 | **`forms/SourcesView.tsx`'s `meta.source === "tds"` branch** | Unreachable since Material Data Sheet moved to the shared "Confirm TDS Export" dialog — `SystemChecklist` routes `material_tds` to `MaterialTdsDialog`, so this table never renders. ~9 lines reference `tds` (the column block, the `has-a-sheet` filter, the `HodTdsItem` import, the NOUNS / WHERE entries). | Delete with **R3** (the `SourcesView` split), not on its own — the file is 545 lines and is being split anyway. |
| U4 | ~~`checklist.PART_UPLOAD`~~ | **Deleted 2026-09-24** with the upload itself; a test now asserts the constant is gone. | — |
| U5 | **`form_data.completed`** | The retired hand mark. Nothing writes it; it is listed in `checklist._META_KEYS` purely so `is_saved` does not mistake a leftover flag for a saved document (a test pins that). Old rows on localhost still carry it. | Clear the key from `form_data` in the same pass as U1, or leave it — it is inert and the meta-key guard is cheap insurance either way. |
| U6 | **`Project HOD Document.remarks`** | Off the SCREEN since 2026-09-24 — nothing on the tab writes it. The printed checklist still prints the column (to be written on by hand), and a Desk edit could still fill it, so the field is NOT dead. | Nothing to do unless you want the printed column to stop reading the stored value. |

**Checked and NOT unused** (so nobody re-reports them): `components/hod-library.tsx` (Packages Settings
lazy-loads it), `HOD_DOCTYPE` / `HOD_PRINT_DOCUMENT` / `HOD_PRINT_CHECKLIST` (read by `hodDownloads.ts`),
`EMPTY_REASON[SRC_TDS]` (still reached when a system has no TDS item), `checklist.is_untouched`
(`project_hod` counts and the remove-system guard).
