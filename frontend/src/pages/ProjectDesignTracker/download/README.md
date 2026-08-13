# Design Tracker — Download Report

Everything behind the **Download** buttons on the design-tracker details page.
A click opens a dialog where the user picks **Phase × Zone × Category**, sees how
many tasks the PDF will contain, and downloads it.

## Files

| File | Job |
|---|---|
| `index.ts` | Barrel — the only thing the page imports |
| `downloadConstants.ts` | Param names, print-format name, labels. The contract with the Jinja |
| `downloadTypes.ts` | `DownloadSelection`, `DownloadSeed`, `DownloadOption`, `DownloadableTask` |
| `downloadSelection.ts` | **Pure** logic: option lists, task counting, pruning, params, filename |
| `downloadSelection.test.ts` | vitest for the pure module |
| `useDownloadReport.ts` | Dialog state + the fetch → blob → save round trip |
| `DownloadReportDialog.tsx` | The UI. No fetch, no URL building |

Reference copy of the print format: [`../design-tracker-printformat.html`](../design-tracker-printformat.html).

## How the page uses it

```tsx
import { DownloadReportDialog, useDownloadReport } from "./download";

const download = useDownloadReport({ trackerId, projectName: trackerDoc?.project_name });

// any Download button:
<Button onClick={() => download.openDownloadDialog({ phases: [activePhase], zones: [activeTab] })}>

// mounted once, only while open:
{download.isOpen && (
  <DownloadReportDialog
    onOpenChange={download.setIsOpen}
    tasks={trackerDoc.design_tracker_task ?? []}
    zoneOrder={uniqueZones}
    hasHandover={hasHandover}
    seed={download.seed}
    isDownloading={download.isDownloading}
    onDownload={download.runDownload}
  />
)}
```

A **seed** pre-fills the dialog. Any axis left out of the seed defaults to
everything available, and a seeded value that no longer exists falls back to
"all" rather than to "nothing".

## The print-format contract

The download is a plain `GET` to `frappe.utils.print_format.download_pdf`. There
is **no backend Python** — Frappe forwards every query param into
`frappe.form_dict`, which the Jinja reads.

| Param | Type | Meaning |
|---|---|---|
| `phases` | JSON array | e.g. `["Onboarding","Handover"]`. **Always sent** |
| `zones` | JSON array | Omitted when every zone is selected → Jinja reads absent as "all" |
| `categories` | JSON array | Omitted when every category is selected |
| `phase` | string | **Legacy.** `All` / `Onboarding` / `Handover`. Read only when `phases` is absent |
| `zone` | string | **Legacy.** One zone name. Read only when `zones` is absent |

`phases` is always sent because an absent `phase` means *Onboarding only* to the
print format's legacy default — not "all".

The legacy pair still exists because
[`pmo-project-detail.tsx`](../../PMODashboard/pmo-project-detail.tsx) downloads
the same format with `phase=All`. Don't remove them without changing that caller.

## ⚠️ The one rule that matters

`downloadSelection.ts` **mirrors the Jinja's inclusion rules**. Five of them:

| Rule | Jinja | `downloadSelection.ts` |
|---|---|---|
| Missing phase ⇒ Onboarding | `t.task_phase or "Onboarding"` | `taskPhase()` |
| Zones compared trimmed | `(t.task_zone or "") \| string \| trim` | `taskZone()` |
| Blank category ⇒ Uncategorized | `category or "Uncategorized"` | `taskCategory()` |
| `Not Applicable` never printed | `t.task_status != "Not Applicable"` | `isPrintableTask()` |
| A **blank zone** is never printed | `all_zones` only collects named zones | `getZoneOptions()` skips it |

That last one is easy to get wrong: a task with no zone matches no entry in the
Jinja's `zones_to_loop`, so it is silently absent from the PDF. The picker must
therefore not offer a "(no zone)" tick — it would show a count the document does
not honour.

Change one side and you must change the other, or the dialog's
"N tasks will be included" starts lying about the PDF.

The print format itself lives **in the database** (Desk → Print Format → *Project
Design Tracker*), not in this repo. Edit it there, then mirror the HTML into
`../design-tracker-printformat.html` so the next person can read it without a
Desk login. `nirmaan_stack/fixtures/print_format.json` is not hand-edited.
