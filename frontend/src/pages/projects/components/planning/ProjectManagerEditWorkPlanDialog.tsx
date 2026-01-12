import { useState, useEffect } from "react";
import { useFrappeUpdateDoc } from "frappe-react-sdk";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ReactSelect from "react-select";
import { Label } from "@/components/ui/label";
import { Loader2, Blocks } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface ProjectManagerEditWorkPlanDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    docName: string;
    initialData: {
        wp_title: string;
        wp_status: string;
        wp_start_date: string;
        wp_end_date: string;
        wp_description: string;
        wp_progress?: number;
        wp_estimate_completion_date?: string;
    };
}

export const ProjectManagerEditWorkPlanDialog = ({
    isOpen,
    onClose,
    onSuccess,
    docName,
    initialData,
}: ProjectManagerEditWorkPlanDialogProps) => {
    const { toast } = useToast();

    const [formData, setFormData] = useState<{
        wp_status: string;
        wp_progress: number | string;
        wp_estimate_completion_date: string;
    }>({
        wp_status: "Not Started",
        wp_progress: 0,
        wp_estimate_completion_date: "",
    });

    useEffect(() => {
        if (initialData) {
            setFormData({
                wp_status: initialData.wp_status || "Not Started",
                wp_progress: initialData.wp_progress !== undefined ? initialData.wp_progress : 0,
                wp_estimate_completion_date: initialData.wp_estimate_completion_date || "",
            });
        }
    }, [initialData]);

    const { updateDoc, loading: updating } = useFrappeUpdateDoc();

    const handleChange = (field: string, value: any) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    // Zod Schema Definition
    const editSchema = z.object({
        wp_status: z.enum(["Not Started", "Pending", "In Progress", "Completed", "On Hold"]),
        wp_progress: z.union([z.number(), z.string()]).optional(),
        wp_estimate_completion_date: z.string().optional(),
    }).superRefine((data, ctx) => {
        if (data.wp_status === "In Progress") {
            if (!data.wp_estimate_completion_date) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Estimated Completion Date is required for In Progress tasks",
                    path: ["wp_estimate_completion_date"],
                });
            }
            if (data.wp_progress === "" || data.wp_progress === undefined || data.wp_progress === null) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Progress is required for In Progress tasks",
                    path: ["wp_progress"],
                });
            }
        }
    });

    const handleSubmit = async () => {
        // Validate with Zod
        const result = editSchema.safeParse(formData);

        if (!result.success) {
            const errorMessages = result.error.issues.map((issue) => issue.message);
            toast({
                title: "Validation Error",
                description: (
                    <ul className="list-disc pl-4">
                        {errorMessages.map((msg, idx) => (
                            <li key={idx}>{msg}</li>
                        ))}
                    </ul>
                ),
                variant: "destructive",
            });
            return;
        }

        const dataToUpdate: any = {
            wp_status: formData.wp_status,
        };

        if (formData.wp_status === "Completed") {
            dataToUpdate.wp_progress = 100;
            dataToUpdate.wp_estimate_completion_date = formData.wp_estimate_completion_date;

        } else if (formData.wp_status === "Not Started" || formData.wp_status === "On Hold") {
             dataToUpdate.wp_progress = 0;
        } else {
            // In Progress
            dataToUpdate.wp_progress = formData.wp_progress;
            dataToUpdate.wp_estimate_completion_date = formData.wp_estimate_completion_date;
        }


        try {
            await updateDoc("Work Plan", docName, dataToUpdate);
            toast({
                title: "Success",
                description: "Task updated successfully",
                variant: "success",
            });

            onSuccess();
            onClose();
        } catch (error: any) {
            console.error("Task operation error:", error);
            toast({
                title: "Error",
                description: error.message || "Failed to update task",
                variant: "destructive",
            });
        }
    };

    const shouldShowFields = formData.wp_status === "In Progress";

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[500px] p-0 gap-0 overflow-hidden">
                <div className="flex items-center gap-4 border-b p-6">
                    <div 
                        className="flex h-12 w-12 items-center justify-center rounded-lg text-white"
                        style={{ backgroundColor: "#2b66ec" }}
                    >
                        <Blocks className="h-6 w-6" />
                    </div>
                    <div className="flex flex-col">
                        <DialogTitle className="text-xl">Update Work Plan Task </DialogTitle>
                        <p className="text-sm text-gray-500">
                           {initialData?.wp_title}
                        </p>
                    </div>
                </div>

                <div className="flex flex-col">
                    <div className="grid gap-4 p-6">
                        <div className="grid gap-2">
                            <Label htmlFor="wp_status">Status</Label>
                        <ReactSelect
                            value={{ label: formData.wp_status, value: formData.wp_status }}
                            options={[
                                { label: "Not Started", value: "Not Started" },
                                { label: "In Progress", value: "In Progress" },
                                { label: "On Hold", value: "On Hold" },
                                { label: "Completed", value: "Completed" },
                            ]}
                            onChange={(newValue) => handleChange("wp_status", newValue?.value)}
                            menuPortalTarget={document.body}
                            styles={{
                                menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                                control: (base) => ({ ...base, borderColor: "rgb(229, 231, 235)" }), // match shadcn border
                            }}
                            classNames={{
                                control: () => "text-sm",
                                option: () => "text-sm",
                            }}
                        />
                    </div>

                    {shouldShowFields && (
                        <>
                            <div className="grid gap-2">
                                <Label htmlFor="wp_progress">Progress (%)</Label>
                                <Input
                                    id="wp_progress"
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={formData.wp_progress}
                                    onChange={(e) => handleChange("wp_progress", e.target.value === "" ? "" : parseFloat(e.target.value))}
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="wp_estimate_completion_date">Estimated Completion Date</Label>
                                <Input
                                    id="wp_estimate_completion_date"
                                    type="date"
                                    value={formData.wp_estimate_completion_date}
                                    min={new Date().toISOString().split("T")[0]} 
                                    onChange={(e) => handleChange("wp_estimate_completion_date", e.target.value)}
                                />
                            </div>
                        </>
                    )}
                     
                    {formData.wp_status === "Completed" && (
                         <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-700">
                            Task will be marked as 100% completed.
                         </div>
                    )}
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
