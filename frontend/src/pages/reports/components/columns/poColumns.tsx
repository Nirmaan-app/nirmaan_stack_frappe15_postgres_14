import { ColumnDef } from "@tanstack/react-table";
import { POReportRowData } from "../../hooks/usePOReportsData";
import {
  formatForReport,
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { Info } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ReportType } from "../../store/useReportStore";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import { PORemarksHoverCard } from "./PORemarksHoverCard";

// Base columns, always present for PO reports
export const basePOColumns: ColumnDef<POReportRowData>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="#PO" />
    ),
    cell: ({ row }) => {
      const name = row.original.name;
      return (
        <div className="flex items-center">
          {name}
          <Link to={`/project-payments/${name.replaceAll("/", "&=")}`}>
            <Info className="text-blue-500 h-3 w-3 ml-1 mt-0.5" />
          </Link>
        </div>
      );
    },
    size: 200,
    meta: {
      exportHeaderName: "#PO",
      exportValue: (row: POReportRowData) => row.name,
    },
  },
  // {
  //   accessorKey: "creation",
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title="Date Created" />
  //   ),
  //   cell: ({ row }) => <div>{formatDate(row.original.creation)}</div>,
  //   meta: {
  //     exportValue: (row: POReportRowData) => formatDate(row.creation),
  //     exportHeaderName: "Date Created",
  //   },
  //   filterFn: dateFilterFn,
  // },
  {
    id: "latest_delivery_date",
    accessorFn: (row) => row.originalDoc.latest_delivery_date, // Explicitly tell the table where to get the data

    // accessorKey: "latest_delivery_date",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={

        <div className="text-left whitespace-normal">
          Latest Delivery Date
        </div>

      } />
    ),
    cell: ({ row }) => {
      // We can now use row.getValue() which is cleaner, as it uses the accessorFn
      //   console.log("row.getValue('latest_delivery_date')", row);
      const latest_delivery_date = row.getValue("latest_delivery_date") as string | undefined;
      return (
        <div>
          {latest_delivery_date ? formatDate(latest_delivery_date) : "N/A"}
        </div>
      );
    },
    meta: {
      exportValue: (row: POReportRowData) => {
        const poDoc = row.originalDoc as ProcurementOrder;
        return poDoc.latest_delivery_date
          ? formatDate(poDoc.latest_delivery_date)
          : "N/A";
      },
      exportHeaderName: "Latest Delivery Date",
    },
    filterFn: dateFilterFn,
  },
  {
    id: "latest_payment_date",

    accessorFn: (row) => row.originalDoc.latest_payment_date, // Explicitly tell the table
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={

        <div className="text-left whitespace-normal">
          Latest Payment Date
        </div>

      } />
    ),
    cell: ({ row }) => {
      // We can now use row.getValue() which is cleaner, as it uses the accessorFn
      const latest_payment_date = row.getValue("latest_payment_date") as string | undefined;
      return (
        <div>
          {latest_payment_date ? formatDate(latest_payment_date) : "N/A"}
        </div>
      );
    },
    meta: {
      exportValue: (row: POReportRowData) => {
        const poDoc = row.originalDoc as ProcurementOrder;
        return poDoc.latest_payment_date
          ? formatDate(poDoc.latest_payment_date)
          : "N/A";
      },
      exportHeaderName: "Latest Payment Date",
    },
    filterFn: dateFilterFn,
  },
  {
    id: "project_name", // Using id for faceted filter key
    accessorFn: (row) => row.projectName || row.project, // For sorting/filtering if values are just IDs
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Project" />
    ),
    cell: ({ row }) => (
      <div>{row.original.projectName || row.original.project}</div>
    ), // Display name
    meta: {
      exportHeaderName: "Project",
      exportValue: (row: POReportRowData) => row.projectName || row.project,
    },
    filterFn: facetedFilterFn,
  },
  {
    id: "vendor_name", // Using id for faceted filter key
    accessorFn: (row) => row.vendorName || row.vendor, // For sorting/filtering if values are just IDs
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Vendor" />
    ),
    cell: ({ row }) => (
      <div>{row.original.vendorName || row.original.vendor}</div>
    ), // Display name
    meta: {
      exportHeaderName: "Vendor",
      exportValue: (row: POReportRowData) => row.vendorName || row.vendor,
    },
    filterFn: facetedFilterFn,
  },
  {
    accessorKey: "totalAmount", // This is pre-calculated in POReportRowData
    header: ({ column }) => (
      <DataTableColumnHeader column={column}
        title={

          <div className="text-center whitespace-normal">
            Total PO Amt (incl. GST)
          </div>

        } />
    ),
    cell: ({ row }) => (
      <div className="tabular-nums">
        {formatToRoundedIndianRupee(row.original.totalAmount)}
      </div>
    ),
    meta: {
      exportValue: (row: POReportRowData) => formatForReport(row.totalAmount),
      exportHeaderName: "Total PO Amt",
      isNumeric: true,
    },
  },
  {
    accessorKey: "invoiceAmount", // This is pre-calculated in POReportRowData
    header: ({ column }) => (
      // <DataTableColumnHeader column={column} title="" />
      <DataTableColumnHeader column={column}
        title={

          <div className="text-center whitespace-normal">
            Total Invoice Amt (incl. GST)
          </div>

        } />
    ),
    cell: ({ row }) => (
      <div className="tabular-nums">
        {formatToRoundedIndianRupee(row.original.invoiceAmount)}
      </div>
    ),
    meta: {
      exportValue: (row: POReportRowData) => formatForReport(row.invoiceAmount),
      exportHeaderName: "Total Invoice Amt (incl. GST)",
      isNumeric: true,
    },
  },
  {
    accessorKey: "amountPaid", // This is pre-calculated in POReportRowData
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Amt Paid" />
    ),
    cell: ({ row }) => (
      <div className="tabular-nums">
        {formatToRoundedIndianRupee(row.original.amountPaid)}
      </div>
    ),
    meta: {
      exportValue: (row: POReportRowData) => formatForReport(row.amountPaid),
      exportHeaderName: "Amt Paid",
      isNumeric: true,
    },
  },
  {
    id: "PendingInvoice",
    accessorFn: (row) => row.amountPaid - row.invoiceAmount,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Pending Invoice Amt" />
    ),
    cell: ({ row }) => (
      <div className="tabular-nums">
        {formatToRoundedIndianRupee(row.original.amountPaid - row.original.invoiceAmount)}
      </div>
    ),
    meta: {
      exportValue: (row: POReportRowData) => formatForReport(row.amountPaid - row.invoiceAmount),
      exportHeaderName: "Pending Invoice Amt",
      isNumeric: true,
    },
  },
  {
    id: "remarks",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Remarks" />
    ),
    cell: ({ row }) => <PORemarksHoverCard poId={row.original.name} />,
    size: 80,
    enableSorting: false,
    meta: {
      exportHeaderName: "Remarks",
      exportValue: () => "-", // Remarks are not exported
    },
  },
];

export const basePOColumnsForPM: ColumnDef<POReportRowData>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="#PO" />
    ),
    cell: ({ row }) => {
      const name = row.original.name;
      return (
        <div className="flex items-center">
          {name}
          <Link
            to={`/prs&milestones/delivery-notes/${name.replaceAll("/", "&=")}`}
          >
            <Info className="text-blue-500 h-3 w-3 ml-1 mt-0.5" />
          </Link>
        </div>
      );
    },
    size: 200,
    meta: {
      exportHeaderName: "#PO",
      exportValue: (row: POReportRowData) => row.name,
    },
  },
  {
    accessorKey: "creation",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Date Created" />
    ),
    cell: ({ row }) => <div>{formatDate(row.original.creation)}</div>,
    meta: {
      exportValue: (row: POReportRowData) => formatDate(row.creation),
      exportHeaderName: "Date Created",
    },
    filterFn: dateFilterFn,
  },
  {
    id: "project", // Using id for faceted filter key
    accessorFn: (row) => row.projectName || row.project, // For sorting/filtering if values are just IDs
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Project" />
    ),
    cell: ({ row }) => (
      <div>{row.original.projectName || row.original.project}</div>
    ), // Display name
    meta: {
      exportHeaderName: "Project",
      exportValue: (row: POReportRowData) => row.projectName || row.project,
    },
    filterFn: facetedFilterFn,
  },
  {
    id: "vendor_name", // Using id for faceted filter key
    accessorFn: (row) => row.vendorName || row.vendor, // For sorting/filtering if values are just IDs
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Vendor" />
    ),
    cell: ({ row }) => (
      <div>{row.original.vendorName || row.original.vendor}</div>
    ), // Display name
    meta: {
      exportHeaderName: "Vendor",
      exportValue: (row: POReportRowData) => row.vendorName || row.vendor,
    },
    filterFn: facetedFilterFn,
  },
  {
    accessorKey: "totalAmount", // This is pre-calculated in POReportRowData
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Total PO Amt" />
    ),
    cell: ({ row }) => (
      <div className="tabular-nums">
        {formatToRoundedIndianRupee(row.original.totalAmount)}
      </div>
    ),
    meta: {
      exportValue: (row: POReportRowData) => formatForReport(row.totalAmount),
      exportHeaderName: "Total PO Amt",
      isNumeric: true,
    },
  },
  {
    accessorKey: "invoiceAmount", // This is pre-calculated in POReportRowData
    header: ({ column }) => (
    //  <DataTableColumnHeader column={column} title="Total Invoice Amt (incl. GST)" />
     <DataTableColumnHeader column={column}
        title={

          <div className="text-center whitespace-normal">
            Total Invoice Amt (incl. GST)
          </div>

        } />
    ),
    cell: ({ row }) => (
      <div className="tabular-nums">
        {formatToRoundedIndianRupee(row.original.invoiceAmount)}
      </div>
    ),
    meta: {
      exportValue: (row: POReportRowData) => formatForReport(row.invoiceAmount),
      exportHeaderName: "Total Invoice Amt (incl. GST)",
      isNumeric: true,
    },
  },
  {
    accessorKey: "amountPaid", // This is pre-calculated in POReportRowData
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Amt Paid" />
    ),
    cell: ({ row }) => (
      <div className="tabular-nums">
        {formatToRoundedIndianRupee(row.original.amountPaid)}
      </div>
    ),
    meta: {
      exportValue: (row: POReportRowData) => formatForReport(row.amountPaid),
      exportHeaderName: "Amt Paid",
      isNumeric: true,
    },
  },
  {
    id: "PendingInvoice",
    accessorFn: (row) => row.amountPaid - row.invoiceAmount,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Pending Invoice Amt" />
    ),
    cell: ({ row }) => (
      <div className="tabular-nums">
        {formatToRoundedIndianRupee(row.original.amountPaid - row.original.invoiceAmount)}
      </div>
    ),
    meta: {
      exportValue: (row: POReportRowData) => formatForReport(row.amountPaid - row.invoiceAmount),
      exportHeaderName: "Pending Invoice Amt",
      isNumeric: true,
    },
  },
  {
    id: "remarks",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Remarks" />
    ),
    cell: ({ row }) => <PORemarksHoverCard poId={row.original.name} />,
    size: 80,
    enableSorting: false,
    meta: {
      exportHeaderName: "Remarks",
      exportValue: () => "-", // Remarks are not exported
    },
  },
];

// // Column specific to "Dispatched for 3 days" report
// export const dispatchedDateColumn: ColumnDef<POReportRowData> = {
//     // POReportRowData contains originalDoc. We access dispatch_date through it.
//     // For direct access for sorting/filtering by TanStack table, if `originalDoc.dispatch_date` is complex,
//     // you might need an accessorFn. If it's a direct string/date on `originalDoc`, this is fine.
//     accessorKey: "dispatch_date",
//     header: ({ column }) => <DataTableColumnHeader column={column} title="Dispatched Date" />,
//     cell: ({ row }) => {
//         const poDoc = row.original.originalDoc as ProcurementOrder; // POReportRowData.originalDoc is already ProcurementOrder
//         return <div>{poDoc.dispatch_date ? formatDate(poDoc.dispatch_date) : "N/A"}</div>;
//     },
//     meta: {
//         exportValue: (row: POReportRowData) => {
//             const poDoc = row.originalDoc as ProcurementOrder;
//             return poDoc.dispatch_date ? formatDate(poDoc.dispatch_date) : "N/A";
//         },
//         exportHeaderName: "Dispatched Date"
//     },
//     filterFn: dateFilterFn,
// };
// Column specific to "Dispatched for 3 days" report

export const dispatchedDateColumn: ColumnDef<POReportRowData> = {
  // UPDATED: Replaced accessorKey with id and accessorFn
  id: "dispatch_date", // A unique string ID for the column
  accessorFn: (row) => row.originalDoc.dispatch_date, // Explicitly tell the table where to get the data

  header: ({ column }) => (
    <DataTableColumnHeader column={column} title="Dispatched Date" />
  ),
  cell: ({ row }) => {
    // We can now use row.getValue() which is cleaner, as it uses the accessorFn
    const dispatchDate = row.getValue("dispatch_date") as string | undefined;
    return <div>{dispatchDate ? formatDate(dispatchDate) : "N/A"}</div>;
  },
  meta: {
    exportValue: (row: POReportRowData) => {
      const poDoc = row.originalDoc as ProcurementOrder;
      return poDoc.dispatch_date ? formatDate(poDoc.dispatch_date) : "N/A";
    },
    exportHeaderName: "Dispatched Date",
  },
  // This will now receive the correct value from the accessorFn
  filterFn: dateFilterFn,
};
// // --- NEW: Column for Latest Delivery Date ---
// export const latestDeliveryDateColumn: ColumnDef<POReportRowData> = {
//     id: "latest_delivery_date",
//     accessorFn: (row) => row.originalDoc.latest_delivery_date,
//     header: ({ column }) => <DataTableColumnHeader column={column} title="Latest Delivery Date" />,
//     cell: ({ row }) => {
//         const deliveryDate = row.getValue("latest_delivery_date") as string | undefined;
//         // Use formatDate for consistency, it will handle null/undefined gracefully
//          return <div>{deliveryDate ? formatDate(deliveryDate) : "N/A"}</div>;
//     },
//     meta: {
//         exportValue: (row: POReportRowData) => formatDate(row.originalDoc.latest_delivery_date),
//         exportHeaderName: "Latest Delivery Date"
//     },
//     filterFn: dateFilterFn, // This column can be filtered by date
// };


// // --- NEW: Column for Latest Payment Date ---
// export const latestPaymentDateColumn: ColumnDef<POReportRowData> = {
//     id: "latest_payment_date",
//     accessorFn: (row) => row.originalDoc.latest_payment_date,
//     header: ({ column }) => <DataTableColumnHeader column={column} title="Latest Payment Date" />,
//     cell: ({ row }) => {
//         const paymentDate = row.getValue("latest_payment_date") as string | undefined;
//         return <div>{paymentDate ? formatDate(paymentDate) : "N/A"}</div>;
//     },
//     meta: {
//         exportValue: (row: POReportRowData) => formatDate(row.originalDoc.latest_payment_date),
//         exportHeaderName: "Latest Payment Date"
//     },
//     filterFn: dateFilterFn, // This column can also be filtered by date
// };




import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Users, ChevronRight, User } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";

// --- NEW: Column for Assignees (Project Team) ---
export const assigneesColumn: ColumnDef<POReportRowData> = {
    id: "assignees",
    accessorFn: (row) => row.assignees?.map(a => a.name).join(", "), // For filtering/sorting
    header: ({ column }) => <DataTableColumnHeader column={column} title="Assignees" className="justify-center" />,
    cell: ({ row }) => {
        const assignees = row.original.assignees || [];
        
        if (assignees.length === 0) {
            return <div className="text-center text-gray-400">--</div>;
        }

        // Group by Role
        const grouped = assignees.reduce((acc, user) => {
            const roleName = user.role?.replace(/Nirmaan\s|\sProfile/g, "") || "Others";
            if (!acc[roleName]) acc[roleName] = [];
            acc[roleName].push(user);
            return acc;
        }, {} as Record<string, typeof assignees>);

        return (
            <div className="flex justify-center">
                 <HoverCard openDelay={200} closeDelay={100}>
                    <HoverCardTrigger asChild>
                        <div className="cursor-pointer p-1.5 hover:bg-gray-100 rounded-full transition-colors group">
                            <Users className="w-4 h-4 text-gray-500 group-hover:text-blue-600" />
                        </div>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-72 p-0 shadow-lg" side="left" align="start">
                         <div className="p-3 border-b bg-gray-50/50 flex justify-between items-center">
                            <h4 className="font-semibold text-sm text-gray-900">Responsible Team</h4>
                            <Badge variant="outline" className="bg-white text-xs font-normal">
                                {assignees.length} Members
                            </Badge>
                        </div>
                        <div className="max-h-[300px] overflow-y-auto p-2 space-y-3 custom-scrollbar">
                            {Object.entries(grouped).map(([role, users]) => (
                                <div key={role} className="space-y-1">
                                    <div className="flex items-center gap-1 px-2">
                                        <h5 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                            {role}
                                        </h5>
                                        <div className="h-px bg-gray-100 flex-1 ml-2" />
                                    </div>
                                    <div className="space-y-1">
                                        {users.map((user, idx) => (
                                            <div 
                                                key={idx} 
                                                className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 transition-colors"
                                            >
                                                <div className="h-6 w-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0 border border-blue-100">
                                                    <span className="text-[10px] font-bold text-blue-600">
                                                        {user.name.charAt(0).toUpperCase()}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-medium text-gray-900 leading-none">
                                                        {user.name}
                                                    </span>
                                                    <span className="text-[10px] text-gray-500 mt-0.5">
                                                        {user.email || 'Nirmaan User'}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </HoverCardContent>
                </HoverCard>
            </div>
        );
    },
    size: 80,
    enableSorting: false, // Sorting by list of names is rarely useful in this view
    meta: {
        exportValue: (row: POReportRowData) => row.assignees?.map(a => `${a.name} (${a.role})`).join("; ") || "--",
        exportHeaderName: "Assignees"
    }
};

// Function to get columns based on report type
export const getPOReportColumns = (
  reportType?: ReportType,
  role?: string
): ColumnDef<POReportRowData>[] => {
  let columnsToDisplay: ColumnDef<POReportRowData>[] =
    role === "Nirmaan Project Manager Profile"
      ? [...basePOColumnsForPM]
      : [...basePOColumns];
  // console.log("reportType", reportType);

  if (reportType === "Dispatched for 1 days") {
    // Filter out the 'latest_delivery_date' column if it exists
    columnsToDisplay = columnsToDisplay.filter(
      (col) => (col as any).id !== "latest_delivery_date"
    );

    // Insert the 'dispatchedDateColumn' at the second position (index 1)
    columnsToDisplay.splice(1, 0, dispatchedDateColumn);
  }
  
  if (reportType !== "2B Reconcile Report") {
      // Insert after Project column (id="project_name" in basePOColumns or "project" in basePOColumnsForPM)
      // We want it BETWEEN Project and Vendor.
      // Filter for Project Index
      const projectIndex = columnsToDisplay.findIndex(c => (c as any).id === "project_name" || (c as any).id === "project");
      
      const insertIndex = projectIndex !== -1 ? projectIndex + 1 : 4; // Default to index 4 if not found

      columnsToDisplay.splice(insertIndex, 0, assigneesColumn);
  }

  // You could add more conditional columns here for other report types if needed
  return columnsToDisplay;
};
