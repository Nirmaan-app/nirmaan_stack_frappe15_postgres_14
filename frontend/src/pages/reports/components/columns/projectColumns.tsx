import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { Projects } from "@/types/NirmaanStack/Projects"; // Base Project type
import { parseNumber } from "@/utils/parseNumber";
import { Link } from "react-router-dom";
import formatToIndianRupee from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectCalculatedFields } from "../../hooks/useProjectReportCalculations";



// Helper functions (formatValueToLakhsString, formatDisplayValueToLakhs) remain the same...


export const formatValueToLakhsString = (value: string | number | undefined | null): string => {
  const num = parseNumber(value);
  if (isNaN(num)) return "-";
  if (num === 0) return "0.00 L";
  const valueInLakhs = (num / 100000).toFixed(2);
  return `${valueInLakhs} L`;
};

const formatDisplayValueToLakhs = (value: string | number | undefined | null): string => {
  const num = parseNumber(value);
  if (isNaN(num)) return "-";
  if (num === 0) return "₹0 L";
  const valueInLakhs = num / 100000;
  return formatToIndianRupee(valueInLakhs) + " L";
};


// Define the expected structure of table.options.meta
interface ProjectTableMeta {
  getProjectCalculatedFields: (projectId: string) => ProjectCalculatedFields | null;
  isLoadingGlobalDeps: boolean;
  dateRange?: { from?: string; to?: string };
}

// A generic cell renderer for calculated fields
const CalculatedCell: React.FC<{
  row: Row<Projects>;
  table: Table<Projects>;
  accessor: keyof ProjectCalculatedFields | 'totalCredit'; // Which field to access from calculatedData
  formatter: (value: number | undefined) => string;
  isLink?: boolean;
  projectId?: string;
  linkToReport?: 'Inflow Report' | 'Outflow Report(Project)';
}> = ({ row, table, accessor, formatter, isLink = false, projectId, linkToReport }) => {
  const meta = table.options.meta as ProjectTableMeta | undefined;

  if (!meta || typeof meta.getProjectCalculatedFields !== 'function') {
    console.error("Table meta not configured correctly for calculated fields.");
    return <span className="text-destructive text-xs">Meta Error</span>;
  }

  if (meta.isLoadingGlobalDeps) {
    return <Skeleton className="h-4 w-20 my-1" />;
  }

  const calculatedData = meta.getProjectCalculatedFields(row.original.name);

  if (calculatedData === null) { // Data is still being processed or not available
    return <Skeleton className="h-4 w-20 my-1" />;
  }

  let valueToFormat: number | undefined;
  if (accessor === 'totalCredit') {
    valueToFormat = parseNumber(calculatedData.totalInvoiced) - parseNumber(calculatedData.totalInflow);
  } else {
    valueToFormat = calculatedData[accessor];
  }

  const displayValue = <div className="tabular-nums">{formatter(valueToFormat)}</div>;

  if (isLink && projectId && linkToReport) {
    // 1. Define the filter structure for tanstack-table
    const filters = [{ id: 'project', value: [projectId] }];

    const { dateRange } = meta; 

// ...

const dateColumnIdInReport = 'payment_date';

if (dateRange && dateRange.from && dateRange.to) {
        // We push a single filter object using the 'Between' operator 
        // and an array containing the start and end date strings.
        filters.push({
            id: dateColumnIdInReport,
            value: {
                operator: 'Between', // <-- NEW OPERATOR
                value: [dateRange.from, dateRange.to] // <-- NEW ARRAY VALUE
            },
        });
    }

    // 2. Stringify and Base64 encode the filter array.
    const encodedFilters = btoa(JSON.stringify(filters));

    const reportType = encodeURIComponent(linkToReport);

    const urlSyncKey = linkToReport === 'Inflow Report'
      ? 'inflow_report_table'
      : 'outflow_report_table';
    // 3. Construct the URL with the correct sync key ('inflow_report_table') + '_filters'
    // const targetUrl = `/reports?tab=projects&report=${reportType}&inflow_report_table_filters=${encodedFilters}`;
    const targetUrl = `/reports?tab=projects&report=${reportType}&${urlSyncKey}_filters=${encodedFilters}`;

    return (
      <Link to={targetUrl} className="text-blue-600 hover:underline">
        {displayValue}
      </Link>
    );
  }

  return displayValue;
};




export type ProjectWithCalculations = Projects & Partial<ProjectCalculatedFields> & {
    cashflowGap?: number;
};

// projectColumns is now a function that returns the column definitions.
// This allows for more flexibility if columns needed to be truly dynamic based on props,
// though for this case, accessing meta via `table` in cell renderers is the key.
export const getClientProjectColumns = (): ColumnDef<ProjectWithCalculations>[] => [
  {
    accessorKey: "project_name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Project Name" />,
    cell: ({ row }) => (
      <Link to={`/projects/${row.original.name}`} className="text-blue-600 hover:underline">
        {row.original.project_name || row.original.name}
      </Link>
    ),
    size: 150, // Adjust size as needed
    meta: { exportHeaderName: "Project Name", exportValue: (row: Projects) => row.project_name || row.name }
  },
   {
    accessorKey: "project_value",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Value (excl. GST)" className="[&_button]:whitespace-normal text-left" />,
    cell: ({ row }) => <div className="tabular-nums text-center">{formatDisplayValueToLakhs(row.original.project_value)}</div>,
    size:120,
    meta: { exportHeaderName: "Value (excl. GST)", exportValue: (row: Projects) => formatValueToLakhsString(row.project_value), isNumeric: true }
  },
  {
    accessorKey: "totalProjectInvoiced",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Client Invoiced (incl. GST)" className="[&_button]:whitespace-normal text-left" />,
    cell: ({ getValue }) => <div className="tabular-nums text-center">{formatDisplayValueToLakhs(getValue() as number)}</div>,
    size: 150,
    
    meta: { exportHeaderName: "Total Project Invoiced (incl. GST)", isNumeric: true }
  },
  {
    accessorKey: "totalInflow",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Inflow" />,
    cell: ({ row, getValue, table }) => {
        const value = getValue() as number;
        
        // Link logic copied and adapted for direct value access
        const meta = table.options.meta as ProjectTableMeta | undefined; // Using any to bypass strictly defined old meta type for now
        const { dateRange } = meta || {};

        if (row.original.name) {
             const filters = [{ id: 'project', value: [row.original.name] }];
             if (dateRange?.from && dateRange?.to) {
                filters.push({
                    id: 'payment_date',
                    value: { operator: 'Between', value: [dateRange.from, dateRange.to] }
                });
            }
             const encodedFilters = btoa(JSON.stringify(filters));
             const targetUrl = `/reports?tab=projects&report=Inflow%20Report&inflow_report_table_filters=${encodedFilters}`;
             
             return (
                <Link to={targetUrl} className="text-blue-600 hover:underline">
                     <div className="tabular-nums">{formatDisplayValueToLakhs(value)}</div>
                </Link>
             )
        }
        return <div className="tabular-nums">{formatDisplayValueToLakhs(value)}</div>
    },
    size: 100,
    meta: { exportHeaderName: "Inflow", isNumeric: true }
  },
  {
    accessorKey: "totalOutflow",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Outflow" />,
    cell: ({ row, getValue, table }) => {
        const value = getValue() as number;
         // Link logic adapted
        const meta = table.options.meta as ProjectTableMeta | undefined; 
        const { dateRange } = meta || {};

        if (row.original.name) {
             const filters = [{ id: 'project', value: [row.original.name] }];
             if (dateRange?.from && dateRange?.to) {
                filters.push({
                    id: 'payment_date',
                    value: { operator: 'Between', value: [dateRange.from, dateRange.to] }
                });
            }
             const encodedFilters = btoa(JSON.stringify(filters));
             // Correct URL encoding for "Outflow Report(Project)" -> Outflow%20Report(Project)
             const targetUrl = `/reports?tab=projects&report=Outflow%20Report(Project)&outflow_report_table_filters=${encodedFilters}`;
             
             return (
                <Link to={targetUrl} className="text-blue-600 hover:underline">
                     <div className="tabular-nums">{formatDisplayValueToLakhs(value)}</div>
                </Link>
             )
        }
        return <div className="tabular-nums ">{formatDisplayValueToLakhs(value)}</div>
    },
    size: 100,
    meta: { exportHeaderName: "Outflow", isNumeric: true }
  },
  {
    accessorKey: "totalLiabilities",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Current Liability" />,
    cell: ({ getValue }) => <div className="tabular-nums">{formatDisplayValueToLakhs(getValue() as number)}</div>,
    size: 150,
    meta: { exportHeaderName: "Current Liability", isNumeric: true }
  },
  {
    accessorKey: "cashflowGap",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Cashflow Gap" />,
    cell: ({ getValue }) => {
        const val = getValue() as number;
        return (
            <div className={`tabular-nums ${val > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {formatDisplayValueToLakhs(val)}
            </div>
          );
    },
     size: 120,
    meta: { exportHeaderName: "Cashflow Gap", isNumeric: true }
  },
  {
    accessorKey: "totalInvoiced",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total PO+SR Value (incl. GST)" className="[&_button]:whitespace-normal text-left" />,
    cell: ({ getValue }) => <div className="tabular-nums text-center">{formatDisplayValueToLakhs(getValue() as number)}</div>,
    size: 140,
    meta: { exportHeaderName: "Total PO+SR Value(incl. GST)", isNumeric: true }
  },
  {
    accessorKey: "totalPoSrInvoiced",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total PO+SR Invoice Received" className="[&_button]:whitespace-normal text-left" />,
    cell: ({ getValue }) => <div className="tabular-nums text-center">{formatDisplayValueToLakhs(getValue() as number)}</div>,
    size: 140,
    meta: { exportHeaderName: "Total PO+SR Invoice Received", isNumeric: true }
  },
  
  {
    accessorKey: "TotalPurchaseOverCredit",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total Purchase Over Credit" className="[&_button]:whitespace-normal text-left" />,
    cell: ({ getValue }) => <div className="tabular-nums text-center">{formatValueToLakhsString(getValue() as number)}</div>,
    size: 140,
    meta: {
      exportHeaderName: "Balance on Credit (Lakhs)",
      isNumeric: true
    }
  },
  // {
  //   id: "CreditPaidAmount", // A unique ID for the column
  //   header: ({ column }) => <DataTableColumnHeader column={column} title="Total Credit Amount Paid" />,
  //   // Pass the correct accessor string
  //   cell: (props) => <CalculatedCell {...props} accessor="CreditPaidAmount" formatter={formatValueToLakhsString} />,
  //   meta: {
  //     exportHeaderName: "Amount Due (Lakhs)",
  //     isNumeric: true
  //   }
  // },
  // --- END OF FIX ---

  // {
  //   accessorKey: "creation",
  //   header: ({ column }) => <DataTableColumnHeader column={column} title="Creation Date" />,
  //   cell: ({ row }) => <div>{formatDate(row.original.creation)}</div>,
  //   meta: { exportHeaderName: "Creation Date", exportValue: (row: Projects) => formatDate(row.creation) }
  // },

];

// Alias for backward compatibility. Defined at the end to ensure getClientProjectColumns is initialized.
export const getProjectColumns = getClientProjectColumns;