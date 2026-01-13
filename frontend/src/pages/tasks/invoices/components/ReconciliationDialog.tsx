import React, { useState, useEffect } from "react";
import { DatePicker } from "antd";
import dayjs from "dayjs";
import { Calendar } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";

interface ReconciliationDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (is2bActivated: boolean, reconciledDate: string | null) => void;
    isProcessing: boolean;
    invoiceNo: string | null;
    currentIs2bActivated: boolean;
    currentReconciledDate: string | null;
}

export const ReconciliationDialog: React.FC<ReconciliationDialogProps> = ({
    isOpen,
    onClose,
    onConfirm,
    isProcessing,
    invoiceNo,
    currentIs2bActivated,
    currentReconciledDate,
}) => {
    const [is2bActivated, setIs2bActivated] = useState(currentIs2bActivated);
    const [reconciledDate, setReconciledDate] = useState<string | null>(
        currentReconciledDate || dayjs().format("YYYY-MM-DD")
    );

    // Reset state when dialog opens with new values
    useEffect(() => {
        if (isOpen) {
            setIs2bActivated(currentIs2bActivated);
            setReconciledDate(
                currentReconciledDate || dayjs().format("YYYY-MM-DD")
            );
        }
    }, [isOpen, currentIs2bActivated, currentReconciledDate]);

    const handleConfirm = () => {
        onConfirm(is2bActivated, is2bActivated ? reconciledDate : null);
    };

    const handleToggleChange = (checked: boolean) => {
        setIs2bActivated(checked);
        if (checked && !reconciledDate) {
            setReconciledDate(dayjs().format("YYYY-MM-DD"));
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !isProcessing && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-purple-600" />
                        2B Reconciliation
                    </DialogTitle>
                    <DialogDescription>
                        Update the GST 2B activation status for invoice <strong>{invoiceNo}</strong>
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* 2B Activated Toggle */}
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="2b-toggle" className="text-sm font-medium">
                                2B Activated
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Mark this invoice as verified in GST 2B form
                            </p>
                        </div>
                        <Switch
                            id="2b-toggle"
                            checked={is2bActivated}
                            onCheckedChange={handleToggleChange}
                            disabled={isProcessing}
                            className="data-[state=checked]:bg-green-600"
                        />
                    </div>

                    {/* Reconciled Date - Only show when activated */}
                    {is2bActivated && (
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
                                Date when this invoice was reconciled with GST 2B
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
                        disabled={isProcessing || (is2bActivated && !reconciledDate)}
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
