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

**Users will notice first:** G1 (repeated Commission reports), G4 (private Drive links), G5 (ELV TDS not narrowed).
**Owner decisions:** G10, G11. The rest are limits to know about, not bugs.

### 3a. Where the data comes from

| # | Gap | Effect | Possible fix |
|---|---|---|---|
| G1 | Commission tasks repeat per zone/floor with **no zone label** | Maconns Noida shows "AHU/CSU Commissioning Report" ×5 — the user cannot tell them apart in the picker | Show the zone from `response_data.zones` / task comments, or the Commission Report adds a zone field |
| G2 | **Hand-added snags** (no batch) cannot be ticked or printed | None exist today; a project with only hand-added snags would show Snag List as empty | Print format support for "no batch", or a whole-project option |
| G3 | **Snag List is project-wide**, not per system | Every system's binder carries the same ticked batches (snag categories are free text) | Map snag categories/areas to systems |
| G4 | **As Built Drive links must be shared "anyone with the link"** | A private Drive file fails; the binder names it in "could not include" | Detect + warn in the picker, or store drawings as Nirmaan files |
| G5 | **TDS items are filtered by package only** | GSS, VESDA, WLD & RRS (all "Critical Room ELV") each see all ELV TDS items | Apply `source_keywords` to TDS items too |
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

Intentional (not gaps): the **Download binder button is hidden** (`SHOW_BINDER_BUTTON` in `hodApi.ts`,
owner 2026-09-23) — the binder itself works, and the flag brings the button back; anything left empty on the Maintenance Checklist (Result, Remarks, Comments, DATE) prints
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
