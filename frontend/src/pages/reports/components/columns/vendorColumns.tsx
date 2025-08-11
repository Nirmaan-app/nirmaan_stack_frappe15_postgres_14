// frontend/src/pages/reports/components/columns/vendorColumns.tsx
import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { Link } from "react-router-dom";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Skeleton } from "@/components/ui/skeleton";
import { VendorCalculatedFields, useVendorLedgerCalculations } from "../../hooks/useVendorLedgerCalculations";
import { dateFilterFn } from "@/utils/tableFilters";

// Define the expected structure of table.options.meta
interface VendorTableMeta {
  getVendorCalculatedFields: (vendorId: string) => VendorCalculatedFields | null;
  isLoadingGlobalDeps: boolean;
}

// Generic cell renderer for our calculated fields
const CalculatedCell: React.FC<{
  row: Row<Vendors>;
  table: Table<Vendors>;
  accessor: keyof VendorCalculatedFields;
}> = ({ row, table, accessor }) => {
  const meta = table.options.meta as VendorTableMeta | undefined;

  if (!meta || typeof meta.getVendorCalculatedFields !== 'function') {
    return <span className="text-destructive text-xs">Meta Error</span>;
  }

  if (meta.isLoadingGlobalDeps) {
    return <Skeleton className="h-4 w-24 my-1" />;
  }

  const calculatedData = meta.getVendorCalculatedFields(row.original.name);
  const value = calculatedData ? calculatedData[accessor] : 0;

  return <div className="tabular-nums text-center">{formatToRoundedIndianRupee(value)}</div>;
};

// Main function to get all columns
export const getVendorColumns = (): ColumnDef<Vendors>[] => [
  {
    accessorKey: "vendor_name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor Name" />,
    cell: ({ row }) => (
      <Link to={`/vendors/${row.original.name}`} className="text-blue-600 hover:underline">
        {row.original.vendor_name || row.original.name}
      </Link>
    ),
    size: 250,
  },
  {
    accessorKey: "vendor_type",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
  },
  {
    id: "totalPO",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total PO Value (incl. GST)" />,
    cell: (props) => <CalculatedCell {...props} accessor="totalPO" />,
  },
  {
    id: "totalSR",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total SR Value" />,
    cell: (props) => <CalculatedCell {...props} accessor="totalSR" />,
  },
  {
    id: "totalInvoiced",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total Invoiced (incl. GST)" />,
    cell: (props) => <CalculatedCell {...props} accessor="totalInvoiced" />,
  },
  {
    id: "totalPaid",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total Paid" />,
    cell: (props) => <CalculatedCell {...props} accessor="totalPaid" />,
  },
  {
    id: "balance",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Balance Payable" />,
    cell: (props) => <CalculatedCell {...props} accessor="balance" />,
  },
];