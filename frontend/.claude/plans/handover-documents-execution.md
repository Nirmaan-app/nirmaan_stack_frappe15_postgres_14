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
- O&M pictures are uploaded by users per project and system, not kept in the library.
- Empty state is a Commission-style "Not Found" card. Its dialog adds several systems at once.
- The checklist fits on one page with Commission-style signature columns.
- The VENDOR / PROJECT / LOCATION / DATE / PACKAGE header block goes only on Checklist, Escalation Matrix,
  Maintenance Checklist, Inventory, Attic, Key List and Warranty (Warranty's date row = COMMISSIONING DATE).
- From Nirmaan documents download their CONTENT (the actual reports), not a list page.
- The binder does not start while a switched-on document has nothing in it: it lists them and offers to switch
  them off. It shows progress.
- Removing a system that has entries warns and asks for confirmation instead of refusing.
- Status is derived from actions: Pending / Form Filled / Completed. The Actions cell follows the Commission Report.
- A "Details" guide sits beside Edit library.
- All six From Nirmaan documents get "Select & Download".
- The Recommended Tools List has Remarks per tool, filled on screen (owner 2026-09-22).
- The binder downloads only when every switched-on document is Completed, with no dialogs (progress runs on
  the button). Its button is then HIDDEN for now: one flag, `SHOW_BINDER_BUTTON` in `hodApi.ts`, hides the
  button and its part of the Details guide; the endpoint and the job are untouched (owner 2026-09-23).
- Only finished records are offered for handover (owner 2026-09-23): Commission tasks Submitted / Client
  Accepted, As Built drawings Submitted / Approved, snags Completed — the rule lives in `services/hod/sources`
  (`commission_is_done`, `design_is_done`, `SNAG_DONE`).
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
| `Project HOD Document` (one per project × system × document) | `project`, `hod_system`, `document` (the 16 keys), `status` (read-only: Pending / Form Filled / Completed), `disabled`, `remarks`, `attachment` (the signed copy), `form_data` (JSON) |

There is no parent record. A project's system tabs are simply the systems that have rows.

What each document keeps in `form_data`:

| Document | Keys |
|---|---|
| Escalation Chart | `date`, `levels` — as many as the project adds (3 by default), each name / designation / phone / email |
| Inventory List | `date`, `materials` (column names), `locations` (`name`, `qty[]`) |
| Attic Stock List | `date`, `rows` |
| Key List | `date`, `rows`, `receiver`, `belongs_to` (default the project customer) |
| O&M Manual | `included` (sub-systems), `blanks` (name → value), `pictures` (`url`, `caption`) |
| Maintenance Checklist | `included`, `date` (of the check; empty prints blank), `checks` (per part and period: `results` = item text → `result` OK / Not OK / NA + `remarks`; `comments`) |
| Equipment Warranty | `equipment` (default the system's list), `commissioning_date` |
| Completion Certificate | `commissioning_date`, `handed_over_to` (default the project customer) |
| The six From Nirmaan documents | `selected` (record names ticked for download; absent = all) |
| Recommended Tools List | `tool_remarks` (tool text → remark; printed in the Remarks column) |
| Do's & Don'ts | nothing |

### The status rule

`services/hod/checklist.derive_status` is the only place status is decided. The controller runs it on every save,
and the API runs it again on read.

- **Completed**: a signed copy is uploaded (`attachment`).
- **Form Filled**: the document has something to fill (`fill` in the index: Escalation, O&M, Maintenance,
  Inventory, Recommended Tools, Attic, Key List, Warranty, Completion) and its saved `form_data` holds real input.
- **Pending**: anything else. Do's & Don'ts and the From Nirmaan documents go straight from Pending to Completed.

Nobody picks a status by hand. `update_row` does not accept one.

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
- Fixtures: only the two print formats, added to `fixtures/print_format.json` (`Print Format` was already an
  unfiltered fixture). `HOD System` / `HOD Library Content` are NOT shipped as fixtures (owner 2026-09-22).

### Screen (`frontend/src/pages/HandoverDocuments/`)

- `HandoverDocumentsTab`: the system tabs, "+ Add system", **Details** (the `HodGuideDialog` guide) and **Edit
  library** (opens Packages Settings → Handover Documents). While no HOD System exists it points there instead.
- `NoHandoverDocumentsView`: the Commission-style "Not Found" card with "Create Handover Documents". It opens
  `AddSystemDialog`, which is multi-select and lists the project's own packages first.
- `SystemChecklist`: one system's 16 rows showing:
  - the **Use** switch, S.No (closed up), the status badge, remarks and the Actions cell;
  - header buttons **Checklist PDF**, **Download binder** and **Remove system**. Remove warns when `touched` > 0,
    then sends `force`.
- `HodActionCell`: the Commission-style Actions cell. Each status has one primary action plus a ⋮ menu:

  | Status | Primary action |
  |---|---|
  | Pending, a fillable document | Fill Form |
  | Pending, anything else | Download (From Nirmaan: **Select & Download**) + Upload Signed |
  | Form Filled | Download + Upload Signed |
  | Completed | View Signed |

  The ⋮ menu offers: view/edit form, view records, Preview PDF, download, and replace/remove/upload the signed copy.
- `DocumentDialog`: routes to the right form:
  - `forms/TableForms`: Escalation, Attic, Key List, Inventory matrix;
  - `forms/TemplateForms`: O&M blanks + part ticks, Do's & Don'ts, Tools (Remarks per tool), Warranty, Completion;
  - `forms/MaintenanceForm`: part ticks, date of the check, Result (OK / Not OK / NA) + Remarks per item and
    Comments per sheet;
  - `forms/PicturesField`: O&M project pictures;
  - `forms/SourcesView`: tick tables for the From Nirmaan records. Each row has a View action, and the footer
    has "Download selected (N)".
- Supporting modules:
  - `hodApi`: every call and SWR key.
  - `hodDownloads`: PDF URLs, `usePdfDownload`, `saveUrlAs`.
  - `useHodBinder`: enqueue, socket events + a 2-second `get_job_status` poll, finish-once guard.
  - `HodDownloadDialogs`: the progress window and the "nothing to include" list.
  - `hodRules` (pure, 11 vitest).
  - `library/`: the Packages Settings → Handover Documents screen — `HodLibraryMaster` (systems, their settings and text
    blocks), `SystemDialog` (tools, warranty equipment, default switched-off documents as ticks, keywords),
    `ContentDialog` (manual text with preview, or the two lists), `hodLibraryApi`.
  - `types`.
- `handoverIndex.ts` is deleted: titles, kinds and order come from the API.

### From Nirmaan documents

| # | Document | Reads | What the user ticks | What goes into the PDF |
|---|---|---|---|---|
| 2 / 3 / 14 | Demo & Training / Commissioning / Factory Test | **Submitted / Client Accepted** tasks of the system's Work Package, narrowed by `source_keywords`. "training" → 2, "factory test" → 14, every other task (incl. Earthing, Megger, pressure tests) → 3 | each task | its client-signed copy, else the filled report (Commission print format, landscape where the category says so), else its uploaded file |
| 4 | Material TDS | `Project TDS Item List` by `tds_work_package` | each item | its attached data sheet |
| 15 | Snag List | the project's snag batches (whole project), counting their **Completed** snags; a batch with none is not listed | each batch | the Snag List print of that batch, filtered to Completed snags |
| 16 | As Built | Design Tracker **Handover-phase** tasks that are **Submitted / Approved**. A category belongs to the system named in it; unclaimed categories (ELV, BMS, Overall Project) go by keywords | each drawing | the drawing, downloaded from its Google Drive link or its stored file |

Nothing is written to those features. The ticks are saved in `form_data.selected`, and the binder uses the same ticks.

### Downloads

- **One generated document**: Frappe's `download_pdf` with format "HOD Document" on the row.
- **Checklist PDF**: format "HOD Checklist" on the project, with `&hod_system=`.
- **One From Nirmaan document's content**: `enqueue_binder(..., document=)`. It is a background job, so large
  Commission sets do not time out.
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
- Library pictures are private files. They are embedded as data URIs at print time (`embed_stored_images`). O&M
  project pictures print only if the File is attached to that row; they are shrunk to 1600 px JPEG and printed
  two per row.

### Library

- Created and edited on each site under Packages Settings → Handover Documents (Desk still works). It is NOT shipped as fixtures (owner 2026-09-22),
  so live needs its systems and content entered there.
- On localhost, 11 HOD Systems and 44 HOD Library Content blocks were inserted directly from the owner's Excel
  formats by a one-off script that is not in the repo. `hod_seed/`, `scripts/hod_build_seed.py` and
  `api/hod/import_formats.py` are deleted.
- The O&M table pictures (tables pasted as pictures in the workbooks) are IN the library since 2026-09-23:
  18 of them, each a private File attached to its `HOD Library Content` record with the `<img>` inside that
  record's `content`, placed under the heading it sits under in the workbook (e.g. Electrical "2. PANEL
  OVERVIEW"). `print_context.embed_stored_images` embeds them at print time. Live needs its own upload.

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
| Status Pending / Yes (then set by hand) | derived Pending / Form Filled / Completed, read-only |
| `add_system` (one system) | `add_systems` (several, all or nothing) |
| Remove system refused once anything was entered | warns, removes with `force` after confirmation |
| From Nirmaan binder part = a list page + the records | the records only (the actual reports, sheets, batches, drawings) |
| As Built listed as Drive links on the divider | downloaded from Drive and merged |
| Snag List = one project-wide print | ticked snag batches, one print each |
| Render with `render_template` + `get_pdf` | `frappe.get_print` + `_drop_jinja_cache` |
| Progress by socket only | socket + cache status polled every 2 s |
| Header block on every page | only the 7 documents listed above |
| Library pictures public | private, embedded at print time |
