// src/components/data-table/date-filter-popover.tsx

import * as React from 'react';

import {
    dateOperators,
    formatDateForFilterValue,
    parseFilterDate,
    timespanOptions,
    type DateFilterValue,
} from './dateFilterModel';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

/**
 * The app's date column filter, as a CONTROLLED component.
 *
 * ⚠️ IT WAS EXTRACTED FROM `DataTableDateFilter`, WHICH NOW DELEGATES TO IT, AND THE EXTRACTION IS
 * THE POINT. That component reads and writes a TanStack `Column` (`column.getFilterValue()` /
 * `setFilterValue`), so a table that is not a TanStack table -- the Bulk Import Outflow master
 * table is hand-rolled -- could not use it at all. The obvious alternative was to write a second
 * date filter for that screen, which is how one application ends up with two date filters that
 * offer different operators and resolve "last quarter" differently.
 *
 * So the OPERATORS, the TIMESPANS, the layout and the Apply/Clear behaviour live here, once, and
 * both callers render this. `DataTableDateFilter` keeps its exact signature and behaviour -- it
 * binds the column to `value` / `onChange` and changes nothing else -- so every screen already
 * using it is untouched.
 *
 * ⚠️ IT RESOLVES NOTHING. A `Timespan` is emitted as the WORD ("last 30 days"), never as dates.
 * Frappe's own list filters understand the word server-side, which is what the DataTable path
 * relies on; a caller whose endpoint takes plain dates resolves it itself (see
 * `utils/dateFilterRange.ts`). Resolving here would freeze a relative window at the moment the
 * popover happened to be open.
 */

/**
 * ⚠️ THE VOCABULARY AND THE VALUE SHAPE MOVED TO `dateFilterModel.ts`, AND ARE RE-EXPORTED HERE.
 * They are pure, and pure MODELS need them: the outflow screen's `outflowPeriod.ts` and
 * `outflowTableModel.ts` both declare themselves React-free, because this repository has no DOM test
 * environment and everything testable is deliberately kept out of components. Importing a runtime
 * value from this `.tsx` would have pulled React into their graph.
 *
 * Re-exported rather than moved-and-updated-everywhere so every existing import path keeps working
 * and there is still exactly one vocabulary. If you are ADDING an operator or a timespan, add it in
 * the model file -- and teach `utils/dateFilterRange.ts` about it in the same change, or the control
 * offers an option that silently filters nothing.
 */
export {
    dateOperators,
    describeDateFilter,
    formatDateForFilterValue,
    parseFilterDate,
    timespanOptions,
    type DateFilterValue,
} from "./dateFilterModel";

interface DateFilterPopoverProps {
    value?: DateFilterValue | null;
    onChange: (value: DateFilterValue | undefined) => void;
    /** The trigger. Rendered inside a `PopoverTrigger asChild`, so it must take a ref. */
    children: React.ReactNode;
    /** Distinguishes the labels' `htmlFor` when several of these are on one screen. */
    id?: string;
    align?: 'start' | 'center' | 'end';
}

export function DateFilterPopover({
    value,
    onChange,
    children,
    id = 'date',
    align = 'start',
}: DateFilterPopoverProps) {
    const [operator, setOperator] = React.useState<string>(value?.operator || 'Is');
    const [date, setDate] = React.useState<Date | undefined>(() =>
        parseFilterDate(
            value?.operator !== 'Between' &&
                value?.operator !== 'Timespan' &&
                typeof value?.value === 'string'
                ? value.value
                : undefined
        )
    );
    const [dateRange, setDateRange] = React.useState<{ from?: Date; to?: Date }>(() => ({
        from: parseFilterDate(
            value?.operator === 'Between' && Array.isArray(value.value) ? value.value[0] : undefined
        ),
        to: parseFilterDate(
            value?.operator === 'Between' && Array.isArray(value.value) ? value.value[1] : undefined
        ),
    }));
    const [timespan, setTimespan] = React.useState<string | undefined>(() =>
        value?.operator === 'Timespan' && typeof value?.value === 'string' ? value.value : undefined
    );
    const [popoverOpen, setPopoverOpen] = React.useState(false);

    // Re-read the value when it changes underneath us -- a URL load, a Clear button elsewhere, or
    // (on the outflow screen) the period selector, which edits the SAME value from another control.
    React.useEffect(() => {
        setOperator(value?.operator || 'Is');
        setDate(
            parseFilterDate(
                value?.operator !== 'Between' &&
                    value?.operator !== 'Timespan' &&
                    typeof value?.value === 'string'
                    ? value.value
                    : undefined
            )
        );
        setDateRange({
            from: parseFilterDate(
                value?.operator === 'Between' && Array.isArray(value.value)
                    ? value.value[0]
                    : undefined
            ),
            to: parseFilterDate(
                value?.operator === 'Between' && Array.isArray(value.value)
                    ? value.value[1]
                    : undefined
            ),
        });
        setTimespan(
            value?.operator === 'Timespan' && typeof value?.value === 'string'
                ? value.value
                : undefined
        );
    }, [value]);

    const handleApply = () => {
        let next: DateFilterValue | undefined;

        if (operator === 'Between') {
            const from = formatDateForFilterValue(dateRange.from);
            const to = formatDateForFilterValue(dateRange.to);
            if (from && to) next = { operator, value: [from, to] };
        } else if (operator === 'Timespan') {
            if (timespan) next = { operator, value: timespan };
        } else if (['Is', 'IsNot', '<=', '>='].includes(operator)) {
            const only = formatDateForFilterValue(date);
            if (only) next = { operator, value: only };
        }

        onChange(next);
        setPopoverOpen(false);
    };

    const handleClear = () => {
        onChange(undefined);
        setPopoverOpen(false);
    };

    return (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align={align}>
                <div className="space-y-4 p-4">
                    <div className="space-y-2">
                        <Label htmlFor={`op-${id}`}>Condition</Label>
                        <Select value={operator} onValueChange={setOperator}>
                            <SelectTrigger id={`op-${id}`} className="h-8">
                                <SelectValue placeholder="Select condition" />
                            </SelectTrigger>
                            <SelectContent>
                                {dateOperators.map((op) => (
                                    <SelectItem key={op.value} value={op.value}>
                                        {op.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {operator === 'Between' && (
                        <div className="space-y-2">
                            <Label>Date Range</Label>
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={dateRange?.from}
                                selected={dateRange as any}
                                onSelect={(range: any) =>
                                    setDateRange({ from: range?.from, to: range?.to })
                                }
                                numberOfMonths={1}
                            />
                        </div>
                    )}

                    {['Is', 'IsNot', '<=', '>='].includes(operator) && (
                        <div className="space-y-2">
                            <Label>Date</Label>
                            <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                        </div>
                    )}

                    {operator === 'Timespan' && (
                        <div className="space-y-2">
                            <Label htmlFor={`ts-${id}`}>Timespan</Label>
                            <Select value={timespan} onValueChange={setTimespan}>
                                <SelectTrigger id={`ts-${id}`} className="h-8">
                                    <SelectValue placeholder="Select timespan" />
                                </SelectTrigger>
                                <SelectContent>
                                    {timespanOptions.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
                <Separator />
                <div className="flex justify-end gap-2 p-2">
                    <Button variant="ghost" size="sm" onClick={handleClear} disabled={!value}>
                        Clear
                    </Button>
                    <Button size="sm" onClick={handleApply}>
                        Apply
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
