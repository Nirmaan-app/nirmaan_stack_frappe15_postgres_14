import React, { useState, useEffect, useCallback } from "react";
import { DatePicker } from "antd";
import dayjs from "dayjs";
import { FileCheck2, ExternalLink } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { ReconciliationStatus } from "../constants";
import SITEURL from "@/constants/siteURL";

// Internal select value type - uses "none" instead of "" for Radix UI compatibility
type InternalSelectValue = "none" | "partial" | "full" | "na";

// Options for the Select component (using "none" instead of "")
const INTERNAL_STATUS_OPTIONS = [
    { label: "Not Reconciled", value: "none" as const },
    { label: "Partially Reconciled", value: "partial" as const },
    { label: "Fully Reconciled", value: "full" as const },
    { label: "Not Applicable", value: "na" as const },
];

// Convert between internal select value and API reconciliation status
const toInternalValue = (status: ReconciliationStatus): InternalSelectValue =>
    status === "" ? "none" : status;

const toReconciliationStatus = (value: InternalSelectValue): ReconciliationStatus =>
    value === "none" ? "" : value;

interface ReconciliationDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (
        reconciliationStatus: ReconciliationStatus,
        reconciledDate: string | null,
        proofFile: File | null,
        reconciledAmount: number | null
    ) => void;
    isProcessing: boolean;
    invoiceNo: string | null;
    currentReconciliationStatus: ReconciliationStatus;
    currentReconciledDate: string | null;
    currentProofAttachmentUrl: string | null;
    currentInvoiceAmount: number;
    currentReconciledAmount: number | null;
}

export const ReconciliationDialog: React.FC<ReconciliationDialogProps> = ({
    isOpen,
    onClose,
    onConfirm,
    isProcessing,
    invoiceNo,
    currentReconciliationStatus,
    currentReconciledDate,
    currentProofAttachmentUrl,
    currentInvoiceAmount,
    currentReconciledAmount,
}) => {
    // Use internal select value (with "none" instead of "") for Radix UI compatibility
    const [internalStatus, setInternalStatus] = useState<InternalSelectValue>(
        toInternalValue(currentReconciliationStatus)
    );
    const [reconciledDate, setReconciledDate] = useState<string | null>(
        currentReconciledDate || dayjs().format("YYYY-MM-DD")
    );
    const [proofFile, setProofFile] = useState<File | null>(null);
    const [showExistingProof, setShowExistingProof] = useState(!!currentProofAttachmentUrl);
    const [reconciledAmount, setReconciledAmount] = useState<string>(
        currentReconciledAmount != null ? String(currentReconciledAmount) : ""
    );

    // Reset state when dialog opens with new values
    useEffect(() => {
        if (isOpen) {
            setInternalStatus(toInternalValue(currentReconciliationStatus));
            setReconciledDate(
                currentReconciledDate || dayjs().format("YYYY-MM-DD")
            );
            setProofFile(null);
            setShowExistingProof(!!currentProofAttachmentUrl);
            setReconciledAmount(
                currentReconciledAmount != null ? String(currentReconciledAmount) : ""
            );
        }
    }, [isOpen, currentReconciliationStatus, currentReconciledDate, currentProofAttachmentUrl, currentReconciledAmount]);

    const isReconciled = internalStatus === "partial" || internalStatus === "full";
    const isPartial = internalStatus === "partial";

    // Check if status is unchanged from the initial value
    const statusUnchanged = internalStatus === toInternalValue(currentReconciliationStatus);

    // Validation: proof is required ONLY when:
    // 1. Setting a NEW reconciled status (status changed TO partial/full from none)
    // 2. AND there's no existing proof AND no new file uploaded
    // If the status is already partial/full and unchanged, proof is optional
    // (allows updating reconciled amount without re-uploading proof)
    const needsProofUpload = isReconciled && !statusUnchanged && !proofFile && !showExistingProof;

    // Validation: reconciled amount is required for partial status
    const parsedReconciledAmount = reconciledAmount ? parseFloat(reconciledAmount) : null;
    const needsReconciledAmount = isPartial && (parsedReconciledAmount === null || isNaN(parsedReconciledAmount));

    const handleConfirm = () => {
        // Convert internal value back to API reconciliation status
        onConfirm(
            toReconciliationStatus(internalStatus),
            isReconciled ? reconciledDate : null,
            proofFile,
            isPartial ? parsedReconciledAmount : null
        );
    };

    const handleStatusChange = (value: InternalSelectValue) => {
        setInternalStatus(value);
        if (value === "none" || value === "na") {
            // Clearing status or setting to N/A - clear proof and reconciled amount
            setProofFile(null);
            setShowExistingProof(false);
            setReconciledAmount("");
        } else if (!reconciledDate) {
            // Setting reconciled status - ensure date is set
            setReconciledDate(dayjs().format("YYYY-MM-DD"));
        }
    };

    const handleReplaceProof = useCallback(() => {
        setShowExistingProof(false);
        setProofFile(null);
    }, []);

    const getStatusLabel = (status: InternalSelectValue) => {
        return INTERNAL_STATUS_OPTIONS.find(opt => opt.value === status)?.label || "Not Reconciled";
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !isProcessing && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileCheck2 className="w-5 h-5 text-purple-600" />
                        Invoice Reconciliation
                    </DialogTitle>
                    <DialogDescription>
                        Update the reconciliation status for invoice <strong>{invoiceNo}</strong>
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Reconciliation Status Select */}
                    <div className="space-y-2">
                        <Label htmlFor="reconciliation-status" className="text-sm font-medium">
                            Reconciliation Status
                        </Label>
                        <Select
                            value={internalStatus}
                            onValueChange={(value) => handleStatusChange(value as InternalSelectValue)}
                            disabled={isProcessing}
                        >
                            <SelectTrigger id="reconciliation-status" className="w-full">
                                <SelectValue placeholder="Select status">
                                    {getStatusLabel(internalStatus)}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {INTERNAL_STATUS_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            Select the GST 2B reconciliation status for this invoice.
                            Use "Not Applicable" for invoices that don't require 2B reconciliation.
                        </p>
                    </div>

                    {/* Reconciled Date - Only show when status is partial or full */}
                    {isReconciled && (
                        <div className="space-y-2">
                            <Label htmlFor="reconciled-date" className="text-sm font-medium">
                                Reconciled Date
                            </Label>
                            <DatePicker
                                id="reconciled-date"
                                value={reconciledDate ? dayjs(reconciledDate) : null}
                                onChange={(date) => setReconciledDate(date ? date.format("YYYY-MM-DD") : null)}
                                format="DD-MM-YYYY"
                                className="w-full"
                                disabled={isProcessing}
                                disabledDate={(current) => current && current > dayjs().endOf("day")}
                                placeholder="Select reconciliation date"
                            />
                            <p className="text-xs text-muted-foreground">
                                Date when this invoice was reconciled
                            </p>
                        </div>
                    )}

                    {/* Reconciled Amount - Only show when status is partial */}
                    {isPartial && (
                        <div className="space-y-2">
                            <Label htmlFor="reconciled-amount" className="text-sm font-medium">
                                Reconciled Amount <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="reconciled-amount"
                                type="number"
                                value={reconciledAmount}
                                onChange={(e) => setReconciledAmount(e.target.value)}
                                placeholder="Enter reconciled amount"
                                disabled={isProcessing}
                                min={0}
                                max={currentInvoiceAmount}
                                step="0.01"
                            />
                            <p className="text-xs text-muted-foreground">
                                Invoice amount: {formatToRoundedIndianRupee(currentInvoiceAmount)}
                            </p>
                        </div>
                    )}

                    {/* Proof Attachment - Only show when status is partial or full */}
                    {isReconciled && (
                        <div className="space-y-2">
                            <Label className="text-sm font-medium">
                                Reconciliation Proof <span className="text-red-500">*</span>
                            </Label>

                            {/* Show existing proof if available */}
                            {showExistingProof && currentProofAttachmentUrl && (
                                <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
                                    <div className="flex items-center gap-2">
                                        <FileCheck2 className="w-4 h-4 text-green-600" />
                                        <span className="text-sm text-green-700 dark:text-green-300">
                                            Existing proof attached
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={() => window.open(`${SITEURL}${currentProofAttachmentUrl}`, "_blank")}
                                        >
                                            <ExternalLink className="w-3 h-3 mr-1" />
                                            View
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={handleReplaceProof}
                                            disabled={isProcessing}
                                        >
                                            Replace
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Show upload component if no existing proof or user wants to replace */}
                            {!showExistingProof && (
                                <CustomAttachment
                                    maxFileSize={20 * 1024 * 1024} // 20MB
                                    selectedFile={proofFile}
                                    onFileSelect={setProofFile}
                                    label="Attach Reconciliation Proof"
                                    className="w-full"
                                    disabled={isProcessing}
                                />
                            )}

                            <p className="text-xs text-muted-foreground">
                                Upload proof of reconciliation (GST portal screenshot, 2B comparison, etc.)
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        variant="outline"
                        onClick={onClose}
                        disabled={isProcessing}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={
                            isProcessing ||
                            (isReconciled && !reconciledDate) ||
                            needsProofUpload ||
                            needsReconciledAmount
                        }
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        {isProcessing ? "Saving..." : "Confirm"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ReconciliationDialog;
