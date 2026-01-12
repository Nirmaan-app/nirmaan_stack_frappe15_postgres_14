# Work Plan Tracker Implementation Plan

## Overview

Create a "Work Plan Tracker" module for Project Leads and Project Managers to track Work Plans across all their assigned projects. This follows the pattern established by:
- **PO Tracker** (`/critical-po-tracker`) - for Critical PO Tasks tracking
- **Design Tracker** (`/design-tracker`) - for Design Tracker progress

## Current Architecture Analysis

### Existing Work Plan Components
- **`SevendaysWorkPlan.tsx`** - Main work plan component that:
  - Fetches data from `nirmaan_stack.api.seven_days_planning.work_plan_api.get_work_plan`
  - Displays milestones grouped by work headers
  - Has zone-based filtering
  - Has special `isProjectManager` mode (read-only, shows only planned activities)

- **`WorkPlanOverview.tsx`** - Simplified view for Project Managers

- **`SevenDayPlanningTab.tsx`** - Container that manages date range selection and tab state (Work Plan vs Material Plan)

### Backend API
- **`work_plan_api.get_work_plan`** - Fetches work plans for a single project
- Requires project to have `enable_project_milestone_tracking` enabled
- Fetches from `Project Progress Reports` and `Work Plan` doctypes

### Target Roles
- **Nirmaan Project Lead Profile** - Can see all their assigned projects
- **Nirmaan Project Manager Profile** - Can see only their assigned projects

---

## Implementation Plan

### Phase 1: Backend API

**File:** `nirmaan_stack/api/work_plan/get_projects_with_stats.py`

Create a new API endpoint that:
1. Gets current user and their role
2. For Project Lead/Project Manager - filter by `Nirmaan User Permissions`
3. For Admin/PMO - show all projects
4. For each project with `enable_project_milestone_tracking`:
   - Count total milestones (from completed Project Progress Reports)
   - Count milestones with work plans
   - Aggregate status counts (Pending, In Progress, Completed)
   - Calculate overall progress percentage

**API Response Structure:**
```python
{
    "project": "PROJ-0001",
    "project_name": "Project Alpha",
    "total_milestones": 50,
    "milestones_with_plans": 30,
    "status_counts": {
        "Pending": 10,
        "In Progress": 15,
        "Completed": 5
    },
    "overall_progress": 65  # percentage
}
```

### Phase 2: Frontend Components

#### 2.1 Types
**File:** `src/pages/WorkPlanTracker/types/index.ts`
- Define `ProjectWithWorkPlanStats` interface

#### 2.2 Utilities
**File:** `src/pages/WorkPlanTracker/utils.ts`
- Status styling helpers (Pending/In Progress/Completed colors)
- Constants

#### 2.3 Project Card Component
**File:** `src/pages/WorkPlanTracker/components/WorkPlanProjectCard.tsx`
- Similar to `CriticalPOProjectCard`
- Shows project name, progress circle, status breakdown
- Click navigates to detail view

#### 2.4 List View
**File:** `src/pages/WorkPlanTracker/work-plan-tracker-list.tsx`
- Header with Calendar icon and title "Work Plan Tracker"
- Search by project name
- Grid of project cards
- Uses `useFrappeGetCall` to fetch from new API

#### 2.5 Detail View
**File:** `src/pages/WorkPlanTracker/work-plan-tracker-detail.tsx`
- Fetches project data
- Reuses `SevendaysWorkPlan` or `SevenDayPlanningTab` component
- Passes `isOverview={false}` for Project Lead, `isProjectManager={true}` for PM

### Phase 3: Routing

**File:** `src/components/helpers/routesConfig.tsx`
- Add route configuration:
```tsx
{
  path: "work-plan-tracker",
  children: [
    { index: true, element: <WorkPlanTrackerList /> },
    { path: ":projectId", element: <WorkPlanTrackerDetail /> },
  ],
}
```

### Phase 4: Sidebar Integration

**File:** `src/components/layout/NewSidebar.tsx`
- Add sidebar item for Project Lead and Project Manager roles:
```tsx
{
  key: '/work-plan-tracker',
  icon: Calendar, // or similar icon
  label: 'Work Plan Tracker',
}
```
- Position after PO Tracker or Design Tracker

### Phase 5: Dashboard Integration

**File:** `src/components/layout/dashboards/dashboard-pm.tsx`
- Add a new DashboardCard in "Other Options" section:
```tsx
<DashboardCard
  title="Work Plan Tracker"
  icon={<Calendar className="h-7 w-7" strokeWidth={1.5} />}
  onClick={() => navigate("/work-plan-tracker")}
  variant="secondary"
/>
```

---

## Files to Create/Modify

### New Files
1. `nirmaan_stack/api/work_plan/__init__.py`
2. `nirmaan_stack/api/work_plan/get_projects_with_stats.py`
3. `frontend/src/pages/WorkPlanTracker/types/index.ts`
4. `frontend/src/pages/WorkPlanTracker/utils.ts`
5. `frontend/src/pages/WorkPlanTracker/components/WorkPlanProjectCard.tsx`
6. `frontend/src/pages/WorkPlanTracker/work-plan-tracker-list.tsx`
7. `frontend/src/pages/WorkPlanTracker/work-plan-tracker-detail.tsx`

### Modified Files
1. `frontend/src/components/helpers/routesConfig.tsx` - Add routes
2. `frontend/src/components/layout/NewSidebar.tsx` - Add sidebar item
3. `frontend/src/components/layout/dashboards/dashboard-pm.tsx` - Add dashboard card

---

## Role Access Summary

| Role | List View | Detail View | Dashboard Card |
|------|-----------|-------------|----------------|
| Nirmaan Admin Profile | All projects | Yes | No |
| Nirmaan PMO Executive Profile | All projects | Yes | No |
| Nirmaan Project Lead Profile | Assigned projects only | Yes | No (uses different dashboard) |
| Nirmaan Project Manager Profile | Assigned projects only | Yes (read-only) | Yes |

---

## Icon Selection

Using **Calendar** icon from lucide-react to represent Work Plan scheduling/planning, which differentiates from:
- **ClipboardCheck** - PO Tracker
- **PencilRuler** - Design Tracker
