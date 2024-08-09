import { Cross2Icon } from "@radix-ui/react-icons";
import { Table } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";

import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { DataTableViewOptions } from "./data-table-view-options";

type ProjectOptions = {
    label: string,
    value: string
}

interface DataTableToolbarProps<TData> {
    table: Table<TData>;
    project_values?: ProjectOptions[];
}

export function DataTableToolbar<TData>({ table, project_values }: DataTableToolbarProps<TData>) {

    const isFiltered = table.getState().columnFilters.length > 0;

    return (
        <div className="flex w-full items-center justify-between">
            <div className="flex flex-1 items-center space-x-2">
                {/* <Input
                    placeholder={"Filter"}
                    value={(table.getColumn("userName")?.getFilterValue() as string) ?? ""}
                    onChange={(event) => table.getColumn("userName")?.setFilterValue(event.target.value)}
                    className="h-8 w-[150px] lg:w-[250px]"
                /> */}
                {table.getColumn("project") && (
                    <DataTableFacetedFilter
                        column={table.getColumn("project")}
                        title={"Project"}
                        options={project_values || []}
                    />
                )}

                {isFiltered && (
                    <Button
                        variant="outline"
                        onClick={() => table.resetColumnFilters()}
                        className="h-8 px-2 lg:px-3">
                        {"Reset"}
                        <Cross2Icon className="ml-2 h-4 w-4" />
                    </Button>
                )}
            </div>
            <DataTableViewOptions table={table} />
        </div>
    );
}
