import React, { useState, useEffect, useMemo } from 'react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { SelectUnit } from "@/components/helpers/SelectUnit";
import { ListChecks } from "lucide-react";
import { Category as CategoryType } from "@/types/NirmaanStack/Category";
import ReactSelect from 'react-select';

import { CATEGORY_DOCTYPE, CATEGORY_LIST_FIELDS_TO_FETCH } from '../items.constants';
import { getFrappeError } from '@/utils/frappeErrors';

interface AddItemDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    onItemAdded: () => void;
}

export const AddItemDialog: React.FC<AddItemDialogProps> = ({ isOpen, onOpenChange, onItemAdded }) => {
    const [itemName, setItemName] = useState("");
    const [selectedUnit, setSelectedUnit] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedBillingCategory, setSelectedBillingCategory] = useState("Billable");
    const [formError, setFormError] = useState<string | null>(null);

    const { toast } = useToast();
    const { data: categoryList } = useFrappeGetDocList<CategoryType>(
        CATEGORY_DOCTYPE,
        {
            fields: CATEGORY_LIST_FIELDS_TO_FETCH,
            orderBy: { field: "name", order: "asc" },
            limit: 1000,
        },
        'category_list_for_add_item_dialog'
    );

    // Check for duplicate item name
    const { data: existingItems } = useFrappeGetDocList("Items", {
        fields: ["name", "item_name"],
        filters: [["item_name", "=", itemName.trim()]],
        limit: 1
    }, itemName.trim().length > 0 ? `existing_item_${itemName.trim()}` : null);

    const isDuplicate = existingItems && existingItems.length > 0;

    const { createDoc, loading: createLoading, error: createApiError } = useFrappeCreateDoc();

    const categoryOptions = useMemo(() =>
        categoryList?.map((cat) => ({
            value: cat.name, // This is what will be stored in Item.category
            label: `${cat.name} (${cat.work_package?.slice(0, 4).toUpperCase() || 'N/A'})`,
        })) || [],
        [categoryList]
    );

    useEffect(() => {
        if (createApiError) {
            const errorMessage = getFrappeError(createApiError);
            toast({
                title: "Error Creating Item",
                description: errorMessage,
                variant: "destructive",
            });
        }
    }, [createApiError, toast]);

    const resetForm = () => {
        setItemName(""); setSelectedUnit(""); setSelectedCategory(""); setSelectedBillingCategory("Billable"); setFormError(null);
    };
    const handleDialogStateChange = (open: boolean) => {
        if (!open) resetForm();
        onOpenChange(open);
    };

    const handleSubmit = async () => {
        if (!itemName.trim() || !selectedUnit || !selectedCategory) {
            setFormError("All fields marked with * are required.");
            return;
        }
        if (isDuplicate) {
            setFormError("A product with this name already exists.");
            return;
        }
        setFormError(null);
        try {
            await createDoc("Items", {
                item_name: itemName.trim(),
                unit_name: selectedUnit,
                category: selectedCategory,
                billing_category: selectedBillingCategory,
            });
            toast({
                title: "Item Created",
                description: `"${itemName.trim()}" has been added successfully.`,
                variant: "success",
            });
            resetForm();
            onItemAdded();
            onOpenChange(false);
        } catch (err) {
            // Error is handled by the useEffect for createApiError
            console.error("Submit error:", err);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogStateChange}>
            <DialogContent className="sm:max-w-[450px]">
                <DialogHeader><DialogTitle className="text-center mb-4">Add New Product</DialogTitle></DialogHeader>
                <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col items-start">
                            <label htmlFor="itemCategory" className="block text-sm font-medium text-gray-700">Category<sup className="pl-1 text-sm text-red-600">*</sup></label>
                            <div className="w-full mt-1">
                                <ReactSelect
                                    options={categoryOptions}
                                    value={categoryOptions.find(option => option.value === selectedCategory) || null}
                                    onChange={val => setSelectedCategory(val ? (val as any).value : "")}
                                    // menuPosition="fixed"
                                    isClearable={true}
                                    placeholder="Select Category"
                                />
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
                            <label htmlFor="itemName" className="block text-sm font-medium text-gray-700">Product Name<sup className="pl-1 text-sm text-red-600">*</sup></label>
                            <Input
                                type="text"
                                id="itemName"
                                value={itemName}
                                onChange={(e) => setItemName(e.target.value)}
                                className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                placeholder="Product name"
                            />
                        </div>

                        <div className="flex flex-col items-start">
                            <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Product Unit<sup className="pl-1 text-sm text-red-600">*</sup></label>
                            <div className="w-full mt-1">
                                <SelectUnit value={selectedUnit} onChange={(value) => setSelectedUnit(value)} />
                            </div>
                        </div>
                    </div>

                    {isDuplicate && <p className="text-sm text-red-600 text-center pt-2 font-medium">A product with this name already exists.</p>}
                    {formError && !isDuplicate && <p className="text-sm text-red-600 text-center pt-2 font-medium">{formError}</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={createLoading || !itemName || !selectedUnit || !selectedCategory || isDuplicate}>
                        {createLoading ? "Submitting..." : "Submit"} <ListChecks className="ml-2 h-4 w-4" />
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};