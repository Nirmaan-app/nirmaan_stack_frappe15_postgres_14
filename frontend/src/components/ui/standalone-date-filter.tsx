/**
 * StandaloneDateFilter — Same UI as DataTableDateFilter but decoupled from TanStack Table.
 * Accepts value/onChange props instead of a Column instance.
 */

import * as React from 'react';
import { format } from 'date-fns';

import { Badge } from '@/components/ui/badge';
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
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

// Reuse the same filter value shape as DataTableDateFilter
export interface DateFilterValue {
    operator: string;
    value: string | string[] | null;
}

const dateOperators = [
    { value: 'Is', label: 'Is' },
    { value: 'Between', label: 'Between' },
    { value: '<=', label: 'On or Before' },
    { value: '>=', label: 'On or After' },
    { value: 'Timespan', label: 'Timespan' },
];

const timespanOptions = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'last week', label: 'Last Week' },
    { value: 'last month', label: 'Last Month' },
    { value: 'last quarter', label: 'Last Quarter' },
    { value: 'last 6 months', label: 'Last Half Year' },
    { value: 'last year', label: 'Last Year' },
    { value: 'last 7 days', label: 'Last 7 days' },
    { value: 'last 14 days', label: 'Last 14 days' },
    { value: 'last 30 days', label: 'Last 30 days' },
    { value: 'last 90 days', label: 'Last 90 days' },
    { value: 'this week', label: 'This Week' },
    { value: 'this month', label: 'This Month' },
    { value: 'this quarter', label: 'This Quarter' },
    { value: 'this year', label: 'This Year' },
];

const formatDateForFilter = (date: Date | undefined | null): string | undefined => {
    return date ? format(date, 'yyyy-MM-dd') : undefined;
};

const parseFilterDate = (dateString: string | undefined | null): Date | undefined => {
    if (!dateString) return undefined;
    try {
        const date = new Date(dateString + 'T00:00:00');
        if (isNaN(date.getTime())) return undefined;
        return date;
    } catch {
        return undefined;
    }
};

// --- Timespan resolver: converts a timespan label into { from, to } date strings ---
export function resolveTimespanToRange(timespan: string): { from: string; to: string } | undefined {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

    const daysAgo = (n: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() - n);
        return d;
    };

    switch (timespan) {
        case 'today':
            return { from: fmt(today), to: fmt(today) };
        case 'yesterday': {
            const y = daysAgo(1);
            return { from: fmt(y), to: fmt(y) };
        }
        case 'last 7 days':
            return { from: fmt(daysAgo(7)), to: fmt(today) };
        case 'last 14 days':
            return { from: fmt(daysAgo(14)), to: fmt(today) };
        case 'last 30 days':
            return { from: fmt(daysAgo(30)), to: fmt(today) };
        case 'last 90 days':
            return { from: fmt(daysAgo(90)), to: fmt(today) };
        case 'last week': {
            const endOfLastWeek = daysAgo(today.getDay() + 1); // Last Saturday
            const startOfLastWeek = new Date(endOfLastWeek);
            startOfLastWeek.setDate(endOfLastWeek.getDate() - 6);
            return { from: fmt(startOfLastWeek), to: fmt(endOfLastWeek) };
        }
        case 'last month': {
            const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const lastOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
            return { from: fmt(firstOfLastMonth), to: fmt(lastOfLastMonth) };
        }
        case 'last quarter': {
            const currentQ = Math.floor(today.getMonth() / 3);
            const firstOfLastQ = new Date(today.getFullYear(), (currentQ - 1) * 3, 1);
            const lastOfLastQ = new Date(today.getFullYear(), currentQ * 3, 0);
            return { from: fmt(firstOfLastQ), to: fmt(lastOfLastQ) };
        }
        case 'last 6 months':
            return { from: fmt(daysAgo(183)), to: fmt(today) };
        case 'last year': {
            const firstOfLastYear = new Date(today.getFullYear() - 1, 0, 1);
            const lastOfLastYear = new Date(today.getFullYear() - 1, 11, 31);
            return { from: fmt(firstOfLastYear), to: fmt(lastOfLastYear) };
        }
        case 'this week': {
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - today.getDay());
            return { from: fmt(startOfWeek), to: fmt(today) };
        }
        case 'this month': {
            const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            return { from: fmt(firstOfMonth), to: fmt(today) };
        }
        case 'this quarter': {
            const q = Math.floor(today.getMonth() / 3);
            const firstOfQ = new Date(today.getFullYear(), q * 3, 1);
            return { from: fmt(firstOfQ), to: fmt(today) };
        }
        case 'this year': {
            const firstOfYear = new Date(today.getFullYear(), 0, 1);
            return { from: fmt(firstOfYear), to: fmt(today) };
        }
        default:
            return undefined;
    }
}

// --- Resolve any DateFilterValue to { from?, to? } date strings ---
export function resolveDateFilterToRange(filter: DateFilterValue | undefined): { from?: string; to?: string } {
    if (!filter || !filter.value) return {};

    switch (filter.operator) {
        case 'Is':
            if (typeof filter.value === 'string') return { from: filter.value, to: filter.value };
            break;
        case 'Between':
            if (Array.isArray(filter.value)) return { from: filter.value[0], to: filter.value[1] };
            break;
        case '<=':
            if (typeof filter.value === 'string') return { to: filter.value };
            break;
        case '>=':
            if (typeof filter.value === 'string') return { from: filter.value };
            break;
        case 'Timespan':
            if (typeof filter.value === 'string') return resolveTimespanToRange(filter.value) || {};
            break;
    }
    return {};
}

// --- Component Props ---
interface StandaloneDateFilterProps {
    value?: DateFilterValue;
    onChange: (value: DateFilterValue | undefined) => void;
    placeholder?: string;
}

export function StandaloneDateFilter({
    value,
    onChange,
    placeholder = 'Filter by date',
}: StandaloneDateFilterProps) {
    const [operator, setOperator] = React.useState<string>(value?.operator || 'Between');
    const [date, setDate] = React.useState<Date | undefined>(() =>
        parseFilterDate(
            value?.operator !== 'Between' && value?.operator !== 'Timespan' && typeof value?.value === 'string'
                ? value.value : undefined
        )
    );
    const [dateRange, setDateRange] = React.useState<{ from: Date | undefined; to: Date | undefined }>(() => ({
        from: parseFilterDate(value?.operator === 'Between' && Array.isArray(value.value) ? value.value[0] : undefined),
        to: parseFilterDate(value?.operator === 'Between' && Array.isArray(value.value) ? value.value[1] : undefined),
    }));
    const [timespan, setTimespan] = React.useState<string | undefined>(() =>
        value?.operator === 'Timespan' && typeof value?.value === 'string' ? value.value : undefined
    );
    const [popoverOpen, setPopoverOpen] = React.useState(false);

    // Sync internal state when external value changes
    React.useEffect(() => {
        setOperator(value?.operator || 'Between');
        setDate(parseFilterDate(
            value?.operator !== 'Between' && value?.operator !== 'Timespan' && typeof value?.value === 'string'
                ? value.value : undefined
        ));
        setDateRange({
            from: parseFilterDate(value?.operator === 'Between' && Array.isArray(value.value) ? value.value[0] : undefined),
            to: parseFilterDate(value?.operator === 'Between' && Array.isArray(value.value) ? value.value[1] : undefined),
        });
        setTimespan(
            value?.operator === 'Timespan' && typeof value?.value === 'string' ? value.value : undefined
        );
    }, [value?.operator, JSON.stringify(value?.value)]);

    const handleApply = () => {
        let newFilter: DateFilterValue | undefined = undefined;

        if (operator === 'Between') {
            if (dateRange.from && dateRange.to) {
                const from = formatDateForFilter(dateRange.from);
                const to = formatDateForFilter(dateRange.to);
                if (from && to) newFilter = { operator, value: [from, to] };
            }
        } else if (operator === 'Timespan') {
            if (timespan) newFilter = { operator, value: timespan };
        } else if (['Is', '<=', '>='].includes(operator)) {
            if (date) {
                const val = formatDateForFilter(date);
                if (val) newFilter = { operator, value: val };
            }
        }

        onChange(newFilter);
        setPopoverOpen(false);
    };

    const handleClear = () => {
        onChange(undefined);
        setPopoverOpen(false);
    };

    // Format the display label for the trigger button
    const displayLabel = React.useMemo(() => {
        if (!value || !value.value) return null;
        const opLabel = dateOperators.find(op => op.value === value.operator)?.label || value.operator;

        if (value.operator === 'Between' && Array.isArray(value.value)) {
            const from = parseFilterDate(value.value[0]);
            const to = parseFilterDate(value.value[1]);
            return `${opLabel}: ${from ? format(from, 'dd MMM') : '?'} – ${to ? format(to, 'dd MMM yyyy') : '?'}`;
        } else if (value.operator === 'Timespan' && typeof value.value === 'string') {
            return timespanOptions.find(t => t.value === value.value)?.label || value.value;
        } else if (typeof value.value === 'string') {
            const d = parseFilterDate(value.value);
            return `${opLabel}: ${d ? format(d, 'dd MMM yyyy') : '?'}`;
        }
        return null;
    }, [value]);

    const isActive = !!value?.value;

    return (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                        'h-8 text-xs font-normal border-gray-300 gap-1.5',
                        isActive && 'border-primary/40 bg-primary/5 text-primary'
                    )}
                >
                    <CalendarDays className="h-3.5 w-3.5" />
                    {displayLabel ? (
                        <span className="font-medium truncate max-w-[180px]">{displayLabel}</span>
                    ) : (
                        <span className="text-muted-foreground">{placeholder}</span>
                    )}
                    {isActive && (
                        <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px] rounded-sm">
                            1
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
                <div className="p-4 space-y-4">
                    {/* Operator Select */}
                    <div className="space-y-2">
                        <Label>Condition</Label>
                        <Select value={operator} onValueChange={setOperator}>
                            <SelectTrigger className="h-8">
                                <SelectValue placeholder="Select condition" />
                            </SelectTrigger>
                            <SelectContent>
                                {dateOperators.map((op) => (
                                    <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Calendar / Timespan based on operator */}
                    {operator === 'Between' && (
                        <div className="space-y-2">
                            <Label>Date Range</Label>
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={dateRange?.from}
                                selected={dateRange}
                                onSelect={(range) => setDateRange({ from: range?.from, to: range?.to })}
                                numberOfMonths={1}
                            />
                        </div>
                    )}
                    {['Is', '<=', '>='].includes(operator) && (
                        <div className="space-y-2">
                            <Label>Date</Label>
                            <Calendar
                                mode="single"
                                selected={date}
                                onSelect={setDate}
                                initialFocus
                            />
                        </div>
                    )}
                    {operator === 'Timespan' && (
                        <div className="space-y-2">
                            <Label>Timespan</Label>
                            <Select value={timespan} onValueChange={setTimespan}>
                                <SelectTrigger className="h-8">
                                    <SelectValue placeholder="Select timespan" />
                                </SelectTrigger>
                                <SelectContent>
                                    {timespanOptions.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
                <Separator />
                <div className="p-2 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={handleClear} disabled={!isActive}>Clear</Button>
                    <Button size="sm" onClick={handleApply}>Apply</Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
