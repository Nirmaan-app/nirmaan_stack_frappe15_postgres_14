import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface TDSItem {
    name: string;
    tds_request_id: string;
    tdsi_project_name: string;
    tds_work_package: string;
    tds_category: string;
    tds_item_name: string;
    tds_description: string;
    tds_make: string;
    tds_attachment?: string;
    tds_status: string;
}

interface EditTDSItemModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: TDSItem | null;
    onSave: (itemName: string, updates: Partial<TDSItem>) => void;
    loading?: boolean;
}

export const EditTDSItemModal: React.FC<EditTDSItemModalProps> = ({
    open,
    onOpenChange,
    item,
    onSave,
    loading = false,
}) => {
    const [formData, setFormData] = useState({
        tds_work_package: "",
        tds_category: "",
        tds_item_name: "",
        tds_description: "",
        tds_make: "",
    });

    // Reset form when item changes
    useEffect(() => {
        if (item) {
            setFormData({
                tds_work_package: item.tds_work_package || "",
                tds_category: item.tds_category || "",
                tds_item_name: item.tds_item_name || "",
                tds_description: item.tds_description || "",
                tds_make: item.tds_make || "",
            });
        }
    }, [item]);

    const handleSubmit = () => {
        if (!item) return;
        onSave(item.name, formData);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Edit TDS Item</DialogTitle>
                    <DialogDescription>
                        Update the details for this TDS item.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="work_package">Work Package</Label>
                        <Input
                            id="work_package"
                            value={formData.tds_work_package}
                            onChange={(e) => setFormData(prev => ({ ...prev, tds_work_package: e.target.value }))}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="category">Category</Label>
                        <Input
                            id="category"
                            value={formData.tds_category}
                            onChange={(e) => setFormData(prev => ({ ...prev, tds_category: e.target.value }))}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="item_name">Item Name</Label>
                        <Input
                            id="item_name"
                            value={formData.tds_item_name}
                            onChange={(e) => setFormData(prev => ({ ...prev, tds_item_name: e.target.value }))}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="make">Make</Label>
                        <Input
                            id="make"
                            value={formData.tds_make}
                            onChange={(e) => setFormData(prev => ({ ...prev, tds_make: e.target.value }))}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="description">Description</Label>
                        <Textarea
                            id="description"
                            rows={3}
                            value={formData.tds_description}
                            onChange={(e) => setFormData(prev => ({ ...prev, tds_description: e.target.value }))}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading}>
                        {loading ? "Saving..." : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default EditTDSItemModal;
