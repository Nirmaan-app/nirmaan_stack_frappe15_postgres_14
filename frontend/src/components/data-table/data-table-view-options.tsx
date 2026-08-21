import { DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu"
import { MixerHorizontalIcon } from "@radix-ui/react-icons"
import { Table } from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

interface DataTableViewOptionsProps<TData> {
    table: Table<TData>
}

export function DataTableViewOptions<TData>({
    table,
}: DataTableViewOptionsProps<TData>) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <div
                    className="mt-2 pl-3 p-1 rounded-md text-primary cursor-pointer hover:bg-gray-100"
                >
                    <MixerHorizontalIcon className="h-5 w-5" />
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[200px] max-h-[50vh] overflow-y-auto">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                    .getAllColumns()
                    .filter(
                        (column) =>
                            typeof column.accessorFn !== "undefined" && column.getCanHide()
                    )
                    .map((column) => {
                        // Human-readable label instead of the raw column id
                        // (e.g. "Contact Person", not "vendor_contact_person_name").
                        // `columnLabel` is display-only; `exportHeaderName` also names the
                        // CSV column, so a column that needs a nicer menu label WITHOUT
                        // changing its CSV header sets `columnLabel`.
                        const meta = column.columnDef.meta as
                            | { columnLabel?: string; exportHeaderName?: string }
                            | undefined
                        const label = meta?.columnLabel || meta?.exportHeaderName || column.id
                        return (
                            <DropdownMenuCheckboxItem
                                key={column.id}
                                checked={column.getIsVisible()}
                                onCheckedChange={(value) => column.toggleVisibility(!!value)}
                                // Keep the menu open so several columns can be toggled in one
                                // go — Radix closes on select by default.
                                onSelect={(event) => event.preventDefault()}
                            >
                                {label}
                            </DropdownMenuCheckboxItem>
                        )
                    })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}