import { Table } from "@tanstack/react-table";


import { useEffect, useState } from "react";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";

type ProjectOptions = {
    label: string,
    value: string
}

interface DataTableToolbarProps<TData> {
    table: Table<TData>;
    project_values?: ProjectOptions[];
    category_options?: ProjectOptions[];
    vendorOptions?: ProjectOptions[];
    projectTypeOptions?: ProjectOptions[];
    roleTypeOptions?: ProjectOptions[];
    statusOptions?: ProjectOptions[];
}

export function DataTableToolbar<TData>({ table, project_values, category_options, vendorOptions=undefined, projectTypeOptions=undefined, roleTypeOptions=undefined, statusOptions=undefined }: DataTableToolbarProps<TData>) {

    const [projectValues, setProjectValues] = useState(false)
    const [categoryValues, setCategoryValues] = useState(false)

    useEffect(() => {
        if (project_values) setProjectValues(true)
        if (category_options) setCategoryValues(true)

    }, [project_values, category_options])

    //console.log("columns", table.getAllColumns().map(item => item.id).find(id => id === "category") === undefined)

    return (
        <div className="flex w-full items-center justify-between">
            <div className="flex flex-1 items-center space-x-2">
                {projectValues && (table.getColumn("project") ? (
                    <DataTableFacetedFilter
                        column={table.getColumn("project")}
                        title={"Project"}
                        options={project_values || []}
                    />
                ) : null)}

                {(categoryValues && table.getAllColumns().map(item => item.id).find(id => id === "vendor_category") !== undefined ? (
                    <DataTableFacetedFilter
                        column={table.getColumn("vendor_category")}
                        title={"Category"}
                        options={category_options || []}
                    />
                ) : (categoryValues &&
                    table.getAllColumns().map(item => item.id).find(id => id === "category") !== undefined ? (
                    <DataTableFacetedFilter
                        column={table.getColumn("category")}
                        title={"Category"}
                        options={category_options || []}
                    />
                ) : null))}

                {vendorOptions && (table.getColumn("vendor_name") ? (
                    <DataTableFacetedFilter
                        column={table.getColumn("vendor_name")}
                        title={"Vendor"}
                        options={vendorOptions || []}
                    />
                ) : null)}
                {projectTypeOptions && (table.getColumn("project_type") ? (
                    <DataTableFacetedFilter
                        column={table.getColumn("project_type")}
                        title={"Project Type"}
                        options={projectTypeOptions || []}
                    />
                ) : null)}

                {roleTypeOptions && (table.getColumn("role_profile") ? (
                    <DataTableFacetedFilter
                        column={table.getColumn("role_profile")}
                        title={"Role"}
                        options={roleTypeOptions || []}
                    />
                ) : null)}

                {statusOptions && (table.getColumn("workflow_state") ? (
                    <DataTableFacetedFilter
                        column={table.getColumn("workflow_state")}
                        title={"Status"}
                        options={statusOptions || []}
                    />
                ) : null)}

                {/* {isFiltered && (
                    <Button
                        variant="outline"
                        onClick={() => table.resetColumnFilters()}
                        className="h-8 px-2 lg:px-3">
                        {"Reset"}
                        <Cross2Icon className="ml-2 h-4 w-4" />
                    </Button>
                )} */}
            </div>
            {/* <DataTableViewOptions table={table} /> */}
        </div>
    );
}
