import React, { useMemo, useState, useCallback } from 'react';
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { Button } from "@/components/ui/button";
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { ColumnDef } from "@tanstack/react-table";
import { useServerDataTable } from '@/hooks/useServerDataTable';
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import SITEURL from "@/constants/siteURL";
import { Paperclip } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { PaymentScreenshotDialog } from './PaymentScreenshotDialog';

interface VendorPaymentsTableProps {
    vendorId: string;
    projectOptions: Array<{ label: string; value: string }>;
}

const PAYMENT_TABLE_FIELDS: (keyof ProjectPayments | 'name')[] = [
    "name", "utr", "payment_attachment", "document_name", "document_type",
    "project", "payment_date", "creation", "amount", "status"
];
const PAYMENT_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Payment ID", default: true },
    { value: "document_name", label: "Ref. Doc ID" },
    { value: "utr", label: "UTR/Ref No." },
    { value: "status", label: "Status" },
];

export const VendorPaymentsTable: React.FC<VendorPaymentsTableProps> = ({ vendorId, projectOptions }) => {
    const [currentPaymentForScreenshot, setCurrentPaymentForScreenshot] = useState<ProjectPayments | null>(null);

    const columns = useMemo<ColumnDef<ProjectPayments>[]>(() => [
        // {
        //     accessorKey: "name",
        //     header: "Payment ID",
        //     cell: ({ row }) => <div className="font-medium">{row.original.name}</div>,
        //     size: 150,
        // },
        {
            accessorKey: "utr",
            header: "UTR / Ref No.",
            cell: ({ row }) => {
                const payment = row.original;
                return (
                    <div className="font-medium min-w-[150px] flex items-center gap-1.5">
                        {payment.utr && payment.payment_attachment ? (
                            <a href={`${SITEURL}${payment.payment_attachment}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                {payment.utr || "View Attachment"}
                            </a>
                        ) : payment.utr || "N/A"}
                        {/* Allow attaching only if UTR exists but no attachment yet */}
                        {payment.utr && !payment.payment_attachment && (
                            <Button variant="ghost" size="icon" className="h-6 w-6 p-0 text-primary hover:bg-primary/10" onClick={() => setCurrentPaymentForScreenshot(payment)}>
                                <Paperclip className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                );
            }, size: 180,
        },
        {
            accessorKey: "document_name",
            header: "Reference Doc",
            cell: ({ row }) => (
              <div  className="font-medium min-w-[170px]">
               {row.original?.document_name}
               <span className="text-xs text-muted-foreground">({row.original.document_type === "Procurement Orders" ? "PO" : "SR"})</span>
               </div>
                // <Link className="text-blue-600 hover:underline min-w-[160px] block"
                //       to={row.original.document_type === "Procurement Orders" ? `/procurement-orders/po/${row.original.document_name.replaceAll("/", "&=")}` : `/service-requests/sr/${row.original.document_name.replaceAll("/","&=")}`}>
                //     {row.original.document_name} <span className="text-xs text-muted-foreground">({row.original.document_type === "Procurement Orders" ? "PO" : "SR"})</span>
                // </Link>
            ), size: 200,
        },
        {
            accessorKey: "project",
            header: "Project",
            cell: ({ row }) => {
                const proj = projectOptions.find(p => p.value === row.original.project);
                return <div className="truncate max-w-[150px]">{proj?.label || row.original.project}</div>;
            }, size: 180,
        },
        {
            accessorKey: "payment_date",
            header: "Payment Date",
            cell: ({ row }) => <div className="whitespace-nowrap">{formatDate(row.original.payment_date || row.original.creation)}</div>,
            size: 160,
        },
        {
            accessorKey: "amount",
            header: "Amount Paid",
            cell: ({ row }) => <div className="font-medium">{formatToRoundedIndianRupee(row.original.amount)}</div>,
            meta: {isNumeric: true},
            size: 130,
        },
        {
            accessorKey: "status",
            header: "Status",
            cell: ({ row }) => <Badge variant={row.original.status === "Paid" ? "green" : "outline"}>{row.original.status}</Badge>,
            size: 110,
        },
    ], [projectOptions, setCurrentPaymentForScreenshot]);

    const {
        table, isLoading, error, totalCount, refetch, // get refetch
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
    } = useServerDataTable<ProjectPayments>({
        doctype: "Project Payments",
        columns: columns,
        fetchFields: PAYMENT_TABLE_FIELDS as string[],
        searchableFields: PAYMENT_SEARCHABLE_FIELDS,
        urlSyncKey: `vendor_payments_list_${vendorId}`,
        additionalFilters: [["vendor", "=", vendorId]], // Initially fetch all, can add status filters
    });

    if (error) return <AlertDestructive error={error} />;

    return (
        <>
            <DataTable<ProjectPayments>
                table={table}
                columns={columns}
                isLoading={isLoading}
                totalCount={totalCount}
                searchFieldOptions={PAYMENT_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                showExportButton={true}
                facetFilterOptions={{ project: { title: "Project", options: projectOptions } }}
                dateFilterColumns={["payment_date", "creation"]}
                exportFileName={`vendor_payments_${vendorId}`}
            />
            {currentPaymentForScreenshot && (
                <PaymentScreenshotDialog
                    isOpen={!!currentPaymentForScreenshot}
                    onOpenChange={(open) => { if (!open) setCurrentPaymentForScreenshot(null);}}
                    paymentDoc={currentPaymentForScreenshot}
                    onUploadSuccess={() => {
                        refetch(); // Refetch payment list after upload
                        setCurrentPaymentForScreenshot(null);
                    }}
                />
            )}
        </>
    );
};