import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { PencilRuler, Trash2, Eye, FilePlus2 } from "lucide-react"; // FilePlus2 for Add Invoice
import { ServiceRequestsExtended } from '../hooks/useApprovedSRData';
import { SRDeleteConfirmationDialog } from '../../components/SRDeleteConfirmationDialog';

interface SRActionButtonsProps {
    srDoc: ServiceRequestsExtended | undefined;
    canModify: boolean; // Based on role and SR status
    canDelete: boolean; // Based on role and SR status (e.g., not if payments made)
    isProcessingAction: boolean; // True if any delete/amend action is in progress
    onAmend: () => void; // Opens amend sheet/dialog
    onDelete: () => void; // Opens delete confirmation
    onAddInvoice: () => void; // Opens InvoiceDialog
    onPreviewInvoice: () => void; // Opens SRInvoicePreviewSheet
}

export const SRActionButtons: React.FC<SRActionButtonsProps> = ({
    srDoc,
    canModify,
    canDelete,
    isProcessingAction,
    onAmend,
    onDelete,
    onAddInvoice,
    onPreviewInvoice
}) => {
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    if (!srDoc) return null;

    return (
        <div className="flex items-center gap-2">
            {canDelete && (
                <Button
                    variant="outline"
                    size="sm"
                    className="text-xs border-destructive text-destructive hover:bg-destructive/10"
                    onClick={() => setIsDeleteDialogOpen(true)}
                    disabled={isProcessingAction}
                >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                </Button>
            )}

            {/* SRDeleteConfirmationDialog is now controlled by its parent (ApprovedSRView)
                This button just triggers the state that opens it.
                Or, if you want it self-contained: */}
            <SRDeleteConfirmationDialog
                open={isDeleteDialogOpen}
                onOpenChange={setIsDeleteDialogOpen}
                itemName={srDoc.name}
                itemType="Service Request"
                onConfirm={onDelete}
                isDeleting={isProcessingAction}
            />

            {canModify && ( // Assuming "Amend" is a modification action
                <Button variant="outline" size="sm" className="text-xs" onClick={onAmend} disabled={isProcessingAction}>
                    <PencilRuler className="mr-1.5 h-3.5 w-3.5" /> Amend
                </Button>
            )}
            
            {/* Always allow adding invoice if SR exists, permissions handled by dialog/API */}
            <Button variant="outline" size="sm" className="text-xs text-primary border-primary" onClick={onAddInvoice} disabled={isProcessingAction}>
                <FilePlus2 className="mr-1.5 h-3.5 w-3.5" /> Add Invoice
            </Button>

            {/* Always allow preview if SR project_gst is set (a prerequisite for your print format) */}
            <Button variant="outline" size="sm" className="text-xs" onClick={onPreviewInvoice} disabled={!srDoc.project_gst || isProcessingAction}>
                <Eye className="mr-1.5 h-3.5 w-3.5" /> Preview Invoice
            </Button>
        </div>
    );
};