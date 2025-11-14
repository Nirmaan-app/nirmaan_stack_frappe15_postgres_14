// frontend/src/utils/datePresets.ts
import { DateRange } from 'react-day-picker';
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';

export interface DatePreset {
  label: string;
  getRange: () => DateRange;
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
   // --- 👇 NEW PRESET ADDED HERE ---
  {
    label: 'Financial Year',
    getRange: () => {
        // The start date is fixed as per your requirement.
        const financialYearStart = new Date('2025-04-01');
        // The end date is always the end of the current day.
        const today = new Date();
        return { from: financialYearStart, to: endOfDay(today) };
    },},
     {
    label: 'ALL',
    getRange: () => {
        // The start date is fixed as per your requirement.
        const financialYearStart = new Date('2024-04-01');
        // The end date is always the end of the current day.
        const today = new Date();
        return { from: financialYearStart, to: endOfDay(today) };
    },}
,
];