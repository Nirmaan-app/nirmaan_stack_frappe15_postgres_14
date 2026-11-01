# ADR 0042 — A reminder's Next Due Date is its next open cycle

**Status:** Accepted · 2026-10-30 (owner)

## Context

A Reminder Schedule stores a Next Due Date and a Reminds On date, and the Reminders page shows the stored
values. They were set only when the schedule was saved, so most schedules showed their August dates in late
October (PF Filing 15-Aug on 29-Oct), and marking a cycle Done never moved them. The calculation was
calendar-only: the next due date from today, Done or not, so a cycle completed ahead of its due date kept
showing that date.

## Decision

**Next Due Date is the first due date from today whose cycle has no Done record; Reminds On follows from it.**

1. **Done skips, Reopen returns.** Marking a cycle Done moves the date to the following cycle at once; reopening
   it moves the date back.
2. **A missed cycle never holds the date back.** An overdue, still-pending cycle stays in the Action Center
   marked Overdue; the Reminders page looks forward. Marking an old overdue cycle Done does not move the date,
   because the current cycle is still open.
3. **The schedule is fixed to its calendar.** A monthly-20th reminder stays on the 20th; a late completion
   never restarts the count from the day it was done.
4. **The stored fields are kept current at three points**, all through the one pure rule
   (`services.reminders.next_open_due_date`): any save of the schedule (create, edit, switching back on), a
   cycle's status change (from the app or from Desk), and the daily 8 AM job for every enabled schedule. A
   disabled schedule keeps its last date until it is switched back on.
5. **Written without a document save.** The refresh writes the two fields directly, firing no document hooks:
   a save would run the schedule's edit hook, which treats a due-date change as an admin edit and re-dates a
   future pending cycle. The next ordinary save recomputes the same values.
6. **History stays history.** Once a schedule is deleted, its kept Done cycles cannot be reopened, in the app or
   in Desk.

## Considered options

- **Calendar only (the old rule).** Simple, but Done never shows on the page, which is what was reported.
- **The oldest unfinished cycle.** It would keep a missed cycle in front of everyone, but the page would show a
  past date, the symptom this decision fixes; the Action Center already shows overdue cycles.
- **Work the date out in the browser at read time.** No stored value to keep current, but the page, the sort
  order and any other reader would each need the Done records; one stored, refreshed value keeps one answer.

## Consequences

- **The date can lag a few hours.** Between midnight and the 8 AM job, the page can show a due date that has
  just passed.
- **The job still raises the calendar cycle.** With a remind-before period close to or above the gap between
  cycles (about 30 days monthly, about 90 quarterly) and the current cycle Done early, the next cycle's task is
  raised only once the Done cycle's date has passed. No reminder is configured that way today (all use 3 days).
- **A cycle is its exact date.** Changing a schedule's due day after a cycle was completed early asks for that
  period again.
- **No data patch.** The first 8 AM run after deploy corrects every enabled schedule.

Rule detail and write points: `.claude/plans/reminders_plan.md` §4a. Terms: `GLOSSARY.md` § Reminders.
