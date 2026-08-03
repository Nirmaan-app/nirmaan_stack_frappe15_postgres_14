# Frontend Plan: Reminders & Action Center

## Overview

Create an "Action Center" module for role-based users to view and interact with pending tasks, alongside a management UI for admins to configure schedules. This pattern utilizes a reusable right-rail panel injected onto existing dashboards, and a dedicated list page for schedule configuration.

## Current Architecture Analysis

### Action Center Components
- **`ActionCenter.tsx`** - Reusable shell component that composes role-scoped sections. Renders as a sticky right rail on desktop (`xl:w-[360px]`), hoists to the top on mobile (`order-first xl:order-none`). Self-scrolling within viewport bounds.
- **`RemindersSection.tsx`** - Maps over `Reminder Schedule Log` data and renders individual task rows.
  - Fetches data from `nirmaan_stack.api.reminders.read.get_my_reminder_logs`.
  - Determines UI state (`overdue` rendered in red, `due_today` in amber, `upcoming` in gray).
  - Handles the `mark_reminder_done` POST call via a **Remarks Dialog** (optional completion notes).
  - Shows month-end clamp warnings (`due_note`) with amber `AlertTriangle` icon.
  - Listens for `reminder_logs_updated` Frappe realtime events for live-refresh.
  - Includes a **History** button that opens `CompletedRemindersDialog`.
- **`CompletedRemindersDialog.tsx`** - Shows the last 30 completed (Done) reminder logs sorted newest-first by `completed_at`. Each entry shows: reminder name, due date, completed date, completed by.
- **`ActionTabs.tsx`** - Project action items (DN/DC/DPR) with project grouping and tab filtering (All / DPR / DN / DC). Separate from reminders.
- **`FinanceActionTabs.tsx`** - Finance-specific action queue for accountant roles.

### Role-Based Section Resolution
The ActionCenter resolves which sections to show based on the user's Role Profile:
- **Finance roles** (Accountant, Accountant Lead) → `["reminders", "finance"]`
- **Everyone else** → `["reminders", "actions"]`

Sections can also be passed explicitly via the `sections` prop for custom dashboard composition.

### Management UI
- **`RemindersPage.tsx`** - Main list view for displaying configured schedules with columns: Title, Schedule Type, Next Due, Reminds On, Notify Before, Role Profiles, Enabled/Off, and Edit button.
  - Role Profiles column hydrated via `get_reminder_schedule_role_profiles` endpoint (grouped map, not per-row fetch).
  - Edit button- Create `types/NirmaanStack/ReminderSchedule.ts` for strictly-typed API responses.
- Wire `useDialogStore` state to the `NewReminderDialog` trigger.

## Recent Fixes & Enhancements (July 2026)

### 1. Real-Time WebSockets & Race Condition Fixes
- Reverted the `RemindersSection.tsx` React component back to standard `useFrappeEventListener("reminder_logs_updated")` for bulletproof WebSocket sync. 
- Removed the `{ revalidateOnFocus: false }` option from SWR so that the Action Center always refetches stale data when navigating back to the dashboard.
- Fixed the global SWR cache `mutate` key in `NewReminderDialog.tsx` so Adding/Editing/Submitting a reminder instantly invalidates the Action Center cache correctly based on the `useFrappeGetCall` array key pattern.

### 2. Naming and Schema Updates
- Updated the frontend UI to display the new `from_month` and `to_month` fields for non-monthly reminders so coverage periods are visible.
- Re-enabled `title` to act as the primary `autoname` ID (`field:title`).tsx`** - Unified create/edit form component.
  - Uses `react-hook-form` + `zod` for validation with `superRefine` (Monthly requires `due_day`, non-Monthly requires at least one `due_dates` row).
  - Dynamic field arrays (`useFieldArray`) for non-Monthly due date rows.
  - Quarterly/Half-Yearly auto-fill: `handleFromMonthChange` derives end month from start month.
  - Title is fully editable in both create and edit modes (since IDs are now `REM-.####`).
  - Explicit form reset on close (`due_day: "" as any`) to prevent stale data from bleeding.
  - Role Profiles picker uses `ReactSelect` multi-select, populated via `get_role_profiles` endpoint.
  - State driven by `useDialogStore.ts` (`newReminderDialog` + `editReminderScheduleName`).

### Backend API Consumed
- **`get_my_reminder_logs`** - Fetches enriched logs (includes lifecycle `state`, `days`, `message`, `due_note` injected by `_enrich_logs`). Default Pending only; `include_done=1` for History.
- **`mark_reminder_done`** - Accepts the log name + optional remarks to flip its status to Done.
- **`reopen_reminder`** - Flips Done → Pending (undo completion).
- **`get_my_reminders`** - Dashboard panel data with LIVE-recomputed due dates and bucket classification.
- **`get_role_profiles`** - Role Profile names for the target picker (non-admin accessible).
- **`get_reminder_schedule_role_profiles`** - Grouped map `{schedule: [profiles]}` for the list page.

## Core UI Logic & Design Decisions

### 1. Action Center Placement Strategy
- **Logic**: Injected as a sticky right-rail on desktop dashboards (`xl:sticky xl:top-0 xl:max-h-[calc(100dvh-5rem)]`). On mobile, hoists to the top (`order-first`) so compliance tasks are the first thing seen.
- **Why**: Keeps actionable, compliance-driven tasks front-and-center, dramatically increasing the visibility of things like "Stock Statement Due."

### 2. Derived UI State (`overdue`, `due_today`, `upcoming`, `completed`)
- **Logic**: The frontend (and backend enrichment) categorizes dates on the fly rather than permanently storing an `is_overdue` boolean in the database.
- **Why**: Time is relative; a task that is "upcoming" today naturally becomes "overdue" tomorrow. Deriving this state dynamically ensures the UI is always accurate and can conditionally style rows (e.g., rendering overdue rows with `border-red-200 bg-red-50/40` and warning icons).

### 3. Role-Based Data Hydration
- **Logic**: The Action Center relies completely on the backend API (`get_my_reminder_logs`) to filter data based on the current user's role profile. The UI does *not* do client-side filtering of roles.
- **Why**: Security and performance. An Accountant's Action Center will only ever receive and render data explicitly targeted at the `Nirmaan Accountant` role profile, guaranteeing data privacy.

### 4. Separation of Schedule vs. Log
- **Logic**: The UI cleanly separates the "Management View" (`RemindersPage.tsx` - configuring rules) from the "Execution View" (`ActionCenter.tsx` - doing the tasks).
- **Why**: Prevents UI clutter. Accountants don't need to see the configuration rules; they just need a simple checklist of what is due right now.

### 5. Explicit Form Reset
- **Logic**: The `NewReminderDialog` explicitly passes blank values to `reset({...})` on close, including `due_day: "" as any`, instead of calling `reset()` with no arguments.
- **Why**: `react-hook-form`'s `reset()` without arguments resets to the *last-set* defaults, not the original. After editing a reminder, the EDIT mode `reset(editData)` overwrites the defaults, causing "Add Reminder" to show stale data.

### 6. Real-Time Updates
- **Logic**: `RemindersSection` uses `useFrappeEventListener("reminder_logs_updated", () => mutate())` to auto-refresh when any log is created or updated.
- **Why**: When the cron job creates a new Pending log or another user marks a reminder Done, the panel updates instantly without requiring a page refresh.

### 7. Mark Done with Remarks
- **Logic**: Clicking "Mark Done" opens a dialog with an optional textarea for remarks (e.g., "Paid via NEFT 123456"), not an immediate action.
- **Why**: Compliance tasks benefit from audit notes. The dialog provides a moment of confirmation before the irreversible status flip, and the remarks become part of the permanent audit trail.

---

## Implementation Plan

### Phase 1: Action Center & Display

**Files:** `src/components/layout/action-center/*`
1. Create `ActionCenter` shell with role-based section resolution. Sticky right rail on desktop.
2. Build `RemindersSection` to render pending task rows:
   - Use the `Check` icon from `lucide-react` for the action button.
   - Style the "Mark Done" button as solid `bg-emerald-600` for clear CTA.
   - Show `reminder_schedule` name as the task title, `due_date` as subtitle.
   - Integrate the bulk-fetched `message` payload from the API into the row's subtitle.
   - Show month-end clamp `due_note` warnings with `AlertTriangle` icon.
3. Build `CompletedRemindersDialog` for History (last 30 Done logs).
4. Add Remarks Dialog for the Mark Done flow (optional textarea + confirm).
5. Wire `useFrappeEventListener` for real-time log refresh.

### Phase 2: Dashboard Integration

**Files:** `src/components/layout/dashboards/dashboard-accountant.tsx` & `dashboard-pm.tsx`
- Wrap existing dashboard content in `flex-col xl:flex-row` layout.
- Append `<ActionCenter />` as the right rail for high visibility and immediate actionability.

### Phase 3: Reminders Management Pages

**Files:** `src/pages/Reminders/*`
- Build a standard list page showing all active and inactive schedules with role profiles column.
- Create `NewReminderDialog` allowing setup of frequency (Monthly, Quarterly, etc.) and selecting `Role Profiles`.
- Title is fully editable in both create and edit modes.
- Update `useDialogStore.ts` to manage the dialog's open/close state and edit target.

### Phase 4: Routing & Navigation

**File:** `src/components/helpers/routesConfig.tsx`
- Add route configuration:
```tsx
{
  path: "reminders",
  element: <RemindersPage />,
}
```

**File:** `src/components/helpers/renderRightActionButton.tsx`
- Add "Add Reminder" button on `/reminders` route, gated to Admin/PMO/Accountant Lead.

**File:** `src/components/layout/NewSidebar.tsx`
- Add sidebar item with `BellRing` icon:
```tsx
{
  key: '/reminders',
  icon: BellRing, 
  label: 'Reminders Dashboard',
}
```
- Visible to Admin, PMO, Accountant, Accountant Lead.

---

## Frontend Folder Structure & File Map

Here is the exact React directory layout for the changes implemented in this feature:

```text
frontend/src/
├── components/
│   ├── helpers/
│   │   ├── routesConfig.tsx        [MODIFIED] # Registers the /reminders route
│   │   └── renderRightActionButton.tsx [MODIFIED] # "Add Reminder" button on /reminders
│   ├── layout/
│   │   ├── NewSidebar.tsx          [MODIFIED] # Adds "Reminders Dashboard" to navigation
│   │   ├── action-center/          # THE ACTION CENTER
│   │   │   ├── ActionCenter.tsx       [NEW] # Reusable shell (right rail / top on mobile)
│   │   │   ├── ActionTabs.tsx         [NEW] # Project actions (DN/DC/DPR)
│   │   │   ├── FinanceActionTabs.tsx  [NEW] # Finance action queue
│   │   │   ├── RemindersSection.tsx   [NEW] # Pending list + Mark Done + Remarks + History
│   │   │   └── CompletedRemindersDialog.tsx [NEW] # History (last 30 Done)
│   │   └── dashboards/
│   │       ├── dashboard-accountant.tsx [MODIFIED] # Injected ActionCenter as right rail
│   │       └── dashboard-pm.tsx         [MODIFIED] # Updated ActionCenter import path
├── pages/
│   └── Reminders/                  # MANAGEMENT UI
│       ├── RemindersPage.tsx       [NEW] # List view with role profiles column
│       └── NewReminderDialog.tsx   [NEW] # Unified create/edit dialog
├── types/
│   └── NirmaanStack/
│       └── ReminderSchedule.ts     [NEW] # End-to-end TS interfaces
└── zustand/
    └── useDialogStore.ts           [MODIFIED] # Dialog state (newReminderDialog + editReminderScheduleName)
```

---

## UI / Icon Selection

Using specific icons from `lucide-react` to maintain consistency:
- **BellRing** - Used in the Sidebar and RemindersSection header.
- **Check** - Used in the "Mark Done" button to signify completion.
- **CheckCircle2** - Used in CompletedRemindersDialog for done entries.
- **AlertTriangle** - Used for warning states (e.g. month-end clamp notes).
- **History** - Used for the History button that opens CompletedRemindersDialog.
- **ChevronDown** - Used for collapsible section toggle.
- **Pencil** - Used for Edit button on RemindersPage.
- **Plus** / **CirclePlus** - Used for "Add date" in the dialog and "Add Reminder" in the nav.
- **Trash2** - Used for removing due date rows in the dialog.

## Recent Fixes Applied

1. **Form state bleeding**: `close()` now explicitly resets all form fields including `due_day: "" as any`.
2. **Title editable**: Removed `readOnly` and "can't be changed" disclaimer. Title is sent in updateDoc payload.
3. **Due Day input clearing**: Changed default from `undefined` to `"" as any` to force number inputs to clear.


## Overview

Create an "Action Center" module for role-based users to view and interact with pending tasks, alongside a management UI for admins to configure schedules. This pattern utilizes a collapsible list view injected onto existing dashboards, and a dedicated list page for schedule configuration.

## Current Architecture Analysis

