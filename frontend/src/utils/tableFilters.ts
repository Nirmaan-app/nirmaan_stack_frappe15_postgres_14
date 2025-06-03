// In a utility file like src/utils/tableFilters.ts or directly in your column definition files

import { Row, Column, FilterFn } from '@tanstack/react-table';
import { DateFilterValue } from '@/components/data-table/data-table-date-filter'; // Adjust path
import {
    parseISO, isWithinInterval, isEqual, isBefore, isAfter,
    startOfDay, endOfDay,
    subDays, subWeeks, subMonths, subQuarters, subYears,
    startOfWeek, endOfWeek, startOfMonth, endOfMonth,
    startOfQuarter, endOfQuarter, startOfYear, endOfYear
} from 'date-fns';

// Helper to parse cell value to a Date object.
// Ensure your cell values are consistently formatted date strings (e.g., ISO 8601) or already Date objects.
const getCellValueAsDate = (row: Row<any>, columnId: string): Date | null => {
    const cellValue = row.getValue(columnId);
    if (cellValue instanceof Date) {
        return cellValue;
    }
    if (typeof cellValue === 'string') {
        try {
            const parsed = parseISO(cellValue);
            if (!isNaN(parsed.getTime())) {
                return parsed;
            }
        } catch (e) { /* ignore parse error */ }
    }
    if (typeof cellValue === 'number') { // Handle timestamps
        try {
            const parsed = new Date(cellValue);
            if (!isNaN(parsed.getTime())) {
                return parsed;
            }
        } catch (e) { /* ignore parse error */ }
    }
    // console.warn(`Could not parse cell value for column "${columnId}" as Date:`, cellValue);
    return null;
};

// Custom filter function for DateFilterValue
export const dateFilterFn: FilterFn<any> = (
    row: Row<any>,
    columnId: string,
    filterValue: DateFilterValue, // This is { operator: string, value: string | string[] | null }
    _addMeta: (meta: any) => void
): boolean => {
    if (!filterValue || filterValue.value === null || filterValue.value === undefined) {
        return true; // No filter applied or invalid filter
    }

    const cellDate = getCellValueAsDate(row, columnId);
    if (!cellDate) {
        return false; // If cell value can't be parsed as date, don't include it
    }

    const { operator, value } = filterValue;

    try {
        if (operator === 'Is' && typeof value === 'string') {
            const filterDate = startOfDay(parseISO(value));
            return isEqual(startOfDay(cellDate), filterDate);
        }
        if (operator === 'Between' && Array.isArray(value) && value.length === 2) {
            const from = startOfDay(parseISO(value[0]));
            const to = endOfDay(parseISO(value[1])); // Use endOfDay for 'Between' inclusive
            return isWithinInterval(cellDate, { start: from, end: to });
        }
        if (operator === '<=' && typeof value === 'string') {
            const filterDate = endOfDay(parseISO(value)); // On or before means up to end of that day
            return isBefore(cellDate, filterDate) || isEqual(startOfDay(cellDate), startOfDay(filterDate));
        }
        if (operator === '>=' && typeof value === 'string') {
            const filterDate = startOfDay(parseISO(value));
            return isAfter(cellDate, filterDate) || isEqual(startOfDay(cellDate), startOfDay(filterDate));
        }
        if (operator === 'Timespan' && typeof value === 'string') {
            const today = startOfDay(new Date());
            let startDate: Date;
            let endDate: Date = endOfDay(new Date()); // Most timespans end today or in past

            switch (value) {
                case 'today': startDate = today; endDate = endOfDay(today); break;
                case 'yesterday':
                    startDate = startOfDay(subDays(today, 1));
                    endDate = endOfDay(subDays(today, 1));
                    break;
                case 'last 7 days': startDate = startOfDay(subDays(today, 6)); break; // 6 days ago to include today
                case 'last 14 days': startDate = startOfDay(subDays(today, 13)); break;
                case 'last 30 days': startDate = startOfDay(subDays(today, 29)); break;
                case 'last 90 days': startDate = startOfDay(subDays(today, 89)); break;
                case 'this week': startDate = startOfWeek(today); endDate = endOfWeek(today); break;
                case 'last week':
                    startDate = startOfWeek(subWeeks(today, 1));
                    endDate = endOfWeek(subWeeks(today, 1));
                    break;
                case 'this month': startDate = startOfMonth(today); endDate = endOfMonth(today); break;
                case 'last month':
                    startDate = startOfMonth(subMonths(today, 1));
                    endDate = endOfMonth(subMonths(today, 1));
                    break;
                case 'this quarter': startDate = startOfQuarter(today); endDate = endOfQuarter(today); break;
                case 'last quarter':
                    startDate = startOfQuarter(subQuarters(today, 1));
                    endDate = endOfQuarter(subQuarters(today, 1));
                    break;
                case 'last 6 months': startDate = startOfDay(subMonths(today, 6)); break; // approx
                case 'this year': startDate = startOfYear(today); endDate = endOfYear(today); break;
                case 'last year':
                    startDate = startOfYear(subYears(today, 1));
                    endDate = endOfYear(subYears(today, 1));
                    break;
                default: return true; // Unknown timespan, don't filter
            }
            return isWithinInterval(cellDate, { start: startDate, end: endDate });
        }
    } catch (e) {
        // console.error("Error applying date filter:", e);
        return false; // Error during parsing/comparison
    }

    return true; // Default to true if operator not matched
};

// Custom filter function for faceted filters (where filterValue is string[])
export const facetedFilterFn: FilterFn<any> = (
    row: Row<any>,
    columnId: string,
    filterValue: string[], // This is an array of selected string values
    _addMeta: (meta: any) => void
): boolean => {
    if (!filterValue || filterValue.length === 0) {
        return true; // No filter applied
    }
    const cellValue = row.getValue(columnId);

    // Handle cases where cell value might be an array (e.g. multi-select in backend)
    if (Array.isArray(cellValue)) {
        return cellValue.some(item => filterValue.includes(String(item)));
    }

    return filterValue.includes(String(cellValue));
};