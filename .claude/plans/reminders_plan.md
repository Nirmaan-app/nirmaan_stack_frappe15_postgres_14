# Reminder Schedule & Action Center Implementation Plan

## Overview

Implement a comprehensive, role-based Reminder Schedule system and an Action Center interface. The system allows users to configure recurring schedules (Monthly, Quarterly, Half-Yearly, or Custom Dates) targeted at specific user roles. When a reminder comes due (within the `notify_before_days` window), it is automatically surfaced in a new "Action Center" on the dashboard for the designated users to action and mark as complete.

## Current Architecture Analysis

### Target Roles
- **Nirmaan Admin Profile** & **PMO Executive Profile**: Can create, edit, and delete Reminder Schedules.
- **Nirmaan Accountant Lead**: Can create, edit, and delete Reminder Schedules.
- **Nirmaan Accountant** / **Project Manager**: Can view the Action Center and mark their assigned reminders as "Done". Read-only access to the Reminders list page.

### System Components
- **Cron Scheduler**: A daily worker (8 AM) that calculates due dates and generates task instances, gated by the `notify_before_days` setting.
- **Action Center**: A dashboard right-rail element that composes role-scoped sections (Reminders, Project Actions, Finance Actions) and shows actionable tasks.

## Core Business Logic & Design Decisions

### 1. Pure Math Service (`services/reminders.py`)
- **What it does**: Handles all date calculations (`next_due_date`, `reminds_on`, `bucket`, month roll-overs, day clamping) entirely in memory without touching `frappe.db`.
- **Why it's needed**: Decouples business logic from the database, meaning the exact same function can be used to validate a form before saving *and* to calculate due dates during the daily cron job. It also makes unit testing trivial.
- **Month-End Clamping**: If a user schedules a reminder for the 31st, but the current month is February, the service automatically clamps the date to the 28th/29th to prevent calculation crashes. A `due_note` warning is shown to the user when this happens.
- **Key functions**:
  - `fill_end_months(schedule_type, due_dates)` — derives `to_month` from `from_month` for Q (+3) / HY (+6)
  - `next_due_date(schedule_type, due_day, due_dates, base)` — the next upcoming due date (today or later)
  - `reminds_on(next_due, notify_before_days)` — the date the reminder fires
  - `bucket(days_until, notify_before_days)` — classifies proximity: `due_soon` / `this_month` / `later`

### 2. Idempotent & Self-Healing Cron (`tasks/reminders.py`)
- **What it does**: The daily worker iterates over active schedules, checks the due date, and generates a `Reminder Schedule Log` in the "Pending" state.
- **Notification gating**: A log is ONLY created when `days_until_due <= notify_before_days`. This prevents reminders from appearing 7–11 days early when the user configured a 3-day window.
- **Why it's needed**: By using an `_ensure_log` function that checks for existing cycle logs, the cron job is **idempotent**. If the server goes down and misses a day, the next run will safely create the missing tasks without ever duplicating them.

### 3. Bulk Enrichment API (`api/reminders/read.py`)
- **What it does**: The `_enrich_logs` function pulls the parent `message`, schedule configuration, and due date child rows for all pending logs in a single bulk database query.
- **Why it's needed**: Prevents the dreaded "N+1 query problem". Instead of doing 50 separate DB lookups for 50 reminders, it does 1 lookup and merges the data in memory before sending it to the frontend.
- **Derived fields**: Computes lifecycle `state` (completed / overdue / due_today / upcoming), `days` count, and `clamped` / `due_note` for month-end clamp warnings — all at read time, never stored.

### 4. Schedule Edit Reconciliation (`integrations/controllers/reminder_schedule.py`)
- **What it does**: When an admin edits a schedule's due date, the `on_update` hook re-dates the current future Pending log to the new due date.
- **Why it's needed**: Without this, editing a schedule would leave a stale Pending log on the old date AND the cron would create a new one on the new date — a duplicate. The controller UPDATEs (never deletes) the existing log, preserving the audit trail.
- **Guarantees**: Done logs and past/overdue Pending logs are NEVER touched — only a not-yet-due, not-yet-done occurrence is re-dated.

### 5. Write Endpoints (`api/reminders/write.py`)
- **Scope gate**: Both `mark_reminder_done` and `reopen_reminder` enforce role-profile scoping via `_my_schedule_names()` — a user can only act on logs belonging to schedules that target their own Role Profile.
- **Audit trail**: Logs are never deleted. Completion is a status flip from Pending → Done with `completed_by` / `completed_at` auto-stamped. Reopening clears those stamps. Optional `remarks` are stored for audit.

## Role-Based Workflow & Lifecycle

The Reminders system operates on a strict Role Profile permission model. Here is the exact lifecycle of how a reminder behaves from creation to completion:

### 1. Creation & Targeting (Admin / PMO / Accountant Lead)
- An Admin, PMO Executive, or Accountant Lead creates a `Reminder Schedule` (e.g., "Monthly GST Filing").
- The system auto-generates an ID like `REM-0001`. The Title is a separate, editable field.
- In the **Role Profiles** child table, they explicitly select which user profiles this reminder targets (e.g., `Nirmaan Accountant Profile`).
- **Behavior**: The reminder is now actively tracking time, but no one sees it in their Action Center until the cron job raises it within the `notify_before_days` window.

### 2. Daily Cron Worker (System — 8 AM)
- Every day at 8 AM, the cron job (`tasks/reminders.py`) iterates over all active schedules.
- For each schedule, it computes `next_due_date` LIVE via the services layer.
- It calculates `days_until_due`. If this is within the `notify_before_days` window, it generates a `Reminder Schedule Log` in the **"Pending"** state.
- If the due date is too far out, the schedule is **skipped** for that run.
- **Idempotency**: The cron checks if a log for this specific cycle already exists (`_ensure_log`). If the server goes down and misses a day, it simply creates the missing log on the next run without duplicating tasks.

### 3. Dynamic Action Center Visibility (Accountant / PM)
- When a user logs in (e.g., an Accountant), their dashboard fetches data from `api/reminders/read.py`.
- **Role-Based Filtering**: The API reads the logged-in user's `role_profile_name`. It cross-references this against the `Reminder Role Profile` table and returns **only** the Pending logs that belong to schedules targeting their specific role.
- **Bulk Enrichment**: To prevent slow load times (N+1 queries), the API bulk-fetches the parent schedule's `message`, schedule configuration, and due date rows, then injects derived fields (`state`, `days`, `due_note`) into the logs before sending them to the UI.
- An Accountant will never see a Project Manager's reminders, and vice versa.
- **Real-time updates**: The frontend listens for `reminder_logs_updated` realtime events and auto-refreshes.

### 4. Action & Completion
- The user sees the Pending task in their Action Center.
- The UI derives its visual urgency dynamically (e.g., `overdue` rendered in red, `due_today` in amber) rather than relying on a static database field, ensuring it is always accurate.
- The user clicks **"Mark Done"**. A **Remarks Dialog** opens, allowing optional notes (e.g., "Paid via NEFT 123456").
- The API (`mark_reminder_done`) flips the log's status to **"Done"**, stamping the `completed_by` and `completed_at` fields for a permanent audit trail.
- **Reopen**: A Done log can be reopened (Pending ← Done), clearing the completion stamps.

### 5. History
- A **"History"** button opens the `CompletedRemindersDialog`, showing the last 30 completed (Done) reminder logs sorted newest-first by `completed_at`.
- Each entry shows: reminder name, due date, completed date, completed by.

---

## Implementation Plan

### Phase 1: Backend Data Model
1. **Reminder Schedule (DocType)**: The parent configuration doctype (autonamed `REM-.####`). Contains title, schedule configuration, role profile targets, notification settings, and message payload. `title_field: "title"` for display.
2. **Reminder Due Date (Child Table)**: Stores explicit day/month mapping for non-monthly cycles (from/to period + due month/day).
3. **Reminder Role Profile (Child Table)**: Stores target Frappe Role Profiles.
4. **Reminder Schedule Log (DocType)**: The transactional record created for each cycle. Born as "Pending" and flips to "Done". Includes `reminder_title` (fetch_from) for display, `remarks` for audit notes, and completion stamps.

### Phase 2: Backend Services & APIs

**File:** `nirmaan_stack/services/reminders.py`
- Pure math service for schedule calculations (`next_due_date`, `reminds_on`, `fill_end_months`, `bucket`, `_clamp`).

**File:** `nirmaan_stack/tasks/reminders.py`
- Daily worker cron job (8 AM) that iterates over active schedules and idempotently creates `Reminder Schedule Log` rows, gated by `notify_before_days`.

**File:** `nirmaan_stack/integrations/controllers/reminder_schedule.py`
- `on_update` hook: re-dates future Pending logs when a schedule's due date changes (UPDATE only, never deletes).

**File:** `nirmaan_stack/api/reminders/read.py` & `write.py`
- `get_my_reminders`: Dashboard panel data with LIVE-recomputed due dates.
- `get_my_reminder_logs`: Action Center data with bulk-enriched derived fields.
- `get_role_profiles`: Picker helper for non-admin users.
- `get_reminder_schedule_role_profiles`: Grouped map for the Reminders list page.
- `mark_reminder_done`: Flips a log to Done with optional remarks (scope-gated).
- `reopen_reminder`: Flips Done → Pending (scope-gated).

### Phase 3: Frontend Action Center

**Files:** `frontend/src/components/layout/action-center/*`
- **`ActionCenter.tsx`**: Reusable shell that composes role-scoped sections. Right rail on desktop, hoists to top on mobile.
- **`RemindersSection.tsx`**: Renders logs with lifecycle state (`overdue`, `due_today`, `upcoming`), Mark Done flow with Remarks Dialog, month-end clamp warnings, real-time refresh, and History button.
- **`CompletedRemindersDialog.tsx`**: History view showing last 30 Done logs.
- **`ActionTabs.tsx`**: Project action items (DN/DC/DPR) — separate from reminders.
- **`FinanceActionTabs.tsx`**: Finance action queue for accountant roles.

### Phase 4: Frontend Management UI

**Files:** `frontend/src/pages/Reminders/*`
- **`RemindersPage.tsx`**: List view of all schedules with role profiles column (hydrated via grouped map endpoint).
- **`NewReminderDialog.tsx`**: Unified create/edit dialog with zod validation, dynamic due date field arrays, Quarterly/Half-Yearly auto-fill, and explicit form reset on close.

---

## Folder Structure & File Map

The codebase is cleanly separated between the Frappe Backend and the React Frontend. Here is the exact directory layout of the changes:

### 1. Backend (Frappe `nirmaan_stack`)

```text
nirmaan_stack/
├── api/
│   └── reminders/
│       ├── __init__.py             [NEW]
│       ├── read.py                 [NEW] # GET endpoints (get_my_reminder_logs, get_my_reminders, etc.)
│       └── write.py                [NEW] # POST endpoints (mark_reminder_done, reopen_reminder)
├── nirmaan_stack/
│   └── doctype/
│       ├── reminder_schedule/      [NEW] # Parent schedule config (REM-.####)
│       ├── reminder_due_date/      [NEW] # Child table (Day/Month mapping)
│       ├── reminder_role_profile/  [NEW] # Child table (Target roles)
│       └── reminder_schedule_log/  [NEW] # Transactional log (Pending/Done) with reminder_title fetch
├── services/
│   └── reminders.py                [NEW] # Pure math calculation service
├── tasks/
│   └── reminders.py                [NEW] # Daily cron worker (8 AM, notify_before_days gated)
├── integrations/
│   └── controllers/
│       └── reminder_schedule.py    [NEW] # on_update hook (re-dates future Pending logs)
└── hooks.py                        [MODIFIED] # Registers cron job (0 8 * * *) & on_update doc_event
```

### 2. Frontend (React `frontend/src`)

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
│   │   │   ├── RemindersSection.tsx   [NEW] # Pending list + Mark Done + History
│   │   │   └── CompletedRemindersDialog.tsx [NEW] # History (last 30 Done)
│   │   └── dashboards/
│   │       ├── dashboard-accountant.tsx [MODIFIED] # Injected ActionCenter
│   │       └── dashboard-pm.tsx         [MODIFIED] # Updated ActionCenter import
├── pages/
│   └── Reminders/                  # MANAGEMENT UI
│       ├── RemindersPage.tsx       [NEW] # List view with role profiles column
│       └── NewReminderDialog.tsx   [NEW] # Unified create/edit dialog
├── types/
│   └── NirmaanStack/
│       └── ReminderSchedule.ts     [NEW] # End-to-end TS interfaces
└── zustand/
    └── useDialogStore.ts           [MODIFIED] # Dialog state (newReminderDialog + editReminderScheduleName)
│       └── NewReminderDialog.tsx   [NEW] # Unified create/edit dialog
├── types/
│   └── NirmaanStack/
│       └── ReminderSchedule.ts     [NEW] # End-to-end TS interfaces
└── zustand/
    └── useDialogStore.ts           [MODIFIED]- Wire `useDialogStore` state to the `NewReminderDialog` trigger.

## Recent Fixes & Enhancements (July 2026)

### 1. Real-Time WebSockets & Race Condition Fixes
- **Backend**: Added `after_commit=True` to the `publish_realtime` event broadcast in both `reminder_schedule.py` and `reminder_schedule_log.py`. This guarantees the frontend is only notified *after* the MySQL transaction commits, preventing stale data fetches.
- **Frontend**: Reverted the `RemindersSection.tsx` React component back to standard `useFrappeEventListener("reminder_logs_updated")` for bulletproof WebSocket sync. Fixed the global SWR cache `mutate` key so Adding/Editing/Submitting a reminder instantly invalidates the Action Center cache.

### 2. Administrator Role Fixes
- **Backend**: Removed the hardcoded bypass for Administrators in `api/reminders/read.py`. The Administrator is now strictly mapped to the **`Nirmaan Admin Profile`** and only sees Reminders explicitly assigned to that profile, resolving disappearing reminder issues.

### 3. Naming and Schema Updates
- **Backend**: Changed the `Reminder Schedule` Auto Name format from `REM-.####` to **`field:title`** so the human-readable title becomes the ID.
- **Backend**: Added `from_month` and `to_month` fields to the `Reminder Schedule Log` and dynamically mapped them in the `send_due_reminders` background job to properly display coverage periods for non-monthly reminders.ditReminderScheduleName)
```

---

## Role Access Summary

| Role | Manage Schedules | Action Center Visibility | Mark as Done |
|------|------------------|--------------------------|--------------| 
| Admin / PMO | Full CRUD | Yes (if targeted) | Yes |
| Accountant Lead | Full CRUD | Yes (if targeted) | Yes |
| Accountant | Read-Only | Yes | Yes (Finance tasks) |
| Project Manager| Read-Only | Yes | Yes (Project tasks) |

## Recent Fixes Applied

1. **Form state bleeding on "Add Reminder"**: `close()` now explicitly resets all form fields to blank defaults (including `due_day: "" as any`) to prevent stale edit data from persisting.
2. **Title made editable**: Changed from `autoname: field:title` to `REM-.####` with `title_field: "title"`. Title is editable post-creation. Added `reminder_title` fetch field to Log.
3. **Notification window honored**: Cron now gates log creation by `days_until_due <= notify_before_days` instead of creating logs unconditionally.
