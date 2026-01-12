# Milestone Reports Module

Reference documentation for the milestone tracking and daily progress reports system.

---

## Module Structure

```
src/pages/Manpower-and-WorkMilestones/
├── MilestonesSummary.tsx          # Main report page with project selector
├── MilestoneDailySummary.tsx      # URL-driven report page (project_id, zone, date params)
├── components/
│   ├── DailyReportView.tsx        # Daily report display with work plans and milestones
│   ├── MilestoneProgress.tsx      # Progress bar visualization
│   ├── ReportControlBar.tsx       # Zone tabs, date picker, report type toggle
│   ├── OverallMilestonesReport.tsx # Overall progress view
│   └── CopyReportButton.tsx       # Copy previous report functionality
├── hooks/
│   └── useMilestoneReportData.ts  # Centralized data fetching hook
└── utils/
    └── milestoneHelpers.ts        # Utility functions
```

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
  validationZoneProgress, // Map<zoneName, { status, percentage }>
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

Delete report button requires:
```typescript
const canDeleteReport = user_id === "Administrator" ||
  ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role);
```
