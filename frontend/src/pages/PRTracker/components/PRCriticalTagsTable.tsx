import React, { useState, useMemo } from "react";
import {
    useReactTable,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    ColumnFiltersState,
    SortingState,
    PaginationState,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/new-data-table";
import { PRPackageRow } from "../types";
import { getPRTagTableColumns } from "./PRTagTableColumns";

interface PRCriticalTagsTableProps {
    tags: PRPackageRow[];
    projectName: string;
    projectId: string;
}

export const PRCriticalTagsTable: React.FC<PRCriticalTagsTableProps> = ({
    tags,
    projectName,
    projectId,
}) => {
    // DataTable state
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSearchField, setSelectedSearchField] = useState("package");
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [sorting, setSorting] = useState<SortingState>([
        { id: "package", desc: false },
    ]);
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });

    // Unique packages for filter
    const uniquePackages = useMemo(() => {
        const pkgs = new Set(tags.filter(t => t.package).map((tag) => tag.package));
        return Array.from(pkgs).sort().map((pkg) => ({ label: pkg, value: pkg }));
    }, [tags]);

    // Faceted filter options
    const facetFilterOptions = useMemo(
        () => ({
            package: {
                title: "Package",
                options: uniquePackages,
            },
        }),
        [uniquePackages]
    );

    // Search field options
    const searchFieldOptions = [
        { value: "package", label: "Package", default: true },
    ];

    // Column definitions
    const columns = useMemo(() => getPRTagTableColumns(projectId), [projectId]);

    // TanStack Table instance
    const table = useReactTable({
        data: tags,
        columns,
        state: {
            columnFilters,
            sorting,
            pagination,
            globalFilter: searchTerm,
        },
        onColumnFiltersChange: setColumnFilters,
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        onGlobalFilterChange: setSearchTerm,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        globalFilterFn: (row, _columnId, filterValue) => {
            const searchValue = filterValue.toLowerCase();
            const fieldValue = row.getValue(selectedSearchField);
            if (typeof fieldValue === "string") {
                return fieldValue.toLowerCase().includes(searchValue);
            }
            return false;
        },
    });

    return (
        <div className="bg-white rounded-lg border border-gray-200">
             <div className="p-4 overflow-x-auto">
                <DataTable<PRPackageRow>
                    table={table}
                    columns={columns}
                    isLoading={false}
                    totalCount={table.getFilteredRowModel().rows.length}
                    searchFieldOptions={searchFieldOptions}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetFilterOptions={facetFilterOptions}
                    showExportButton={true}
                    exportFileName={`${projectName.replace(/[^a-zA-Z0-9]/g, "_")}_PR_Packages`}
                    onExport="default"
                    tableHeight="50vh"
                />
            </div>
        </div>
    );
};
