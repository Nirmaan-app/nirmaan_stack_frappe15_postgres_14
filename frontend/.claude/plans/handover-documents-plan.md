# Handover Documents (HOD) — plan

Started 2026-09-21. Living document: every layout the owner sends is transcribed into **Appendix — received
layouts** below, so the formats survive beyond the chat they arrived in.

**Status 2026-09-22: built** on `hod/feature` (committed, not pushed; migrated on localhost). This file is the
DESIGN and the owner's rulings; sections that a later ruling replaced are marked SUPERSEDED and kept as history.
What was built, file by file: `handover-documents-execution.md`. What is still open: `handover-documents-gaps.md`.

## Scope rule

HOD **never writes** to an older feature (Commission Report, Design Tracker, TDS, Snag List, PMO "Handover"
category, the project status change). Since the owner's notes of 2026-09-21 it **reads** from four of them,
because six handover documents already exist there ("From app" below).

## Structure

```
Project page → tab "Handover Documents"
  → one tab per SYSTEM the team has added (Electrical, HVAC, GSS, …) + "+ Add system"
    → the SAME 16-document index under every system: S.No · Description · Status · Remarks · Document
```

Superseded twice on 2026-09-21: first "one sub-tab per package", then (owner) systems added on purpose — see
"Owner ruling 2026-09-21: SYSTEMS are the tabs". The project's packages only SUGGEST systems in the picker.

## Document kinds

| Kind | Content comes from | Project team does | Needs code per new layout? |
|---|---|---|---|
| **From app** | an existing Nirmaan feature, read-only | nothing — HOD shows the source's files + status | no (one reader per source) |
| **Template** | text written once per package, reused on every project; may contain **blanks** the project fills | fills any blanks; preview + PDF | no — the text is data |
| **Form** | one fixed format, same for every package | fills the table; system prints the PDF | yes — a form + a PDF template |

Every row also keeps an Upload for the final signed copy, and can be switched off per system (the owner's
"enable/disable" on Attic Stock + Key List). A switched-off row is not printed at all: the checklist drops it and
the S.No closes up (see "a per-row DISABLE switch replaces NA").

**Template blanks (owner, 2026-09-21; as built):** O&M manuals are mostly static text with names in between that
users fill. The owner's text already marks them with square brackets, so a blank is written `[Blank Name]`
exactly as in the Excel (`services/hod/blanks.py`). Every blank becomes an input box in the O&M dialog, its
value is stored in `form_data.blanks`, and an unfilled blank prints as written so it stays visible. (The first
proposal, `{{Blank Name}}` with self-filling `{{Project}}` / `{{Date}}`, was not built.)

## The 16-document index (owner's notes, 2026-09-21)

| S.No | Document | Kind | Source / layout |
|---|---|---|---|
| 1 | Escalation Chart | Form | layout received — Appendix A; levels are added by the project (3 by default, owner 2026-09-23) |
| 2 | Demo & Training Certificate | From app | Commission Report → "… Training Report" tasks |
| 3 | Commissioning Report | From app | Commission Report → "… Commissioning Report" tasks |
| 4 | Material Technical Data Sheet | From app | Project TDS (`Project TDS Item List`) |
| 5 | Operations & Maintenance Manual | Template + blanks | library per system (all 11 workbooks); `[blanks]`; a library document again since 2026-09-23 (no form, no project pictures) |
| 6 | Do's & Don'ts | Template | library per system |
| 7 | Maintenance Checklist | Template + results | check items from the library; filled on screen (owner 2026-09-22): Result + Remarks per check, Comments per sheet, date of the check |
| 8 | Inventory List | Form — Location rows × extendable Material columns, qty cells, Total row; LANDSCAPE | layout received — Appendix F |
| 9 | Recommended Tools List | Template + remarks | `HOD System.tools`; Remarks per tool, filled on screen (owner 2026-09-22) |
| 10 | Attic Stock List | Form — S No / Material / Make / Qty / Remark; can be switched off | layout received — Appendix D |
| 11 | Key List | Form — keys table + recipient details + declaration; can be switched off | layout received — Appendix E |
| 12 | Equipment Warranty | Template list — equipment from `HOD System.warranty_equipment`, project can remove/add | workbook layout; escalation levels copied from #1 |
| 13 | Completion Certificate | Template | workbook layout; DLP from the commissioning date |
| 14 | Factory Test Reports | From app | Commission Report → "… Factory Test Report" tasks (vendor-obtained) |
| 15 | Snag List | From app | Snag List — project-wide; the user ticks snag batches |
| 16 | As Built Drawings | From app | Design Tracker → Handover-phase tasks, drawings downloaded from Drive (Correction 2 below) |

Spelling of the index was corrected from the owner's sheet (Commissioning, Recommended, Attic Stock, Don'ts).
The list lives ONLY in `nirmaan_stack/services/hod/index.py`; the frontend receives it from the API
(`handoverIndex.ts` was deleted). Each From app document has **Select & Download**: the user ticks which records
go in (`form_data.selected`), and the binder uses the same ticks.

### From-app sources — verified against localhost data 2026-09-21

| Doc | Where it lives | Split by package? | Finding |
|---|---|---|---|
| 2, 3, 14 | `Project Commission Report` → `Commission Report Task Child Table` (task_status, approval_proof, response_data → the existing report PDF) | **yes** — `Commission Report Category.work_package` (Electrical → Electrical Work; three HVAC categories → HVAC System) | Every package has a "… Training Report" and ≥1 "… Commissioning Report" task. Factory Test tasks exist only for Electrical (LT Panel, UPS) and HVAC Chilled Water (AHU/CSU). |
| 4 | `Project TDS Item List` (tds_attachment, tds_status) | **yes** — `tds_work_package` holds the exact package names | 846 rows across 10 packages. |
| 15 | `Project Snag` + `Project Snag Batch` | **no** — `category` is free text and blank on 607 of 760 snags | Snag List can only be shown project-wide; each uploaded batch prints as its own Snag List. |
| 16 | `Design Tracker Task Child Table` (file_link, approval_proof) | by category NAME — on this site no `Design Tracker Category` has a work_package (checked 2026-09-22) | Read the **Handover-phase** tasks (Correction 2), not tasks named "As Built". A category belongs to the system named in it ("Electrical", "Fire Sprinkler" → Sprinkler, "Data Networking" → Networking); categories no system claims (ELV, BMS, Overall Project) are matched by `source_keywords`. |

Commission tasks that are neither training nor factory test (Earthing Test, LT Cable Megger, Socket Testing,
pressure tests, Fluke/continuity tests, …) are listed under **3. Commissioning Report** (decision 9, as built).

**Owner 2026-09-23: only FINISHED records are offered.** A Commission task counts when it is Submitted or
Client Accepted, and an As Built drawing when it is Submitted or Approved. Unfinished records are not listed
at all (site-wide today: 46 of 894 commission tasks, 268 of 722 handover drawings qualify).

**Owner 2026-09-25: the SNAG LIST is the exception — it is handed over in full.** A snag list carries every
snag of the batch, whatever its status, because the OPEN items are exactly what the client is being handed;
holding one back would make the document a lie. So no status filter is applied anywhere on the snag path —
not in the picker's count, not in the batch's own print, not in the binder — and only a batch holding no snags
at all is left out, having nothing to print. This replaces the completed-only rule of 2026-09-23 (which had
offered 195 of the site's 884 snags; one batch was handing over 1 snag out of 124).

### Template coverage

All 11 systems from the owner's workbooks are in the library on localhost: 11 `HOD System` records (tools,
warranty equipment) and 44 `HOD Library Content` blocks (18 O&M manuals, 12 Do's & Don'ts, 14 maintenance
checklists). They were inserted directly (2026-09-22), and the 18 tables the workbooks hold as pictures were
transcribed into the content on 2026-09-23 (gaps §2). A new system is a new library record, no code.

### Form layouts

**All four received:** Escalation Chart (A) · Attic Stock List (D) · Key List (E) · Inventory List (F).

**Shared form frame (from A + D + E):** the same 5-row header block — VENDOR (fixed: Stratos Infra
Technologies Pvt Ltd) / PROJECT / LOCATION / DATE / PACKAGE — then the document's own table, then its own
extra sections / footer (Attic: 3 signature boxes; Key List: recipient details + declaration + signature).
Built once as a print-format macro.

**Owner 2026-09-22: the header block prints ONLY on** the Checklist, Escalation Matrix, Maintenance Checklist,
Inventory List, Attic Stock List, Key List and Equipment Warranty (whose date row reads COMMISSIONING DATE). The
other documents print without it. The Maintenance Checklist's DATE is the date of the check the team entered, or
blank to write by hand.

## Analysis — owner's `HOD FORMATS` workbooks (2026-09-21)

Source: `~/Downloads/HOD FORMATS/*.xlsx` — 11 workbooks, one per SYSTEM: ACS, CCTV, Electrical, FAS, GSS, HVAC,
Networking, PAS, Sprinkler, VESDA, WLD & RRS. Read-only analysis (openpyxl in a scratch venv); nothing imported.

### Workbook anatomy (identical in all 11)

`cover` ("ELECTRICAL – HANDING OVER DOCUMENTS") → `0.CheckList` → for each index topic: a one-cell **divider
sheet** (big title page) followed by its content sheet(s). The binder is printed in that order; From-app
documents (training, commissioning, TDS, factory tests, snag, as-built) have ONLY the divider — the physical
reports are inserted behind it.

`0.CheckList` is the **single source of the header**: VENDOR / PROJECT / LOCATION / DATE / PACKAGE (B2:B6) and
the footer signature labels (A35 / C35 / E35). Every other sheet pulls them by formula (`='0.CheckList'!$B$3`).
The Warranty Certificate additionally pulls Level 1–3 Name / Contact / Email from the Escalation Matrix sheet.

### Systems vs Nirmaan packages — HOD is per SYSTEM, not per package

| Workbook | Nirmaan Work Package | Note |
|---|---|---|
| ACS | Access Control System | |
| CCTV | CCTV System | |
| Electrical | Electrical Work | 2 O&M manuals (general + Electrical Panel) |
| FAS | FA System | |
| HVAC | HVAC System | 6 O&M (DX, Duct, Chilled Water, AHU, Air Washer, VRF) + 3 maintenance checklists (DX, Ductable, VRF) — a project uses only the sub-systems it has |
| Networking | Data & Networking | |
| PAS | PA System | |
| Sprinkler | Fire Fighting System | |
| GSS | **Critical Room ELV** | one package → **4 systems** (GSS, VESDA, WLD, RRS), matching the Commission Report categories |
| VESDA | **Critical Room ELV** | |
| WLD & RRS | **Critical Room ELV** | one binder, but separate O&M / Do's / maintenance for WLD and RRS |
| — | BMS, Civil & Interior, Services, Tool & Equipments, Additional Charges | no HOD workbook |

### Per-document findings

| # | Document | What varies | Verdict |
|---|---|---|---|
| — | Checklist | 16 items in 9 systems; **GSS + VESDA use 13** (no TDS, Attic, Factory Test). Status values actually used: **YES / NA** only. Closing line "The above list was handed over by Nirmaan and taken over by the respective client." + Comments + signatures | generated; applicable documents come from the system |
| 1 | Escalation Matrix | nothing — identical in all 11 | Form |
| 2, 3, 4, 14, 15, 16 | Training, Commissioning, TDS, Factory Test, Snag, As Built | divider page only | From app, inserted behind a divider |
| 5 | O&M | per system; 18 manuals in total; 8 contain images (true diagrams AND tables pasted as pictures); **5 bracket placeholders** — `[Facility Name]` (HVAC Duct), `[Type: upright, pendant, sidewall, etc.]`, `[Material: GI, MS etc.,]`, `[City main, pump, or tank]`, `[Types: main control valve, test valve, drain valve]` (Sprinkler) | Template (rich text + images) with `[blanks]` |
| 6 | Do's & Don'ts | per system (WLD and RRS separate) — two numbered lists | Template (list) |
| 7 | Maintenance Checklist | per system (HVAC ×3, WLD/RRS ×2) — Half-yearly items + Yearly items, blank Result / Remarks columns, fixed "Emergency Maintenance" note | Template (item lists), printed blank for the client |
| 8 | Inventory List | material-column count (ACS 4, others 3) | Form (matrix) |
| 9 | Recommended Tools | per system — intro sentence + item list | Template (list) |
| 10 | Attic Stock List | nothing | Form |
| 11 | Key List | nothing | Form |
| 12 | Warranty Certificate | **only the equipment list** (e.g. Electrical: Distribution Board, Cable Tray, Power Outlets, Conduits, LT Cables, Enclosures, Internal Wiring); fixed text "…standard manufacturer's warranty of One year from the date of Commissioning"; commissioning date; escalation Level 1–3 copied from #1; company registered + corporate address + CIN footer | Template list (equipment seeded per system, project can add/remove) + auto values |
| 13 | Completion Certificate | identical paragraph; hand-typed **project, system name, client, DLP start/end dates**; authorized-signature image; company footer | Template with auto values |

### Data-quality problems in the Excel copies (the case for generating instead of copying)

- Footer label is "HVAC CONSULTANT" in **all 11** workbooks (set once on the HVAC checklist, copied everywhere).
- Electrical's Completion says "in the field of **HVAC SYSTEM**"; CCTV's O&M title says "for **Electrical** Systems";
  CCTV's tool list is titled "**ACS** - Recommended Tool List".
- GSS's "Twelve months" DLP reads 25/12/2025 → 10/03/2026; GSS's "client" is an address.
- Warranty "COMMISSIONING DATE" points at the checklist's handover DATE, while the Completion's DLP starts on a
  different, hand-typed commissioning date — **two dates are being conflated**.
- Several Attic sheets read their header from ANOTHER workbook (`'[1]0.CheckList'` external link).
- Header label drifts: VENDOR / CONTRACTOR / CONTARCTOR. Spelling: Commissioing, Recomended, Atick/Attick, assest.
- GSS checklist lists Key List (YES) but has no Key List sheet; has a Factory Test divider not in its checklist.
- "PROJECT" holds the client's legal entity on some sets (COE Special Technical Service India Pvt Ltd) while the
  Completion's "handed over to the client" is a third party (the architect / PMC: Gayathri & Namith Architects,
  CIAO Green Pvt Ltd) — **"handed over to" is its own per-project value, not the Nirmaan customer by default**.

### Shared company assets (identical bytes in every workbook)

Nirmaan logo ×3 sizes (`image1–3.png`), the **authorized signature / seal** (`image4.jpeg`, used on every
Completion Certificate), registered address, corporate address, CIN.

### Dynamic design that follows from this

Code owns the **16 renderers** (one per document type: layout, header, footer, PDF). Data owns everything that
varies:

1. **System library** (admin, once): per system — display name ("ELECTRICAL SYSTEM"), its Nirmaan package,
   which documents apply, its O&M manuals (rich text + images + `[blanks]`), Do's / Don'ts lists, maintenance
   checklists (half-yearly + yearly items), tool list, warranty equipment list. **As built:** created and edited
   on screen (Desk); on localhost the 11 workbooks were inserted directly, once (no import script, no import
   button — owner 2026-09-22); the library is edited under Packages Settings → Handover Documents (owner
   2026-09-23; Desk still works) and travels as exported JSON loaded with `import-doc`, never by migrate. A new system (e.g. BMS) = a new
   library record, **zero code**.
2. **Company settings** (admin, once): legal name, addresses, CIN, logo, authorized signature. **As built:** kept
   in the print formats (as the Commission Report does), not as a record.
3. **Project HOD** (per project × system): commissioning date, "handed over to", which sub-systems apply (HVAC:
   VRF + Duct only), per-document on/off switch + remarks (the signed upload was dropped), the filled forms (escalation,
   inventory, attic, key list, warranty equipment edits, O&M blanks + pictures) and the ticked From-app records.
   **As built:** all of it lives on the 16 `Project HOD Document` rows; status is the handover answer
   **YES / NO / NA**, picked by hand (owner 2026-09-24), and the signed upload is gone.
4. **Output**: one merged PDF binder per system in the workbook's order — cover → checklist → divider + content
   for each applicable document, with the From-app PDFs placed behind their dividers.

## Work Packages, not Procurement Packages (owner question, 2026-09-21)

Two masters with the identical shape (`work_package_name` + an image), keyed by the SAME name strings:

| | Work Packages | Procurement Packages |
|---|---|---|
| Records (localhost) | 11 trades | the same 11 **+ Additional Charges, Services, Tool & Equipments** |
| Meaning | the trades a project is **executed** in | the buckets a **purchase** is categorised under |
| Linked from | Commission Report Category, Design Tracker Category, Critical PO Category, Scopes of Work, WO Service Category, Work Headers | Category, PR Tag Child Table / Headers, Approved Quotations, Project Work Package Category Make, Project Estimates, TDS Items, TDS Repository |

A project's own list (`Projects.project_work_packages`) is picked from Work Packages on the new-project form and
from Procurement Packages on the edit form — both filter out the three procurement-only entries, so the result is
the same 11 trade names. Legacy data: 12 projects still carry "Tool & Equipments" from before that filter.

**HOD links to Work Packages.** Handover is execution-side, the sibling of Commission Report and Design Tracker,
which both link to Work Packages; the three procurement-only buckets never have handover documents. Package tabs
show only project packages that exist in Work Packages (drops "Tool & Equipments"); a trade with no HOD system
yet (BMS, Civil & Interior) shows an empty state. Because both masters share the name strings, the earlier
Procurement Packages choice changed no stored value — nothing existed yet.

## Owner ruling 2026-09-21: SYSTEMS are the tabs, and a system is ADDED on purpose

Supersedes "one sub-tab per package" and "rows created on first edit". A project often hands over only some of
its systems (e.g. only Electrical), so auto-tabs per package would be wasted tabs.

- The Handover Documents tab shows one tab **per system the team has added** + a **"+ Add system"** button.
  Nothing is added automatically. A project with no system yet shows a Commission-style **"Not Found" card** with
  "Create Handover Documents" (owner 2026-09-22).
- **Create / + Add system** opens a multi-select dialog over the active `HOD System` records — "From this
  project's packages" first (packages = DISTINCT `project_wp_category_makes.procurement_package`, kept only where
  it is a Work Package), then the rest of the library. It **creates each ticked system's 16 `Project HOD Document`
  rows at once, all or nothing** (`add_systems`); the system's default documents start switched off.
- The tab list = DISTINCT `hod_system` of the project's `Project HOD Document` rows. **Still no parent record** —
  the rows themselves record that the system was added.
- **Remove system** (as changed by the owner 2026-09-22): when every row is untouched it just removes the 16 rows;
  when anything was entered (forms, remarks, uploads, switches) the screen warns "N documents already have
  entries — are you sure?" and removes them on confirmation (`remove_system(..., force=1)`). ~~Once anything is
  filled, the button is disabled~~ — superseded.
- Every later edit (switch, remarks, upload, a saved form, ticked records) UPDATEs one of the 16 rows.

## Owner ruling 2026-09-21 (later same day): a per-row DISABLE switch replaces NA

- Every `Project HOD Document` row gets an on/off switch: new field **`disabled`** (Check, default 0).
  Switched off → its actions are blocked (status, remarks, form, upload, PDF), it is **removed from the printed
  checklist with S.No renumbered** (the GSS/VESDA workbooks already print a 13-item list that way), and it is
  **left out of the binder**. Switching back on restores it; nothing filled in is lost.
- ~~`status` becomes **Pending / Yes** only~~ — superseded, see "Status is derived" below.
  `HOD System.default_na_documents` is renamed **`default_disabled_documents`**: "+ Add system" creates those
  rows switched off.
- "Remove system" treats a row as untouched when `disabled` equals its default and it has no remarks, upload or
  form input.
- Confirmed and built: switching off fully replaces NA.

## Owner ruling 2026-09-24: status IS the handover answer — YES / NO / NA, picked by hand

**There is no Pending / Form Filled / Completed.** Those three were the 2026-09-22 design, derived by
`checklist.derive_status` from what had been done; that function is deleted and the doctype field is a
writable Select `YES\nNO\nNA` with default **NO**. The retired values survive in the code only as something
to HEAL from: `normalise_status` reads any unrecognised value as NO and the next save writes NO back, which
is why no backfill script was needed.

| Answer | Means | Gate |
|---|---|---|
| **YES** | handed over — the document goes in the binder | refused until the document has been SAVED, where it has anything to save: a form its entries, a From Nirmaan document its ticked records. A library text (O&M Manual, Do's & Don'ts) carries the library's own content, so it is answerable as it stands (`can_be_yes`) |
| **NO** | not handed over | the default a row is created with, so "not answered" reads as NO. No blank option |
| **NA** | not applicable to this project | always allowed — a document nobody will fill must still be markable |

The answer is its own column on the checklist, changed from a small dropdown; the Actions cell is three
buttons (Edit / Preview / Download) and nothing else. The printed checklist prints the answer as it stands.
A switched-off row is a different thing: it leaves the printed checklist entirely and the S.No closes up,
while an NA row stays on the sheet. A **Details** button beside Edit library opens a guide to the whole flow.

## Downloads = Frappe Print Formats; binder = everything + uploads (owner, 2026-09-21)

- **Print Format "HOD Document"** on `Project HOD Document`: one print format that picks its layout from the row's
  `document` (Jinja blocks per document, shared header-block macro, Nirmaan letterhead + footer). Inventory List
  switches to landscape with top-level `.print-format { orientation: Landscape; }` (the pdfkit meta tag is dead
  since Frappe 15.115). Row "PDF" button = Frappe's print/download for that row with this format.
- **Print Format "HOD Checklist"** on `Projects`, the system passed in the print link (`?hod_system=Electrical`) —
  the existing Snag List print format pattern. Prints the cover + the checklist of switched-on documents on ONE
  page, with Commission-style signature columns (owner 2026-09-22).
- **Binder** (not a print format): a background job builds cover + checklist, then for every switched-on
  document a divider + its content. **As built (owner 2026-09-22):**
  - content = the uploaded signed copy if there is one (it REPLACES everything else, From-app documents
    included); else the HOD Document page; for a From-app document that page comes FIRST — the list naming
    what follows (TDS: item, make, category; Commission: the tasks; As Built: the drawings), showing only the
    ticked records (owner 2026-09-23) — and behind it the records themselves: Commission reports (signed copy,
    else the filled report through the Commission print format, else the uploaded file), TDS data sheets, one
    Snag List print per ticked batch, and As Built drawings **downloaded from their Google Drive links and
    merged** (~~listed on the divider~~ — superseded). ~~Never a list page~~ — superseded: the list page leads,
    the records follow it.
  - **Owner 2026-09-23: the binder downloads only when every switched-on document is Completed.** The button
    is disabled until then and says how many are left; a document the project does not need is switched off
    and stops counting. The earlier pre-check dialog ("these documents have nothing to include — switch them
    off") is gone: a Completed document always has its uploaded copy to put in. The server still refuses an
    empty document on its own.
  - Progress per step, shown ON the button (no window); the screen polls the job status every 2 s (realtime
    events do not reach the browser on this setup); the PDF downloads by itself.
  - The same job downloads one From-app document's content alone (the row's Select & Download).
  - Rendering: `frappe.get_print` with the Jinja cache dropped before each render (the formats read
    `form_dict`). `frappe.get_print` COMMITS.
- Print Format HTML is maintained in Desk (paste flow), same as the Commission Report format; the source lives
  in `frontend/src/pages/HandoverDocuments/print-formats/` and ships through the existing `Print Format` fixture.
- Confirmed and built: the uploaded signed copy REPLACES the generated page.

Client-facing plan (Part 1 plain words, Part 2 technical) + PDF: https://claude.ai/artifact/GLcJGtXM5aD2WXubPpbuTp
Clickable demo: https://claude.ai/artifact/47haBw3MBDBr23FLEa9kaD

## Documents a project does not need → NA (owner question, 2026-09-21) — SUPERSEDED by the Disable switch above

Per project × system × document the team sets the row's status to **NA** (optionally with a remark). NA prints
as "NA" on the checklist (the Networking workbook already does this), is **left out of the binder** (no divider,
no pages), and **drops out of the progress count** ("9 of 13 needed documents done"). Reversible any time.

**PROPOSED, needs approval (one field):** `HOD System.default_na_documents` (Small Text, one document key per
line). "+ Add system" creates those rows as **NA** instead of Pending. Seed from the workbooks: GSS and VESDA →
`material_tds`, `attic_stock_list`, `factory_test_reports` (their checklists have 13 items). "Remove system"
treats a row as untouched when its status equals that default.

**Stored vs referenced, per document:** forms (1, 8, 10, 11) store everything typed in `form_data`; O&M / Do's /
Maintenance store only which library blocks + blank values; Tools stores nothing; Warranty stores equipment
kept/added + commissioning date; Completion stores commissioning date + handed-over-to; From-app documents (2, 3,
4, 14, 15, 16) store nothing — read live. Every row stores status, remarks, attachment.

## Worked example: Cygnus 2F (BENGALURU-PROJ-00192) — corrections it exposed (2026-09-21)

Read-only look at localhost (a restored prod backup). Cygnus 2F: status Handover, customer CUST-0051 "Space
Design", address "5, 8th Road, KIADB Export Promotion Industrial Estate, Whitefield, Bengaluru, Karnataka 560066".

**Correction 1 — package source.** `Projects.project_work_packages` is **NULL** on Cygnus. Across all non-tendering
projects: 63 have the JSON and the child table, **43 only the child table** (36 of them WIP/Handover/Completed), 1
neither; where both exist they disagree on 2. The reliable source is `Projects.project_wp_category_makes`
(`Project Work Package Category Make.procurement_package`) — Cygnus: 18 rows, all "HVAC System". HOD package tabs
= DISTINCT `procurement_package` from that table ∪ the JSON names, kept only where the name is a Work Package.

**Correction 2 — As Built = Design Tracker HANDOVER-PHASE tasks, not tasks named "As Built".** The handover status
change generates them: 722 tasks in 24 trackers (Panel SLD, Cable Tray Layout, GSS System Layout, WLD Layout, …),
file in `file_link` (a Drive link). Cygnus: HVAC Ducting Layout, HVAC Typical Installation, HVAC VRF/DX Layout, VRF
Schematics Layout — Submitted, each with a Drive link; four more are Not Applicable. Map a task to a system through
`design_category` (→ `Design Tracker Category.work_package`, set for Electrical / Fire Sprinkler / HVAC; the ELV
category needs a name → system map, e.g. "CCTV Layout" → CCTV).

**Correction 3 — HVAC sub-system defaults.** The project's Commission Report categories say which HVAC sub-systems
exist: Cygnus has HVAC Ducting + HVAC VRF/DX (no Chilled Water) → the O&M row pre-ticks Duct, VRF, DX and leaves
Chilled Water, AHU, Air Washer unticked. The user can still change the ticks; the pre-tick is a default, not a rule.

**What Cygnus 2F's HOD would show and save** (one HOD System: HVAC; at most 16 `Project HOD Document` rows):

| # | Document | Data comes from (Cygnus today) | Saved in Project HOD Document |
|---|---|---|---|
| 1 | Escalation Chart | typed | `form_data.levels` ×3 + date |
| 2 | Demo & Training | Commission: "HVAC VRF/DX Training Report" — Pending | remarks, upload, ticked records (`selected`) |
| 3 | Commissioning | Commission: VRF, DX, VAV Commissioning — Pending; other tests (CFM/Air Balance, Duct Light Test Submitted; Fire Damper, Auto Sequencing, Drain Slope, Nitrogen Pressure Pending; 2 NA) | remarks, upload, ticked records (`selected`) |
| 4 | Material TDS | Project TDS Item List: 18 HVAC items, all Approved, all with files (Daikin VRF ODU + cassettes, Twiga flexible duct, …) | remarks, upload, ticked records (`selected`) |
| 5 | O&M | Library HVAC ×6; pre-ticked Duct, VRF, DX; Duct manual's `[Facility Name]` | `form_data.included` + `blanks` |
| 6 | Do's & Don'ts | Library HVAC ×1 | remarks, upload |
| 7 | Maintenance | Library HVAC ×3 (DX, Duct, VRF) — pre-ticked by the same rule | `form_data.included` + `checks` (results, remarks, comments) + `date` |
| 8 | Inventory | typed (zones: Default) | `form_data` matrix, landscape |
| 9 | Tools | `HOD System.tools` (27) | `form_data.tool_remarks` |
| 10 | Attic Stock | typed | `form_data.rows` |
| 11 | Key List | typed; "belongs to" defaults to Space Design | `form_data` |
| 12 | Warranty | `HOD System.warranty_equipment` (12) + Escalation (#1) | `form_data.equipment` + commissioning date |
| 13 | Completion | Projects (name, address) + typed | `form_data.commissioning_date` + `handed_over_to` (default Space Design) |
| 14 | Factory Test | Commission: **no** Factory Test task | → switch off, or Upload |
| 15 | Snag List | Project Snag: **0 snags** | → switch off, or Upload |
| 16 | As Built | Design Tracker handover tasks: 4 Submitted with Drive links | remarks, upload, ticked drawings (`selected`) |

The Fire Sprinkler tasks in Cygnus's Commission Report (all Not Applicable) produce no HOD tab: Fire Fighting
System is not among the project's packages.

## Schema v2 — BUILT (approved 2026-09-21; supersedes v1 after the workbook analysis)

v1 (`Project Handover Document` per project × package × document + `Handover Document Template` per package) is
withdrawn: the workbooks show HOD is per SYSTEM, a package can hold several systems, and a system holds several
O&M / Do's / maintenance blocks (sub-systems).

```
LIBRARY (admin, Packages Settings)                 PROJECT (site team, SPA)
HOD System ──1:N── HOD Library Content             Project HOD Document
   │  (one per system)   (O&M / Do's / Maint.)        (one per project × system × document,
   │                                                   16 rows created by "+ Add system")
   └── Link → Work Packages        ◄── Link ──────── ├── Link → HOD System
                                                       └── Link → Projects
```

**Owner ruling 2026-09-21: no `Project HOD` parent.** Its header fields (handover date, commissioning date,
handed-over-to, sub-systems, comments) are not needed as a record; ONE project-side doctype remains. Where the
values that are still needed went:
- the header DATE → each form's own date (in its `form_data`, default today); the checklist prints the download date;
- commissioning date + "handed over to" → only the Warranty and Completion certificates use them → their own
  `form_data` (gaps G11: the two dates are kept separately);
- sub-system choice (HVAC: VRF + Duct) → the O&M / Maintenance row's `form_data.included` (default: the parts
  named in the project's Commission Report categories, else all);
- checklist comments → dropped.

**As built:**

1. **`HOD System`** — library, one per system (11 on localhost). `system_name` (Data, unique, autoname) ·
   `display_name` ("ELECTRICAL SYSTEM", printed as PACKAGE and in certificates) · `work_package` (Link Work
   Packages — GSS / VESDA / WLD & RRS → Critical Room ELV) · `is_active` · `warranty_equipment` (one item per
   line — #12) · `tools` (one per line — #9) · `default_disabled_documents` (document keys, one per line; "+ Add
   system" creates those rows switched off — GSS and VESDA: `material_tds`, `attic_stock_list`,
   `factory_test_reports`) · `source_keywords` (one per line — narrows the Commission tasks and the unclaimed
   Design Tracker categories where one package holds several systems; e.g. VESDA: "VESDA, Critical Room ELV").
2. **`HOD Library Content`** — library, one per O&M manual / Do's & Don'ts / maintenance checklist (44 on
   localhost: 18 O&M, 12 Do's, 14 maintenance). `hod_system` (Link) · `document` (Select: O&M Manual / Do's &
   Don'ts / Maintenance Checklist) · `sub_system` (Data, optional — VRF, Duct, Panel, WLD, RRS; blank = always
   included) · `display_order` (Int) · `title` (Data) · `content` (Text Editor — O&M body: headings, lists,
   tables, pictures, `[blanks]`) · `list_1` (Do's / half-yearly items) · `list_2` (Don'ts / yearly items).
   Standalone (not a child table) so each big manual is edited as its own record. Attachments are private
   (`make_attachments_public` 0 — public GCS uploads never work on this site); pictures are embedded at print.
3. **`Project HOD Document`** — standalone, one per project × system × document; all 16 created by "+ Add system"
   (unique triple: controller message + a unique index). `project` (Link Projects) · `hod_system` (Link HOD
   System) · `document` (Select — the 16 index keys) · `status` (Select `YES\nNO\nNA`, default NO, writable —
   the handover answer, picked by hand) · `disabled` (Check — the switch) · `remarks` (Small Text) · ~~`attachment`
   (Attach — the signed copy)~~ retired 2026-09-24 · `form_data` (JSON — the document's own values: escalation levels, inventory
   matrix, attic rows, key list + receiver, warranty equipment + commissioning date, completion commissioning
   date + handed-over-to, O&M included parts + blank values, maintenance included parts + results + comments, the
   From-app records ticked for download, each form's date). Write: System Manager, PMO Executive, Project Lead,
   Project Manager; the other Nirmaan roles read.
   **Screens (owner 2026-10-07):** the HOD Tracker (sidebar + `/hod-tracker` route guard) and the project page's
   Handover Documents tab are shown to Admin / PMO / Project Lead / Project Manager ONLY — one list,
   `HOD_ACCESS` / `canAccessHod` in `frontend/src/constants/roles.ts`. The tracker list shows only projects the
   user may open. The server is NOT narrowed yet: System Manager also rides on Estimates, HR Executive and
   Design Lead, so they can still write by API (gaps G16).

**Deliberately NOT schema:** the 16-document index + kinds → `services/hod/index.py` only (the frontend reads it
from the API); company letterhead / address / CIN / logo → inside the two print formats (the Commission print
format's pattern); From-app documents → read live, only the ticks are stored; per-system document applicability
(GSS/VESDA's 13) → `default_disabled_documents` + the switch; the authorized signature → a wet signature box.

**Code placement (as built):**

```
nirmaan_stack/nirmaan_stack/doctype/hod_system, hod_library_content, project_hod_document
nirmaan_stack/integrations/controllers/project_hod_document.py   unique triple, derived status, switched-off lock
nirmaan_stack/services/hod/          pure: index, checklist (status, counts, S.No), blanks, dates (DLP), sources
nirmaan_stack/api/hod/project_hod.py get_project_hod · add_systems · remove_system(force) · update_row ·
                                     get_system_library
nirmaan_stack/api/hod/from_app.py    get_from_app_sources (read-only Commission / TDS / Snag / Design)
nirmaan_stack/api/hod/print_context.py   hooks.jinja: hod_print_context · hod_checklist_context
nirmaan_stack/api/hod/binder.py      check_binder · enqueue_binder(document=) · get_job_status (long queue)
frontend/src/pages/HandoverDocuments/     tab → system tabs → checklist + Actions cell + dialogs
frontend/src/pages/HandoverDocuments/print-formats/   source of the two print formats (pasted in Desk)
```

No import script: the library is edited under Packages Settings → Handover Documents and lives in each site's
database only. **The exported `fixtures/hod_system.json` + `hod_library_content.json` were DELETED
2026-10-07 (owner).** Frappe's migrate imports EVERY `.json` in `<app>/fixtures/` with force, whether or not
the hooks `fixtures` list names it, so those files overwrote on-screen library edits (the "New projects"
switches flipped back on) on every migrate. A site without the library loads a saved export once with
`bench --site <site> import-doc`, systems first, or enters it on screen. The two print formats DO ship,
through the existing `Print Format` fixture.

**Address (settled):** the Commission print format's corporate address "No.234, 1st Floor, 9th Main, 16th Cross,
6th Sector, HSR Layout" — the HOD Excel's "No L-376/A, 17th Cross" was outdated.

## Build phases

| # | Slice | Status |
|---|---|---|
| 0 | Tab shell | built (committed earlier: b3227585d) |
| 1 | Doctypes + switch / remarks / upload on all rows | built, migrated on localhost |
| 2 | From-app rows: Commission Report (2, 3, 14), TDS (4), Snag List (15), As Built (16) + Select & Download | built |
| 3 | Header block + Escalation Chart + Attic Stock List + Key List, form + PDF | built |
| 3b | Inventory List — matrix editor + landscape PDF | built |
| 4 | Library + template documents (O&M with `[blanks]`, Do's & Don'ts, Maintenance, Tools, Warranty, Completion) | built; library filled for all 11 systems, tables and all |
| 5 | Binder + content download, pre-check, progress | built; not yet run from the button |
| 5+ | A new system → a library record (no code); a new FORM layout → a form + a print-format block | — |

Remaining work (browser walk-through, go-live) is tracked in `handover-documents-gaps.md`.

## Decisions (all settled)

1. Doctypes — approved: the three in Schema v2 (not the v1 `Project Handover Document`).
2. Status values — **YES / NO / NA, picked by hand** (owner 2026-09-24). It replaced the derived
   Pending / Form Filled / Completed of 2026-09-22, which had itself replaced the earlier proposals
   (Pending / Received / Submitted / Not Applicable, then Pending / Yes).
3. Who can edit — System Manager, PMO Executive, Project Lead, Project Manager (doctype permissions); everyone
   else view-only.
4. ~~Kinds marked `?`~~ — settled by the owner's notes 2026-09-21.
5. A project cannot edit its template text beyond the `[blanks]` (and the part ticks); library
   text is changed in the library, for every project at once.
6. Package name on PDFs — the system's `display_name` ("ELECTRICAL SYSTEM"), as in the workbooks.
7. Project line under each title — the header block, on the 7 documents listed under "Form layouts".
8. Escalation Chart levels — none required, and the project adds levels itself ("Add level", owner
   2026-09-23); unfilled levels print blank.
9. Other Commission test reports (Earthing, Megger, pressure tests…) — listed under **3. Commissioning Report**.
10. Snag List — **project-wide**; the user ticks the snag batches to include (gaps G3: not split by system).
11. As Built — Design Tracker **Handover-phase** tasks (Correction 2), drawings downloaded from Drive; a private
    Drive link fails and is named in the binder's "could not include" (gaps G4).
12. Doc 7 name — "Maintenance Checklist".

Still for the owner (gaps §3c): G11 — one shared commissioning date per system. (G10 — "should Form Filled
print YES" — died with the derived statuses on 2026-09-24: the answer is now typed in by hand.)

---

## Appendix — received layouts

Transcribed verbatim from the owner's screenshots. Owner-side inconsistencies are listed under each layout,
not silently fixed.

### A. Escalation Chart — Form, all packages (received 2026-09-21)

Title: **PROJECT ESCALATION MATRIX**

Header rows (label → value):

| Label | Value source |
|---|---|
| VENDOR | fixed: STRATOS INFRA TECHNOLOGIES PVT LTD (Nirmaan's own company) |
| PROJECT | project name |
| LOCATION | project address (sample: "Maithreyi, Kurubarakunte, Bengaluru, Karnataka-562107") |
| DATE | editable, defaults to today (sample: 14.02.2025) |
| PACKAGE | the package tab (sample: ELECTRICAL SYSTEM) |

Table — filled by the user, per package:

| Escalation | Contact Person | Designation | Contact Info. | Email Address |
|---|---|---|---|---|
| 1st Level | | | | |
| 2nd Level | | | | |
| 3rd Level | | | | |

Footer text: "If any queries/ complaints with regards to the work, services, drawings and material, please
follow the above escalation provided."

### B. Operations & Maintenance Manual — Template, Electrical Work (received 2026-09-21)

Title: **Operation and Maintenance Manuals for Electrical Systems**

Owner's table of contents (page 1):

1. Introduction — Purpose of the Manual · Overview of the Electrical System
2. System Components — LT Panels · Distribution Boards (DB) · Power Points (Sockets) · Cable Trays · Wiring
3. Operation of Electrical Systems — LT Panels · DB Operation · Power Points (Sockets) · Cable Tray and Wiring Guidelines
4. Maintenance Procedures — Routine Maintenance · Troubleshooting and Repairs
5. Safety Guidelines — Electrical Safety Precautions · Personal Protective Equipment (PPE) · Emergency Shutdown Procedures
6. Service and Spare Parts — Recommended Spare Parts
7. Warranty Information

Inconsistencies in the sample:
- The body numbers spare parts **7** and warranty **8** with no section 6; the table of contents says
  6. Service and Spare Parts / 7. Warranty Information. The body below follows the **table of contents**.
  The generated PDF builds its contents from the headings, so the two cannot disagree again.
- Under 4 → Routine Maintenance the sample has a stray bold "LT Panels:" line above a list that covers all
  five components; dropped below.

Body:

**1. Introduction**

*Purpose of the Manual*
This manual provides detailed operational and maintenance instructions for Low Tension (LT) Panels,
Distribution Boards (DB), Power Points (sockets), Cable Trays, and Wiring systems in a building or facility.
It is intended to ensure proper use, safety, and longevity of the system components.

*Overview of the Electrical System*
The electrical system distributes power from the main source to various parts of the building, enabling the
operation of equipment and devices. The LT panel is the primary distribution point, feeding power to
distribution boards (DB) that distribute it further to power points and other devices via wiring and cable
trays.

**2. System Components**

*LT Panels*
- **Function**: The LT panel receives electricity from the transformer or generator and distributes it to DBs and other loads in the building.
- **Components**: Circuit breakers, isolators, busbars, relays, meters, and protection devices.

*Distribution Boards (DB)*
- **Function**: A distribution board splits the electrical power supply into subsidiary circuits while providing a fuse or circuit breaker for each circuit.
- **Components**: MCBs (Miniature Circuit Breakers), MCCBs (Molded Case Circuit Breakers), RCDs (Residual Current Devices), and neutral links.

*Power Points (Sockets)*
- **Function**: Power points or sockets provide direct electrical connections for equipment and appliances. They can be single-phase or three-phase depending on the application.
- **Components**: Sockets, switches, and protective covers.

*Cable Trays*
- **Function**: Cable trays support and protect electrical cables, facilitating neat and organized cable routing.
- **Components**: Perforated trays, ladder trays, bends, and junctions.

*Wiring*
- **Function**: Wiring connects all electrical components, distributing power safely and efficiently across the building.
- **Types**: PVC-insulated copper cables, armored cables for high-power applications, and control cables.

**3. Operation of Electrical Systems**

*LT Panels Operation*

Pre-Start Inspection:
- Ensure all breakers and isolators are in the off position before powering the panel.

Switching On:
- Turn on the main isolator to power the system.
- Sequentially switch on individual breakers for different circuits to avoid overloading.
- Check meters for voltage, current, and power factor readings to ensure normal operation.

Normal Operation:
- Monitor for any alarms or unusual readings (such as overcurrent or low voltage).
- Ensure cooling fans (if installed) are operating efficiently to avoid overheating.
- Perform regular inspections of the busbar and wiring insulation for signs of wear or damage.

Shutdown Procedure:
- Switch off all breakers sequentially before turning off the main isolator.
- Lockout/Tagout (LOTO) procedures should be followed during maintenance.

*DB Operation*

Circuit Breaker Management:
- Always switch off the circuit breaker before working on any connected circuit or device.
- Ensure that the correct breaker rating is used for the associated load.

Residual Current Devices (RCDs):
- RCDs should be tested regularly using the test button to ensure functionality.
- If an RCD trips frequently, check for faulty appliances or wiring.

*Power Points (Sockets) Operation*

Pre-Use Check:
- Inspect for damage such as loose connections or cracks in the casing.
- Ensure proper earthing and that the socket is connected to the correct phase.

In-Use Safety:
- Avoid overloading sockets with too many devices, especially high-current appliances like heaters or motors.
- Use sockets designed for the required voltage and current rating of the connected equipment.

*Cable Tray and Wiring Guidelines*

Installation:
- Securely mount cable trays along designated routes with proper support spacing.
- Cables should be neatly arranged within the tray without crossing or tangling.

Cable Management:
- Ensure cables are properly insulated and clamped to avoid damage from vibrations.
- Avoid overloading trays with too many cables, which can cause heat buildup.

Wiring Operation:
- Use appropriately sized cables based on load requirements and run length.
- Periodically inspect cables for insulation damage, particularly in high- stress areas such as bends and junctions

**4. Maintenance Procedures**

*Routine Maintenance*
- LT Panels : Inspect for dust accumulation, check for loose connections, and clean the panel exterior.
- DB : Inspect for signs of overheating or corrosion, clean dust from breakers.
- Power Point : Visually inspect sockets for wear or damage, check the tightness of wiring.
- Cable Tray : Check for proper support of the trays and any signs of corrosion.
- Wiring : Inspect exposed wiring for cuts, nicks, or abrasions
- For Six Months : Refer Six months Maintenance Checklist for Electrical
- For Annually : Refer Yearly Maintenance Checklist for Electrical

*Troubleshooting and Repairs*

Circuit Breaker Tripping:
- **Cause**: Overload, short circuit, or faulty breaker.
- **Solution**: Identify the overloaded circuit and redistribute the load or replace the faulty breaker.

Power Outages:
- **Cause**: Loose connections, blown fuses, or main power failure.
- **Solution**: Check wiring and connections, replace fuses, and ensure there are no supply issues.

Voltage Fluctuations:
- **Cause**: Unbalanced loads or poor quality power supply.
- **Solution**: Check load distribution and stabilize the system using voltage stabilizers or proper load balancing techniques.

**5. Safety Guidelines**

*Electrical Safety Precautions*
- **De-energize Before Maintenance**: Always disconnect the power supply before performing any maintenance or repairs.
- **Lockout/Tagout (LOTO)**: Use lockout/tagout procedures to ensure that equipment remains powered off during service.
- **Avoid Water**: Never operate electrical equipment in wet conditions, and ensure that all devices are properly waterproofed if in a moisture-prone area.

*Personal Protective Equipment (PPE)*
- **Gloves**: Use insulated gloves when working on live equipment.
- **Safety Glasses**: Wear eye protection to guard against arc flashes or debris.
- **Insulated Footwear**: Use non-conductive footwear when working near electrical equipment.

*Emergency Shutdown Procedures*
- In case of an electrical emergency (such as a fire or shock), immediately shut off the main power supply at the LT panel.
- Use only non-conductive equipment to address electrical fires (e.g., Class C fire extinguishers).
- Follow the facility's emergency response plan.

**6. Service and Spare Parts**

*Recommended Spare Parts*
- Circuit breakers
- Fuses
- Busbar connectors
- Socket outlets
- Cable clamps
- RCDs/ELCBs

**7. Warranty Information**

Refer Warranty Certificate from Nirmaan for details.

### C. Do's & Don'ts — Template, Electrical Work (received 2026-09-21)

Title: **ELECTRICAL Do's & Don't**

Inconsistencies in the sample: "Don't" (title and heading) vs the index's "Don'ts"; "in case of a emergency".
Kept verbatim below; fix when seeding if the owner agrees.

**Do's:**
1. Use appropriate electrical protection devices, such as circuit breakers and ground fault circuit interrupters.
2. Label all electrical panels and circuits clearly.
3. Make sure that all electrical connections are tight and secure.
4. Use appropriate electrical cable and conduit for the type of installation and environment.
5. Test all electrical systems and devices after installation.
6. Regularly inspect electrical systems and devices for signs of wear or damage.
7. Train all employees on electrical safety and how to respond in case of a emergency.

**Don't:**
1. Attempt electrical work without proper training and experience.
2. Ignore electrical code requirements and regulations.
3. Overload electrical circuits or outlets.
4. Make electrical connections with frayed or damaged cables.
5. Ignore signs of electrical issues, such as flickering lights or frequent circuit breaker trips.
6. Use of electrical devices or systems that show signs of wear or damage.
7. Ignore electrical hazards, such as water and electrical equipment.
8. Use of electrical equipment in hazardous or wet conditions.
9. Ignore the proper use of electrical protection devices.
10. Ignore electrical safety rules and procedures.

### D. Attic Stock List — Form, all packages (received 2026-09-21)

Title: **ATTICK STOCK LIST** (spelling in the sample; print as "ATTIC STOCK LIST" unless the owner objects)

Header block: identical to Appendix A — VENDOR / PROJECT / LOCATION / DATE / PACKAGE (sample: ELECTRICAL SYSTEM).

Table — filled by the user, per package (sample shows 19 empty rows):

| S No | Material | Make | Qty (in Nos) | Remark |
|---|---|---|---|---|

Footer — signature boxes: **TESTED BY** · **HVAC CONSULTANT** · **CLIENT**

Inconsistencies in the sample: the footer says "HVAC CONSULTANT" on an Electrical sheet — probably a leftover
from the HVAC copy; default is to print the package's consultant (or plain "CONSULTANT") — owner to confirm.

Owner's notes: this document can be switched on/off per package.

### E. Key List — Form, all packages (received 2026-09-21)

Title: **KEY LIST**

Header block: identical to Appendix A (sample package: CCTV SYSTEM).

Table — filled by the user, per package (sample shows 8 empty rows):

| S No | Description | Key No. | Qty (in Nos) | Remarks |
|---|---|---|---|---|

Section **"Details of the person handing over to:"** — Name · Designation · Contact Number · Date
(the person RECEIVING the keys).

Section **"ACKNOWLEDGEMENT AND DECLARATION BY EMPLOYEE"** — verbatim:

> I, Ms/Mr.________ hereby acknowledge that I have received the above mentioned material. I understand that this
> assest belong to ________ and I assure that I own the responsibility to care of the assest of the company to its
> extent.
>
> I will be solely responsible for the company belongoing with me.

Footer: **Signature of the receiving person** (signed on paper; the signed copy goes back in via the row's Upload).

Blanks: "Ms/Mr. ___" = the Name from the details section; "belong to ___" = default the project's customer
(`Projects.customer` → `Customers.company_name`), editable.

Inconsistencies in the sample: "assest" (×2), "belongoing" — print as "asset" / "belongings" unless the owner
wants the wording kept.

Owner's notes: this document can be switched on/off per package.

### F. Inventory List — Form, all packages (received 2026-09-21)

Title: **INVENTORY LIST**. **Page orientation: LANDSCAPE** (owner) — the only landscape form so far.

Header block: identical to Appendix A (sample package: CCTV SYSTEM).

Table — a MATRIX, filled by the user, per package (sample shows 19 rows and 3 material columns):

| S No | Location | Material | Material | Material | … |
|---|---|---|---|---|---|

- Rows = locations / areas (add/remove).
- **Material columns are extendable (owner)**: the user adds as many as the package needs and types each
  column's material name as its header (e.g. Dome Camera · Bullet Camera · NVR).
- Cells = quantity of that material at that location.
- Owner's notes say "with total": a **Total row** at the bottom, one total per material column. No row total
  across materials (adding cameras to NVRs means nothing).

Footer — signature boxes: **TESTED BY** · **HVAC CONSULTANT** · **CLIENT** (same footer and same
"HVAC CONSULTANT" question as Appendix D).

PDF implementation note: landscape via top-level `.print-format { orientation: Landscape; }` — the
`pdfkit-orientation` meta tag is dead since Frappe 15.115. Default for very wide sheets: fits ~10–12 material
columns on one landscape page; beyond that the extra columns continue on a following page with Location repeated.
