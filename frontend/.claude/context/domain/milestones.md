# Milestone Reports Module

Reference documentation for the milestone tracking and daily progress reports system.

---

## Module Structure

```
src/pages/Manpower-and-WorkMilestones/
├── MilestonesSummary.tsx          # Main report page with project selector (zone chips, Draft delete)
├── MilestoneDailySummary.tsx      # URL-driven report page (project_id, zone, date params)
├── MilestoneTab.tsx               # The DPR editor (fill tabs, save Draft, submit Completed)
├── components/
│   ├── DailyReportView.tsx        # Daily report display with work plans and milestones
│   ├── MilestoneProgress.tsx      # Progress bar visualization
│   ├── ReportControlBar.tsx       # Zone tabs, date picker, report type toggle
│   ├── OverallMilestonesReport.tsx # Overall progress view
│   ├── CopyReportButton.tsx       # Copy previous report functionality
│   └── StaleDraftDialog.tsx       # Editor's blocking "This draft was deleted" dialog
├── hooks/
│   └── useMilestoneReportData.ts  # Centralized data fetching hook
└── utils/
    ├── milestoneHelpers.ts        # Utility functions
    └── dprSessionStorage.ts       # Editor's browser-copy keys, draft marker, stale check (pure)
```

---

## Load-bearing invariants

### A DPR draft's browser copy must never outlive its server draft

The editor (`MilestoneTab.tsx`) keeps each tab's entries in `sessionStorage` under
`project_{id}_date_{date}_zone_{zone}_tab_{header}`, and that browser copy **wins over the server draft**
(the server draft is only read into an empty key). So a copy whose draft was deleted would be saved back
as a new draft, with photo links the delete already removed from cloud storage. Rules (owner, 2026-10-28):

- Beside the tab keys the editor stores `{prefix}draft_ref`: the server draft's name, or `"none"` when the
  zone had no draft. It is written when the copy is first seeded and after the copy's own first save
  (`createDoc`), and removed with the tab keys (`clearAllTabData`, `clearDprSessionData`).
- `getStaleDraftKind(storedRef, serverDraftName)` runs on load, whenever the draft lookup refreshes (SWR
  refetches on tab refocus), and at the top of every Save / Submit after a fresh refetch. A mismatch stops
  the save and shows `StaleDraftDialog`. No marker (a fresh tab, or a copy from before the marker existed)
  means keep: no dialog.
- `StaleDraftDialog` has **one mandatory button, "Clear and start new"** (no Cancel, no close icon; Esc and
  outside clicks do nothing). It clears that project + date + zone only, then the form re-seeds from the
  server. No option keeps the old entries: that would undo the delete.
- The dialog names who deleted the draft and when via `api/milestone/dpr_draft_deletion.get_dpr_draft_deletion`,
  which reads Frappe's `Deleted Document` log (System Manager only, so the editor cannot read it directly).
  When the report still exists as Completed, it says the report was submitted instead.
- Deleting a draft from anywhere (the zone chip below, or "Clear Draft & Take Over") clears only the
  deleting user's own browser copy; every other browser is handled by the check above.

---

## Key Constants

```typescript
// Work plan delimiter for parsing work_plan field
const WORK_PLAN_DELIMITER = "$#,,,";

// Zone progress status values
type ZoneProgressStatus = 'completed' | 'partial' | 'pending' | null;
```

---

## useMilestoneReportData Hook

Central data fetching hook used by both report pages.

### Interface

```typescript
interface UseMilestoneReportDataOptions {
  projectId: string | null;
  selectedZone: string | null;
  displayDate: Date;
  reportType: 'Daily' | 'Overall';
}

// Returns
{
  projectData,           // Project document with zones and work headers
  dailyReportDetails,    // Report document for selected date/zone
  workPlanGroups,        // Parsed work plan entries grouped by header
  milestoneGroups,       // Milestones grouped by header
  validationZoneProgress, // Map<zoneName, ZoneProgressInfo>: { status, name, draft_owner, draft_last_updated }
  totalWorkHeaders,
  completedWorksOnReport,
  totalManpowerInReport,
  isLoading,
  projectLoading,
  projectError,
  reportForDisplayDateName,
  mutateProgressReports,
  mutateAllReportsForDate,
  workHeaderOrderMap,
  workMilestonesList,
}
```

---

## Helper Functions (milestoneHelpers.ts)

| Function | Purpose |
|----------|---------|
| `formatDateForInput(date)` | Format Date to YYYY-MM-DD for input fields |
| `isDateToday(date)` | Check if date is today |
| `getZoneStatusIndicator(status)` | Returns { icon, color } for zone badge |
| `formatServerDateTime(value)` | Frappe datetime string → `dd-MMM-yyyy, hh:mm a` |
| `parseWorkPlan(workPlan, workHeaderOrderMap, workMilestonesList)` | Parse work_plan string into grouped entries |

---

## Zone Progress Indicator

Status badges shown on zone tabs:

| Status | Icon | Color |
|--------|------|-------|
| `completed` | CheckCircle2 | text-green-500 |
| `partial` | Clock | text-yellow-500 |
| `pending` | AlertCircle | text-red-500 |
| `null` | Circle | text-gray-400 |

---

## Related Doctypes

- **Project Progress Reports**: Daily progress entries per project/zone
- **Projects**: `project_zones` child table, `project_work_header_entries` child table
- **Work Headers**: Configuration with `work_package_link`
- **Work Milestones**: Child entries under Work Headers

---

## Permission Checks

Delete report button (today's Completed report) requires:
```typescript
const canDeleteReport = user_id === "Administrator" ||
  ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role);
```

Delete **Draft** (bin icon right after the clock icon on a Draft zone chip, any date) requires Admin or
PMO (owner, 2026-10-28). Project Lead and the draft's own owner do not get it; they keep the editor's
30-minute "Clear Draft & Take Over".
```typescript
const canDeleteDraft = isNirmaanAdmin(role, user_id) || role === PMO_EXECUTIVE_PROFILE;
```
Frontend only: the doctype's DocPerms already let most roles delete.
