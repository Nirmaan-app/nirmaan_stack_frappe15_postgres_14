/**
 * Dialog for rejecting vendor invoices with a required rejection reason.
 *
 * This component is used when an approver rejects an invoice - they must
 * provide a reason which will be stored and displayed to the submitter.
 */
import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";

interface InvoiceRejectionDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (rejectionReason: string) => Promise<void>;
    isLoading: boolean;
    invoiceNo?: string | null;
}

export const InvoiceRejectionDialog: React.FC<InvoiceRejectionDialogProps> = ({
    isOpen,
    onClose,
    onConfirm,
    isLoading,
    invoiceNo,
}) => {
    const [rejectionReason, setRejectionReason] = useState("");
    const [error, setError] = useState("");

    // Reset state when dialog opens/closes
    useEffect(() => {
        if (!isOpen) {
            setRejectionReason("");
            setError("");
        }
    }, [isOpen]);

    const handleConfirm = async () => {
        if (!rejectionReason.trim()) {
            setError("Rejection reason is required.");
            return;
        }
        setError("");
        await onConfirm(rejectionReason.trim());
    };

    const handleOpenChange = (open: boolean) => {
        if (!open && !isLoading) {
            onClose();
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden border-none shadow-lg">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle className="text-2xl font-bold text-gray-900 leading-tight">
                        Reject Invoice
                    </DialogTitle>
                    {invoiceNo && (
                        <p className="text-[15px] text-gray-500 mt-1">
                            Invoice: <strong>{invoiceNo}</strong>
                        </p>
                    )}
                </DialogHeader>

                <div className="px-6 py-4 space-y-6">
                    {/* Warning Banner */}
                    <div className="bg-[#FEF2F2] border border-[#FEE2E2] rounded-xl p-4 flex gap-4">
                        <div className="mt-0.5">
                            <AlertTriangle className="h-5 w-5 text-[#EF4444]" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-[15px] font-semibold text-[#991B1B]">
                                Are you sure you want to reject this invoice?
                            </h3>
                            <p className="text-[15px] text-[#DC2626] leading-relaxed">
                                This will send the invoice back to the submitter for corrections.
                            </p>
                        </div>
                    </div>

                    {/* Rejection Reason Field */}
                    <div className="space-y-3">
                        <Label
                            htmlFor="rejection-reason"
                            className="text-[17px] font-semibold text-gray-900"
                        >
                            Reason for Rejection<span className="text-red-500 ml-1">*</span>
                        </Label>
                        <div className="relative">
                            <Textarea
                                id="rejection-reason"
                                placeholder="Type your comments here (e.g., incorrect amount, missing documentation, wrong vendor details, etc.)"
                                value={rejectionReason}
                                onChange={(e) => {
                                    setRejectionReason(e.target.value);
                                    if (e.target.value.trim()) setError("");
                                }}
                                disabled={isLoading}
                                className={`min-h-[140px] text-[15px] placeholder:text-gray-400 border-gray-200 rounded-xl focus:ring-red-500 focus:border-red-500 resize-none py-3 px-4 ${
                                    error ? "border-red-500 ring-1 ring-red-500" : ""
                                }`}
                            />
                        </div>
                        <p className="text-[15px] text-gray-500 font-medium italic">
                            This reason will be visible to the invoice submitter.
                        </p>
                        {error && (
                            <p className="text-sm text-red-500 font-medium mt-1 animate-in fade-in slide-in-from-top-1">
                                {error}
                            </p>
                        )}
                    </div>
                </div>

                <DialogFooter className="px-6 py-5 bg-gray-50/50 border-t border-gray-100 flex items-center justify-end gap-3">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        disabled={isLoading}
                        className="px-8 font-semibold text-gray-600 hover:bg-gray-100 rounded-md transition-all shadow-md shadow-black-200"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={isLoading}
                        className="px-8 font-semibold text-white bg-[#D32F2F] hover:bg-[#B71C1C] rounded-md transition-all shadow-md shadow-red-200"
                    >
                        {isLoading ? "Rejecting..." : "Reject"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default InvoiceRejectionDialog;
