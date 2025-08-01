// src/pages/vendors/components/AdvancedDateFilter.tsx

import * as React from 'react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
// --- 1. IMPORT BOTH ICONS ---
import { Filter, FilterX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

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
    { value: 'last 7 days', label: 'Last 7 days' },
    { value: 'last 30 days', label: 'Last 30 days' },
    { value: 'this month', label: 'This Month' },
    { value: 'last month', label: 'Last Month' },
    { value: 'this year', label: 'This Year' },
];

interface AdvancedDateFilterProps {
    value: DateFilterValue | undefined;
    onChange: (value: DateFilterValue | undefined) => void;
}

const formatDateForFilter = (date: Date): string => format(date, 'yyyy-MM-dd');

export function AdvancedDateFilter({ value: filterValue, onChange }: AdvancedDateFilterProps) {
    const [popoverOpen, setPopoverOpen] = React.useState(false);
    const [operator, setOperator] = React.useState(filterValue?.operator || 'Is');
    const [date, setDate] = React.useState<Date | undefined>();
    const [dateRange, setDateRange] = React.useState<DateRange | undefined>();
    const [timespan, setTimespan] = React.useState<string | undefined>();

    const handleApplyFilter = () => {
        let newFilter: DateFilterValue | undefined = undefined;
        if (operator === 'Between' && dateRange?.from && dateRange?.to) {
            newFilter = { operator, value: [formatDateForFilter(dateRange.from), formatDateForFilter(dateRange.to)] };
        } else if (operator === 'Timespan' && timespan) {
            newFilter = { operator, value: timespan };
        } else if (['Is', '<=', '>='].includes(operator) && date) {
            newFilter = { operator, value: formatDateForFilter(date) };
        }
        onChange(newFilter);
        setPopoverOpen(false);
    };

    const handleClearFilter = () => {
        onChange(undefined);
        setPopoverOpen(false);
    };

    return (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 data-[state=open]:bg-accent"
                >
                    {/* --- 2. ADD CONDITIONAL ICON LOGIC --- */}
                    {filterValue ? (
                        <FilterX className="h-4 w-4 text-red-500 animate-bounce" />
                    ) : (
                        <Filter className="h-4 w-4 text-red-500" />
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <div className="p-4 space-y-4">
                    <div className="space-y-2">
                        <Label>Condition</Label>
                        <Select value={operator} onValueChange={setOperator}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>{dateOperators.map((op) => <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    {operator === 'Between' && <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />}
                    {['Is', '<=', '>='].includes(operator) && <Calendar mode="single" selected={date} onSelect={setDate} />}
                    {operator === 'Timespan' && (
                         <Select value={timespan} onValueChange={setTimespan}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Select a period..." /></SelectTrigger>
                            <SelectContent>{timespanOptions.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}</SelectContent>
                        </Select>
                    )}
                </div>
                <Separator />
                <div className="p-2 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={handleClearFilter}>Clear</Button>
                    <Button size="sm" onClick={handleApplyFilter} className="bg-red-600 hover:bg-red-700 text-white">Apply</Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}