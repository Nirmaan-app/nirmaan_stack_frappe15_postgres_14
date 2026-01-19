import React, { useState } from "react";
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

interface RejectTDSModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (remarks: string) => void;
    loading?: boolean;
}

export const RejectTDSModal: React.FC<RejectTDSModalProps> = ({
    open,
    onOpenChange,
    onConfirm,
    loading = false,
}) => {
    const [remarks, setRemarks] = useState("");
    const [error, setError] = useState("");

    const handleConfirm = () => {
        if (!remarks.trim()) {
            setError("Remarks are mandatory for rejection.");
            return;
        }
        setError("");
        onConfirm(remarks);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden border-none shadow-lg">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle className="text-2xl font-bold text-gray-900 leading-tight">
                        Reject TDS Request
                    </DialogTitle>
                    <p className="text-[15px] text-gray-500 mt-1">
                        This action will mark the selected TDS items as rejected.
                    </p>
                </DialogHeader>

                <div className="px-6 py-4 space-y-6">
                    {/* Warning Banner */}
                    <div className="bg-[#FEF2F2] border border-[#FEE2E2] rounded-xl p-4 flex gap-4">
                        <div className="mt-0.5">
                            <AlertTriangle className="h-5 w-5 text-[#EF4444]" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-[15px] font-semibold text-[#991B1B]">
                                Are you sure you want to reject this TDS Request?
                            </h3>
                            <p className="text-[15px] text-[#DC2626] leading-relaxed">
                                Once rejected, the request will be sent back to the creator for changes
                            </p>
                        </div>
                    </div>

                    {/* Form Field */}
                    <div className="space-y-3">
                        <Label htmlFor="remarks" className="text-[17px] font-semibold text-gray-900">
                            Reason for Rejection<span className="text-red-500 ml-1">*</span>
                        </Label>
                        <div className="relative">
                            <Textarea
                                id="remarks"
                                placeholder="Type your comments here (e.g., missing documents, incorrect item details, pricing issues, etc.)"
                                value={remarks}
                                onChange={(e) => {
                                    setRemarks(e.target.value);
                                    if (e.target.value.trim()) setError("");
                                }}
                                className={`min-h-[140px] text-[15px] placeholder:text-gray-400 border-gray-200 rounded-xl focus:ring-red-500 focus:border-red-500 resize-none py-3 px-4 ${
                                    error ? "border-red-500 ring-1 ring-red-500" : ""
                                }`}
                            />
                        </div>
                        <p className="text-[15px] text-gray-500 font-medium italic">
                            This comment will be visible to the request creator.
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
                        onClick={() => onOpenChange(false)}
                        disabled={loading}
                        className="px-8  font-semibold text-gray-600 hover:bg-gray-100 rounded-md transition-all shadow-md shadow-black-200"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={loading}
                        className="px-8  font-semibold text-white bg-[#D32F2F] hover:bg-[#B71C1C] rounded-md transition-all shadow-md shadow-red-200"
                    >
                        {loading ? "Rejecting..." : "Reject"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default RejectTDSModal;
