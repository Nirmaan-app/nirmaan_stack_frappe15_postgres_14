import React, { useState, useMemo } from 'react';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUserData } from '@/hooks/useUserData';
import { useToast } from '@/components/ui/use-toast';
import { Items } from '@/types/NirmaanStack/Items';
import { ProcurementRequestItem } from '../types';
import CreatableSelect from 'react-select/creatable';
import { SingleValue } from 'react-select';
import { FuseResult } from 'fuse.js';
import { Category } from '@/types/NirmaanStack/Category';


interface NewItemDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    categories: Category[];
    selectedHeaderTags: { tag_header: string; tag_package: string }[];
    categoryToPackageMap: Record<string, string>;
    onSubmit: (itemData: Omit<ProcurementRequestItem, "uniqueId" | "status">, isRequest?: boolean) => void;
    fuzzySearch: (input: string) => FuseResult<Items>[];
    itemMutate: () => Promise<any>;
}

export const NewItemDialog: React.FC<NewItemDialogProps> = ({
    isOpen,
    onOpenChange,
    categories,
    selectedHeaderTags,
    categoryToPackageMap,
    onSubmit,
    fuzzySearch,
    itemMutate,
}) => {
    const { toast } = useToast();
    const userData = useUserData();

    const [newItem, setNewItem] = useState({
        item: '',
        category: '',
        unit: '',
        comment: '',
    });

    const [isFocused, setIsFocused] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const categoryOptions = useMemo(() => 
        categories.map(cat => ({
            value: cat.name,
            label: cat.category_name,
            tax: cat.tax || 0,
            newItemsDisabled: cat.new_items === 'false'
        }))
    , [categories]);

    const selectedCategory = useMemo(() => 
        categoryOptions.find(opt => opt.value === newItem.category)
    , [categoryOptions, newItem.category]);

    const fuzzyMatches = useMemo(() => 
        newItem.item.length > 2 ? fuzzySearch(newItem.item) : []
    , [newItem.item, fuzzySearch]);

    const handleExistingItemSelect = (item: Items) => {
        if (!selectedCategory) return;
        
        onSubmit({
            name: item.name,
            item: item.item_name,
            unit: item.unit,
            category: selectedCategory.value,
            tax: selectedCategory.tax,
            comment: '',
            work_package: categoryToPackageMap[selectedCategory.value] || (selectedHeaderTags.length > 0 ? selectedHeaderTags[0].tag_package : ''),
         }, false);

         closeDialog();
    };

    const handleCreateNew = async () => {
        if (!newItem.item || !newItem.category || !newItem.unit) {
            toast({
                title: "Error",
                description: "Please fill in all required fields",
                variant: "destructive",
            });
            return;
        }

        if (!selectedCategory) return;

        setIsSubmitting(true);
        try {
            const requestItemData: Omit<ProcurementRequestItem, "uniqueId" | "status"> = {
                name: `REQ-${Date.now()}`,
                item: newItem.item.trim(),
                unit: newItem.unit.trim(),
                category: selectedCategory.value,
                tax: selectedCategory.tax,
                comment: newItem.comment.trim() || undefined,
                work_package: categoryToPackageMap[selectedCategory.value] || (selectedHeaderTags.length > 0 ? selectedHeaderTags[0].tag_package : ''),
            };
            onSubmit(requestItemData, true);
            closeDialog();
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to create item request",
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const closeDialog = () => {
        setNewItem({ item: '', category: '', unit: '', comment: '' });
        onOpenChange(false);
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader className="text-left pb-0">
                    <AlertDialogTitle>
                        Create or Request New Item
                    </AlertDialogTitle>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {selectedHeaderTags.map((tag, idx) => (
                            <span 
                                key={idx} 
                                className="px-2 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-medium border border-primary/20"
                            >
                                {tag.tag_header}
                            </span>
                        ))}
                    </div>
                    <AlertDialogDescription className="mt-2">
                        Fill in the details for the new item. If creation is disabled for the category, it will be added as a request.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="category">Category <sup className="text-red-500">*</sup></Label>
                        <CreatableSelect
                            id="category"
                            options={categoryOptions}
                            value={selectedCategory}
                            onChange={(newValue: SingleValue<{value: string, label: string}>) => 
                                setNewItem(prev => ({ ...prev, category: newValue?.value || '' }))
                            }
                            placeholder="Select category..."
                            className="text-sm"
                        />
                    </div>

                    <div className="grid gap-2 relative">
                        <Label htmlFor="item_name">Item Name <sup className="text-red-500">*</sup></Label>
                        <Input
                            id="item_name"
                            value={newItem.item}
                            onChange={(e) => setNewItem(prev => ({ ...prev, item: e.target.value }))}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
                            placeholder="Enter item name..."
                        />
                        {isFocused && fuzzyMatches.length > 0 && selectedCategory && (
                            <ul className="absolute z-20 mt-1 top-full left-0 right-0 bg-white border border-gray-300 rounded-md shadow-lg max-h-40 w-full overflow-y-auto">
                                <li className='px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50'>Similar Existing Items:</li>
                                {fuzzyMatches.slice(0,10).map(({ item }) => (
                                     <li
                                        key={item.name}
                                        className="p-2 hover:bg-gray-100 flex justify-between items-center text-sm cursor-default"
                                    >
                                        <span>{item.item_name} ({item.unit})</span>
                                        <Button 
                                            size="sm" 
                                            variant="ghost" 
                                            className="text-primary hover:text-primary"
                                            onClick={() => handleExistingItemSelect(item)}
                                        >
                                            Add This
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="unit">Unit <sup className="text-red-500">*</sup></Label>
                            <Input
                                id="unit"
                                value={newItem.unit}
                                onChange={(e) => setNewItem(prev => ({ ...prev, unit: e.target.value }))}
                                placeholder="e.g. Nos, Kg, Pkt"
                            />
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="comment">Comments (Optional)</Label>
                        <Input
                            id="comment"
                            value={newItem.comment}
                            onChange={(e) => setNewItem(prev => ({ ...prev, comment: e.target.value }))}
                            placeholder="Add notes for this new item..."
                        />
                    </div>
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel onClick={closeDialog}>Cancel</AlertDialogCancel>
                    <Button 
                        onClick={handleCreateNew}
                        disabled={isSubmitting || !newItem.item || !newItem.category || !newItem.unit}
                    >
                        {selectedCategory?.newItemsDisabled && userData?.role !== 'Nirmaan Admin Profile' 
                            ? (isSubmitting ? 'Requesting...' : 'Request Item')
                            : (isSubmitting ? 'Creating...' : 'Create & Add')}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};