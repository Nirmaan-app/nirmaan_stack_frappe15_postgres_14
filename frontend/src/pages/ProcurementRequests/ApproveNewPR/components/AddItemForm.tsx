import React from 'react';
import ReactSelect from 'react-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CirclePlus } from 'lucide-react';
import { ItemOption } from '../types';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

interface AddItemFormProps {
    itemOptions: ItemOption[];
    currentItemOption: ItemOption | null;
    setCurrentItemOption: (option: ItemOption | null) => void;
    quantity: string;
    handleQuantityChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onAdd: () => void;
    onClose: () => void;
    onToggleNewItemDialog: () => void;
    canCreateItem: boolean;
    isLoading: boolean;
    showNewItemsCard: boolean
}

export const AddItemForm: React.FC<AddItemFormProps> = ({
    itemOptions,
    currentItemOption,
    setCurrentItemOption,
    quantity,
    handleQuantityChange,
    onAdd,
    onClose,
    onToggleNewItemDialog,
    canCreateItem,
    isLoading,
    showNewItemsCard
}) => {
    return (
        <AlertDialog open={showNewItemsCard} onOpenChange={onClose}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Add Missing Product
                    </AlertDialogTitle>
        {/* <Card className="p-4 border border-gray-200 rounded-lg shadow-sm relative"> */}
            {/* <Button variant="ghost" size="icon" className="absolute top-1 right-1 text-muted-foreground hover:text-red-500" onClick={onClose}>
                 <X className="w-5 h-5" />
             </Button> */}
             <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2 mb-3">
                <div className="flex-grow md:w-2/3">
                    <label className="text-xs text-muted-foreground db-block mb-1">Select Product</label>
                    <ReactSelect
                        value={currentItemOption}
                        options={itemOptions}
                        onChange={(selected) => setCurrentItemOption(selected as ItemOption)}
                        isClearable
                        placeholder="Search or select a product..."
                        isDisabled={isLoading}
                    />
                </div>
                <div className="flex-shrink w-full md:w-[100px]">
                     <label className="text-xs text-muted-foreground db-block mb-1">UOM</label>
                     <Input
                        type="text"
                        placeholder="Unit"
                        value={currentItemOption?.unit || ''}
                        readOnly // Unit is determined by selection
                        className="bg-gray-100"
                    />
                </div>
                <div className="flex-shrink w-full md:w-[100px]">
                    <label className="text-xs text-muted-foreground db-block mb-1">Quantity</label>
                    <Input
                        type="number"
                        placeholder="Qty"
                        value={quantity}
                        onChange={handleQuantityChange}
                        min="0.01" // Example validation
                        step="any"
                         disabled={isLoading || !currentItemOption} // Disable if no item selected
                    />
                </div>
            </div>
            <div className="flex justify-between items-center mt-2">
                {canCreateItem ? (
                    <Button
                        variant="link"
                        className="text-sm p-0 h-auto text-blue-600 hover:text-blue-800"
                        onClick={onToggleNewItemDialog}
                         disabled={isLoading}
                    >
                         <CirclePlus className="w-4 h-4 mr-1" /> Create New Product
                    </Button>
                ) : <div />} {/* Placeholder to keep layout consistent */}

                <div className='flex items-center gap-2'>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <Button
                     onClick={onAdd}
                     disabled={!currentItemOption || !quantity || parseFloat(quantity) <= 0 || isLoading}
                     size="sm"
                 >
                    {isLoading ? "Adding..." : "Add Product"}
                 </Button>
                </div>
            </div>
        {/* </Card> */}
        </AlertDialogHeader>
        </AlertDialogContent>
    </AlertDialog>
    );
};