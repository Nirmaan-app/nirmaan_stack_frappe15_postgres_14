import React from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from 'lucide-react';
import { formatDate } from 'date-fns';
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TailSpin } from 'react-loader-spinner';

interface InvoiceTableProps {
    /** Array of Vendor Invoice documents */
    items: VendorInvoice[] | undefined | null;
    /** Function called when the view/invoice number link is clicked */
    onViewAttachment: (attachmentId: string | undefined) => void;
    /** Function called when the delete button is clicked */
    onDeleteEntry?: (invoiceId: string) => void;
    /** Loading state of the delete button */
    isLoading?: boolean;
    /** Function to determine if a specific entry can be deleted */
    canDeleteEntry?: (item: VendorInvoice) => boolean;
    /** Function to convert user ID to display name */
    getUserName?: (userId: string | undefined) => string;
    /** Whether to hide the actions column */
    hideActions?: boolean;
}

export const InvoiceTable: React.FC<InvoiceTableProps> = ({
    items,
    onViewAttachment,
    onDeleteEntry,
    isLoading,
    canDeleteEntry,
    getUserName,
    hideActions = false,
}) => {
    const invoiceList = items || [];

    // Determine if the delete column should be shown at all
    const showDeleteColumn = onDeleteEntry && canDeleteEntry && invoiceList.some((item) => canDeleteEntry(item));

    // Function to get status badge variant
    const getStatusBadgeVariant = (status?: VendorInvoice['status']): 'default' | 'secondary' | 'destructive' | 'outline' | 'red' | 'green' => {
        switch (status) {
            case 'Pending': return 'red';
            case 'Approved': return 'green';
            case 'Rejected': return 'destructive';
            default: return 'secondary';
        }
    };

    return (
        <Table>
            <TableHeader className="bg-red-100">
                <TableRow>
                    <TableHead className="w-[150px] text-black font-bold">Date</TableHead>
                    <TableHead className="w-[150px] text-black font-bold">Amount</TableHead>
                    <TableHead className="text-black font-bold">Invoice No.</TableHead>
                    <TableHead className="w-[120px] text-black font-bold">Status</TableHead>
                    <TableHead className="w-[150px] text-black font-bold">Uploaded By</TableHead>
                    {!hideActions && <TableHead className="w-[100px] text-center text-black font-bold">Actions</TableHead>}
                </TableRow>
            </TableHeader>
            <TableBody>
                {invoiceList.length > 0 ? (
                    invoiceList.map((invoice) => {
                        const showDeleteButton = showDeleteColumn && canDeleteEntry?.(invoice);

                        return (
                            <TableRow key={invoice.name}>
                                <TableCell>{formatDate(new Date(invoice.invoice_date), "dd-MMM-yyyy")}</TableCell>
                                <TableCell>{formatToRoundedIndianRupee(invoice.invoice_amount)}</TableCell>
                                <TableCell>
                                    {invoice.invoice_attachment ? (
                                        <Button
                                            variant="link"
                                            className="p-0 h-auto text-blue-600 hover:underline"
                                            onClick={() => onViewAttachment(invoice.invoice_attachment)}
                                            title={`View Invoice ${invoice.invoice_no}`}
                                        >
                                            {invoice.invoice_no || 'View'}
                                        </Button>
                                    ) : (
                                        <span className="text-gray-600">{invoice.invoice_no || '--'}</span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <Badge variant={getStatusBadgeVariant(invoice.status)}>
                                        {invoice.status || 'Approved'}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-gray-600 text-sm">
                                    {getUserName ? getUserName(invoice.uploaded_by) : invoice.uploaded_by || '--'}
                                </TableCell>
                                {!hideActions && <TableCell className="text-center space-x-1">
                                    {showDeleteButton ? (
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-red-600 hover:text-red-800"
                                                    disabled={isLoading}
                                                    title={`Delete Invoice Entry ${invoice.invoice_no}`}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                                <DialogHeader>
                                                    <DialogTitle>Are you sure?</DialogTitle>
                                                </DialogHeader>
                                                <DialogDescription className="text-primary">
                                                    Click on Confirm to delete this invoice entry!
                                                </DialogDescription>
                                                <div className="flex items-center justify-end gap-2">
                                                    {isLoading ? <TailSpin color="red" height={40} width={40} /> : (
                                                        <>
                                                            <DialogClose asChild>
                                                                <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                                            </DialogClose>
                                                            <Button disabled={isLoading} onClick={() => onDeleteEntry?.(invoice.name)}>Confirm</Button>
                                                        </>
                                                    )}
                                                </div>
                                            </DialogContent>
                                        </Dialog>
                                    ) : "--"}
                                </TableCell>}
                            </TableRow>
                        );
                    })
                ) : (
                    <TableRow>
                        <TableCell colSpan={hideActions ? 5 : 6} className="text-center py-4 text-gray-500">
                            No Invoices Found
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );
};
