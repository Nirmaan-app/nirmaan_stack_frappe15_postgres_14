
import { useState, useEffect } from "react";
import { useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, Blocks } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface CreateWorkplantaskProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    defaultValues: {
        project: string;
        zone: string;
        work_header: string;
        work_milestone: string;
    };
    // Edit mode props
    docName?: string;
    initialData?: {
        wp_title: string;
        wp_status: string;
        wp_start_date: string;
        wp_end_date: string;
        wp_description: string;
    };
}

export const CreateWorkplantask = ({
    isOpen,
    onClose,
    onSuccess,
    defaultValues,
    docName,
    initialData,
}: CreateWorkplantaskProps) => {
    const { toast } = useToast();
    const isEditMode = !!docName;

    const [formData, setFormData] = useState({
        wp_title: "",
        wp_status: "Not Started", // Default status
        wp_start_date: "",
        wp_end_date: "",
        wp_description: "",
    });

    useEffect(() => {
        if (initialData) {
            setFormData({
                wp_title: initialData.wp_title || "",
                wp_status: initialData.wp_status || "Not Started",
                wp_start_date: initialData.wp_start_date || "",
                wp_end_date: initialData.wp_end_date || "",
                wp_description: initialData.wp_description || "",
            });
        }
    }, [initialData]);

    const { createDoc, loading: creating } = useFrappeCreateDoc();
    const { updateDoc, loading: updating } = useFrappeUpdateDoc();
    
    const loading = creating || updating;

    const handleChange = (field: string, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async () => {
        if (!formData.wp_title) {
            toast({
                title: "Error",
                description: "Task Title is required",
                variant: "destructive",
            });
            return;
        }

        if (formData.wp_start_date && formData.wp_end_date) {
            if (new Date(formData.wp_end_date) < new Date(formData.wp_start_date)) {
                toast({
                    title: "Error",
                    description: "Planned End Date cannot be before Planned Start Date",
                    variant: "destructive",
                });
                return;
            }
        }

        try {
            if (isEditMode && docName) {
                await updateDoc("Work Plan", docName, {
                    ...formData,
                });
                toast({
                    title: "Success",
                    description: "Task updated successfully",
                    variant: "success",
                });
            } else {
                await createDoc("Work Plan", {
                    ...defaultValues,
                    wp_zone: defaultValues.zone, // Use zone value for wp_zone as requested
                    ...formData,
                });
                toast({
                    title: "Success",
                    description: "Task created successfully",
                    variant: "success",
                });
            }

            onSuccess();
            onClose();
            // Reset form if creating (if editing, we depend on incoming props or close)
            if (!isEditMode) {
                setFormData({
                    wp_title: "",
                    wp_status: "Not Started",
                    wp_start_date: "",
                    wp_end_date: "",
                    wp_description: "",
                });
            }
        } catch (error: any) {
            console.error("Task operation error:", error);
            toast({
                title: "Error",
                description: error.message || "Failed to save task",
                variant: "destructive",
            });
        }
    };

    const isFormValid = formData.wp_title && formData.wp_status && formData.wp_start_date && formData.wp_end_date;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[600px] p-0 gap-0 overflow-hidden">
                <div className="flex items-center gap-4 border-b p-6">
                    <div 
                        className="flex h-12 w-12 items-center justify-center rounded-lg text-white"
                        style={{ backgroundColor: "#2b66ec" }}
                    >
                        <Blocks className="h-6 w-6" />
                    </div>
                    <div className="flex flex-col">
                        <DialogTitle className="text-xl">{isEditMode ? "Edit Task" : "Add Tasks"}</DialogTitle>
                        <p className="text-sm text-gray-500">
                            {isEditMode ? "Update the details below" : "Fill in the details below to create a task"}
                        </p>
                    </div>
                </div>

                <div className="grid gap-4 p-6">
                    <div className="grid gap-2">
                        <Label htmlFor="wp_title">Task Title</Label>
                        <Input
                            id="wp_title"
                            placeholder="Write follow-up task"
                            value={formData.wp_title}
                            onChange={(e) => handleChange("wp_title", e.target.value)}
                        />
                    </div>

                    {isEditMode && (
                        <div className="grid gap-2">
                            <Label htmlFor="wp_status">Status</Label>
                            <Select
                                value={formData.wp_status}
                                onValueChange={(value) => handleChange("wp_status", value)}
                                disabled={true}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Not Started">Not Started</SelectItem>
                                    <SelectItem value="In Progress">In Progress</SelectItem>
                                    <SelectItem value="Completed">Completed</SelectItem>
                                    <SelectItem value="On Hold">On Hold</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="wp_start_date">Planned Start Date</Label>
                            <Input
                                id="wp_start_date"
                                type="date"
                                value={formData.wp_start_date}
                                onChange={(e) => {
                                    handleChange("wp_start_date", e.target.value);
                                    // Reset end date if it becomes invalid
                                    if (formData.wp_end_date && e.target.value > formData.wp_end_date) {
                                         handleChange("wp_end_date", "");
                                    }
                                }}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="wp_end_date" className={!formData.wp_start_date ? "text-gray-400" : ""}>
                                Planned End Date
                            </Label>
                            <Input
                                id="wp_end_date"
                                type="date"
                                value={formData.wp_end_date}
                                min={formData.wp_start_date}
                                disabled={!formData.wp_start_date}
                                onChange={(e) => handleChange("wp_end_date", e.target.value)}
                                title={!formData.wp_start_date ? "Please select a Planned Start Date first" : ""}
                            />
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="wp_description">Notes/ Description (Optional)</Label>
                        <Textarea
                            id="wp_description"
                            placeholder="Add any additional notes or details..."
                            value={formData.wp_description}
                            onChange={(e) => handleChange("wp_description", e.target.value)}
                            className="resize-none"
                            rows={4}
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 border-t bg-gray-50/50 p-6">
                    <Button variant="outline" onClick={onClose} className="bg-white hover:bg-gray-100">
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleSubmit} 
                        disabled={loading || !isFormValid} 
                        className={`bg-red-600 hover:bg-red-700 text-white ${(!isFormValid || loading) ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isEditMode ? "Update" : "Confirm"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
