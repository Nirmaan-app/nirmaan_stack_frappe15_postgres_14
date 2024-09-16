import { Cross2Icon } from "@radix-ui/react-icons";
import { Table } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";

import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { DataTableViewOptions } from "./data-table-view-options";
import { useState, useEffect } from "react";

type ProjectOptions = {
    label: string,
    value: string
}

interface DataTableToolbarProps<TData> {
    table: Table<TData>;
    project_values?: ProjectOptions[];
    category_options?: ProjectOptions[];
}

export function DataTableToolbar<TData>({ table, project_values, category_options }: DataTableToolbarProps<TData>) {

    const [projectValues, setProjectValues] = useState(false)
    const [categoryValues, setCategoryValues] = useState(false)

    useEffect(() => {
        if (project_values) setProjectValues(true)
        if (category_options) setCategoryValues(true)

    }, [project_values, category_options])

    const isFiltered = table.getState().columnFilters.length > 0;

    //console.log("columns", table.getAllColumns().map(item => item.id).find(id => id === "category") === undefined)

    return (
        <div className="flex w-full items-center justify-between">
            <div className="flex flex-1 items-center space-x-2">
                {projectValues && (table.getColumn("project") ? (
                    <DataTableFacetedFilter
                        column={table.getColumn("project")}
                        title={"Filter by Project"}
                        options={project_values || []}
                    />
                ) : null)}

                {(categoryValues && table.getAllColumns().map(item => item.id).find(id => id === "vendor_category") !== undefined ? (
                    <DataTableFacetedFilter
                        column={table.getColumn("vendor_category")}
                        title={"Filter by Category"}
                        options={category_options || []}
                    />
                ) : (categoryValues &&
                    table.getAllColumns().map(item => item.id).find(id => id === "category") !== undefined ? (
                    <DataTableFacetedFilter
                        column={table.getColumn("category")}
                        title={"Filter by Category"}
                        options={category_options || []}
                    />
                ) : null))}

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
