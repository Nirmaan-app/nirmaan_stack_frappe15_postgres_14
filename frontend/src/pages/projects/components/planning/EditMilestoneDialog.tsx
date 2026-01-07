
import { useState, useEffect } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, Pencil } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { WorkPlanItem } from "./SevendaysWorkPlan";

interface EditMilestoneDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    item: WorkPlanItem | null;
}

export const EditMilestoneDialog = ({
    isOpen,
    onClose,
    onSuccess,
    item,
}: EditMilestoneDialogProps) => {
    const { toast } = useToast();

    const [formData, setFormData] = useState({
        status: "",
        expected_starting_date: "",
        expected_completion_date: "",
        progress: "" as number | string,
    });

    useEffect(() => {
        if (item) {
            setFormData({
                status: item.status || "Not Started",
                expected_starting_date: item.expected_starting_date || "",
                expected_completion_date: item.expected_completion_date || "",
                progress: item.progress ?? "",
            });
        }
    }, [item, isOpen]);

    const { call, loading: updating } = useFrappePostCall("nirmaan_stack.api.seven_days_planning.work_plan_api.update_milestone");

    const handleChange = (field: string, value: any) => {
        setFormData((prev) => {
            const newData = { ...prev, [field]: value };
            
            // Logic: If status is Completed, set progress to 100
            if (field === "status" && value === "Completed") {
                newData.progress = 100;
            }
            
            // Logic: If status is Not Started, set progress to 0
            if (field === "status" && value === "Not Started") {
                newData.progress = 0;
            }
             if (field === "status" && value === "Not Applicable") {
                newData.progress = 0;
            }
            
            return newData;
        });
    };

    const handleSubmit = async () => {
        if (!item || !item.dpr_name) {
            toast({
                title: "Error",
                description: "DPR Name is missing for this milestone",
                variant: "destructive",
            });
            return;
        }

        try {
            await call({
                dpr_name: item.dpr_name,
                work_milestone_name: item.work_milestone_name,
                work_header: item.work_header,
                status: formData.status,
                expected_starting_date: formData.expected_starting_date,
                expected_completion_date: formData.expected_completion_date,
                progress: formData.progress,
            });

            toast({
                title: "Success",
                description: "Milestone updated successfully",
                variant: "success",
            });

            onSuccess();
            onClose();
        } catch (error: any) {
            console.error("Milestone update error:", error);
            toast({
                title: "Error",
                description: error.message || "Failed to update milestone",
                variant: "destructive",
            });
        }
    };

    if (!item) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[500px] p-0 gap-0 overflow-hidden">
                <div className="flex items-center gap-4 border-b p-6">
                    <div 
                        className="flex h-12 w-12 items-center justify-center rounded-lg text-white"
                        style={{ backgroundColor: "#2b66ec" }}
                    >
                        <Pencil className="h-6 w-6" />
                    </div>
                    <div className="flex flex-col">
                        <DialogTitle className="text-xl">Edit Milestone</DialogTitle>
                        <p className="text-sm text-gray-500 truncate max-w-[300px]" title={item.work_milestone_name}>
                            {item.work_milestone_name}
                        </p>
                    </div>
                </div>

                <div className="grid gap-4 p-6">
                    <div className="grid gap-2">
                        <Label htmlFor="status">Status</Label>
                        <Select
                            value={formData.status}
                            onValueChange={(value) => handleChange("status", value)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Not Started">Not Started</SelectItem>
                                <SelectItem value="In Progress">In Progress</SelectItem>
                                <SelectItem value="Completed">Completed</SelectItem>
                                <SelectItem value="WIP">WIP</SelectItem>
                                <SelectItem value="Not Applicable">Not Applicable</SelectItem>
                                
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="expected_starting_date" className="text-gray-400 cursor-not-allowed">Expected Starting Date</Label>
                            <Input
                                id="expected_starting_date"
                                type="date"
                                value={formData.expected_starting_date}
                                onChange={(e) => handleChange("expected_starting_date", e.target.value)}
                                disabled={true}
                                className="bg-gray-50 cursor-not-allowed"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="expected_completion_date" className="text-gray-400 cursor-not-allowed">
                                Expected Completion Date
                            </Label>
                            <Input
                                id="expected_completion_date"
                                type="date"
                                value={formData.expected_completion_date}
                                onChange={(e) => handleChange("expected_completion_date", e.target.value)}
                                disabled={true}
                                className="bg-gray-50 cursor-not-allowed"
                            />
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="progress" className={formData.status === "Not Started" ? "text-gray-400" : ""}>Progress (%)</Label>
                        <Input
                            id="progress"
                            type="number"
                            min="0"
                            max="100"
                            value={formData.progress}
                            onChange={(e) => handleChange("progress", e.target.value === "" ? "" : Number(e.target.value))}
                            placeholder="0"
                            disabled={formData.status === "Not Started" || formData.status === "Completed" |formData.status === "Not Applicable"}
                            className={formData.status === "Not Started"||formData.status === "Not Applicable"  || formData.status === "Completed" ? "bg-gray-50 cursor-not-allowed" : ""}
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 border-t bg-gray-50/50 p-6">
                    <Button variant="outline" onClick={onClose} className="bg-white hover:bg-gray-100">
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleSubmit} 
                        disabled={updating} 
                        className="bg-red-600 hover:bg-red-700 text-white"
                    >
                        {updating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Update
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
