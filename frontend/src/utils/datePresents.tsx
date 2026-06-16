// frontend/src/utils/datePresets.ts
import { DateRange } from 'react-day-picker';
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';

export interface DatePreset {
  label: string;
  getRange: () => DateRange | undefined;
}

// "today" is read live inside each getRange() — i.e. when the user clicks the
// preset — NOT frozen at module load. A frozen date drifts: a tab left open
// across midnight (or a long-lived SPA session) keeps computing an old window,
// so "Last 30 days" stops matching the server-computed dashboard cards. Reading
// it live keeps every report's relative presets aligned with the real date.
export const datePresets: DatePreset[] = [
  {
    label: 'Today',
    getRange: () => {
      const today = new Date();
      return { from: startOfDay(today), to: endOfDay(today) };
    },
  },
  {
    label: 'Yesterday',
    getRange: () => {
      const yesterday = subDays(new Date(), 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    },
  },
  {
    label: 'Last 7 days',
    getRange: () => {
      const today = new Date();
      return { from: startOfDay(subDays(today, 6)), to: endOfDay(today) };
    },
  },
  {
    label: 'Last 30 days',
    getRange: () => {
      const today = new Date();
      return { from: startOfDay(subDays(today, 29)), to: endOfDay(today) };
    },
  },
  {
    label: 'This month',
    getRange: () => {
      const today = new Date();
      return { from: startOfMonth(today), to: endOfMonth(today) };
    },
  },
  {
    label: 'This year',
    getRange: () => {
      const today = new Date();
      return { from: startOfYear(today), to: endOfYear(today) };
    },
  },
  {
    label: 'FY 25-26',
    getRange: () => ({
        from: startOfDay(new Date('2025-04-01')),
        to: endOfDay(new Date('2026-03-31')),
    }),
  },
  {
    label: 'FY 26-27',
    getRange: () => ({
        from: startOfDay(new Date('2026-04-01')),
        to: endOfDay(new Date('2027-03-31')),
    }),
  },
  {
    label: 'ALL',
    getRange: () => undefined,  // Returns undefined to disable date filtering entirely
  }
,
];