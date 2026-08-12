import { Column } from '@tanstack/react-table';
import { Filter, FilterX } from 'lucide-react';

import {
    DateFilterPopover,
    type DateFilterValue,
} from '@/components/data-table/date-filter-popover';

/**
 * The date column filter for a TanStack table.
 *
 * ⚠️ IT IS NOW A THIN BINDING, AND THE BODY MOVED TO `date-filter-popover.tsx`. Nothing about what
 * this renders or emits changed -- same operators, same timespans, same Apply/Clear, same trigger
 * -- but the popover itself is a CONTROLLED component now, so a table that is not a TanStack table
 * can render the identical control. The Bulk Import Outflow master table is hand-rolled and needed
 * exactly that; the alternative was a second date filter, which is how an application ends up
 * offering different operators on different screens and resolving "last quarter" two ways.
 *
 * This file's only job is `column.getFilterValue()` <-> `value` / `onChange`. If you are changing
 * the operators, the timespans or the layout, change the popover, not this.
 */

// Re-exported so the many existing importers of this path keep working unchanged.
export type { DateFilterValue };

interface DataTableDateFilterProps<TData> {
    column: Column<TData, unknown>;
    title?: string;
}

export function DataTableDateFilter<TData>({ column }: DataTableDateFilterProps<TData>) {
    const filterValue = column.getFilterValue() as DateFilterValue | undefined;

    return (
        <DateFilterPopover
            id={String(column.id)}
            value={filterValue}
            onChange={(next) => column.setFilterValue(next)}
        >
            <div
                className={`cursor-pointer ${
                    filterValue && 'bg-gray-200'
                } hover:bg-gray-100 px-1 pr-2 py-1 rounded-md`}
            >
                {filterValue ? (
                    <FilterX className="text-primary h-4 w-4 animate-bounce" />
                ) : (
                    <Filter className="text-primary h-4 w-4" />
                )}
            </div>
        </DateFilterPopover>
    );
}
