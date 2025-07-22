import React, { useEffect } from 'react';
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectUnit } from '@/components/helpers/SelectUnit';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RequestItemState, FuzzyMatch, Item } from '../types'; // Use specific types
import { TailSpin } from 'react-loader-spinner';
import { CirclePlus, CheckCheck, X, Trash } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { parseNumber } from '@/utils/parseNumber';

interface CategoryOption {
    label: string; // category_name
    value: string; // category docname
}

interface RequestItemDialogProps {
    isOpen: boolean;
    onClose: () => void;
    requestItem: RequestItemState | null;
    setRequestItem: React.Dispatch<React.SetStateAction<RequestItemState | null>>; // Allow direct update
    categoryOptions: CategoryOption[];
    fuzzyMatches: FuzzyMatch[];
    onApproveAsNew: () => Promise<void>;
    onAddMatchingItem: (match: Item, originalRequest: RequestItemState) => void; // Pass Item (or FuzzyMatch) and the original request state
    onReject: (itemToReject: RequestItemState) => void; // Reject means delete
    isLoading: boolean;
    handleFuzzySearch: (input: string) => void
}

export const RequestItemDialog: React.FC<RequestItemDialogProps> = ({
    isOpen, onClose, requestItem, setRequestItem, categoryOptions,
    fuzzyMatches, onApproveAsNew, onAddMatchingItem, onReject, isLoading,
    handleFuzzySearch
}) => {
    if (!requestItem) return null;

    useEffect(() => {
        if(requestItem.item_name) {
            handleFuzzySearch(requestItem.item_name)
        }
    }, [])

    const handleFormChange = (field: keyof RequestItemState, value: string) => {
        setRequestItem(prev => prev ? { ...prev, [field]: value } : null);
        if(field === "newItemName") handleFuzzySearch(value)
    };

     const canApprove = requestItem.newItemName && requestItem.newUnit && requestItem.newCategory && requestItem.quantity && parseNumber(requestItem.quantity) > 0;


    return (
        <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            {/* Increase max width for more content */}
            <AlertDialogContent className="sm:max-w-2xl overflow-auto max-h-[90vh]">
                <AlertDialogHeader>
                    <AlertDialogTitle>Review Requested Product: <span className='text-primary'>{requestItem.item_name}</span></AlertDialogTitle>
                    <AlertDialogDescription>
                         Approve this request by confirming/correcting details and creating a new product master, or match it to an existing product below. You can also reject the request.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="grid gap-4 py-4">
                    {/* --- Form to Approve/Create --- */}
                     <Card className='border-green-200 bg-green-50/50'>
                         <CardHeader className='pb-2'>
                              <CardTitle className='text-base text-green-800'>Option 1: Approve & Create New Product</CardTitle>
                              <CardDescription className='text-xs text-green-700'>Verify or correct the details below. Clicking "Confirm & Create" will create a new product master and add it to the PR.</CardDescription>
                         </CardHeader>
                          <CardContent className='grid gap-3'>
                               {/* Category */}
                               <div className="grid grid-cols-4 items-center gap-4">
                                   <Label htmlFor="req-category" className="text-right text-xs">Category <span className='text-red-500'>*</span></Label>
                                   <Select
                                        value={requestItem.newCategory || ''}
                                        onValueChange={(value) => handleFormChange('newCategory', value)}
                                        disabled={isLoading}
                                    >
                                        <SelectTrigger id="req-category" className="col-span-3 h-8">
                                            <SelectValue placeholder="Select Category..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {categoryOptions.map(cat => (
                                                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                               </div>

                              {/* Item Name */}
                               <div className="grid grid-cols-4 items-center gap-4">
                                   <Label htmlFor="req-item-name" className="text-right text-xs">Product Name <span className='text-red-500'>*</span></Label>
                                   <Input
                                       id="req-item-name"
                                       value={requestItem.newItemName || ''}
                                       onChange={(e) => handleFormChange('newItemName', e.target.value)}
                                       className="col-span-3 h-8"
                                       placeholder="Enter confirmed item name"
                                       disabled={isLoading}
                                   />
                               </div>

                              {/* Unit and Quantity */}
                               <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right text-xs">Unit & Qty <span className='text-red-500'>*</span></Label>
                                   <div className="col-span-3 flex gap-2">
                                       <div className='w-1/2'>
                                           <SelectUnit
                                                value={requestItem.newUnit || ''}
                                                onChange={(value) => handleFormChange('newUnit', value)}
                                                disabled={isLoading}
                                            />
                                        </div>
                                        <div className='w-1/2'>
                                            <Input
                                                type="number"
                                                id="req-quantity"
                                                placeholder="Quantity"
                                                value={requestItem.quantity || ''}
                                                onChange={(e) => handleFormChange('quantity', e.target.value)}
                                                min="0.01"
                                                step="any"
                                                className='h-8'
                                                disabled={isLoading}
                                            />
                                        </div>
                                    </div>
                               </div>
                               <div className='flex justify-end'>
                                    <Button size="sm" onClick={onApproveAsNew} disabled={!canApprove || isLoading} className='bg-green-600 hover:bg-green-700 h-8'>
                                         {isLoading ? <TailSpin color="#fff" height={16} width={16} /> : <><CheckCheck className="h-4 w-4 mr-1"/>Confirm & Create</>}
                                    </Button>
                               </div>
                         </CardContent>
                     </Card>


                    {/* --- Fuzzy Matches --- */}
                     {fuzzyMatches && fuzzyMatches.length > 0 && (
                         <Card className='border-blue-200 bg-blue-50/50'>
                             <CardHeader className='pb-2'>
                                 <CardTitle className='text-base text-blue-800'>Option 2: Match to Existing Product</CardTitle>
                                 <CardDescription className='text-xs text-blue-700'>
                                      Found similar products. Clicking "Use This Product" will replace the requested product with the selected existing product (using the requested quantity: {requestItem.quantity}).
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
                                              onClick={() => onAddMatchingItem(match, requestItem)}
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
                </div>

                <AlertDialogFooter className='flex justify-between items-center'>
                     {/* <Button variant="destructive" onClick={() => onReject(requestItem)} disabled={isLoading} size='sm'>
                         <Trash className='h-4 w-4 mr-1'/> Reject Request
                     </Button> */}
                     <AlertDialogCancel onClick={onClose} disabled={isLoading}>Close</AlertDialogCancel>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};