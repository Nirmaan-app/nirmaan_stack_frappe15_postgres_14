import React, { Fragment, useState } from 'react';
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
import { Trash2, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDate } from 'date-fns';
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TailSpin } from 'react-loader-spinner';
import { InvoiceMappingTable, POItemTotals, usePoItemTotals, useInvoiceMatchedLines } from "./InvoiceLineMappingView";

interface InvoiceTableProps {
    /** Array of Vendor Invoice documents */
    items: VendorInvoice[] | undefined | null;
    /** Function called when the view/invoice number link is clicked */
    onViewAttachment: (attachmentId: string | undefined) => void;
    /** Function called when the edit button is clicked */
    onEditEntry?: (item: VendorInvoice) => void;
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
    /**
     * When set (the PO name), each invoice row gets an expand chevron that
     * reveals its line → PO-item mapping. Omit to disable the feature entirely
     * (e.g. Project Invoices tables). The chevron is shown ONLY for invoices
     * that actually have matched line items.
     */
    poName?: string;
}

// Status badge variant (pure).
const getStatusBadgeVariant = (
    status?: VendorInvoice['status']
): 'default' | 'secondary' | 'destructive' | 'outline' | 'red' | 'green' => {
    switch (status) {
        case 'Pending': return 'red';
        case 'Approved': return 'green';
        case 'Rejected': return 'destructive';
        default: return 'secondary';
    }
};

export const InvoiceTable: React.FC<InvoiceTableProps> = ({
    items,
    onViewAttachment,
    onEditEntry,
    onDeleteEntry,
    isLoading,
    canDeleteEntry,
    getUserName,
    hideActions = false,
    poName,
}) => {
    const invoiceList = items || [];

    // Line-mapping expand is opt-in via `poName` (PO context needed for the
    // PO / Invoiced comparison). PO totals are fetched once here; each candidate
    // invoice's lines are fetched inside its row (see InvoiceTableRow).
    const enableMapping = !!poName;
    const { poItemsByRow, poItemsById } = usePoItemTotals(poName, enableMapping);

    // Determine if the delete column should be shown at all
    const showDeleteColumn = !!(onDeleteEntry && canDeleteEntry && invoiceList.some((item) => canDeleteEntry(item)));

    // Total columns (for colSpan on the empty-state + expand rows).
    const colCount = (enableMapping ? 1 : 0) + 5 + (hideActions ? 0 : 1);

    return (
        <Table>
            <TableHeader className="bg-red-100">
                <TableRow>
                    {enableMapping && <TableHead className="w-6 px-1" />}
                    <TableHead className="w-[150px] text-black font-bold">Date</TableHead>
                    <TableHead className="w-[150px] text-black font-bold">Amount</TableHead>
                    <TableHead className="text-black font-bold">Invoice No.</TableHead>
                    <TableHead className="w-[120px] text-black font-bold">Status</TableHead>
                    <TableHead className="w-[150px] text-black font-bold">Uploaded By</TableHead>
                    {!hideActions && <TableHead className="w-[120px] text-center text-black font-bold">Actions</TableHead>}
                </TableRow>
            </TableHeader>
            <TableBody>
                {invoiceList.length > 0 ? (
                    invoiceList.map((invoice) => (
                        <InvoiceTableRow
                            key={invoice.name}
                            invoice={invoice}
                            enableMapping={enableMapping}
                            colCount={colCount}
                            poItemsByRow={poItemsByRow}
                            poItemsById={poItemsById}
                            onViewAttachment={onViewAttachment}
                            onEditEntry={onEditEntry}
                            onDeleteEntry={onDeleteEntry}
                            isLoading={isLoading}
                            showDeleteColumn={showDeleteColumn}
                            canDeleteEntry={canDeleteEntry}
                            getUserName={getUserName}
                            hideActions={hideActions}
                        />
                    ))
                ) : (
                    <TableRow>
                        <TableCell colSpan={colCount} className="text-center py-4 text-gray-500">
                            No Invoices Found
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );
};

interface InvoiceTableRowProps {
    invoice: VendorInvoice;
    enableMapping: boolean;
    colCount: number;
    poItemsByRow: Map<string, POItemTotals>;
    poItemsById: Map<string, POItemTotals>;
    onViewAttachment: (attachmentId: string | undefined) => void;
    onEditEntry?: (item: VendorInvoice) => void;
    onDeleteEntry?: (invoiceId: string) => void;
    isLoading?: boolean;
    showDeleteColumn: boolean;
    canDeleteEntry?: (item: VendorInvoice) => boolean;
    getUserName?: (userId: string | undefined) => string;
    hideActions: boolean;
}

const InvoiceTableRow: React.FC<InvoiceTableRowProps> = ({
    invoice,
    enableMapping,
    colCount,
    poItemsByRow,
    poItemsById,
    onViewAttachment,
    onEditEntry,
    onDeleteEntry,
    isLoading,
    showDeleteColumn,
    canDeleteEntry,
    getUserName,
    hideActions,
}) => {
    const [expanded, setExpanded] = useState(false);
    const showDeleteButton = showDeleteColumn && canDeleteEntry?.(invoice);

    // Only autofilled invoices can carry line mappings — gate the fetch on that
    // so we never hit the network for a plain manual invoice. The chevron then
    // appears ONLY when the fetch confirms matched items exist.
    const candidate = enableMapping && !!invoice.autofill_used;
    const { lines, hasMapping } = useInvoiceMatchedLines(invoice.name, candidate);

    return (
        <Fragment>
            <TableRow>
                {enableMapping && (
                    <TableCell className="w-6 px-1 text-gray-500">
                        {hasMapping && (
                            <button
                                type="button"
                                onClick={() => setExpanded((o) => !o)}
                                className="p-0.5 text-gray-500 hover:text-gray-800"
                                title="Show item mapping"
                            >
                                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                        )}
                    </TableCell>
                )}
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
                    {onEditEntry && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-blue-600 hover:text-blue-800"
                            onClick={() => onEditEntry(invoice)}
                            title={`Edit Invoice ${invoice.invoice_no}`}
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                    )}
                    {showDeleteButton && (
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
                    )}
                    {!onEditEntry && !showDeleteButton && "--"}
                </TableCell>}
            </TableRow>
            {enableMapping && expanded && hasMapping && (
                <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={colCount} className="bg-gray-50 p-0">
                        <InvoiceMappingTable
                            lines={lines}
                            poItemsByRow={poItemsByRow}
                            poItemsById={poItemsById}
                        />
                    </TableCell>
                </TableRow>
            )}
        </Fragment>
    );
};
