# Handover Documents (HOD) — execution record

Companion to `handover-documents-plan.md` (the design and the owner's rulings) and `handover-documents-gaps.md`
(what is still open). Written 2026-09-21 as the order of work; **rewritten 2026-09-22 to describe what was
actually built**. Branch `hod/feature`: committed, not pushed. The three doctypes are
migrated on localhost.

Who: **Claude** writes code + tests and dry-runs; **you** run `bench migrate`, paste the print
formats in Desk, give a browser test login and commit; **owner** makes the rulings.

---

## Where each step stands

| Step | What | State |
|---|---|---|
| 0 | Decisions D1–D9 | all settled (below) |
| 1 | 3 doctypes + the 16-document index | built; migrated on localhost |
| 2 | Import the Excel formats into the library | **dropped** (owner 2026-09-22): the library is created on screen on each site |
| 3 | Tab, system tabs, checklist | built |
| 4 | The four forms | built |
| 5 | Template documents (O&M, Do's & Don'ts, Maintenance, Tools, Warranty, Completion) | built |
| 6 | Documents from Nirmaan (read-only) + Select & Download | built |
| 7 | Print formats "HOD Document" + "HOD Checklist" | built; pasted in Desk on localhost (they match the repo files) |
| 8 | Binder + single-document content download | built; tested by running the job directly, not yet from the button |
| 9 | Tests | 35 Python unit tests + 11 vitest pass; endpoints, binder and print have no automated tests (gaps §4) |
| 10 | Rollout | pending: gaps P2–P6 |

## Decisions

| # | Decision | Outcome |
|---|---|---|
| D1 | 3 doctypes `HOD System`, `HOD Library Content`, `Project HOD Document` | approved, built |
| D2 | `Project HOD Document.disabled` + `HOD System.default_disabled_documents` | approved, built |
| D3 | The switch replaces NA | yes: switched-off rows are not printed and the S.No closes up |
| D4 | An uploaded signed copy replaces the generated page in the binder | yes, and for From Nirmaan documents too (no duplicate of the reports it certifies) |
| D5 | Corporate address | "No.234, 1st Floor, 9th Main, 16th Cross, 6th Sector, HSR Layout" (same as Commission Report) |
| D6 | Completion Certificate signature | wet signature (empty "AUTHORIZED SIGNATURE" box) |
| D7 | Footer label | "<SYSTEM> CONSULTANT" |
| D8 | Who may edit | doctype permissions: System Manager, PMO Executive, Project Lead, Project Manager write/create/delete; the other Nirmaan roles read |
| D9 | Systems that share a package (Critical Room ELV = GSS, VESDA, WLD & RRS) | `HOD System.source_keywords` added |

Owner rulings made during the build (2026-09-22), all built:
- No bench command or import button. The library is created on each site; it is NOT shipped as fixtures
  (owner 2026-09-22). Since 2026-09-23 it is managed in the app, under Packages Settings → Handover Documents (owner).
- The O&M Manual is a library document: no form, no project pictures (owner 2026-09-23). Its blanks and part
  ticks are still edited from the row's ⋮ menu.
- Empty state is a Commission-style "Not Found" card. Its dialog adds several systems at once.
- The checklist fits on one page with Commission-style signature columns.
- The VENDOR / PROJECT / LOCATION / DATE / PACKAGE header block goes only on Checklist, Escalation Matrix,
  Maintenance Checklist, Inventory, Attic, Key List and Warranty (Warranty's date row = COMMISSIONING DATE).
- From Nirmaan documents download their CONTENT (the actual reports), not a list page.
- The binder does not start while a switched-on document has nothing in it: it lists them and offers to switch
  them off. It shows progress.
- Removing a system that has entries warns and asks for confirmation instead of refusing.
- Status is the handover checklist ANSWER, picked by hand: **YES / NO / NA** (owner 2026-09-24, replacing the
  derived Pending / Form Filled / Completed). The Actions cell is three buttons.
- A "Details" guide sits beside Edit library.
- All six From Nirmaan documents get "Select & Download".
- A document the project FILLS is labelled "Form" wherever its text comes from (`hodRules.documentChip`, used
  by the checklist and the library screen): the Recommended Tools List and the Maintenance Checklist are Forms,
  the O&M Manual and Do's & Don'ts are Library.
- The Recommended Tools List has Remarks per tool, filled on screen (owner 2026-09-22).
- The binder downloads only when every switched-on document is Completed, with no dialogs (progress runs on
  the button). Its button is then HIDDEN for now: one flag, `SHOW_BINDER_BUTTON` in `hodApi.ts`, hides the
  button and its part of the Details guide; the endpoint and the job are untouched (owner 2026-09-23).
- Only finished records are offered for handover (owner 2026-09-23): Commission tasks Submitted / Client
  Accepted, As Built drawings Submitted / Approved — the rule lives in `services/hod/sources`
  (`commission_is_done`, `design_is_done`). The **snag list is the exception** (owner 2026-09-25): it goes
  over in full, open snags included, so no snag status filter exists at all — `SNAG_DONE` was removed and
  neither `snag_batches`, `snagBatchPdfUrl` nor the binder sends a `statuses` param.
- The Escalation Chart takes as many levels as a project adds ("Add level"), labelled by position; the
  Equipment Warranty prints the same list (owner 2026-09-23).
- The Maintenance Checklist is filled on screen (owner 2026-09-22): Result + Remarks per check, Comments per sheet, date of the check.

---

## As built (2026-09-22)

### Data

| Doctype | Fields |
|---|---|
| `HOD System` (library, name = `system_name`) | `system_name`, `display_name` ("ELECTRICAL SYSTEM", printed as PACKAGE), `work_package` (Link Work Packages), `is_active`, `warranty_equipment`, `tools`, `default_disabled_documents` (document keys, one per line), `source_keywords` (one per line) |
| `HOD Library Content` (library) | `hod_system`, `document` (O&M Manual / Do's & Don'ts / Maintenance Checklist), `sub_system` (blank = always included), `display_order`, `title`, `content` (Text Editor, may hold `[Blank]` placeholders and pictures), `list_1` / `list_2` (Do's / Don'ts, half-yearly / yearly items). `make_attachments_public` = 0 |
| `Project HOD Document` (one per project × system × document) | `project`, `hod_system`, `document` (the 16 keys), `status` (Select `YES\nNO\nNA`, default **NO**, writable), `disabled`, `remarks`, `form_data` (JSON). The `attachment` field for a signed copy was retired with the upload itself (2026-09-24) |

There is no parent record. A project's system tabs are simply the systems that have rows.

What each document keeps in `form_data`:

| Document | Keys |
|---|---|
| Escalation Chart | `date`, `levels` — as many as the project adds (3 by default), each name / designation / phone / email |
| Inventory List | `date`, `materials` (column names), `locations` (`name`, `qty[]`) |
| Attic Stock List | `date`, `rows` |
| Key List | `date`, `rows`, `receiver`, `belongs_to` (default the project customer) |
| O&M Manual | `included` (sub-systems), `blanks` (name → value) |
| Maintenance Checklist | `included`, `date` (of the check; empty prints blank), `checks` (per part and period: `results` = item text → `result` OK / Not OK / NA + `remarks`; `comments`) |
| Equipment Warranty | `equipment` (default the system's list), `commissioning_date` |
| Completion Certificate | `commissioning_date`, `handed_over_to` (default the project customer) |
| The six From Nirmaan documents | `selected` (record names ticked for download; absent = all) |
| Recommended Tools List | `tool_remarks` (tool text → remark; printed in the Remarks column) |
| Do's & Don'ts | nothing |

### The status rule

`status` IS the handover checklist answer, and a person picks it (owner 2026-09-24). Nothing derives it:
`derive_status` is deleted, and there is no Pending / Form Filled / Completed any more.

- **YES** — handed over. It is the one answer that costs something, so it is GUARDED: a document with
  anything to save must have been saved first (`checklist.can_be_yes` → `needs_saving` + `is_saved`).
  A form has its entries and a From Nirmaan document its ticked records, so both must be saved; a library
  text (O&M Manual, Do's & Don'ts) holds the library's own content, which a project adds nothing to, so it
  is answerable as it stands.
- **NO** — not handed over. The **default** a row is created with, so "not answered" reads as NO and there
  is no blank option.
- **NA** — not applicable to this project.

`update_row` accepts a status and the controller guards it; the screen refuses YES the same way and says
what to save. Anything unrecognised — a blank, or a row still carrying a RETIRED
Pending / Form Filled / Completed — reads as NO through `normalise_status` and is written back as NO on
its next save, which is why no backfill script was needed.

A switched-off row is a separate thing from NA: it leaves the printed checklist entirely and the S.No
closes up, while NA stays on the sheet with its answer.

### Backend

- `services/hod/` (pure, ADR-0010 B1) + `test_hod_services.py` (35 tests):
  - `index`: the 16 documents (key, S.No, title, kind, `fill`, `landscape`, library / source).
  - `checklist`: status rule, `is_untouched`, `counts`, S.No close-up (`printable_rows`), `binder_parts`.
  - `blanks`: `[Blank]` find / fill.
  - `dates`: DLP end.
  - `escalation`: the chart's levels — a project's own list, labelled by position ("4th Level").
  - `maintenance`: the Maintenance Checklist sheets (one per part and period) with the project's results.
  - `sources`: Commission buckets, whole-word keywords, default sub-system ticks, `commission_binder_source`,
    `drawing_download_url`, `design_category_belongs`.
- `integrations/controllers/project_hod_document.validate`, wired in `hooks.py` doc_events:
  - the key must be one of the 16, and a new row needs an active system;
  - one row per project × system × document, backed by a unique index;
  - it derives the status;
  - a switched-off row keeps its remarks, attachment and form_data locked.
- `api/hod/project_hod.py` (tab endpoints):
  - `get_project_hod`: the payload includes `library_empty`, `can_edit_library` and per-system counts, including `touched`.
  - `add_systems(project, hod_systems)`: all or nothing, one commit.
  - `remove_system(project, hod_system, force)`.
  - `update_row(name, patch)`: switch, remarks, attachment, form_data.
  - `get_system_library`.
- `api/hod/from_app.py`: read-only Commission / TDS / Snag / Design reads, plus `get_from_app_sources`.
- `api/hod/print_context.py`: the two `hooks.jinja` methods, `hod_print_context(doc)` and `hod_checklist_context()`.
- `api/hod/project_info.py`: the header values, read in one place.
- `api/hod/library.py`: `get_hod_library` — one read for the library screen (systems + their blocks + the 16
  documents + Work Packages + how many projects use each system) and `preview_row` — the newest project row
  of a document, so the screen can print it as a preview. Its writes are ordinary document calls.
- `api/hod/binder.py`:
  - `check_binder`, `enqueue_binder(project, hod_system, document=None)`, `get_job_status(job_id)`;
  - the job runs on the `long` queue with a per-user lock and a 15-minute timeout.
- Fixtures: the two print formats ride the existing unfiltered `Print Format` fixture. The library is
  exported to `fixtures/hod_system.json` + `fixtures/hod_library_content.json` with
  `bench --site localhost export-json "<doctype>" <path>` (NEVER `bench export-fixtures`: it rewrites every
  fixture file, Expense Type included), but it is deliberately NOT in the hooks `fixtures` list
  (owner 2026-09-23) — a migrate neither imports nor overwrites it, and another site loads it with
  `bench --site <site> import-doc`, systems first.

### Screen (`frontend/src/pages/HandoverDocuments/`)

- `HandoverDocumentsTab`: the system tabs, an **ⓘ** beside the heading (the `HodGuideDialog` guide),
  **Header logos**, **+ Add system**, and a **"…"** menu holding **Edit library** (opens Packages Settings →
  Handover Documents). While no HOD System exists it points there instead. Each tab's count badge turns green
  once that system is fully answered. See the layout pass below for why the menu exists.
- `NoHandoverDocumentsView`: the Commission-style "Not Found" card with "Create Handover Documents". It opens
  `AddSystemDialog`, which is multi-select and lists the project's own packages first.
- `SystemChecklist`: one system's 16 rows showing:
  - the **Use** switch, S.No (closed up), the status badge, remarks and the Actions cell;
  - a card header carrying the system name, its work-package chip, a progress bar with
    `n of 16 answered YES` (plus NA / switched-off chips), and the buttons **Checklist PDF** and
    **Download binder**. **Remove system** is in that header's **"…"** menu; it warns when `touched` > 0,
    then sends `force`.
- `HodActionCell`: three buttons and nothing else (owner 2026-09-24 — the status menu moved to its own
  column and the signed upload was retired):

  | Button | What it does |
  |---|---|
  | **Edit** | opens the document — the form, or the From Nirmaan records. A library text does not get it (its content is the library's) |
  | **Preview** | shows the row's "HOD Document" print on screen |
  | **Download** | saves it |

  For a From Nirmaan row the "HOD Document" print is the page LISTING its ticked records, so Preview shows
  that and **Download** is what builds the records themselves. (Routing Preview through the build was tried
  and reverted on 2026-09-25 — `build_plan` refuses a document that is not answered YES, which is every row
  worth previewing.) The cell takes `busy` (disable — any build blocks every From Nirmaan row) and
  `working` (spin — this row's own work only).
- `DocumentDialog`: routes to the right form:
  - `forms/TableForms`: Escalation, Attic, Key List, Inventory matrix;
  - `forms/TemplateForms`: O&M blanks + part ticks, Do's & Don'ts, Tools (Remarks per tool), Warranty, Completion;
  - `forms/MaintenanceForm`: part ticks, date of the check, Result (OK / Not OK / NA) + Remarks per item and
    Comments per sheet;
  - the O&M "Pictures for this project" field is REMOVED (owner 2026-09-23); the print side can still show
    `form_data.pictures` if a row ever holds any, but nothing writes them now;
  - `forms/SourcesView`: tick tables for the From Nirmaan records. Each row has a View action, and the footer
    has "Download selected (N)".
- Supporting modules:
  - `hodApi`: every call and SWR key.
  - `hodDownloads`: PDF URLs, `usePdfDownload`, `saveUrlAs`.
  - `useHodBinder`: enqueue, socket events + a 2-second `get_job_status` poll, finish-once guard. The
    finished PDF is always SAVED (`fetch_temp_file` spends its one-shot token).
  - `HodDownloadDialogs`: the progress window and the "nothing to include" list.
  - `hodRules` (pure, 11 vitest).
  - `library/`: the Packages Settings → Handover Documents screen — `HodLibraryMaster` (systems, their settings and text
    blocks), `SystemDialog` (tools, warranty equipment, default switched-off documents as ticks, keywords),
    `ContentDialog` (manual text with preview, or the two lists), `hodLibraryApi`.
  - `types`.
- `handoverIndex.ts` is deleted: titles, kinds and order come from the API.

### Layout pass (2026-09-28)

The tab carried seven same-weight buttons across two header rows, and the actions that act on ONE system sat
in an unframed row above the table, so nothing on screen said which tab a download belonged to.

- **Page header** — the guide became an **ⓘ** beside the heading (it is help, not an action, and it was
  taking a slot in the action row). **Header logos** and **+ Add system** stay as buttons — Header logos is
  used often enough to be one (owner 2026-09-28) — and **Edit library** alone moved behind a **"…"**, which
  is hidden entirely for anyone who cannot edit the library.
- **System card** — the system header and its table are now ONE bordered card, so its actions read as the
  ACTIVE tab's. The work package became a chip instead of trailing prose, and the counts became a progress
  bar with `n of 16 answered YES` plus NA / switched-off chips.
- **Remove system** moved into that card's **"…"**. It had been sitting directly beside the red **Download
  binder**, which put a 16-row delete one pixel from the primary action.
- **The status menu names what each answer does to the binder** (owner wording, 2026-09-28): `— document goes
  into the binder` on YES, `— document skipped in the binder` on NO and NA. A blocked YES still reads
  `— save <document> first`, which is the only warning before the click. Guide section 3 carries the same
  three lines and spells out that "skipped" means no PAGES — the answer still prints on the checklist, which
  is what `api/hod/binder.py` does (`build_plan` keeps YES rows only).

- **One word for the off state: "Disabled".** The column is headed *Enable / Disable*, so the Actions cell
  now reads `Disabled` (was `Switched off`), and the card chip, the switch tooltip and `DocumentDialog`'s
  read-only note follow it. The guide's "switch **Use** off" was stale on top of that — no control has been
  called *Use* since the column was renamed — and now names the *Enable / Disable* switch. The library
  screens under Packages Settings still say "switched off"; they are a different screen and were left alone.

Screen only: no endpoint, no payload and no status semantics changed. `StatusCell` lost its `meta` prop
briefly when the menu was stripped to bare badges, and got it back when the wording returned.

### From Nirmaan documents

| # | Document | Reads | What the user ticks | What goes into the PDF |
|---|---|---|---|---|
| 2 / 3 / 14 | Demo & Training / Commissioning / Factory Test | **Submitted / Client Accepted** tasks of the system's Work Package, narrowed by `source_keywords`. "training" → 2, "factory test" → 14, every other task (incl. Earthing, Megger, pressure tests) → 3 | each task | its client-signed copy, else the filled report (Commission print format, landscape where the category says so), else its uploaded file |
| 4 | Material TDS | `Project TDS Item List` by `tds_work_package` | each item | its attached data sheet |
| 15 | Snag List | the project's snag batches (whole project), counting **every** snag; only a batch with no snags at all is not listed | each batch | the Snag List print of that batch, unfiltered — open snags included (owner 2026-09-25) |
| 16 | As Built | Design Tracker **Handover-phase** tasks that are **Submitted / Approved**. A category belongs to the system named in it; unclaimed categories (ELV, BMS, Overall Project) go by keywords | each drawing | the drawing, downloaded from its Google Drive link or its stored file |

Nothing is written to those features. The ticks are saved in `form_data.selected`, and Preview, Download
and the binder all build from the same ticks. A picker opens with **nothing ticked** (owner 2026-09-25) —
the person picks the records they want; the header checkbox takes them all in one click.

### Downloads

- **One generated document**: Frappe's `download_pdf` with format "HOD Document" on the row.
- **Checklist PDF**: format "HOD Checklist" on the project, with `&hod_system=`.
- **One From Nirmaan document's content**: `enqueue_binder(..., document=)`. It is a background job, so large
  Commission sets do not time out. It starts with the document's own page — the list that names what follows
  (TDS: item, make, category, status; Commission: the tasks; As Built: the drawings) — and the page lists only
  the ticked records, because `services/hod/sources.selected_items` is read by the print context and the binder
  alike (owner 2026-09-23: a stack of data sheets says nothing about which item each one is for).
- **Binder**:
  1. The button unlocks only when every switched-on document is Completed (owner 2026-09-23), so nothing in
     it can be empty; there is no pre-check dialog and no progress window — the button counts the steps.
     `check_binder` stays as the read that says which document is empty and why, and `enqueue_binder`
     refuses an empty one on its own.
  2. The job renders the cover and the checklist, then all divider pages in one pass. For each switched-on
     document, in S.No order, it adds a divider, then the uploaded copy OR the generated page OR the ticked records.
  3. Attached files are prefetched on 6 threads while pages render. Each file is fitted to A4 and everything is
     merged with pypdf.
  4. Progress is reported per step. Every event is also written to the cache under the job_id; the screen polls
     `get_job_status` every 2 s because realtime events do not reach the browser here. The finished file downloads
     through a one-time token (`pdf_helper.bulk_download.fetch_temp_file`).
- Rendering uses `frappe.get_print` with `_drop_jinja_cache` before each render (the formats read `form_dict`).
  **`frappe.get_print` commits the transaction.**

### Print formats (pasted in Desk; source in `print-formats/hod-document.html` and `hod-checklist.html`)

- One "HOD Document" format with a block per document and shared macros for the header block, signatures and footer.
- The header block appears on 7 documents only (see the owner rulings). The Maintenance Checklist prints the team's results, remarks, comments and date of the check;
  whatever is left empty prints blank.
- Checklist: one page, Commission-style signature row. It prints **YES only for Completed**.
- Inventory is landscape, via a top-level `.print-format { orientation: Landscape; }`.
- Blank rows when nothing is entered: Attic 14, Key List 8, Inventory 8, so each fits one page.
- Rules that took a while to find:
  - Custom HTML ignores the Print Format margin fields. The top-level `.print-format{margin-*}` rule becomes the
    wkhtmltopdf margins, and `div.print-format{margin:0 auto !important}` cancels it as CSS.
  - Frappe forces `td{padding:6px !important}`; `.print-format .hd-table td{… !important}` overrides it.
  - The footer uses `class="letter-head-footer"`.
  - Inside `#header-html` / `#footer-html` use a Jinja comment `{# #}`, because an HTML comment prints as text.
  - The Jinja environment is DebugUndefined, so every value goes through the `v()` macro.
- A picture pasted into library content would be a private file, embedded as a data URI at print time
  (`embed_stored_images`); the library holds none today — its tables are HTML.
- Writing a table into library content: borders inline, `color:#000` on `<th>` (the print CSS greys it),
  padding `!important` (`.print-format td{padding:6px !important}` beats a plain inline padding and printed the
  rows tall), and the header row in `<thead>` so it repeats across a page break.

### Library

- Created and edited under Packages Settings → Handover Documents (Desk still works). It travels as the two
  exported fixture files, loaded on another site with `import-doc` — never by migrate (see Fixtures above).
- On localhost, 11 HOD Systems and 44 HOD Library Content blocks were inserted directly from the owner's Excel
  formats by a one-off script that is not in the repo. `hod_seed/`, `scripts/hod_build_seed.py` and
  `api/hod/import_formats.py` are deleted.
- The O&M tables that the workbooks hold as PICTURES are now REAL TABLES in the library (owner 2026-09-23):
  all 18 were extracted, transcribed and written back as HTML tables under their own heading, and the picture
  files were deleted — the library has 17 tables and 0 images (Sprinkler's two pictures are one grouped table).
  So a value can be corrected in the library screen instead of in the workbook, and the text is searchable and
  printable rather than a screenshot. Each table carries inline borders (the library content keeps them), states
  its header colour (Frappe's print CSS greys `th`) and puts the header row in `<thead>` so it repeats when a
  table breaks across pages. The extracted pictures are kept at `~/Downloads/HOD FORMATS/_images/`.

### Verified (localhost, real data)

- Maersk Kolkata full binder: 141 pages in 46 s. Commissioning content was 5 reports / 14 pages; ticking 2
  reports gave 10 pages.
- Paytm Bangalore snag batch print: 6 pages.
- KANCHIPURAM-PROJ-00070: 19 Electrical As Built drawings downloaded from Drive and merged.
- `check_binder` lists the empty documents. `add_systems` is all-or-nothing. Statuses are derived on save and on read.
- All 16 documents and the checklist render through the real print path. tsc shows no errors in HOD files.
  The residence check adds nothing.

### Not verified yet

- The browser walk-through (needs a test login).

### Trap found on 2026-09-23 (fixed)

`job_id` is a keyword parameter of `frappe.enqueue` itself (the RQ job id), so passing `job_id=` to
`frappe.enqueue` does NOT reach the enqueued function. The binder ran fine and wrote its status and its
ready event for job `None`, while the screen polled its own id and waited forever — the worker log said
"Job OK" the whole time. The id now travels as `hod_job_id`. Verified end to end through `enqueue_binder`
plus the 2-second poll: 73 steps, 168 pages, token returned.

---

## Superseded during the build (kept so older notes make sense)

| Was | Now |
|---|---|
| Step 2: Excel importer + `hod_seed/` + build script | deleted; library created on screen on each site (no library fixtures) |
| Status Pending / Yes (then set by hand) | briefly derived (Pending / Form Filled / Completed, read-only), then replaced 2026-09-24 by the hand-picked **YES / NO / NA** |
| `add_system` (one system) | `add_systems` (several, all or nothing) |
| Remove system refused once anything was entered | warns, removes with `force` after confirmation |
| From Nirmaan binder part = a list page + the records | the records only (the actual reports, sheets, batches, drawings) |
| As Built listed as Drive links on the divider | downloaded from Drive and merged |
| Snag List = one project-wide print | ticked snag batches, one print each |
| Render with `render_template` + `get_pdf` | `frappe.get_print` + `_drop_jinja_cache` |
| Progress by socket only | socket + cache status polled every 2 s |
| Header block on every page | only the 7 documents listed above |
| Library pictures public | private, embedded at print time |
