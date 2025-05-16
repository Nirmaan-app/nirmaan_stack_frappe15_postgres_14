import * as React from 'react';
// import { CalendarIcon, MixerHorizontalIcon } from '@radix-ui/react-icons';
import { Column } from '@tanstack/react-table';
import { format } from 'date-fns'; // Date utility

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
import { Filter, FilterX } from 'lucide-react';

// Define the structure for our date filter state
export interface DateFilterValue {
    operator: string;
    value: string | string[] | null; // string for single date/timespan, array for 'Between'
}

// Define operators
const dateOperators = [
    { value: 'Is', label: 'Is' },
    // { value: 'IsNot', label: 'Is Not' },
    { value: 'Between', label: 'Between' },
    { value: '<=', label: 'On or Before' },
    { value: '>=', label: 'On or After' },
    { value: 'Timespan', label: 'Timespan' },
    // Add { value: '>', label: 'After' }, { value: '<', label: 'Before' } if needed
];

const timespanOptions = [
    // Relative to today
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    // { value: 'this week', label: 'This Week' },
    { value: 'last week', label: 'Last Week' },
    { value: 'last month', label: 'Last Month' },
    {value: "last quarter", label: "Last Quarter"},
    {value: "last 6 months", label: "Last Half Year"},
    { value: 'last year', label: 'Last Year' },
    // { value: 'next week', label: 'Next Week' },
    // { value: 'next month', label: 'Next Month' },
    // { value: 'next year', label: 'Next Year' },
    // Rolling period
    { value: 'last 7 days', label: 'Last 7 days' },
    { value: 'last 14 days', label: 'Last 14 days' },
    { value: 'last 30 days', label: 'Last 30 days' },
    // { value: 'last 60 days', label: 'Last 60 days' },
    { value: 'last 90 days', label: 'Last 90 days' },
    // { value: 'last 180 days', label: 'Last 180 days' },
    // { value: 'last 365 days', label: 'Last 365 days' },
    // Specific periods
    { value: 'this week', label: 'This Week' },
    { value: 'this month', label: 'This Month' },
    { value: 'this quarter', label: 'This Quarter' },
    { value: 'this year', label: 'This Year' },
    // { value: 'previous week', label: 'Previous Week' },
    // { value: 'previous month', label: 'Previous Month' },
    // { value: 'previous quarter', label: 'Previous Quarter' },
    // { value: 'previous year', label: 'Previous Year' },
];

interface DataTableDateFilterProps<TData> {
    column: Column<TData, unknown>;
    title?: string;
}

// Helper to format date for filter value (YYYY-MM-DD)
const formatDateForFilterValue = (date: Date | undefined | null): string | undefined => {
    return date ? format(date, 'yyyy-MM-dd') : undefined;
};

// Helper to safely parse date string, considering timezone might be needed
const parseFilterDate = (dateString: string | undefined | null): Date | undefined => {
    if (!dateString) return undefined;
    try {
        // Important: Adding time prevents timezone shifts from changing the date
        const date = new Date(dateString + 'T00:00:00');
        // Basic validation
        if (isNaN(date.getTime())) return undefined;
        return date;
    } catch (e) {
        return undefined;
    }
}


export function DataTableDateFilter<TData>({
    column,
    title,
}: DataTableDateFilterProps<TData>) {

    const filterValue = column.getFilterValue() as DateFilterValue | undefined;

    // Internal state for the popover UI elements
    const [operator, setOperator] = React.useState<string>(filterValue?.operator || 'Is');
    const [date, setDate] = React.useState<Date | undefined>(() =>
        parseFilterDate(
             (filterValue?.operator !== 'Between' && filterValue?.operator !== 'Timespan' && typeof filterValue?.value === 'string')
                ? filterValue.value : undefined
        )
    );
    const [dateRange, setDateRange] = React.useState<{ from: Date | undefined; to: Date | undefined }>(() => ({
        from: parseFilterDate(filterValue?.operator === 'Between' && Array.isArray(filterValue.value) ? filterValue.value[0] : undefined),
        to: parseFilterDate(filterValue?.operator === 'Between' && Array.isArray(filterValue.value) ? filterValue.value[1] : undefined),
    }));
    const [timespan, setTimespan] = React.useState<string | undefined>(() =>
         filterValue?.operator === 'Timespan' && typeof filterValue?.value === 'string' ? filterValue.value : undefined
    );
    const [popoverOpen, setPopoverOpen] = React.useState(false);

    // Sync UI state when filter value changes externally (e.g., URL load, reset button)
    React.useEffect(() => {
        const currentFilter = column.getFilterValue() as DateFilterValue | undefined;
        setOperator(currentFilter?.operator || 'Is');
        setDate(parseFilterDate( (currentFilter?.operator !== 'Between' && currentFilter?.operator !== 'Timespan' && typeof currentFilter?.value === 'string') ? currentFilter.value : undefined ));
        setDateRange({
            from: parseFilterDate(currentFilter?.operator === 'Between' && Array.isArray(currentFilter.value) ? currentFilter.value[0] : undefined),
            to: parseFilterDate(currentFilter?.operator === 'Between' && Array.isArray(currentFilter.value) ? currentFilter.value[1] : undefined),
        });
        setTimespan(currentFilter?.operator === 'Timespan' && typeof currentFilter?.value === 'string' ? currentFilter.value : undefined);
    }, [column.getFilterValue()]); // Depend only on the external value

    const handleApplyFilter = () => {
        let newFilter: DateFilterValue | undefined = undefined;
        let hasValidValue = false;

        if (operator === 'Between') {
            if (dateRange.from && dateRange.to) {
                const valFrom = formatDateForFilterValue(dateRange.from);
                const valTo = formatDateForFilterValue(dateRange.to);
                if(valFrom && valTo) {
                    newFilter = { operator, value: [valFrom, valTo] };
                    hasValidValue = true;
                }
            }
        } else if (operator === 'Timespan') {
            if (timespan) {
                newFilter = { operator, value: timespan };
                hasValidValue = true;
            }
        } else if (['Is', 'IsNot', '<=', '>='].includes(operator)) {
            if (date) {
                const val = formatDateForFilterValue(date);
                if (val) {
                    newFilter = { operator, value: val };
                    hasValidValue = true;
                }
            }
        }

        console.log("Applying Date Filter:", newFilter);
        column.setFilterValue(hasValidValue ? newFilter : undefined);
        setPopoverOpen(false); // Close popover on apply
    };

    const handleClearFilter = () => {
        column.setFilterValue(undefined);
        setPopoverOpen(false); // Close popover on clear
    };

    const renderSelectedValue = () => {
        // Use the actual filterValue from the column state for display consistency
        const currentFilter = column.getFilterValue() as DateFilterValue | undefined;
        if (!currentFilter || !currentFilter.value) return null;
        const opLabel = dateOperators.find(op => op.value === currentFilter.operator)?.label || currentFilter.operator;
        let displayValue = '';
        if (currentFilter.operator === 'Between' && Array.isArray(currentFilter.value)) {
            const fromDate = parseFilterDate(currentFilter.value[0]);
            const toDate = parseFilterDate(currentFilter.value[1]);
            displayValue = `${fromDate ? format(fromDate, 'P') : '?'} to ${toDate ? format(toDate, 'P') : '?'}`; // 'P' for localized date format
        } else if (currentFilter.operator === 'Timespan' && typeof currentFilter.value === 'string') {
             displayValue = timespanOptions.find(t => t.value === currentFilter.value)?.label || currentFilter.value;
        } else if (typeof currentFilter.value === 'string') {
             const displayDate = parseFilterDate(currentFilter.value);
             displayValue = displayDate ? format(displayDate, 'P') : '?';
        }
        return (
            <>
                <Separator orientation="vertical" className="mx-2 h-4" />
                <Badge variant="secondary" className="rounded-sm px-1 font-normal whitespace-nowrap">
                    {opLabel}: {displayValue}
                </Badge>
            </>
        );
    }

    return (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>

          <PopoverTrigger asChild>
              <div
                  className={`cursor-pointer ${
                    column.getFilterValue() && "bg-gray-200"
                  } hover:bg-gray-100 px-1 pr-2 py-1 rounded-md`}
              >
                  {column.getFilterValue() ? (
                      <FilterX
                          className={`text-primary h-4 w-4 ${
                            column.getFilterValue() && "animate-bounce"
                          }`}
                      />
                  ) : (
                      <Filter className="text-primary h-4 w-4" />
                  )}
              </div>
          </PopoverTrigger>
            {/* <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 border-dashed">
                    <MixerHorizontalIcon className="mr-2 h-4 w-4" />
                    {title || column.id}
                    {renderSelectedValue()}
                </Button>
            </PopoverTrigger> */}
            <PopoverContent className="w-[300px] p-0" align="start">
                <div className="p-4 space-y-4">
                    {/* Operator Select */}
                    <div className="space-y-2">
                        <Label htmlFor={`op-${column.id}`}>Condition</Label>
                        <Select value={operator} onValueChange={setOperator}>
                            <SelectTrigger id={`op-${column.id}`} className="h-8">
                                <SelectValue placeholder="Select condition" />
                            </SelectTrigger>
                            <SelectContent>
                                {dateOperators.map((op) => (
                                    <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Date/Range/Timespan Inputs based on selected operator */}
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
                    {['Is', 'IsNot', '<=', '>='].includes(operator) && (
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
                             <Label htmlFor={`ts-${column.id}`}>Timespan</Label>
                            <Select value={timespan} onValueChange={setTimespan}>
                                <SelectTrigger id={`ts-${column.id}`} className="h-8">
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
                     <Button variant="ghost" size="sm" onClick={handleClearFilter} disabled={!filterValue}>Clear</Button>
                     <Button size="sm" onClick={handleApplyFilter}>Apply</Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}