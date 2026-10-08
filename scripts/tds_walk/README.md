# TDS request browser walk

A headless Playwright walk of Project TDS (Technical Data Sheet, not tax TDS) requests: spec #1373,
tickets #1374–#1380, fixes 8f38ed4fe and 830f3cd27. It runs in the live dev app and checks each result
in the screen and in the database.

## What it checks

| # | Case |
|---|---|
| 1 | Repository wording: "Unlinked TDS Item" / "No linked SKUs", never "Custom" |
| 2 | Request New dialog: Type first, both choices stacked with help text, makes that already have a datasheet greyed out |
| 3 | Project Custom form: fields, required errors, Category limited to the Work Package and reset when it changes, PDF required |
| 4 | Name-clash warning, the one-click Add New Make switch, and the Make kept across the round trip (830f3cd27) |
| 5 | Cart badges (New Make blue, Project Custom amber, none on picks), duplicate refused, same name in another make allowed |
| 6 | Send For Approval: rows saved on the server under one `RQ-001-NN` id |
| 7 | A refused send keeps its uploads, and the retry reuses them (uploads only) |
| 8 | TDS History: only Pending / Approved by Admin / Rejected, the Project Custom tag, the Status filter |
| 9 | Pending Review: Request Type and Item Status values, Request Type facet |
| 10 | Legacy New row with a blank TDS Item id: reads New Make, opens the request edit, approval refused |
| 11 | Approving Project Custom leaves the TDS Repository alone |
| 12 | Approving a New Make with no entry creates a Verified entry that owns the datasheet |
| 13 | Datasheet chooser opens before any approve call, repository pre-selected; "keep the repository's sheet" |
| 14 | "Use the datasheet sent with this request" replaces the entry's sheet and keeps its old File |
| 15 | Multi-row chooser, the other rows approved alongside, Cancel approves nothing |
| 16 | Chooser opened from the server's reply when the entry appears after the page loaded |
| 17 | Admin edit switches New Make → Project Custom → New Make |
| 18 | Admin edit racing an approval is refused |
| 19 | Reject, then resubmit a pick, a New Make and a Project Custom row |
| 20 | Export dialog lists approved Project Custom rows; chips read Approved by Admin / Pending, Pending includes New |
| 21 | Approved / Rejected rows can't be selected, and approve refuses a Rejected row |
| 23 | Create New Request button: the form replaces the tables, Back keeps the table filter, a send returns to TDS History (#1382) |
| 24 | A saved draft answered from TDS History opens the request form (#1382) |

## Prerequisites

- Vite on `http://localhost:8080` and the Frappe backend on `http://localhost:8000`.
- The bench container `frappe_docker_devcontainer-frappe-1` running. The walk seeds and cleans data through
  `docker exec`.
- The test user `playwright@claude.ai` / `adminclaude1234` (an Admin; see `frontend/.claude/context/testing.md`).
- The project `TestCity-PROJ-00001`, with its TDS tab set up.
- Playwright on the host: `pip install playwright && playwright install chromium`.

## Run

```bash
python3 scripts/tds_walk/walk.py                    # every case
python3 scripts/tds_walk/walk.py --case 13          # one case
python3 scripts/tds_walk/walk.py --case 13,16       # several (ranges work too: 9-12)
python3 scripts/tds_walk/walk.py --out /tmp/walk    # screenshot directory (default: under the system temp dir)
python3 scripts/tds_walk/walk.py --headed           # watch it
```

It prints a PASS / FAIL / SKIPPED table and exits non-zero when a case fails or the cleanup check finds a
difference. A failing case also saves a `c<n>_FAIL.png` screenshot.

## Uploads go to production storage

Local file storage writes to the **production GCS bucket, with deletes turned off**. Anything uploaded stays
there for good.

- **Default run: no uploads.** Rows that need a datasheet are seeded through the backend with fake URLs. The
  browser blocks every upload request, and a case that tries one fails. Case 7 is SKIPPED. Cases 6 and 19
  run without their upload steps (6 sends picks only; 19 sends only the pick resubmit) and say so.
- **`--allow-uploads`** also runs those steps. Each one uploads a small PDF named `tds-walk-test-<n>.pdf`, and
  the run prints how many it uploaded. Cleanup removes their File records, but the stored objects stay in
  the bucket.

## Data and cleanup

Setup records a start time, checks no earlier walk left data behind, and creates a test TDS Item
("TDS WALK Test Valve") with two Repository Entries. Each case seeds its own rows on `TestCity-PROJ-00001`
under a `RQ-001-WALK<n>` request id, so any case runs on its own. After every case, the walk deletes the rows it created and
any extra entries, and resets the two seeded entries.

Cleanup runs in a `finally`, even when a case fails or the browser crashes. It deletes:

- rows created on the project since the start
- the test entries and TDS Item
- `tds-walk*` File records, deleted with `frappe.db.delete` so the storage app's trash hook never runs
- the Version and Deleted Document rows the walk caused

It then compares the project's rows and the TDS Items, TDS Repository and File counts with the baseline,
and prints `cleanup: counts back to baseline` or `CLEANUP MISMATCH`. Activity elsewhere in the app during
a run can also move the global counts.
