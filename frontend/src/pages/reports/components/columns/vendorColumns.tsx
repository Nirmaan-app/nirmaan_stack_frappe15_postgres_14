// frontend/src/pages/reports/components/columns/vendorColumns.tsx
import { ColumnDef } from "@tanstack/react-table";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { Link } from "react-router-dom";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { VendorCalculatedFields } from "../../hooks/useVendorLedgerCalculations";

// One report row: the vendor plus its ledger totals, so every column sorts on a real value.
export type VendorReportRow = Vendors & VendorCalculatedFields;

// Ignoring case, spaces and punctuation matches the order Postgres (en_US.utf8) gave the
// old server-side "vendor_name asc" sort, e.g. "A B PAL" sits between "ABDUL" and "ABRAR".
const vendorNameCollator = new Intl.Collator(undefined, { sensitivity: "base", ignorePunctuation: true });

// Numeric total column. `enableGlobalFilter: false` is set on EVERY column: VendorReports
// searches the selected field itself, so the table's fuzzy global filter must never run.
const totalColumn = (accessor: keyof VendorCalculatedFields, title: React.ReactNode): ColumnDef<VendorReportRow> => ({
  accessorKey: accessor,
  header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
  cell: ({ row }) => (
    <div className="tabular-nums text-center">{formatToRoundedIndianRupee(row.original[accessor])}</div>
  ),
  sortingFn: "basic",
  enableGlobalFilter: false,
});

// Main function to get all columns
export const getVendorColumns = (): ColumnDef<VendorReportRow>[] => [
  {
    accessorKey: "vendor_name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor Name" />,
    cell: ({ row }) => (
      <Link to={`/vendors/${row.original.name}?tab=poVendorLedger`} className="text-blue-600 hover:underline">
        {row.original.vendor_name || row.original.name}
      </Link>
    ),
    sortingFn: (a, b) => vendorNameCollator.compare(a.original.vendor_name ?? "", b.original.vendor_name ?? ""),
    enableGlobalFilter: false,
    size: 250,
  },
  {
    accessorKey: "vendor_type",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
    enableGlobalFilter: false,
  },
  totalColumn("totalPO", <>Total PO Value<br />(incl. GST)</>),
  totalColumn("totalSR", "Total SR Value"),
  totalColumn("totalInvoiced", <>Total Invoiced<br />(incl. GST)</>),
  totalColumn("totalPaid", "Total Paid"),
  totalColumn("balance", "Balance Payable"),
];
