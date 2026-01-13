import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table'; // Your generic DataTable
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { ColumnDef } from '@tanstack/react-table';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import SITEURL from '@/constants/siteURL';
import { formatDate } from '@/utils/FormatDate';
import formatToIndianRupee, { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { Paperclip, Trash2, SquarePlus } from 'lucide-react';
import { SRNewPaymentDialog } from './SRNewPaymentDialog'; // Specific dialog for SR paid entries

import { useFrappeDeleteDoc } from 'frappe-react-sdk';
import { toast } from '@/components/ui/use-toast';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { PaymentScreenshotDialog } from '@/pages/vendors/components/PaymentScreenshotDialog';
import { SRRequestPaymentDialog } from './SRRequestPaymentDialog';
import { useUserData } from '@/hooks/useUserData';


interface SRPaymentsSectionProps {
    srId: string;
    srDoc?: ServiceRequests; // Pass the full SR document
    canRequestPayment: boolean; // e.g. based on role or SR status
    canRecordPaidEntry: boolean; // e.g., for accounts role
    totalSrAmountInclGST: number; // For RequestPaymentDialog
    totalSrAmountExclGST: number; // For RequestPaymentDialog
    currentPaidAmount: number;    // For RequestPaymentDialog
    currentPendingAmount: number; // For RequestPaymentDialog
    mutatePayments: () => Promise<any>; // To refetch payments list
}

const PAYMENT_TABLE_FIELDS: (keyof ProjectPayments | 'name')[] = [
    "name", "utr", "payment_attachment", "document_name", "project",
    "payment_date", "creation", "amount", "status", "tds", "docstatus"
];
const PAYMENT_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Payment ID", default: true },
    { value: "utr", label: "UTR/Ref No." },
    { value: "status", label: "Status" },
];

export const SRPaymentsSection: React.FC<SRPaymentsSectionProps> = ({
    srId,
    srDoc,
    canRequestPayment,
    canRecordPaidEntry,
    totalSrAmountInclGST,
    totalSrAmountExclGST,
    currentPaidAmount,
    currentPendingAmount,
    mutatePayments,
}) => {
    const [isRequestPaymentDialogOpen, setIsRequestPaymentDialogOpen] = useState(false);
    const [isNewPaymentDialogOpen, setIsNewPaymentDialogOpen] = useState(false);
    const [screenshotPayment, setScreenshotPayment] = useState<ProjectPayments | null>(null);
    const [deletePayment, setDeletePayment] = useState<ProjectPayments | null>(null);

    const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();
    const { role } = useUserData();

    const handleDeletePayment = async () => {
        if (!deletePayment) return;
        try {
            await deleteDoc("Project Payments", deletePayment.name);
            toast({ title: "Success", description: "Payment deleted successfully." });
            mutatePayments();
            setDeletePayment(null);
        } catch (error: any) {
            toast({ title: "Error", description: `Failed to delete payment: ${error.message}`, variant: "destructive" });
        }
    };

    const paymentColumns = useMemo<ColumnDef<ProjectPayments>[]>(() => [
        // ... (Your paymentColumns from VendorView, adapted slightly if needed)
        { accessorKey: "name", header: "Payment ID", size: 140 },
        {
            accessorKey: "utr", header: "UTR/Ref", size: 160,
            cell: ({ row }) => {
                const payment = row.original;
                return (
                    <div className="flex items-center gap-1.5">
                        {payment.utr && payment.payment_attachment ? (
                            <a href={`${SITEURL}${payment.payment_attachment}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                {payment.utr || "View"}
                            </a>
                        ) : payment.utr || "-"}
                        {payment.utr && !payment.payment_attachment && canRecordPaidEntry && payment.status === "Paid" && (
                            <Button variant="ghost" size="icon" className="h-5 w-5 p-0" onClick={() => setScreenshotPayment(payment)}>
                                <Paperclip className="h-3.5 w-3.5 text-primary" />
                            </Button>
                        )}
                    </div>
                );
            }
        },
        { accessorKey: "payment_date", header: "Date", cell: ({ row }) => formatDate(row.original.payment_date || row.original.creation), size: 100 },
        { accessorKey: "amount", header: () => <div className="text-right">Amount</div>, cell: ({ row }) => <div className="text-right font-medium">{formatToRoundedIndianRupee(row.original.amount)}</div>, size: 110 },
        { accessorKey: "tds", header: () => <div className="text-right">TDS</div>, cell: ({ row }) => <div className="text-right">{row.original.tds ? formatToRoundedIndianRupee(row.original.tds) : "-"}</div>, size: 90 },
        { accessorKey: "status", header: "Status", cell: ({ row }) => <Badge variant={row.original.status === "Paid" ? "green" : row.original.status === "Requested" || row.original.status === "Approved" ? "destructive" : "outline"}>{row.original.status}</Badge>, size: 100 },
        {
            id: "actions",
            cell: ({ row }) => {
                const payment = row.original;
                // Allow delete only for non-Paid/non-Approved by admin/owner or specific roles
                const canDelete = !["Paid", "Approved"].includes(payment.status) && canRecordPaidEntry; // Example condition
                if (!canDelete) return null;
                return (
                    <Button variant="ghost" size="icon" className="h-6 w-6 p-0 text-destructive" onClick={() => setDeletePayment(payment)}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                );
            },
            size: 60,
        }
    ], [canRecordPaidEntry]);

    const { table, isLoading, error, totalCount, ...dataTableProps } = useServerDataTable<ProjectPayments>({
        doctype: "Project Payments",
        columns: paymentColumns,
        fetchFields: PAYMENT_TABLE_FIELDS as string[],
        searchableFields: PAYMENT_SEARCHABLE_FIELDS,
        urlSyncKey: `sr_payments_${srId}`,
        additionalFilters: [["document_name", "=", srId], ["document_type", "=", "Service Requests"]],

    });

    // Refresh payments when the main SR doc is mutated externally, or when a payment is made/requested
    useEffect(() => {
        dataTableProps.refetch();
    }, [srDoc?.modified, mutatePayments]); // Listen to parent mutatePayments and srDoc.modified


    return (
        <Card className="shadow-sm">
            <CardHeader>
                <div className="flex justify-between items-center">
                    <CardTitle className="text-lg text-muted-foreground">Payments</CardTitle>
                    <div className="flex gap-2">
                        {canRequestPayment && (
                            <Button size="sm" variant="outline" className="text-xs" onClick={() => setIsRequestPaymentDialogOpen(true)}>
                                Request Payment
                            </Button>
                        )}
                        {canRecordPaidEntry && ["Nirmaan Accountant Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"].includes(role) && (
                            <Button size="sm" variant="default" className="text-xs" onClick={() => setIsNewPaymentDialogOpen(true)}>
                                <SquarePlus className="mr-2 h-4 w-4" /> Record Paid Entry
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {error && <AlertDestructive error={error} />}
                <DataTable<ProjectPayments>
                    table={table}
                    columns={paymentColumns}
                    isLoading={isLoading}
                    error={error}
                    totalCount={totalCount}
                    searchFieldOptions={PAYMENT_SEARCHABLE_FIELDS}
                    // Pass other search/filter props from dataTableProps
                    selectedSearchField={dataTableProps.selectedSearchField}
                    onSelectedSearchFieldChange={dataTableProps.setSelectedSearchField}
                    searchTerm={dataTableProps.searchTerm}
                    onSearchTermChange={dataTableProps.setSearchTerm}
                    // Facet/Date filters can be added if needed for payments
                    estimatedRowHeight={40}
                    showExportButton={false} // Typically not needed for embedded payment list
                />
            </CardContent>

            {/* Dialogs */}
            {isRequestPaymentDialogOpen && srDoc && (
                <SRRequestPaymentDialog
                    isOpen={isRequestPaymentDialogOpen}
                    onOpenChange={setIsRequestPaymentDialogOpen}
                    srDoc={srDoc}
                    totalSrAmountInclGST={totalSrAmountInclGST}
                    totalSrAmountExclGST={totalSrAmountExclGST}
                    currentPaidAmount={currentPaidAmount}
                    currentPendingAmount={currentPendingAmount}
                    onPaymentRequested={() => {
                        mutatePayments(); // This is passed from useApprovedSRData
                        dataTableProps.refetch(); // Refetch this table's data
                    }}
                />
            )}
            {isNewPaymentDialogOpen && srDoc && (
                <SRNewPaymentDialog
                    isOpen={isNewPaymentDialogOpen}
                    onOpenChange={setIsNewPaymentDialogOpen}
                    srDoc={srDoc}
                    totalPayable={totalSrAmountInclGST} // Or based on GST applicability
                    alreadyPaid={currentPaidAmount}
                    onPaymentRecorded={() => {
                        mutatePayments();
                        dataTableProps.refetch();
                    }}
                />
            )}
            {screenshotPayment && (
                <PaymentScreenshotDialog
                    isOpen={!!screenshotPayment}
                    onOpenChange={() => setScreenshotPayment(null)}
                    paymentDoc={screenshotPayment}
                    onUploadSuccess={() => {
                        mutatePayments();
                        dataTableProps.refetch();
                    }}
                />
            )}
            {deletePayment && (
                <AlertDialog open={!!deletePayment} onOpenChange={() => setDeletePayment(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete Payment {deletePayment.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will permanently delete the payment record. Amount: {formatToIndianRupee(deletePayment.amount)}.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <Button variant="destructive" onClick={handleDeletePayment} disabled={deleteLoading}>
                                {deleteLoading ? "Deleting..." : "Confirm Delete"}
                            </Button>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </Card>
    );
};