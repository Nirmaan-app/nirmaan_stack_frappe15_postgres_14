import React, { useCallback, useMemo } from 'react';
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table'; // Your new DataTable
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { Badge } from "@/components/ui/badge";
import { ProcurementOrder, PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useServerDataTable } from '@/hooks/useServerDataTable'; // Your main hook
import { formatDate } from '@/utils/FormatDate';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { useOrderTotals } from '@/hooks/useOrderTotals';
import { useOrderPayments } from '@/hooks/useOrderPayments';
import { PO_STATUS_OPTIONS } from '@/pages/ProcurementOrders/purchase-order/config/purchaseOrdersTable.config';

interface VendorMaterialOrdersTableProps {
    vendorId: string;
    // Pass necessary lookup data as props to avoid re-fetching or prop drilling deeply
    projectOptions: Array<{ label: string; value: string }>;
    procurementRequests?: ProcurementRequest[]; // For getting work_package
}

// Fields needed for this specific table
const PO_TABLE_FIELDS: (keyof ProcurementOrder | 'name')[] = [
    "name", "status", "creation", "project", "project_name", "procurement_request", "order_list"
];
const PO_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "PO ID", default: true },
    { value: "project_name", label: "Project" },
    { value: "status", label: "Status" },
    { value: "procurement_request", label: "PR ID" },
    {
        value: "order_list", // Field name for backend
        label: "Item in PO",
        placeholder: "Search by Item Name in order list...",
        is_json: true, // Signal to backend for special JSON search logic
    },
];


export const VendorMaterialOrdersTable: React.FC<VendorMaterialOrdersTableProps> = ({
    vendorId,
    projectOptions,
    procurementRequests,
}) => {

    const getWorkPackage = useCallback((prName?: string) => {
        if (!prName || !procurementRequests) return "--";
        return procurementRequests.find(pr => pr.name === prName)?.work_package || "--";
    }, [procurementRequests]);

    const { getTotalAmount } = useOrderTotals();
    const { getAmount } = useOrderPayments();


    const facetFilterOptions = useMemo(() => ({
            // Use the 'accessorKey' or 'id' of the column
            project: { title: "Project", options: projectOptions }, // Or use 'project' if filtering by ID
            status: { title: "Status", options: PO_STATUS_OPTIONS },
        }), [projectOptions]);

    const getCategoriesFromOrderList = useCallback((orderListJson?: { list: PurchaseOrderItem[] } | string) => {
        let items: PurchaseOrderItem[] = [];
        if (typeof orderListJson === 'string') {
            try { items = JSON.parse(orderListJson).list || []; } catch (e) { items = []; }
        } else if (orderListJson?.list) {
            items = orderListJson.list;
        }
        return Array.from(new Set(items.map(item => item.category))).slice(0, 3); // Show first 3 unique
    }, []);


    const columns = useMemo<ColumnDef<ProcurementOrder>[]>(() => [
        {
            accessorKey: "name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="PO ID" />,
            cell: ({ row }) => {
                const po = row.original;
                return (
                    <div className="flex items-center gap-1.5">
                        <Link className="text-blue-600 hover:underline font-medium" to={`${po.name.replaceAll("/", "&=")}`}>
                            {po?.name?.split("/")[1]}
                        </Link>
                        <ItemsHoverCard order_list={
                            typeof po.order_list === 'string' ? JSON.parse(po.order_list)?.list : po.order_list?.list || []
                        } />
                    </div>
                );
            }, size: 120,
        },
        {
            accessorKey: "status",
            header: "Status",
            cell: ({ row }) => <Badge variant={["Partially Delivered", "Delivered"].includes(row.original.status) ? "green" : "outline"}>{row.original.status}</Badge>,
            size: 130,
            enableColumnFilter: true,
        },
        {
            accessorKey: "creation",
            header: "Created On",
            cell: ({ row }) => <div className="whitespace-nowrap">{formatDate(row.original.creation)}</div>,
            size: 170,
        },
        {
        accessorKey: "procurement_request",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader
              column={column}
              title="PR ID"
            />
          );
        },
        cell: ({ row }) => {
          return (
            <div className="min-w-[160px]">
              {row.getValue("procurement_request")}
            </div>
          );
        },
        size: 180,
      },
        {
            accessorKey: "project_name",
            header: "Project",
            cell: ({ row }) => {
                return <div className="truncate max-w-[150px]" title={row.original.project_name}>{row.original.project_name}</div>;
            }, size: 180,
        },
        {
            id: "work_package",
            header: "Package",
            accessorFn: row => getWorkPackage(row.procurement_request),
            cell: info => <div className="truncate max-w-[120px]">{info.getValue<string>()}</div>,
            size: 140,
        },
        {
            id: "categories",
            header: "Categories",
            accessorFn: row => getCategoriesFromOrderList(row.order_list),
            cell: ({ row }) => {
                const cats = getCategoriesFromOrderList(row.original.order_list);
                return (
                    <div className="flex flex-col items-start gap-0.5">
                        {cats.map(c => <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>)}
                    </div>
                );
            }, size: 150,
        },
        {
            id: "order_financials",
            header: "Order Financials",
            cell: ({ row }) => {
                const totals = getTotalAmount(row.original.name, "Procurement Orders");
                const totalPaid = getAmount(row.original.name, ["Paid"]);
                return (
                    <div className="flex flex-col gap-1 text-xs min-w-[200px]">
                        <div className="flex justify-between"><span>Value (Excl. GST):</span> <span className="font-semibold">{formatToRoundedIndianRupee(totals.total)}</span></div>
                        <div className="flex justify-between"><span>Value (Incl. GST):</span> <span className="font-semibold">{formatToRoundedIndianRupee(totals.totalWithTax)}</span></div>
                        <div className="flex justify-between"><span>Amount Paid:</span> <span className="font-semibold">{formatToRoundedIndianRupee(totalPaid)}</span></div>
                    </div>
                );
            }, size: 220,
        }
    ], [projectOptions, procurementRequests, getWorkPackage, getCategoriesFromOrderList, getTotalAmount, getAmount]);

    const {
        table,
        isLoading: tableLoading,
        error: tableError,
        totalCount,
        // ... other props from useServerDataTable ...
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField
    } = useServerDataTable<ProcurementOrder>({
        doctype: "Procurement Orders",
        columns: columns,
        fetchFields: PO_TABLE_FIELDS as string[],
        searchableFields: PO_SEARCHABLE_FIELDS,
        urlSyncKey: `vendor_po_list_${vendorId}`,
        additionalFilters: [["vendor", "=", vendorId], ["status", "!=", "Merged"]],
    });

    if (tableError) return <AlertDestructive error={tableError} />;

    return (
        <DataTable<ProcurementOrder>
            table={table}
            columns={columns} // Pass the actual column defs for rendering
            isLoading={tableLoading}
            totalCount={totalCount}
            searchFieldOptions={PO_SEARCHABLE_FIELDS}
            selectedSearchField={selectedSearchField}
            onSelectedSearchFieldChange={setSelectedSearchField}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            facetFilterOptions={facetFilterOptions}
            dateFilterColumns={["modified", "creation"]}
            showExportButton={true}
            onExport={'default'}
        />
    );
};


export default VendorMaterialOrdersTable;