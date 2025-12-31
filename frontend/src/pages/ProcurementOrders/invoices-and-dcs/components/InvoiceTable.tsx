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
import { Badge } from "@/components/ui/badge"; // Import Badge
import { Trash2 } from 'lucide-react'; // Added Eye icon for view
import { formatDate } from 'date-fns';
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice"; // Assuming this utility exists
import { InvoiceDataType, InvoiceItem } from '@/types/NirmaanStack/ProcurementOrders'; // Adjust import path
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TailSpin } from 'react-loader-spinner';

interface InvoiceTableProps {
    /** The invoice data object (key: dateKey, value: InvoiceItem) */
    items: InvoiceDataType | undefined | null;
    /** Function called when the view/invoice number link is clicked */
    onViewAttachment: (attachmentId: string | undefined) => void;
    /** Function called when the delete button is clicked */
    onDeleteEntry?: (dateKey: string) => void; // Optional delete handler
    /** Loading state of the delete button */
    isLoading?: boolean;
    /** Function to determine if a specific entry can be deleted */
    canDeleteEntry?: (item: InvoiceItem) => boolean;
}

export const InvoiceTable: React.FC<InvoiceTableProps> = ({
    items,
    onViewAttachment,
    onDeleteEntry,
    isLoading,
    canDeleteEntry,
}) => {
    const invoiceEntries = items ? Object.entries(items) : [];

    // console.log("Invoicedata",items,invoiceEntries)

    // Determine if the delete column should be shown at all
    const showDeleteColumn = onDeleteEntry && canDeleteEntry && invoiceEntries.some(([_, item]) => canDeleteEntry(item));

    // Function to get status badge variant
    const getStatusBadgeVariant = (status?: InvoiceItem['status']): 'default' | 'secondary' | 'destructive' | 'outline' | 'red' | 'green' => {
        switch (status) {
            case 'Pending': return 'red';
            case 'Approved': return 'green';
            case 'Rejected': return 'destructive';
            default: return 'secondary'; // Default or unknown status
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
                    {/* Conditionally render action headers */}
                    <TableHead className="w-[100px] text-center text-black font-bold">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {invoiceEntries.length > 0 ? (
                    invoiceEntries.map(([dateKey, invoice]) => {
                        const showDeleteButton = showDeleteColumn && canDeleteEntry?.(invoice);
                        
                        const displayDate = dateKey.includes('_') ? dateKey.split('_')[0] : dateKey; // Show only date part if timestamp exists

                        return (
                            <TableRow key={dateKey}>
                                <TableCell>{formatDate(new Date(displayDate), "dd-MMM-yyyy")}</TableCell> {/* Consistent date format */}
                                <TableCell>{formatToRoundedIndianRupee(invoice?.amount)}</TableCell>
                                <TableCell>
                                    {invoice?.invoice_attachment_id ? (
                                        <Button
                                            variant="link"
                                            className="p-0 h-auto text-blue-600 hover:underline"
                                            onClick={() => onViewAttachment(invoice.invoice_attachment_id)}
                                            title={`View Invoice ${invoice.invoice_no}`}
                                        >
                                            {invoice?.invoice_no || 'View'}
                                        </Button>
                                    ) : (
                                        <span className="text-gray-600">{invoice?.invoice_no || '--'}</span> // Show number even without link
                                    )}
                                </TableCell>
                                <TableCell>
                                     <Badge variant={getStatusBadgeVariant(invoice?.status || "Approved")}>
                                         {invoice?.status || 'Approved'}
                                     </Badge>
                                </TableCell>
                                <TableCell className="text-center space-x-1">
                                    {/* View Button (optional, if link isn't enough) */}
                                     {/* <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-blue-600 hover:text-blue-800"
                                        onClick={() => onViewAttachment(invoice?.invoice_attachment_id)}
                                        disabled={!invoice?.invoice_attachment_id}
                                        title="View Attachment"
                                    >
                                        <Eye className="h-4 w-4" />
                                    </Button> */}
                                    {/* Delete Button */}
                                    {(showDeleteButton) ? (
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
                                                <Button disabled={isLoading} onClick={() => onDeleteEntry(dateKey)}>Confirm</Button>
                                              </>
                                            )}
                                          </div>  
                                        </DialogContent>
                                      </Dialog>
                                    ) : "--"}
                                </TableCell>
                            </TableRow>
                        );
                    })
                ) : (
                    <TableRow>
                        <TableCell colSpan={showDeleteColumn ? 5 : 4} className="text-center py-4 text-gray-500">
                            No Invoices Found
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );
};