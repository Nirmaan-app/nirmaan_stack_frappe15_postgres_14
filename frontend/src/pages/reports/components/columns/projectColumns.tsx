import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { Projects } from "@/types/NirmaanStack/Projects"; // Base Project type
import { parseNumber } from "@/utils/parseNumber";
import { Link } from "react-router-dom";
import formatToIndianRupee from "@/utils/FormatPrice"; // Assuming formatToRoundedIndianRupee is also here
import { formatDate } from "@/utils/FormatDate";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Skeleton } from "@/components/ui/skeleton"; // For cell loading state
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
}

// A generic cell renderer for calculated fields
const CalculatedCell: React.FC<{
  row: Row<Projects>;
  table: Table<Projects>;
  accessor: keyof ProjectCalculatedFields | 'totalCredit'; // Which field to access from calculatedData
  formatter: (value: number | undefined) => string;
}> = ({ row, table, accessor, formatter }) => {
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

  return <div className="tabular-nums">{formatter(valueToFormat)}</div>;
};



// projectColumns is now a function that returns the column definitions.
// This allows for more flexibility if columns needed to be truly dynamic based on props,
// though for this case, accessing meta via `table` in cell renderers is the key.
export const getProjectColumns = (): ColumnDef<Projects>[] => [
  {
    accessorKey: "project_name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Project Name" />,
    cell: ({ row }) => (
      <Link to={`/projects/${row.original.name}`} className="text-blue-600 hover:underline">
        {row.original.project_name || row.original.name}
      </Link>
    ),
    size: 200, // Adjust size as needed
    meta: { exportHeaderName: "Project Name", exportValue: (row: Projects) => row.project_name || row.name }
  },
  {
    id: "totalProjectInvoiced", // Use ID for columns not directly on `Projects`
    header: ({ column }) => <DataTableColumnHeader column={column} title="Client Invoiced (incl. GST)" />,
    cell: (props) => <CalculatedCell {...props} accessor="totalProjectInvoiced" formatter={formatDisplayValueToLakhs} />,
    meta: { exportHeaderName: "Total Project Invoiced (incl. GST)", isNumeric: true } // exportValue will need custom handling (see ProjectReports.tsx)
  },
  {
    id: "totalInflow",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Inflow" />,
    cell: (props) => <CalculatedCell {...props} accessor="totalInflow" formatter={formatDisplayValueToLakhs} />,
    meta: { exportHeaderName: "Inflow", isNumeric: true }
  },
  {
    id: "totalOutflow",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Outflow" />,
    cell: (props) => <CalculatedCell {...props} accessor="totalOutflow" formatter={formatDisplayValueToLakhs} />,
    meta: { exportHeaderName: "Outflow", isNumeric: true }
  },
  {
    id: "totalInvoiced", // Use ID for columns not directly on `Projects`
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total PO+SR Value (incl. GST)" />,
    cell: (props) => <CalculatedCell {...props} accessor="totalInvoiced" formatter={formatDisplayValueToLakhs} />,
    meta: { exportHeaderName: "Total PO+SR Value(incl. GST)", isNumeric: true } // exportValue will need custom handling (see ProjectReports.tsx)
  },
  // --- (Indicator) NEW COLUMN ---
  {
    id: "totalPoSrInvoiced",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total PO+SR Invoiced (incl. GST)" />,
    cell: (props) => <CalculatedCell {...props} accessor="totalPoSrInvoiced" formatter={formatDisplayValueToLakhs} />,
    meta: { exportHeaderName: "Total PO+SR Invoiced (incl. GST)", isNumeric: true }
  },
  {
    accessorKey: "project_value",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Value (excl. GST)" />,
    cell: ({ row }) => <div className="tabular-nums">{formatDisplayValueToLakhs(row.original.project_value)}</div>,
    meta: { exportHeaderName: "Value (excl. GST)", exportValue: (row: Projects) => formatValueToLakhsString(row.project_value), isNumeric: true }
  },
   // --- ✨ THIS IS THE FIX FOR YOUR NEW COLUMNS ---
  {
    id: "totalBalanceCredit", // A unique ID for the column
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total Balance Due" />,
    // Pass the correct accessor string that matches the key in ProjectCalculatedFields
    cell: (props) => <CalculatedCell {...props} accessor="totalBalanceCredit" formatter={formatValueToLakhsString} />,
    meta: { 
      exportHeaderName: "Balance on Credit (Lakhs)", 
      isNumeric: true 
    }
  },
  {
    id: "totalDue", // A unique ID for the column
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total Due Not Paid" />,
    // Pass the correct accessor string
    cell: (props) => <CalculatedCell {...props} accessor="totalDue" formatter={formatValueToLakhsString} />,
    meta: { 
      exportHeaderName: "Amount Due (Lakhs)", 
      isNumeric: true
    }
  },
  // --- END OF FIX ---
  
  {
    accessorKey: "creation",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Creation Date" />,
    cell: ({ row }) => <div>{formatDate(row.original.creation)}</div>,
    meta: { exportHeaderName: "Creation Date", exportValue: (row: Projects) => formatDate(row.creation) }
  },
  
];