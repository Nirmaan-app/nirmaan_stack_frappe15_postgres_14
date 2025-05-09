import { useMemo, useCallback } from 'react';
import { KeyedMutator } from 'swr';
import { useFrappeGetDocList, useFrappePostCall } from 'frappe-react-sdk';
import { useDialogStore } from '@/zustand/useDialogStore'; // Adjust import path
import { useToast } from "@/components/ui/use-toast"; // Adjust import path
import { TailSpin } from 'react-loader-spinner';

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Types
import { ProcurementOrder, InvoiceItem } from '@/types/NirmaanStack/ProcurementOrders'; // Adjust import path
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests'; // Adjust import path
import { NirmaanAttachment } from '@/types/NirmaanStack/NirmaanAttachment'; // Adjust import path

// Reusable Table Components
import { InvoiceTable } from './components/InvoiceTable'; // Adjust import path
import { DeliveryChallanTable } from './components/DeliveryChallanTable'; // Adjust import path
import SITEURL from '@/constants/siteURL'; // Adjust import path

// Define a union type for the document data
type DocumentType = ProcurementOrder | ServiceRequests;
// type AllowedDocTypes = "Procurement Orders" | "Service Requests";

interface DocumentAttachmentsProps<T extends DocumentType> {
    docType: T extends ProcurementOrder ? "Procurement Orders" : T extends ServiceRequests ? "Service Requests" : never;
    docName: string;
    documentData: T | null | undefined;
    // Mutator specifically for the *parent* document (PO or SR)
    docMutate: KeyedMutator<T[]>; // Use 'any' for flexibility or define a more specific SWRResponse type if possible
}

export const DocumentAttachments = <T extends DocumentType>({
    docType,
    docName,
    documentData,
    docMutate,
}: DocumentAttachmentsProps<T>) => {

    const { toggleNewInvoiceDialog } = useDialogStore();
    const { toast } = useToast();

    // --- Data Fetching ---
    const { data: attachmentsData, isLoading: attachmentsLoading, error: attachmentsError } = useFrappeGetDocList<NirmaanAttachment>(
        "Nirmaan Attachments",
        {
            fields: ["name", "attachment_type", "attachment", "creation"], // Fetch only needed fields
            filters: [
                ["associated_doctype", "=", docType],
                ["associated_docname", "=", docName]
            ],
            limit: 1000, // Consider pagination if lists can get very large
        },
        // SWR key depends on docName being available
        docName ? `Nirmaan Attachments-${docName}` : null,
        // Options
        {
            revalidateOnFocus: false, // Optional: reduce refetching
            // dedupingInterval: 5000, // Optional: further reduce redundant fetches
        }
    );

    // --- API Hooks ---
    const { call: deleteInvoiceEntryApi, loading: deleteInvoiceEntryLoading } = useFrappePostCall(
        "nirmaan_stack.api.delivery_notes.update_invoice_data.delete_invoice_entry"
    );

    // --- Memoized Data ---
    const dcAttachments = useMemo(
        () => attachmentsData?.filter((att) => att.attachment_type === "po delivery challan" || att.attachment_type === "dc attachment") || [], // Add more DC types if needed
        [attachmentsData]
    );

    // This list helps find the full URL for an attachment ID stored in invoice_data
    const invoiceAttachmentLookup = useMemo(() => {
        const lookup = new Map<string, string>(); // Map attachment_id (name) to attachment URL
        attachmentsData?.forEach(att => {
            if ((att.attachment_type === "po invoice" || att.attachment_type === "service request invoice") && att.attachment) {
                 lookup.set(att.name, att.attachment);
            }
        });
        return lookup;
    }, [attachmentsData]);


    // --- Event Handlers ---
    const handleViewInvoiceAttachment = useCallback((attachmentId: string | undefined) => {
        if (!attachmentId) {
             toast({ title: "Info", description: "No attachment linked to this invoice entry.", variant: "default" });
             return;
        }
        const attachmentUrl = invoiceAttachmentLookup.get(attachmentId);
        if (attachmentUrl) {
            window.open(`${SITEURL}${attachmentUrl}`, '_blank', 'noopener,noreferrer');
        } else {
             toast({ title: "Error", description: "Attachment file not found or inaccessible.", variant: "destructive" });
            console.error(`Invoice attachment URL not found for ID: ${attachmentId}. Lookup map:`, invoiceAttachmentLookup);
        }
    }, [invoiceAttachmentLookup, toast]);

    const handleDeleteInvoiceEntry = useCallback(async (dateKey: string) => {
        if (!docName) return; // Should not happen if component renders

        try {
            const response = await deleteInvoiceEntryApi({
                docname: docName,
                isSR: docType === "Service Requests",
                date_key: dateKey,
            });

            if (response.message?.status === 200) {
                toast({
                    title: "Success!",
                    description: response.message.message || "Invoice entry deleted.",
                    variant: "success",
                });
                await docMutate(); // Refresh the parent PO/SR document data (which includes invoice_data)
                // Optionally revalidate attachments if the delete API modifies them (it does)
                 // Use the SWR key directly for revalidation
                 // mutateAttachments(); // Or use global mutate with key pattern if needed
            } else {
                 throw new Error(response.message?.message || "Failed to delete invoice entry.");
            }
        } catch (error) {
            console.error("Error while deleting invoice entry:", error);
            toast({
                title: "Deletion Failed!",
                description: error instanceof Error ? error.message : "Please try again.",
                variant: "destructive",
            });
        }
    }, [docName, docType, deleteInvoiceEntryApi, toast, docMutate]);

    const canDeleteInvoice = useCallback((item: InvoiceItem): boolean => {
        // Only allow deletion if status is Pending or Rejected (or other statuses you define)
        return ["Pending", "Rejected"].includes(item?.status || "");
    }, []);

    // --- Loading and Error States ---
    if (attachmentsLoading) {
        return <div className="flex justify-center items-center p-4"><TailSpin color="red" width={40} height={40} /></div>;
    }

    if (attachmentsError) {
        console.error(`Error fetching attachments for ${docName}:`, attachmentsError);
        toast({ title: "Error", description: "Could not load attachments.", variant: "destructive" });
        // Optionally return a more user-friendly error state component
    }

    // Determine if the document is a Procurement Order for conditional rendering
    const isPO = docType === "Procurement Orders";
    const documentStatus = documentData?.status; // Get status from the passed document data

    // Check if DC table should be shown (only for POs in specific statuses)
    const showDcTable = isPO && documentStatus && ["Delivered", "Partially Delivered"].includes(documentStatus);

    return (
        <div className={`grid gap-4 grid-cols-1 ${showDcTable ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}> {/* Dynamic grid */}
            {/* Invoice Card */}
            <Card className=""> {/* Subtle styling */}
                <CardHeader className="border-b border-gray-200">
                    <CardTitle className="flex justify-between items-center">
                        <p className="text-xl max-sm:text-lg text-red-600">Invoices</p>
                        <Button
                            variant="outline"
                            size="sm" // Consistent button size
                            className="text-primary border-primary hover:bg-primary/5" // Subtle hover
                            onClick={toggleNewInvoiceDialog}
                        >
                            Add Invoice
                        </Button>
                    </CardTitle>
                </CardHeader>
                <CardContent> {/* Remove padding to let table control it */}
                     <div className="overflow-x-auto"> {/* Ensure table scrolls horizontally if needed */}
                        <InvoiceTable
                            items={documentData?.invoice_data?.data} // Access nested data
                            onViewAttachment={handleViewInvoiceAttachment}
                            onDeleteEntry={handleDeleteInvoiceEntry}
                            isLoading={deleteInvoiceEntryLoading}
                            canDeleteEntry={canDeleteInvoice}
                        />
                     </div>
                </CardContent>
            </Card>

            {/* Delivery Challan Card (Conditional) */}
            {showDcTable && (
                 <Card className="rounded-md shadow-sm border border-gray-200 overflow-hidden">
                    <CardHeader className="border-b border-gray-200">
                        <CardTitle>
                            <p className="text-lg font-semibold text-red-600">Delivery Challans</p>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <DeliveryChallanTable attachments={dcAttachments} />
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};