/**
 * Column definitions for the Bulk Download selection tables, one set per document type.
 *
 * Facet columns filter with `facetedFilterFn`, date columns with `dateFilterFn` -- the same
 * client-side filter functions the rest of the app's tables use. Columns left searchable
 * (`enableGlobalFilter` not switched off) are what the table's search box matches.
 */
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import type { POItem, WOItem, VendorInvoice, PODeliveryDocuments, ProjectInvoice } from "../useBulkDownloadWizard";

type VendorRow = { name: string; vendor?: string; vendor_name?: string };

/** `yyyy-MM-dd[ time]` -> `dd-MMM-yyyy`, read at local midnight so the day never shifts. */
const displayDate = (value?: string) => (value ? formatDate(`${value.slice(0, 10)}T00:00:00`) : "—");

const textColumn = <T,>(id: string, title: string, get: (row: T) => string | undefined, strong = false): ColumnDef<T, any> => ({
    id,
    accessorFn: (row) => get(row) ?? "",
    header: title,
    cell: ({ getValue }) => <span className={strong ? "font-medium" : undefined}>{getValue() || "—"}</span>,
});

const facetColumn = <T,>(id: string, title: string, get: (row: T) => string | undefined): ColumnDef<T, any> => ({
    id,
    accessorFn: (row) => get(row) ?? "",
    header: title,
    filterFn: facetedFilterFn,
    cell: ({ getValue }) => <span>{getValue() || "—"}</span>,
});

const vendorColumn = <T extends VendorRow>(): ColumnDef<T, any> =>
    facetColumn<T>("vendor", "Vendor", (row) => row.vendor_name || row.vendor);

const statusColumn = <T extends { status?: string }>(): ColumnDef<T, any> => ({
    id: "status",
    accessorFn: (row) => row.status ?? "",
    header: "Status",
    filterFn: facetedFilterFn,
    enableGlobalFilter: false,
    cell: ({ getValue }) =>
        getValue() ? (
            <Badge variant="outline" className="text-[11px] py-0.5 px-2 h-auto font-medium border-gray-300 whitespace-nowrap">
                {getValue()}
            </Badge>
        ) : null,
});

const dateColumn = <T,>(id: string, title: string, get: (row: T) => string | undefined): ColumnDef<T, any> => ({
    id,
    accessorFn: (row) => get(row) ?? "",
    header: title,
    filterFn: dateFilterFn,
    enableGlobalFilter: false,
    cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{displayDate(getValue())}</span>,
});

const amountColumn = <T,>(id: string, title: string, get: (row: T) => number | undefined): ColumnDef<T, any> => ({
    id,
    accessorFn: (row) => get(row) ?? 0,
    header: title,
    enableGlobalFilter: false,
    cell: ({ row }) => {
        const value = get(row.original);
        return value != null ? <span className="whitespace-nowrap tabular-nums">{formatToRoundedIndianRupee(value)}</span> : "—";
    },
});

const poOf = (row: PODeliveryDocuments) => row.parent_docname || row.procurement_order;

export const poColumns: ColumnDef<POItem, any>[] = [
    textColumn<POItem>("name", "PO ID", (row) => row.name, true),
    vendorColumn<POItem>(),
    statusColumn<POItem>(),
    amountColumn<POItem>("amount", "Amount (excl. GST)", (row) => row.amount),
    amountColumn<POItem>("total_amount", "Amount (incl. GST)", (row) => row.total_amount),
    dateColumn<POItem>("creation", "Created On", (row) => row.creation),
];

export const woColumns: ColumnDef<WOItem, any>[] = [
    textColumn<WOItem>("name", "WO ID", (row) => row.name, true),
    vendorColumn<WOItem>(),
    amountColumn<WOItem>("total_amount", "Amount (incl. GST)", (row) => row.total_amount),
    dateColumn<WOItem>("creation", "Created On", (row) => row.creation),
];

export const dnColumns: ColumnDef<POItem, any>[] = [
    textColumn<POItem>("name", "PO ID", (row) => row.name, true),
    vendorColumn<POItem>(),
    statusColumn<POItem>(),
    dateColumn<POItem>("creation", "PO Date", (row) => row.creation),
    dateColumn<POItem>("latest_delivery_date", "Last Delivery", (row) => row.latest_delivery_date),
];

export const invoiceColumns: ColumnDef<VendorInvoice, any>[] = [
    textColumn<VendorInvoice>("invoice_no", "Invoice No", (row) => row.invoice_no, true),
    vendorColumn<VendorInvoice>(),
    {
        ...facetColumn<VendorInvoice>("type", "Type", (row) =>
            row.document_type === "Procurement Orders" ? "PO Invoice" : row.document_type === "Service Requests" ? "WO Invoice" : row.document_type
        ),
        enableGlobalFilter: false,
    },
    textColumn<VendorInvoice>("document_name", "PO / WO", (row) => row.document_name),
    dateColumn<VendorInvoice>("invoice_date", "Invoice Date", (row) => row.invoice_date),
    amountColumn<VendorInvoice>("invoice_amount", "Invoice Amount", (row) => row.invoice_amount),
];

export const dcColumns: ColumnDef<PODeliveryDocuments, any>[] = [
    textColumn<PODeliveryDocuments>("reference_number", "DC No.", (row) => row.reference_number, true),
    textColumn<PODeliveryDocuments>("po", "PO", poOf),
    vendorColumn<PODeliveryDocuments>(),
    dateColumn<PODeliveryDocuments>("dc_date", "DC Date", (row) => row.dc_date),
    dateColumn<PODeliveryDocuments>("creation", "Uploaded On", (row) => row.creation),
];

export const mirColumns: ColumnDef<PODeliveryDocuments, any>[] = [
    textColumn<PODeliveryDocuments>("reference_number", "MIR No.", (row) => row.reference_number, true),
    textColumn<PODeliveryDocuments>("dc_reference", "DC Ref", (row) => row.dc_reference),
    textColumn<PODeliveryDocuments>("po", "PO", poOf),
    vendorColumn<PODeliveryDocuments>(),
    dateColumn<PODeliveryDocuments>("dc_date", "MIR Date", (row) => row.dc_date),
    dateColumn<PODeliveryDocuments>("creation", "Uploaded On", (row) => row.creation),
];

export const clientInvoiceColumns: ColumnDef<ProjectInvoice, any>[] = [
    textColumn<ProjectInvoice>("invoice_no", "Invoice No", (row) => row.invoice_no, true),
    facetColumn<ProjectInvoice>("customer", "Customer", (row) => row.company_name || row.customer),
    dateColumn<ProjectInvoice>("invoice_date", "Invoice Date", (row) => row.invoice_date),
    amountColumn<ProjectInvoice>("amount", "Amount (incl. GST)", (row) => row.amount),
];
