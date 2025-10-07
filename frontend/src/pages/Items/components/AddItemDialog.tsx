import React, { useState, useEffect, useMemo } from 'react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { SelectUnit } from "@/components/helpers/SelectUnit";
import { ListChecks } from "lucide-react";
import { Category as CategoryType } from "@/types/NirmaanStack/Category";
import ReactSelect from 'react-select';

import { CATEGORY_DOCTYPE, CATEGORY_LIST_FIELDS_TO_FETCH } from '../items.constants';

interface AddItemDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    onItemAdded: () => void;
}

export const AddItemDialog: React.FC<AddItemDialogProps> = ({ isOpen, onOpenChange, onItemAdded }) => {
    const [itemName, setItemName] = useState("");
    const [selectedUnit, setSelectedUnit] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [formError, setFormError] = useState<string | null>(null);

    const { toast } = useToast();
    const { data: categoryList, isLoading: categoryLoading, error: categoryFetchError } = useFrappeGetDocList<CategoryType>(
        CATEGORY_DOCTYPE,
        {
            fields: CATEGORY_LIST_FIELDS_TO_FETCH,
            orderBy: { field: "name", order: "asc" },
            limit: 1000,
        },
        'category_list_for_add_item_dialog'
    );
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
            toast({
                title: "Error Creating Item",
                description: createApiError.message || "An unknown error occurred.",
                variant: "destructive",
            });
        }
    }, [createApiError, toast]);

    const resetForm = () => {
        setItemName(""); setSelectedUnit(""); setSelectedCategory(""); setFormError(null);
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
        setFormError(null);
        try {
            await createDoc("Items", {
                item_name: itemName.trim(),
                unit_name: selectedUnit,
                category: selectedCategory,
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
                <div className="grid gap-5 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="category" className="text-right col-span-1">Category<sup className="text-red-500">*</sup></Label>

                        {/* <Select value={selectedCategory} onValueChange={setSelectedCategory} disabled={categoryLoading}>
                            <SelectTrigger className="col-span-3"><SelectValue placeholder={categoryLoading ? "Loading..." : "Select Category"} /></SelectTrigger>
                            <SelectContent>
                                {categoryFetchError && <SelectItem value="error" disabled>Error loading categories</SelectItem>}
                                {categoryOptions.map(cat => <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>)}
                            </SelectContent>
                        </Select> */}
                         <div className="col-span-3"> {/* Wrap ReactSelect to fit grid */}
                                                                      <ReactSelect
                                                                          options={categoryOptions}
                                                                          // Value needs to be the full option object for react-select
                                                                          value={categoryOptions.find(option => option.value === selectedCategory) || null}
                                                                          onChange={val => setSelectedCategory(val ? val.value as string : undefined)}
                                                                          menuPosition="auto"
                                                                          isClearable={true} // Allows clearing the selection
                                                                          placeholder="Select Category"
                                                               
                                                                      />
                                                                  </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="itemName" className="text-right col-span-1">Name<sup className="text-red-500">*</sup></Label>
                        <Input id="itemName" value={itemName} onChange={e => setItemName(e.target.value)} className="col-span-3" placeholder="Product name"/>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="itemUnit" className="text-right col-span-1">Unit<sup className="text-red-500">*</sup></Label>
                        <div className="col-span-3"><SelectUnit value={selectedUnit} onChange={setSelectedUnit} /></div>
                    </div>
                    {formError && <p className="col-span-4 text-sm text-red-600 text-center pt-2">{formError}</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={createLoading || !itemName || !selectedUnit || !selectedCategory}>
                        {createLoading ? "Submitting..." : "Submit"} <ListChecks className="ml-2 h-4 w-4" />
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};