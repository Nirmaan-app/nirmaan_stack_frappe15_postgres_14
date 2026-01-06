// frontend/src/utils/datePresets.ts
import { DateRange } from 'react-day-picker';
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';

export interface DatePreset {
  label: string;
  getRange: () => DateRange | undefined;
}

const today = new Date();

export const datePresets: DatePreset[] = [
  {
    label: 'Today',
    getRange: () => ({ from: startOfDay(today), to: endOfDay(today) }),
  },
  {
    label: 'Yesterday',
    getRange: () => {
      const yesterday = subDays(today, 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    },
  },
  {
    label: 'Last 7 days',
    getRange: () => ({ from: startOfDay(subDays(today, 6)), to: endOfDay(today) }),
  },
  {
    label: 'Last 30 days',
    getRange: () => ({ from: startOfDay(subDays(today, 29)), to: endOfDay(today) }),
  },
  {
    label: 'This month',
    getRange: () => ({ from: startOfMonth(today), to: endOfMonth(today) }),
  },
  {
    label: 'This year',
    getRange: () => ({ from: startOfYear(today), to: endOfYear(today) }),
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