import React, { useCallback, useMemo, useState } from "react";
import { useFacetValues } from "@/hooks/useFacetValues";
import {
  DataTable,
  SearchFieldOption,
} from "@/components/data-table/new-data-table"; // Your new DataTable
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { Badge } from "@/components/ui/badge";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useVendorInvoices } from "../data/useVendorQueries";
import { formatDate } from "@/utils/FormatDate";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { parseNumber } from "@/utils/parseNumber";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { InvoiceDataDialog } from "@/pages/ProcurementOrders/purchase-order/components/InvoiceDataDialog";
import { PaymentsDataDialog } from "@/pages/ProjectPayments/PaymentsDataDialog";

// src/components/cells/OrderCategoriesCell.tsx

interface VendorMaterialOrdersTableProps {
  vendorId: string;
  vendorName: string;
  // Pass necessary lookup data as props to avoid re-fetching or prop drilling deeply
  projectOptions: Array<{ label: string; value: string }>;
  procurementRequests?: ProcurementRequest[]; // For getting work_package
}

// Fields needed for this specific table
const PO_TABLE_FIELDS: (keyof ProcurementOrder | "name")[] = [
  "name",
  "status",
  "creation",
  "project",
  "project_name",
  "procurement_request",
  "amount",
  "tax_amount",
  "total_amount",
  "amount_paid",
  "vendor_name",
  "expected_delivery_date",
  "latest_delivery_date",
];
const PO_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  { value: "name", label: "PO ID", default: true },
  { value: "project_name", label: "Project" },
  { value: "status", label: "Status" },
  { value: "procurement_request", label: "PR ID" },
  {
    value: "items", // Field name for backend
    label: "Item in PO",
    placeholder: "Search by Item Name in order list...",
    is_json: true, // Signal to backend for special JSON search logic
  },
];

export const VendorMaterialOrdersTable: React.FC<
  VendorMaterialOrdersTableProps
> = ({ vendorId, vendorName, projectOptions, procurementRequests }) => {
  // --- State for Dialogs ---
  const [selectedInvoicePO, setSelectedInvoicePO] = useState<ProcurementOrder | undefined>();
  const [selectedPaymentPO, setSelectedPaymentPO] = useState<ProcurementOrder | undefined>();

  const getWorkPackage = useCallback(
    (prName?: string) => {
      if (!prName || !procurementRequests) return "--";
      return (
        procurementRequests.find((pr) => pr.name === prName)?.work_package ||
        "--"
      );
    },
    [procurementRequests]
  );

  // --- Static Filters ---
  const staticFilters = useMemo(() => {
    return [
      ["vendor", "=", vendorId],
      ["status", "not in", ["Merged", "Inactive"]],
    ];
  }, [vendorId]);

  // Fetch Vendor Invoices for this vendor to calculate total invoiced per PO
  const { data: vendorInvoices } = useVendorInvoices(vendorId);

  // Group invoice totals by PO name
  const invoiceTotalsMap = useMemo(() => {
    if (!vendorInvoices) return new Map<string, number>();
    return vendorInvoices.reduce((acc, inv) => {
      const current = acc.get(inv.document_name) ?? 0;
      acc.set(inv.document_name, current + parseNumber(inv.invoice_amount));
      return acc;
    }, new Map<string, number>());
  }, [vendorInvoices]);

  // Fetch Project Payments for this vendor (for payments dialog)
  const { data: projectPayments } = useFrappeGetDocList<ProjectPayments>(
    "Project Payments",
    {
      filters: [["vendor", "=", vendorId]],
      fields: [
        "name", "document_name", "document_type", "status", "amount",
        "tds", "payment_date", "creation", "utr", "payment_attachment",
      ],
      limit: 0,
    } as GetDocListArgs<FrappeDoc<ProjectPayments>>,
    `ProjectPayments-vendor-${vendorId}`
  );

  // --- Dynamic Facet Values ---
  const {
    facetOptions: projectFacetOptions,
    isLoading: isProjectFacetLoading,
  } = useFacetValues({
    doctype: "Procurement Orders",
    field: "project",
    currentFilters: [],
    searchTerm: "",
    selectedSearchField: "name",
    additionalFilters: staticFilters,
    enabled: true,
  });

  const { facetOptions: statusFacetOptions, isLoading: isStatusFacetLoading } =
    useFacetValues({
      doctype: "Procurement Orders",
      field: "status",
      currentFilters: [],
      searchTerm: "",
      selectedSearchField: "name",
      additionalFilters: staticFilters,
      enabled: true,
    });

  const facetFilterOptions = useMemo(
    () => ({
      project: {
        title: "Project",
        options: projectFacetOptions,
        isLoading: isProjectFacetLoading,
      },
      status: {
        title: "Status",
        options: statusFacetOptions,
        isLoading: isStatusFacetLoading,
      },
    }),
    [
      projectFacetOptions,
      isProjectFacetLoading,
      statusFacetOptions,
      isStatusFacetLoading,
    ]
  );

  // const getCategoriesFromOrderList = useCallback((orderListJson?: { list: PurchaseOrderItem[] } | string) => {
  //     let items: PurchaseOrderItem[] = [];
  //     if (typeof orderListJson === 'string') {
  //         try { items = JSON.parse(orderListJson).list || []; } catch (e) { items = []; }
  //     } else if (orderListJson?.list) {
  //         items = orderListJson.list;
  //     }
  //     return Array.from(new Set(items.map(item => item.category))).slice(0, 3); // Show first 3 unique
  // }, []);

  const columns = useMemo<ColumnDef<ProcurementOrder>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="PO ID" />
        ),
        cell: ({ row }) => {
          const data = row.original;
          return (
            <div className="flex items-center gap-1.5">
              <Link
                className="text-blue-600 hover:underline font-medium"
                to={`${data.name.replace(/\//g, "&=")}`}
              >
                {data?.name?.split("/")[1]}
              </Link>

              <ItemsHoverCard
                parentDoc={data}
                parentDoctype={"Procurement Orders"}
                childTableName="items"
              />
            </div>
          );
        },
        size: 120,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            variant={
              ["Partially Delivered", "Delivered"].includes(row.original.status)
                ? "green"
                : ["Partially Dispatched"].includes(row.original.status)
                ? "yellow"
                : "outline"
            }
          >
            {row.original.status}
          </Badge>
        ),
        size: 130,
        enableColumnFilter: true,
      },
      {
        accessorKey: "creation",
        header: "Created On",
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            {formatDate(row.original.creation)}
          </div>
        ),
        size: 170,
      },
      // {
      //     accessorKey: "procurement_request",
      //     header: ({ column }) => {
      //         return (
      //             <DataTableColumnHeader
      //                 column={column}
      //                 title="PR ID"
      //             />
      //         );
      //     },
      //     cell: ({ row }) => {
      //         return (
      //             <div className="min-w-[160px]">
      //                 {row.getValue("procurement_request")}
      //             </div>
      //         );
      //     },
      //     size: 180,
      // },
      // {
      //     accessorKey: "project_name",
      //     header: "Project",
      //     cell: ({ row }) => {
      //         return <div className="truncate max-w-[150px]" title={row.original.project_name}>{row.original.project_name}</div>;
      //     }, size: 180,
      //      enableColumnFilter: true,
      // },

      {
        accessorKey: "project_name",

        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Project Name" />
        ),

        cell: ({ row }) => {
          return (
            <div
              className="truncate max-w-[150px]"
              title={row.original.project_name}
            >
              {row.original.project_name}
            </div>
          );
        },
        size: 180,
      },

      {
        id: "work_package",
        header: "Package",
        accessorFn: (row) => getWorkPackage(row.procurement_request),
        cell: (info) => (
          <div className="truncate max-w-[120px]">
            {info.getValue<string>()}
          </div>
        ),
        size: 140,
        meta: {
          exportHeaderName: "Package",
          exportValue: (row: ProcurementOrder) =>
            getWorkPackage(row.procurement_request),
        },
      },
      // {
      //     id: "categories",
      //     header: "Categories",
      //     accessorFn: row => getCategoriesFromOrderList(row.order_list),
      //     cell: ({ row }) => {
      //         const cats = getCategoriesFromOrderList(row.original.order_list);
      //         return (
      //             <div className="flex flex-col items-start gap-0.5">
      //                 {cats.map(c => <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>)}
      //             </div>
      //         );
      //     }, size: 150,
      // },
      // {
      //     id: "categories",
      //     header: "Categories", // This column cannot be sorted, so no DataTableColumnHeader
      //     // The cell now just renders our new, smart component, passing the PO ID.
      //     cell: ({ row }) => <CategoryCell poId={row.original.name} />,

      //     size: 150,
      // },
      {
        accessorKey: "amount",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="PO Amount (Excl. GST)"
            className="justify-end"
          />
        ),

        cell: ({ row }) => (
          <div className="text-center font-medium">
            {formatToRoundedIndianRupee(row.original.amount)}
          </div>
        ),
        size: 180,
        meta: {
          exportHeaderName: "PO Amount (Excl. GST)",
          exportValue: (row: ProcurementOrder) => parseNumber(row.amount) || 0,
        },
      },
      {
        accessorKey: "total_amount",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="PO Amount (Incl. GST)"
            className="justify-end"
          />
        ),
        cell: ({ row }) => (
          <div className="text-center font-medium">
            {formatToRoundedIndianRupee(row.original.total_amount)}
          </div>
        ),
        size: 180,
        meta: {
          exportHeaderName: "PO Amount (Incl. GST)",
          exportValue: (row: ProcurementOrder) => parseNumber(row.total_amount) || 0,
        },
      },
      {
        id: "total_invoiced",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Total Invoiced"
            className="justify-end"
          />
        ),
        cell: ({ row }) => {
          const invoiceTotal = invoiceTotalsMap.get(row.original.name) ?? 0;
          return (
            <div
              className={cn("text-center font-medium", invoiceTotal ? "underline cursor-pointer text-blue-600 hover:text-blue-800" : "")}
              onClick={() => invoiceTotal && setSelectedInvoicePO(row.original)}
            >
              {formatToRoundedIndianRupee(invoiceTotal)}
            </div>
          );
        },
        size: 150,
        enableSorting: false,
        meta: {
          exportHeaderName: "Total Invoiced",
          exportValue: (row: ProcurementOrder) => {
            const invoiceTotal = invoiceTotalsMap.get(row.name) ?? 0;
            return invoiceTotal;
          },
        },
      },
      {
        accessorKey: "amount_paid",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Amount Paid"
            className="justify-end"
          />
        ),
        cell: ({ row }) => {
          const amountPaid = parseNumber(row.original.amount_paid) || 0;
          return (
            <div
              className={cn("text-center font-medium", amountPaid ? "underline cursor-pointer text-blue-600 hover:text-blue-800" : "text-green-700")}
              onClick={() => amountPaid && setSelectedPaymentPO(row.original)}
            >
              {formatToRoundedIndianRupee(amountPaid)}
            </div>
          );
        },
        size: 180,
        meta: {
          exportHeaderName: "Amount Paid",
          exportValue: (row: ProcurementOrder) => parseNumber(row.amount_paid) || 0,
        },
      },
      {
        id: "amount_due",
        header: "Amount Due",
        cell: ({ row }) => {
          const invoiced = invoiceTotalsMap.get(row.original.name) ?? 0;
          const paid = parseNumber(row.original.amount_paid) || 0;
          const value = invoiced - paid;
          return (
            <div className={cn("text-center font-medium", value < 0 ? "text-red-600" : "text-amber-600")}>
              {formatToRoundedIndianRupee(value)}
            </div>
          );
        },
        enableSorting: false,
        size: 150,
        meta: {
          exportHeaderName: "Amount Due",
          exportValue: (row: ProcurementOrder) => {
            const invoiced = invoiceTotalsMap.get(row.name) ?? 0;
            const paid = parseNumber(row.amount_paid) || 0;
            return invoiced - paid;
          },
        },
      },
      {
        accessorKey: "expected_delivery_date",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Expected Delivery" />
        ),
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            {row.original.expected_delivery_date ? formatDate(row.original.expected_delivery_date) : "--"}
          </div>
        ),
        size: 180,
        meta: {
          exportHeaderName: "Expected Delivery Date",
          exportValue: (row: ProcurementOrder) =>
            row.expected_delivery_date ? formatDate(row.expected_delivery_date) : "--",
        },
      },
      {
        accessorKey: "latest_delivery_date",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Latest Delivery" />
        ),
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            {row.original.latest_delivery_date ? formatDate(row.original.latest_delivery_date) : "--"}
          </div>
        ),
        size: 150,
        meta: {
          exportHeaderName: "Latest Delivery Date",
          exportValue: (row: ProcurementOrder) =>
            row.latest_delivery_date ? formatDate(row.latest_delivery_date) : "--",
        },
      },
      // --- CHANGE END ---
      // {
      //     id: "order_financials",
      //     header: "Order Financials",
      //     cell: ({ row }) => {
      //         const totals = getTotalAmount(row.original.name, "Procurement Orders");
      //         const totalPaid = getAmount(row.original.name, ["Paid"]);
      //         return (
      //             <div className="flex flex-col gap-1 text-xs min-w-[200px]">
      //                 <div className="flex justify-between"><span>Value (Excl. GST):</span> <span className="font-semibold">{formatToRoundedIndianRupee(totals.total)}</span></div>
      //                 <div className="flex justify-between"><span>Value (Incl. GST):</span> <span className="font-semibold">{formatToRoundedIndianRupee(totals.totalWithTax)}</span></div>
      //                 <div className="flex justify-between"><span>Amount Paid:</span> <span className="font-semibold">{formatToRoundedIndianRupee(totalPaid)}</span></div>
      //             </div>
      //         );
      //     }, size: 220,
      // }
    ],
    [projectOptions, procurementRequests, getWorkPackage, invoiceTotalsMap]
  );

  const {
    table,
    isLoading: tableLoading,
    error: tableError,
    totalCount,
    exportAllRows,
    isExporting,
    // ... other props from useServerDataTable ...
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
  } = useServerDataTable<ProcurementOrder>({
    doctype: "Procurement Orders",
    columns: columns,
    fetchFields: PO_TABLE_FIELDS as string[],
    searchableFields: PO_SEARCHABLE_FIELDS,
    urlSyncKey: `vendor_po_list_${vendorId}`,
    additionalFilters: staticFilters,
  });

  if (tableError) return <AlertDestructive error={tableError} />;

  return (
    <>
      <Alert className="bg-blue-50 border-blue-200 mb-2">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800 text-sm">
          <strong>Note:</strong> Amount Due = Total Invoiced − Amount Paid
        </AlertDescription>
      </Alert>
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
        dateFilterColumns={["modified", "creation", "expected_delivery_date", "latest_delivery_date"]}
        showExportButton={true}
        onExport={"default"}
        onExportAll={exportAllRows}
        isExporting={isExporting}
        exportFileName={`${vendorName}_Material_Orders`}
      />

      <InvoiceDataDialog
        open={!!selectedInvoicePO}
        onOpenChange={(open) => !open && setSelectedInvoicePO(undefined)}
        vendorInvoices={vendorInvoices?.filter(inv => inv.document_name === selectedInvoicePO?.name)}
        project={selectedInvoicePO?.project_name}
        poNumber={selectedInvoicePO?.name}
        vendor={selectedInvoicePO?.vendor_name}
      />

      <PaymentsDataDialog
        open={!!selectedPaymentPO}
        onOpenChange={(open) => !open && setSelectedPaymentPO(undefined)}
        payments={projectPayments}
        data={selectedPaymentPO}
        isPO
      />
    </>
  );
};

export default VendorMaterialOrdersTable;
