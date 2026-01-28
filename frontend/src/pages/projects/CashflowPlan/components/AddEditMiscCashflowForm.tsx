import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { CashflowDatePicker } from "./CashflowDatePicker";

interface AddEditMiscCashflowFormProps {
    isOpen: boolean;
    projectId: string;
    initialData?: {
        name: string;
        remarks: string;
        planned_amount: number;
        planned_date: string;
    } | null;
    onClose: () => void;
    onSuccess: () => void;
}

export const AddEditMiscCashflowForm = ({ isOpen, projectId, initialData, onClose, onSuccess }: AddEditMiscCashflowFormProps) => {
    const { toast } = useToast();
    const { createDoc, loading: isCreating } = useFrappeCreateDoc();
    const { updateDoc, loading: isUpdating } = useFrappeUpdateDoc();

    const isSubmitting = isCreating || isUpdating;

    const [remarks, setRemarks] = useState("");
    const [plannedAmount, setPlannedAmount] = useState("");
    const [plannedDate, setPlannedDate] = useState<Date | undefined>(undefined);

    // Reset form when opened or initialData changes
    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setRemarks(initialData.remarks || "");
                setPlannedAmount(initialData.planned_amount?.toString() || "");
                setPlannedDate(initialData.planned_date ? new Date(initialData.planned_date) : undefined);
            } else {
                setRemarks("");
                setPlannedAmount("");
                setPlannedDate(undefined);
            }
        }
    }, [isOpen, initialData]);

    const handleSubmit = async () => {
        // Validation
        if (!remarks.trim()) {
            toast({
                title: "Missing Remarks",
                description: "Review your fields! Remarks are mandatory.",
                variant: "destructive"
            });
            return;
        }

        if (!plannedAmount || parseFloat(plannedAmount) <= 0) {
             toast({
                title: "Missing Planned Amount",
                description: "Review your fields! Planned Amount is mandatory and must be greater than 0.",
                variant: "destructive"
            });
            return;
        }

        if (!plannedDate) {
             toast({
                title: "Missing Planned Date",
                description: "Review your fields! Planned Date is mandatory.",
                variant: "destructive"
            });
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const plannedDateStr = format(plannedDate, "yyyy-MM-dd");
        
        // Only validate date in past for NEW plans, maybe allow editing past plans? 
        // User didn't specify, but usually past dates are allowed if editing historical data or correcting a mistake.
        // But for consistency let's keep the check unless user complains or if it's existing plan we might skip?
        // Let's keep the check for now.
        if (plannedDateStr < today) {
            toast({
                title: "Invalid Date",
                description: "Planned Date cannot be in the past.",
                variant: "destructive"
            });
            return;
        }

        try {
            if (initialData) {
                await updateDoc("Cashflow Plan", initialData.name, {
                    remarks: remarks,
                    planned_amount: parseFloat(plannedAmount),
                    planned_date: plannedDateStr
                });
                toast({ title: "Success", description: "Updated miscellaneous plan." });
            } else {
                await createDoc("Cashflow Plan", {
                    project: projectId,
                    type: "Misc",
                    remarks: remarks,
                    planned_amount: parseFloat(plannedAmount),
                    planned_date: plannedDateStr
                });
                toast({ title: "Success", description: "Created miscellaneous plan." });
            }
            onSuccess();
            onClose();
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: `Failed to ${initialData ? "update" : "create"} plan.`, variant: "destructive" });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[600px] p-0 gap-0 overflow-hidden bg-white">
                <DialogHeader className="px-6 py-4 border-b bg-white">
                    <DialogTitle className="text-lg font-semibold text-gray-900">
                        {initialData ? "Edit Miscellaneous Plan" : "Add Miscellaneous Plan"}
                    </DialogTitle>
                    <p className="text-sm text-gray-500 mt-1">
                        {initialData ? "Update plan details" : "Record additional planned expenses"}
                    </p>
                </DialogHeader>

                <div className="p-6 space-y-6">
                    <div className="space-y-2">
                        <Label className="text-sm font-medium text-gray-700">Remarks <span className="text-red-500">*</span></Label>
                        <Textarea
                            placeholder="Enter remarks about this miscellaneous expense"
                            value={remarks}
                            onChange={(e) => setRemarks(e.target.value)}
                            className="resize-none h-24"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label className="text-sm font-medium text-gray-700">Planned Amount</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-2.5 text-gray-500">₹</span>
                                <Input
                                    type="number"
                                    className="pl-7"
                                    placeholder=""
                                    value={plannedAmount}
                                    onChange={(e) => setPlannedAmount(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <CashflowDatePicker
                                date={plannedDate}
                                setDate={setPlannedDate}
                                label="Planned Date"
                                required
                            />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end items-center gap-3 px-6 py-4 bg-gray-50 border-t">
                    <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleSubmit} 
                        disabled={isSubmitting}
                        className="bg-red-600 hover:bg-red-700 text-white"
                    >
                        {isSubmitting ? "Saving..." : initialData ? "Save Changes" : "Confirm Selection"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
