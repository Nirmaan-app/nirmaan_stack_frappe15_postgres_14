import React from 'react';
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea'; // Use Textarea for comments
import ReactSelect from 'react-select';
import { SelectUnit } from '@/components/helpers/SelectUnit'; // Assuming this is your unit selector
import { FuzzyMatch, ItemOption, NewItemState, RequestItemState } from '../types';
import { TailSpin } from 'react-loader-spinner';
import { parseNumber } from '@/utils/parseNumber';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CirclePlus } from 'lucide-react';

interface CategoryOption {
    label: string; // category_name
    value: string; // category docname
    tax: number;
}

interface NewItemDialogProps {
    isOpen: boolean;
    onClose: () => void;
    newItem: NewItemState;
    setNewItem: React.Dispatch<React.SetStateAction<NewItemState>>; // Allow direct update
    categoryOptions: CategoryOption[];
    currentCategory: CategoryOption | null;
    setCurrentCategory: (option: CategoryOption | null) => void;
    onSubmit: () => Promise<void>; // Async handler
    isLoading: boolean;
    fuzzyMatches: FuzzyMatch[];
    handleFuzzySearch: (input: string) => void
    onAddMatchingItem: React.Dispatch<React.SetStateAction<ItemOption | null>>
}

export const NewItemDialog: React.FC<NewItemDialogProps> = ({
    isOpen, onClose, newItem, setNewItem, categoryOptions, currentCategory,
    setCurrentCategory, onSubmit, isLoading, fuzzyMatches, handleFuzzySearch, onAddMatchingItem
}) => {

    const handleInputChange = (field: keyof NewItemState, value: string) => {
        setNewItem(prev => ({ ...prev, [field]: value }));
        if (field === "item_name") handleFuzzySearch(value)
    };

    const handleUnitChange = (value: string) => {
         setNewItem(prev => ({ ...prev, unit_name: value }));
    };

    const canSubmit = currentCategory && newItem.item_name && newItem.unit_name && newItem.quantity && parseNumber(newItem.quantity) > 0;

    return (
        <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <AlertDialogContent className='overflow-auto max-h-[90vh]'>
                <AlertDialogHeader>
                    <AlertDialogTitle>Create New Product</AlertDialogTitle>
                    <AlertDialogDescription>
                        Enter the details for the new product. It will be added to the system and this PR.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="grid gap-4 py-4">
                    {/* Category */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="category" className="text-right">Category <span className='text-red-500'>*</span></Label>
                        <ReactSelect
                            id="category"
                            className="col-span-3"
                            value={currentCategory}
                            options={categoryOptions}
                            onChange={(selected) => setCurrentCategory(selected as CategoryOption)}
                            placeholder="Select Category..."
                            isDisabled={isLoading}
                        />
                    </div>

                    {/* Item Name */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="product_name" className="text-right">Product Name <span className='text-red-500'>*</span></Label>
                        <Input
                            id="product_name"
                            value={newItem.item_name || ''}
                            onChange={(e) => handleInputChange('item_name', e.target.value)}
                            className="col-span-3"
                            placeholder="e.g., ACC Blocks 4 inch"
                            disabled={!currentCategory || isLoading}
                        />
                    </div>

                    {/* Unit and Quantity */}
                    <div className="grid grid-cols-4 items-center gap-4">
                         <Label className="text-right">Unit & Qty <span className='text-red-500'>*</span></Label>
                        <div className="col-span-3 flex gap-2">
                            <div className='w-1/2'>
                                 <SelectUnit
                                     value={newItem.unit_name || ''}
                                     onChange={handleUnitChange} // Use onValueChange for Shadcn Select
                                     disabled={!currentCategory || isLoading}
                                 />
                             </div>
                             <div className='w-1/2'>
                                 <Input
                                     type="number"
                                     id="quantity"
                                     placeholder="Quantity"
                                     value={newItem.quantity || ''}
                                     onChange={(e) => handleInputChange('quantity', e.target.value)}
                                     min="0.01"
                                     step="any"
                                     disabled={!currentCategory || isLoading}
                                 />
                             </div>
                         </div>
                    </div>

                    {/* Comment */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="comment" className="text-right">Comment</Label>
                        <Textarea
                            id="comment"
                            placeholder="(Optional) Add a comment for this product"
                            value={newItem.comment || ''}
                            onChange={(e) => handleInputChange('comment', e.target.value)}
                            className="col-span-3"
                             disabled={isLoading}
                        />
                    </div>
                </div>

                {/* --- Fuzzy Matches --- */}
                                     {fuzzyMatches && fuzzyMatches.length > 0 && (
                                         <Card className='border-blue-200 bg-blue-50/50'>
                                             <CardHeader className='pb-2'>
                                                 <CardTitle className='text-base text-blue-800'>Match to Existing Product</CardTitle>
                                                 <CardDescription className='text-xs text-blue-700'>
                                                      Found similar products. Click on "Use This Product" to take you to "Add Missing Product" dialog.
                                                 </CardDescription>
                                             </CardHeader>
                                             <CardContent className='space-y-2'>
                                                 {fuzzyMatches?.slice(0, 3).map((match) => (
                                                     <div key={match.name} className="flex justify-between items-center border rounded p-2 bg-white text-sm">
                                                         <div>
                                                             <strong className='block'>{match.item_name}</strong>
                                                             <span className="text-xs text-muted-foreground">{match.category} - {match.unit_name} ({match.matchPercentage}% match)</span>
                                                          </div>
                                                         <Button
                                                              variant="outline"
                                                              size="sm"
                                                              onClick={() => {
                                                                onAddMatchingItem({
                                                                    value: match.name,
                                                                    label: match.item_name,
                                                                    unit: match.unit_name,
                                                                    category: match.category,
                                                                    tax: parseNumber(categoryOptions.find(c => c.value === match.category)?.tax ?? "0")
                                                                })
                                                                onClose()
                                                              }}
                                                              disabled={isLoading}
                                                              className='h-7 border-blue-500 text-blue-600 hover:bg-blue-100'
                                                         >
                                                             <CirclePlus className="w-4 h-4 mr-1" /> Use This Product
                                                         </Button>
                                                     </div>
                                                 ))}
                                             </CardContent>
                                         </Card>
                                     )}

                <AlertDialogFooter>
                    <AlertDialogCancel 
                    onClick={() => handleFuzzySearch('')}
                    disabled={isLoading}>Cancel</AlertDialogCancel>
                    <Button onClick={onSubmit} disabled={!canSubmit || isLoading}>
                         {isLoading ? <TailSpin color="#fff" height={20} width={20} /> : "Create & Add Product"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};