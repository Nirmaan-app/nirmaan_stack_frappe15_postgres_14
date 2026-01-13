# Critical PO Tracker - Project View Implementation Plan

## Overview

Create a new list view for all projects with Critical PO setup, following the Design Tracker pattern. The view shows project cards with task counts and status breakdowns.

## Current State Analysis

### Critical PO Tasks Flow
- **Doctype**: `Critical PO Tasks` (separate document per task, linked to project)
- **Statuses**: "Not Released", "Partially Released", "Released", "Not Applicable"
- **Current Location**: Project tab at `/src/pages/projects/CriticalPOTasks/`
- **Key difference from Design Tracker**: Tasks are individual documents linked to project (not child table)

### Design Tracker Pattern (Reference)
- List view at `/design-tracker` with project cards showing aggregated stats
- Backend API `get_trackers_with_stats` aggregates task statistics per tracker
- Card component shows progress circle, completed/total counts, and status breakdown
- Click navigates to detail view

## Implementation Approach

### Phase 1: Backend API
**File**: `/nirmaan_stack/api/critical_po_tasks/get_projects_with_stats.py`

Create a whitelisted API that:
1. Fetches all unique projects that have Critical PO Tasks
2. For each project, aggregates:
   - `total_tasks` (excluding "Not Applicable")
   - `released_tasks` (count of "Released" status)
   - `status_counts` object with counts per status
3. Returns project info + stats

```python
@frappe.whitelist()
def get_projects_with_critical_po_stats():
    """
    Returns projects that have Critical PO Tasks with aggregated statistics.
    """
    # Query all tasks grouped by project
    # Return: [{project, project_name, total_tasks, released_tasks, status_counts}, ...]
```

### Phase 2: Frontend Components

#### Directory Structure
```
src/pages/CriticalPOTracker/
├── index.tsx                           # Barrel export
├── critical-po-tracker-list.tsx        # Main list view
├── types/
│   └── index.ts                        # TypeScript interfaces
├── components/
│   └── CriticalPOProjectCard.tsx       # Project card component
└── utils.ts                            # Status styling helpers
```

#### 2.1 Type Definitions (`types/index.ts`)
```typescript
export interface ProjectWithCriticalPOStats {
  project: string;               // Project ID
  project_name: string;          // Project display name
  total_tasks: number;           // Excluding "Not Applicable"
  released_tasks: number;        // "Released" count
  status_counts: {
    "Not Released": number;
    "Partially Released": number;
    "Released": number;
  };
}
```

#### 2.2 Project Card Component (`components/CriticalPOProjectCard.tsx`)
- Display project name with title tooltip
- Progress circle showing released/total percentage
- Task counter: `{released} / {total}`
- Status breakdown grid (3 badges: Not Released, Partially Released, Released)
- Click handler to navigate to project's Critical PO tab
- Follow `ProjectWiseCard.tsx` styling pattern

**Color coding:**
- Released: Green (`bg-green-100 text-green-700 border-green-500`)
- Partially Released: Yellow (`bg-yellow-100 text-yellow-700 border-yellow-500`)
- Not Released: Red (`bg-red-100 text-red-700 border-red-500`)

#### 2.3 List View (`critical-po-tracker-list.tsx`)
Features:
- Search by project name
- Optional: Multi-select filter by project
- Responsive grid layout (1 col mobile → 4 cols desktop)
- Empty state when no projects have Critical PO setup
- Loading skeleton during data fetch
- Error handling with retry option

Data fetching:
```typescript
useFrappeGetCall<ProjectWithCriticalPOStats[]>(
  'nirmaan_stack.api.critical_po_tasks.get_projects_with_stats.get_projects_with_critical_po_stats',
  {}
);
```

Navigation on card click:
- Navigate to `/projects/{projectId}` with Critical PO tab active
- OR create query param: `/projects/{projectId}?tab=critical-po`

### Phase 3: Routing Configuration

**File**: `src/components/helpers/routesConfig.tsx`

Add new route:
```tsx
{
  path: "critical-po-tracker",
  children: [
    { index: true, element: <CriticalPOTrackerList /> },
  ],
}
```

Position: After "design-tracker" route section (around line 282)

### Phase 4: Sidebar Integration

**File**: `src/components/layout/NewSidebar.tsx`

Add sidebar item for roles:
- Nirmaan Project Lead Profile
- Nirmaan Project Manager Profile
- Nirmaan Procurement Executive Profile

**Implementation:**
1. Add to `items` array (around line 507, after Design Tracker):
```tsx
...(user_id == "Administrator" || ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile", "Nirmaan Project Manager Profile", "Nirmaan Procurement Executive Profile"].includes(role)
  ? [{
      key: '/critical-po-tracker',
      icon: ClipboardCheck, // Or appropriate icon
      label: 'Critical PO Tracker',
    }]
  : [])
```

2. Add to `allKeys` set (around line 558):
```tsx
"critical-po-tracker"
```

3. Add to `groupMappings` object (around line 587):
```tsx
'/critical-po-tracker': ['critical-po-tracker']
```

4. Add "Critical PO Tracker" to the label check Set (around line 663)

## Detailed Tasks

### Backend Tasks
- [ ] Create `/nirmaan_stack/api/critical_po_tasks/` directory
- [ ] Create `__init__.py` file
- [ ] Create `get_projects_with_stats.py` with aggregation logic
- [ ] Test API response format

### Frontend Tasks
- [ ] Create `/src/pages/CriticalPOTracker/` directory structure
- [ ] Create `types/index.ts` with type definitions
- [ ] Create `utils.ts` with status styling helpers (reuse from CriticalPOTasks if possible)
- [ ] Create `components/CriticalPOProjectCard.tsx`
- [ ] Create `critical-po-tracker-list.tsx` main component
- [ ] Create `index.tsx` barrel export

### Integration Tasks
- [ ] Add import and route to `routesConfig.tsx`
- [ ] Add sidebar item to `NewSidebar.tsx`
- [ ] Update `allKeys` and `groupMappings` in sidebar
- [ ] Test navigation flow

## UI/UX Considerations

1. **Card Layout**: Follow Design Tracker's clean card design
2. **Progress Indicator**: Use ProgressCircle component from Design Tracker
3. **Status Colors**: Match existing Critical PO Task status colors from `TaskStatusBadge.tsx`
4. **Navigation**: Clicking card navigates to existing project Critical PO tab (no duplicate detail view)
5. **Empty State**: Show helpful message when no projects have Critical PO setup

## Decisions Made

1. **Icon Selection**: `ClipboardCheck` - emphasizes task tracking/checklist nature

2. **Navigation Target**: **UPDATED - Create dedicated detail view**
   - Navigate to `/critical-po-tracker/{projectId}` (self-contained flow)
   - Reuse `CriticalPOTasksTab` component from existing project tab
   - Keeps the PO Tracker flow independent from project page
   - Add back navigation to return to list view

3. **Project Manager Access**: Yes, include `Nirmaan Project Manager Profile` in access list

## Updated Implementation - Dedicated Detail View

### New Detail View Component (`critical-po-tracker-detail.tsx`)

Create a wrapper component that:
1. Receives `projectId` from URL params
2. Fetches project data (name, start date) needed by CriticalPOTasksTab
3. Renders header with back button and project info
4. Renders the existing `CriticalPOTasksTab` component

```tsx
// critical-po-tracker-detail.tsx
const CriticalPOTrackerDetail: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // Fetch project data
  const { data: project, isLoading } = useFrappeGetDoc<Projects>("Projects", projectId);

  if (isLoading) return <LoadingFallback />;

  return (
    <div className="flex-1 p-6 space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/critical-po-tracker')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to PO Tracker
        </Button>
        <div>
          <h1 className="text-xl font-semibold">{project?.project_name}</h1>
          <p className="text-sm text-gray-500">Critical PO Tasks</p>
        </div>
      </div>

      {/* Reuse existing CriticalPOTasksTab */}
      <CriticalPOTasksTab
        projectId={projectId}
        projectData={project}
      />
    </div>
  );
};
```

### Updated Route Configuration

```tsx
{
  path: "critical-po-tracker",
  children: [
    { index: true, element: <CriticalPOTrackerList /> },
    { path: ":projectId", element: <CriticalPOTrackerDetail /> },  // NEW
  ],
}
```

### Updated Navigation in List View

```tsx
const handleProjectClick = (projectId: string) => {
  navigate(`/critical-po-tracker/${projectId}`);
};
```

## Estimated Files to Create/Modify

### New Files (8)
1. `/nirmaan_stack/api/critical_po_tasks/__init__.py`
2. `/nirmaan_stack/api/critical_po_tasks/get_projects_with_stats.py`
3. `/frontend/src/pages/CriticalPOTracker/index.tsx`
4. `/frontend/src/pages/CriticalPOTracker/critical-po-tracker-list.tsx`
5. `/frontend/src/pages/CriticalPOTracker/critical-po-tracker-detail.tsx` - **NEW**
6. `/frontend/src/pages/CriticalPOTracker/types/index.ts`
7. `/frontend/src/pages/CriticalPOTracker/components/CriticalPOProjectCard.tsx`
8. `/frontend/src/pages/CriticalPOTracker/utils.ts`

### Modified Files (2)
1. `/frontend/src/components/helpers/routesConfig.tsx`
2. `/frontend/src/components/layout/NewSidebar.tsx`

## Dependencies

- Existing `ProgressCircle` component from `@/components/ui/ProgressCircle`
- Existing Card, Badge, Input components from shadcn/ui
- Existing tooltip components
- frappe-react-sdk hooks for data fetching
