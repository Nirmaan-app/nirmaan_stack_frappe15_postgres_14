import React, { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link, useNavigate } from "react-router-dom";

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";

import { CustomersSummaryCard } from "./components/CustomersSummaryCard"; // Adjust path
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { Customers as CustomersType } from "@/types/NirmaanStack/Customers";
import { formatDate } from "@/utils/FormatDate";

import {
    CUSTOMER_DOCTYPE, CUSTOMER_LIST_FIELDS_TO_FETCH, CUSTOMER_SEARCHABLE_FIELDS,
    CUSTOMER_DATE_COLUMNS
} from "./customers.constants"; // Adjust path

export default function CustomersPage() {

    const columns = useMemo<ColumnDef<CustomersType>[]>(() => [
        {
            accessorKey: "name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Customer ID" />,
            cell: ({ row }) => (
                <Link className="text-blue-600 hover:underline font-medium whitespace-nowrap"
                      to={`/customers/${row.original.name}`}> {/* Adjust route */}
                    {row.getValue<string>("name")?.slice(-6) || row.getValue("name")}
                </Link>
            ), size: 150,
        },
        {
            accessorKey: "company_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Company Name" />,
            cell: ({ row }) => (
                <Link className="hover:underline font-medium whitespace-nowrap"
                      to={`/customers/${row.original.name}`}> {/* Adjust route */}
                    {row.getValue("company_name")}
                </Link>
            ), size: 250,
        },
        {
            accessorKey: "company_contact_person",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Contact Person" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("company_contact_person") || "--"}</div>,
            size: 200,
        },
        // { // Assuming 'enabled' field exists for customer status
        //     accessorKey: "enabled",
        //     header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        //     cell: ({ row }) => (
        //         <Badge variant={row.getValue("enabled") ? "success" : "secondary"}>
        //             {row.getValue("enabled") ? "Active" : "Inactive"}
        //         </Badge>
        //     ),
        //     size: 100,
        // },
        // {
        //     accessorKey: "customer_type", // Example field
        //     header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        //     cell: ({ row }) => <Badge variant="outline">{row.getValue("customer_type") || "--"}</Badge>,
        //     size: 150,
        // },
        {
            accessorKey: "company_phone",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Phone" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("company_phone") || "--"}</div>,
            size: 150,
        },
        {
            accessorKey: "company_email",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("company_email") || "--"}</div>,
            size: 220,
        },
        {
            accessorKey: "creation",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Date Joined" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
        },
    ], []);

    const {
        table, totalCount, isLoading, error,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        refetch: refetchTable,
    } = useServerDataTable<CustomersType>({
        doctype: CUSTOMER_DOCTYPE,
        columns: columns,
        fetchFields: CUSTOMER_LIST_FIELDS_TO_FETCH as string[],
        searchableFields: CUSTOMER_SEARCHABLE_FIELDS,
        defaultSort: 'creation desc',
        urlSyncKey: 'customers_list',
        enableRowSelection: false, // Adjust if selection is needed
        shouldCache: true
    });

    // const facetFilterOptions = useMemo(() => ({
    //     // Assuming you have 'customer_type', 'industry', and 'enabled' fields in your Customers DocType
    //     ...(CUSTOMER_LIST_FIELDS_TO_FETCH.includes('customer_type') ? { customer_type: { title: "Customer Type", options: CUSTOMER_TYPE_OPTIONS } } : {}),
    //     ...(CUSTOMER_LIST_FIELDS_TO_FETCH.includes('industry') ? { industry: { title: "Industry", options: CUSTOMER_INDUSTRY_OPTIONS } } : {}),
    //     ...(CUSTOMER_LIST_FIELDS_TO_FETCH.includes('enabled') ? { enabled: { title: "Status", options: CUSTOMER_STATUS_OPTIONS } } : {}),
    // }), []);

    return (
        <div className="flex-1 space-y-4">
            {/* <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"> */}
                <CustomersSummaryCard />
            {/* </div> */}

            <DataTable<CustomersType>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                searchFieldOptions={CUSTOMER_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                // facetFilterOptions={facetFilterOptions}
                dateFilterColumns={CUSTOMER_DATE_COLUMNS}
                showExportButton={true}
                onExport={'default'}
                exportFileName="customers_data"
                showRowSelection={false} // Set to true if row selection is needed
            />
        </div>
    );
}