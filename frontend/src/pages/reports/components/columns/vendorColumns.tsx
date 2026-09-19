// frontend/src/pages/reports/components/columns/vendorColumns.tsx
import { ColumnDef } from "@tanstack/react-table";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { VendorCalculatedFields, getCurrentFinancialYear } from "../../hooks/useVendorLedgerCalculations";
import { HeaderWithInfo } from "./projectColumns";

// One report row: the vendor plus its ledger totals, so every column sorts on a real value.
export type VendorReportRow = Vendors & VendorCalculatedFields;

// Ignoring case, spaces and punctuation matches the order Postgres (en_US.utf8) gave the
// old server-side "vendor_name asc" sort, e.g. "A B PAL" sits between "ABDUL" and "ABRAR".
const vendorNameCollator = new Intl.Collator(undefined, { sensitivity: "base", ignorePunctuation: true });

// Numeric total column. `enableGlobalFilter: false` is set on EVERY column: VendorReports
// searches the selected field itself, so the table's fuzzy global filter must never run.
const totalColumn = (
  accessor: keyof VendorCalculatedFields,
  title: React.ReactNode,
  tooltip: string,
): ColumnDef<VendorReportRow> => ({
  accessorKey: accessor,
  header: ({ column }) => (
    <HeaderWithInfo tooltip={tooltip}>
      <DataTableColumnHeader column={column} title={title} />
    </HeaderWithInfo>
  ),
  cell: ({ row }) => (
    <div className="tabular-nums text-center">{formatToRoundedIndianRupee(row.original[accessor])}</div>
  ),
  sortingFn: "basic",
  enableGlobalFilter: false,
});

// Main function to get all columns
export const getVendorColumns = (): ColumnDef<VendorReportRow>[] => {
  const fy = getCurrentFinancialYear();
  return [
    {
      accessorKey: "vendor_name",
      header: ({ column }) => (
        <HeaderWithInfo tooltip="Vendor name. Click to open the vendor's ledger.">
          <DataTableColumnHeader column={column} title="Vendor Name" />
        </HeaderWithInfo>
      ),
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
      header: ({ column }) => (
        <HeaderWithInfo tooltip="Vendor category: Material, Service, or Material & Service.">
          <DataTableColumnHeader column={column} title="Type" />
        </HeaderWithInfo>
      ),
      enableGlobalFilter: false,
    },
    totalColumn(
      "totalPO",
      <>Total PO Value<br />(incl. GST)</>,
      "Total value of Purchase Orders raised for this vendor, inclusive of GST. When a date range is applied, only POs created within that range are included.",
    ),
    totalColumn(
      "totalSR",
      <>Total WO Value<br />(incl. GST)</>,
      "Total value of Work Orders raised for this vendor, inclusive of GST where applicable. When a date range is applied, only WOs created within that range are included.",
    ),
    totalColumn(
      "totalInvoiced",
      <>Total Invoiced<br />(incl. GST)</>,
      "Total value of approved invoices received from this vendor, inclusive of GST. When a date range is applied, only invoices dated within that range are included.",
    ),
    totalColumn(
      "totalPaid",
      "Total Paid",
      "Total payments made to this vendor (status: Paid). When a date range is applied, only payments dated within that range are included.",
    ),
    totalColumn(
      "currentFYPaid",
      <>Current FY Paid<br />({fy.label})</>,
      `Total payments made to this vendor during the current financial year (${format(fy.start, "d MMM yyyy")} – ${format(fy.end, "d MMM yyyy")}). This column is not affected by the date filter.`,
    ),
    totalColumn(
      "balance",
      "Balance Payable",
      "Outstanding amount payable to this vendor, as per the vendor's Ledger tab (including the opening balance as of 31 Mar 2025). This column is not affected by the date filter. A negative value indicates an advance paid to the vendor.",
    ),
  ];
};
