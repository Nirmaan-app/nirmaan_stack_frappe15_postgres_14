import React, { useState, useEffect, useMemo } from 'react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useFrappeUpdateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { SelectUnit } from "@/components/helpers/SelectUnit";
import { ListChecks, CheckCircle2, XCircle } from "lucide-react";
import { cn } from '@/lib/utils';
import ReactSelect from 'react-select';

import { CATEGORY_DOCTYPE, CATEGORY_LIST_FIELDS_TO_FETCH } from '../items.constants';
import { Items as ItemsType } from "@/types/NirmaanStack/Items";
import { Category as CategoryType } from "@/types/NirmaanStack/Category";

interface EditItemDialogProps {
    item: ItemsType | null;
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    onItemUpdated: () => void;
}

export const EditItemDialog: React.FC<EditItemDialogProps> = ({ item, isOpen, onOpenChange, onItemUpdated }) => {
    const [itemName, setItemName] = useState("");
    const [selectedUnit, setSelectedUnit] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedBillingCategory, setSelectedBillingCategory] = useState("");
    const [selectedItemStatus, setSelectedItemStatus] = useState("");
    const [formError, setFormError] = useState<string | null>(null);

    const { toast } = useToast();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

    const { data: categoryList, isLoading: categoryLoading } = useFrappeGetDocList<CategoryType>(
        CATEGORY_DOCTYPE,
        {
            fields: CATEGORY_LIST_FIELDS_TO_FETCH,
            orderBy: { field: "name", order: "asc" },
            limit: 1000,
        },
        'category_list_for_edit_item_dialog'
    );

    // Check for duplicate item name excluding current item
    const { data: existingItems } = useFrappeGetDocList("Items", {
        fields: ["name", "item_name"],
        filters: [
            ["item_name", "=", itemName.trim()],
            ["name", "!=", item?.name || ""]
        ],
        limit: 1
    }, (item && itemName.trim().length > 0 && itemName.trim() !== item.item_name) ? `existing_item_edit_${itemName.trim()}` : null);

    const isDuplicate = existingItems && existingItems.length > 0;

    const categoryOptions = useMemo(() =>
        categoryList?.map((cat) => ({
            value: cat.name,
            label: `${cat.name} (${cat.work_package?.slice(0, 4).toUpperCase() || 'N/A'})`,
        })) || [],
        [categoryList]
    );

    // Initialize state when item changes
    useEffect(() => {
        if (item) {
            setItemName(item.item_name || "");
            setSelectedUnit(item.unit_name || "");
            setSelectedCategory(item.category || "");
            setSelectedBillingCategory(item.billing_category || "");
            setSelectedItemStatus(item.item_status || "");
        }
    }, [item, isOpen]);

    const handleSave = async () => {
        if (!item) return;
        if (!itemName.trim() || !selectedUnit || !selectedCategory || !selectedBillingCategory || !selectedItemStatus) {
            setFormError("All fields marked with * are required.");
            return;
        }
        if (isDuplicate) {
            setFormError("Product name already exists for another item.");
            return;
        }
        setFormError(null);

        try {
            await updateDoc("Items", item.name, {
                item_name: itemName.trim(),
                unit_name: selectedUnit,
                category: selectedCategory,
                billing_category: selectedBillingCategory,
                item_status: selectedItemStatus,
            });

            toast({
                title: "Success!",
                description: `Product ${item.name} updated successfully!`,
                variant: "success",
            });
            onItemUpdated();
            onOpenChange(false);
        } catch (err: any) {
            toast({
                title: "Failed!",
                description: err.message || `Unable to update Product ${item.name}.`,
                variant: "destructive",
            });
        }
    };

    const isDirty = useMemo(() => {
        if (!item) return false;
        return (
            itemName !== (item.item_name || "") ||
            selectedUnit !== (item.unit_name || "") ||
            selectedCategory !== (item.category || "") ||
            selectedBillingCategory !== (item.billing_category || "") ||
            selectedItemStatus !== (item.item_status || "")
        );
    }, [item, itemName, selectedUnit, selectedCategory, selectedBillingCategory, selectedItemStatus]);

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[450px]">
                <DialogHeader>
                    <DialogTitle className="mb-2">Edit Product</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col items-start">
                            <label htmlFor="itemName" className="block text-sm font-medium text-gray-700">Product Name<sup className="pl-1 text-sm text-red-600">*</sup></label>
                            <div className="relative w-full mt-1">
                                <Input
                                    type="text"
                                    id="itemName"
                                    value={itemName}
                                    onChange={(e) => setItemName(e.target.value)}
                                    className={cn(
                                        "block w-full p-2 pr-8 border rounded-md shadow-sm sm:text-sm",
                                        itemName.trim() ? (isDuplicate ? "border-red-500 focus-visible:ring-red-500" : "border-green-500 focus-visible:ring-green-500") : "border-gray-300"
                                    )}
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                    {itemName.trim() && !isDuplicate && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                                    {itemName.trim() && isDuplicate && <XCircle className="h-4 w-4 text-red-600" />}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-start">
                            <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Product Unit<sup className="pl-1 text-sm text-red-600">*</sup></label>
                            <div className="w-full mt-1">
                                <SelectUnit value={selectedUnit} onChange={(value) => setSelectedUnit(value)} />
                            </div>
                        </div>

                        <div className="flex flex-col items-start w-full">
                            <label htmlFor="billingCategory" className="block text-sm font-medium text-gray-700">Billing Category<sup className="pl-1 text-sm text-red-600">*</sup></label>
                            <Select value={selectedBillingCategory} onValueChange={setSelectedBillingCategory}>
                                <SelectTrigger className="w-full mt-1">
                                    <SelectValue placeholder="Select Billing Category" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Billable">Billable</SelectItem>
                                    <SelectItem value="Non-Billable">Non-Billable</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex flex-col items-start">
                            <label htmlFor="itemCategory" className="block text-sm font-medium text-gray-700">Category<sup className="pl-1 text-sm text-red-600">*</sup></label>
                            <div className="w-full mt-1">
                                <ReactSelect
                                    options={categoryOptions}
                                    value={categoryOptions.find(opt => opt.value === selectedCategory) || null}
                                    onChange={val => setSelectedCategory(val ? (val as any).value : "")}
                                    isClearable={true}
                                    placeholder={categoryLoading ? "Loading..." : "Select Category"}
                                    isDisabled={categoryLoading}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col items-start pt-2">
                            <label htmlFor="itemStatus" className="block text-sm font-medium text-gray-700">Item Status<sup className="pl-1 text-sm text-red-600">*</sup></label>
                            <Select value={selectedItemStatus} onValueChange={setSelectedItemStatus}>
                                <SelectTrigger className="w-full mt-1">
                                    <SelectValue placeholder={item?.item_status || "Select Status"} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Active">Active</SelectItem>
                                    <SelectItem value="Inactive">Inactive</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {formError && !isDuplicate && <p className="text-sm text-red-600 text-center pt-2 font-medium">{formError}</p>}

                    <div className="flex justify-center mt-3">
                        <Button
                            disabled={updateLoading || !isDirty || isDuplicate}
                            className="flex items-center gap-1"
                            onClick={handleSave}
                        >
                            <ListChecks className="h-4 w-4" />
                            {updateLoading ? "Submitting..." : "Submit"}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
