// Types for the dashboard Reminders panel — mirrors the payload returned by
// `nirmaan_stack.api.reminders.read.get_my_reminders`.

export type ReminderBucket = "due_soon" | "this_month" | "later";

export type ReminderScheduleType =
  | "Monthly"
  | "Quarterly"
  | "Half-Yearly"
  | "Custom Dates";

export interface ReminderRow {
  name: string;
  title: string;
  schedule_type: ReminderScheduleType;
  message?: string | null;
  notify_before_days: number;
  /** YYYY-MM-DD — the next upcoming due date, computed live against today. */
  next_due_date: string;
  /** YYYY-MM-DD — the date the reminder fires (= next_due_date - notify_before). */
  reminds_on: string | null;
  /** Whole days from today to next_due_date (>= 0). */
  days_until: number;
  /** True when the notify window is open now (days_until <= notify_before_days). */
  is_active: boolean;
  bucket: ReminderBucket;
}

export interface GetMyRemindersResponse {
  message: {
    reminders: ReminderRow[];
  };
}
