import { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList } from 'frappe-react-sdk';

import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDate } from '@/utils/FormatDate';
import { DataTable } from '@/components/data-table/new-data-table';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { Button } from '@/components/ui/button';
import { Projects } from '@/types/NirmaanStack/Projects';
import { Vendors } from '@/types/NirmaanStack/Vendors';

export default function ProcurementOrdersTesting() {
    // --- Configuration for the hook ---
    const doctype = 'Procurement Orders';
    const urlSyncKey = 'po'; // Unique key for URL state for this table instance

    // const urlSyncKey = 'po_final_approach'; // New key for fresh state

    // --- Define columns using TanStack's ColumnDef ---
    const columns = useMemo<ColumnDef<ProcurementOrder>[]>(() => [
        // Row Selection Column
        {
            id: 'select',
            header: ({ table }) => (
                <Checkbox
                    checked={table.getIsAllPageRowsSelected()}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all rows"
                    className="translate-y-[2px]"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                    className="translate-y-[2px]"
                />
            ),
            enableSorting: false,
            enableHiding: false,
            size: 40,
        },
        {
            accessorKey: 'name',
            header: ({ column }) => <DataTableColumnHeader column={column} title="#PO" />,
            cell: ({ row }) => (
                <Link
                    className="font-medium underline hover:underline-offset-2 whitespace-nowrap"
                    // Adjust the route path as needed
                    to={`/purchase-orders/${row.original.name?.replaceAll("/", "&=")}`}
                >
                    {row.original.name}
                </Link>
            ),
            size: 150,
        },
        {
            accessorKey: 'creation',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
            cell: ({ row }) => (
                <div className="font-medium whitespace-nowrap">
                    {formatDate(row.getValue<string>('creation'))}
                </div>
            ),
            enableColumnFilter: false,
            size: 150,
        },
        {
            accessorKey: 'project',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => (
                <div className="font-medium">{row.original.project_name}</div>
                // Optional: Link to project page
                // <Link to={`/projects/${row.original.project}`}>
                //     {row.original.project_name}
                // </Link>
            ),
            enableColumnFilter: true, // Enable faceted filter for project
            size: 250,
        },
        {
            accessorKey: 'vendor',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
            cell: ({ row }) => (
                <div className="font-medium">{row.original.vendor_name}</div>
                 // Optional: Link to vendor page
                // <Link to={`/vendors/${row.original.vendor}`}>
                //     {row.original.vendor_name}
                // </Link>
            ),
            enableColumnFilter: true, // Enable faceted filter for vendor
            size: 250,
        },
        {
            accessorKey: 'status',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => {
                // Optional: Add color/styling based on status
                const status = row.getValue<string>('status');
                return <Badge variant="outline">{status}</Badge>; // Simple badge
            },
            enableColumnFilter: true, // Enable faceted filter for status
            size: 150,
        },
        // {
        //     accessorKey: 'category',
        //     header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
        //     cell: ({ row }) => (
        //         row.getValue('category') ? <Badge>{row.getValue('category')}</Badge> : '--'
        //     ),
        //     enableColumnFilter: true, // Enable filtering for category
        //     size: 180,
        // },
    ], []);

    // --- Fetch options for Faceted Filters ---
    const { data: projectList } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000,
    });
    const projectOptions = useMemo(() => {
        return projectList?.map(p => ({ value: p.name, label: p.project_name })) || [];
    }, [projectList]);

    // Fetch Vendors
     const { data: vendorList } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 1000,
    });
    const vendorOptions = useMemo(() => {
        return vendorList?.map(v => ({ value: v.name, label: v.vendor_name })) || [];
    }, [vendorList]);

    // Define Status options (assuming a fixed list, fetch if dynamic)
    // const statusOptions = useMemo(() => [
    //     { value: "PO Approved", label: "PO Approved" },
    //     { value: "Pending Approval", label: "Pending Approval" }, // Add other statuses
    //     { value: "Sent Back", label: "Sent Back" },
    //     { value: "Amended", label: "Amended" },
    //     { value: "Closed", label: "Closed" },
    //     // Add all relevant statuses from your workflow
    // ], []);


    // Prepare facet filter options map for the DataTable component
    const facetFilterOptions = useMemo(() => ({
        // Use the 'accessorKey' or 'id' of the column
        project: { title: "Project", options: projectOptions }, // Or use 'project' if filtering by ID
        vendor: { title: "Vendor", options: vendorOptions }, // Or use 'vendor' if filtering by ID
        // status: { title: "Status", options: statusOptions },
    }), [projectOptions, vendorOptions]);


    // --- Fields to fetch from the Frappe API ---
    const fieldsToFetch = [
        "name",
        "project",
        "vendor",
        "procurement_request",
        "project_name",
        "vendor_name",
        "status",
        "creation",
        "modified",
        "owner"
    ];

    // Fields for global search (simple names)
    const poGlobalSearchFields = ["name", "project", "vendor", "procurement_request", "project_name", "vendor_name", "status", 
        // "creation"
    ];

    // --- Use the Server Data Table Hook ---
    const {
        table,
        data,
        totalCount,
        isLoading,
        error,
        globalFilter,
        setGlobalFilter,
        isGlobalSearchEnabled,
        toggleGlobalSearch,
        refetch // Added refetch in case needed
    } = useServerDataTable<ProcurementOrder>({
        doctype: doctype,
        columns: columns,
        fetchFields: fieldsToFetch,
        defaultSearchField: "name", // Search PO ID by default when specific search is on
        globalSearchFieldList: poGlobalSearchFields,
        enableRowSelection: true,
        urlSyncKey: urlSyncKey,
        defaultSort: 'creation desc', // Default sort order
        additionalFilters: [["Procurement Orders", "status", "not in", ["Merged", "PO Amendment"]]] // Filter out merged POs
    });

    // Handle Export (optional)
    const handleExport = () => {
        const selectedRowsData = table.getSelectedRowModel().rows.map(row => row.original);
        console.log("Exporting selected PO data:", selectedRowsData);
        alert(`Exporting ${selectedRowsData.length} selected POs... (Check console)`);
        table.resetRowSelection();
    };

    return (
        <div className="container mx-auto py-6 px-4 sm:px-6 lg:px-8">
            <h1 className="text-2xl font-semibold mb-4">Procurement Orders Testing</h1>
            {/* Optional: Add a button to trigger refetch manually for debugging */}
            <Button onClick={refetch} variant="outline" size="sm" className="mb-4">Refetch Data</Button>

            <DataTable<ProcurementOrder>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                globalFilterValue={globalFilter}
                onGlobalFilterChange={setGlobalFilter}
                globalSearchConfig={{
                    isEnabled: isGlobalSearchEnabled,
                    toggle: toggleGlobalSearch,
                    // Update placeholders
                    specificPlaceholder: "Search by PO ID...",
                    globalPlaceholder: "Search All PO Fields..."
                }}
                facetFilterOptions={facetFilterOptions}
                showExport={true}
                onExport={handleExport}
                // toolbarActions={<Button size="sm">New PO</Button>} // Example action
            />
        </div>
    );
}