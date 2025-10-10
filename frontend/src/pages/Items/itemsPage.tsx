import React, { useMemo, useState, useEffect, useContext } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";

import { AddItemDialog } from "./components/AddItemDialog"; // Adjust path
import { ItemsSummaryCard } from "./components/ItemsSummaryCard"; // Adjust path
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import { Items as ItemsType } from "@/types/NirmaanStack/Items";
import { Category as CategoryType } from "@/types/NirmaanStack/Category";

import {
    ITEM_DOCTYPE, ITEM_LIST_FIELDS_TO_FETCH, ITEM_SEARCHABLE_FIELDS, ITEM_DATE_COLUMNS,
    CATEGORY_DOCTYPE, CATEGORY_LIST_FIELDS_TO_FETCH
} from "./items.constants"; // Adjust path
import { useDialogStore } from "@/zustand/useDialogStore";
import { UnitOptions } from "@/components/helpers/SelectUnit";




// --- (1) NEW: Define the static options for the status filter ---
const ITEM_STATUS_OPTIONS = [
    { label: "Active", value: "Active" },
    { label: "Inactive", value: "Inactive" },
];


export default function ItemsPage() {
    const { toast } = useToast();
    const userData = useUserData();

    const { newItemDialog, toggleNewItemDialog } = useDialogStore();

    const { data: categoryList, isLoading: categoryUiLoading, error: categoryUiError } = useFrappeGetDocList<CategoryType>(
        CATEGORY_DOCTYPE,
        {
            fields: CATEGORY_LIST_FIELDS_TO_FETCH,
            orderBy: { field: "name", order: "asc" },
            limit: 1000,
        },
        'category_list_for_item_page_ui'
    );

    const categoryFacetOptions = useMemo(() =>
        categoryList?.map(cat => ({
            label: `${cat.name} (${cat.work_package?.slice(0, 4).toUpperCase() || 'N/A'})`,
            value: cat.name,
        })) || [],
        [categoryList]
    );

    const columns = useMemo<ColumnDef<ItemsType>[]>(() => [
        {
            accessorKey: "name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
            cell: ({ row }) => (
                <Link className="text-blue-600 hover:underline font-medium whitespace-nowrap"
                    to={`${row.original.name}`}> {/* Adjust route */}
                    {row.getValue("name").slice(-6)}
                </Link>
            ), size: 150,
            meta: {
                exportHeaderName: "ID",
                exportValue: (row: ItemsType) => {
                    return row.name.slice(-6);
                }
            }
        },
        {
            accessorKey: "item_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Product Name" />,
            cell: ({ row }) => {
                const itemName = row.getValue<string>("item_name");
                const makeName = row.original.make_name;
                return (
                    <Link className="hover:underline font-medium"
                        to={`${row.original.name}`}> {/* Adjust route */}
                        {makeName ? `${itemName} - ${makeName}` : itemName}
                    </Link>
                );
            }, size: 300,
            meta: {
                exportHeaderName: "Product Name",
                exportValue: (row: ItemsType) => {
                    const itemName = row.item_name;
                    const makeName = row.make_name;
                    return makeName ? `${itemName} - ${makeName}` : itemName;
                }
            }
        },
        {
            accessorKey: "category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => {
                const catName = row.getValue<string>("category");
                const catDetail = categoryList?.find(c => c.name === catName);
                const displayLabel = catDetail ? `${catName} (${catDetail.work_package?.slice(0, 4).toUpperCase() || 'N/A'})` : catName;
                return <Badge variant="outline">{displayLabel || "N/A"}</Badge>;
            }, size: 220,
            meta: {
                exportHeaderName: "Category",
                exportValue: (row: ItemsType) => {
                    const catName = row.category;
                    const catDetail = categoryList?.find(c => c.name === catName);
                    return catDetail ? `${catName} (${catDetail.work_package?.slice(0, 4).toUpperCase() || 'N/A'})` : catName;
                }
            }
        },
        {
            accessorKey: "unit_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Unit" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("unit_name") || "--"}</div>,
            size: 100,
            meta: {
                exportHeaderName: "Unit",
                exportValue: (row: ItemsType) => row.unit_name || "--"
            }
        },
        {
            accessorKey: "item_status",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("item_status") || "--"}</div>,
            enableColumnFilter: true,
            size: 120,
            meta: {
                exportHeaderName: "Status",
                exportValue: (row: ItemsType) => row.item_status || "--"
            }
        },
        {
            accessorKey: "creation",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Item Creation Date",
                exportValue: (row: ItemsType) => formatDate(row.creation)
            }
        },
    ], [categoryList]); // Dependency on categoryList for rendering category names

    const {
        table, totalCount, isLoading: tableIsLoading, error: tableError,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        refetch: refetchTable,
    } = useServerDataTable<ItemsType>({
        doctype: ITEM_DOCTYPE,
        columns: columns,
        fetchFields: ITEM_LIST_FIELDS_TO_FETCH as string[],
        searchableFields: ITEM_SEARCHABLE_FIELDS,
        defaultSort: 'creation desc',
        urlSyncKey: 'items_master',
        enableRowSelection: false,
        shouldCache: true
    });

    const facetFilterOptions = useMemo(() => ({
        category: { title: "Category", options: categoryFacetOptions },
        unit_name: { title: "Unit", options: UnitOptions },
        item_status: { title: "Status", options: ITEM_STATUS_OPTIONS }, // Add new config
    }), [categoryFacetOptions, UnitOptions]);

    const canManageItems = userData?.role === "Nirmaan Admin Profile"; // Define roles that can add/edit

    return (
        <div className="flex-1 space-y-4">

            {/* <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"> */}
            <ItemsSummaryCard />
            {/* You can add more summary cards here */}
            {/* </div> */}

            <DataTable<ItemsType>
                table={table}
                columns={columns}
                isLoading={tableIsLoading || categoryUiLoading}
                error={(tableError || categoryUiError) as Error}
                totalCount={totalCount}
                searchFieldOptions={ITEM_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={ITEM_DATE_COLUMNS}
                showExportButton={true}
                onExport={'default'}
                exportFileName="products_master_data"
                showRowSelection={false}
            />

            {canManageItems && (
                <AddItemDialog
                    isOpen={newItemDialog}
                    onOpenChange={toggleNewItemDialog}
                    onItemAdded={refetchTable}
                />
            )}
        </div>
    );
}