import React from 'react';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    AlertDialogTrigger // Added trigger for delete confirmation
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EditItemState, PRItem } from '../types'; // Use EditItemState which includes PRItem fields
import { Trash2 } from 'lucide-react';
import { TailSpin } from 'react-loader-spinner';


interface EditItemDialogProps {
    isOpen: boolean;
    onClose: () => void;
    editItem: EditItemState | null; // The item being edited
    handleEditItemChange: (field: keyof EditItemState, value: string | number) => void;
    onSave: () => void;
    onDelete: (itemToDelete: EditItemState) => void; // Pass the item to delete
    isLoading: boolean;
}

export const EditItemDialog: React.FC<EditItemDialogProps> = ({
    isOpen, onClose, editItem, handleEditItemChange, onSave, onDelete, isLoading
}) => {
    if (!editItem) return null; // Don't render if no item selected

    const canSave = editItem.quantity !== undefined && parseFloat(String(editItem.quantity)) > 0;

    return (
        <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Edit Product: {editItem.item}</AlertDialogTitle>
                    <AlertDialogDescription>
                        Update the quantity or add a comment for this product.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="grid gap-4 py-4">
                    {/* Item Name (Read Only) */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Product Name</Label>
                        <p className="col-span-3 text-sm font-medium">{editItem.item}</p>
                    </div>

                    {/* Unit (Read Only) & Quantity */}
                    <div className="grid grid-cols-4 items-center gap-4">
                         <Label className="text-right">Unit & Qty <span className='text-red-500'>*</span></Label>
                         <div className="col-span-3 flex gap-2">
                             <div className='w-1/2'>
                                <Input value={editItem.unit || ''} readOnly className='bg-gray-100'/>
                            </div>
                            <div className='w-1/2'>
                                <Input
                                    type="number"
                                    id="quantity"
                                    placeholder="Quantity"
                                    value={editItem.quantity || ''}
                                    onChange={(e) => handleEditItemChange('quantity', e.target.value)}
                                    min="0.01"
                                    step="any"
                                    disabled={isLoading}
                                />
                             </div>
                        </div>
                    </div>

                    {/* Comment */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="comment" className="text-right">Comment</Label>
                        <Textarea
                            id="comment"
                            placeholder="(Optional) Add or update comment"
                            value={editItem.comment || ''}
                            onChange={(e) => handleEditItemChange('comment', e.target.value)}
                            className="col-span-3"
                             disabled={isLoading}
                        />
                    </div>
                </div>

                <AlertDialogFooter className="flex justify-between items-center">
                    {/* Delete Trigger within Edit Dialog */}
                    <AlertDialog>
                         <AlertDialogTrigger asChild>
                             <Button variant="destructive" size="sm" disabled={isLoading}>
                                 <Trash2 className='h-4 w-4 mr-1'/> Delete Product
                             </Button>
                         </AlertDialogTrigger>
                         <AlertDialogContent>
                             <AlertDialogHeader>
                                 <AlertDialogTitle>Delete Product from PR?</AlertDialogTitle>
                                 <AlertDialogDescription>
                                     Are you sure you want to remove "{editItem.item}" from this Procurement Request?
                                </AlertDialogDescription>
                             </AlertDialogHeader>
                             <AlertDialogFooter>
                                 <AlertDialogCancel>Cancel</AlertDialogCancel>
                                 {/* Call onDelete passed from parent, ensuring the item context is correct */}
                                 <AlertDialogAction onClick={() => onDelete(editItem)} className='bg-destructive hover:bg-destructive/90'>Confirm Delete</AlertDialogAction>
                             </AlertDialogFooter>
                         </AlertDialogContent>
                     </AlertDialog>

                     {/* Save and Cancel Buttons */}
                    <div className='flex gap-2'>
                        <AlertDialogCancel onClick={onClose} disabled={isLoading}>Cancel</AlertDialogCancel>
                        <Button onClick={onSave} disabled={!canSave || isLoading}>
                            {isLoading ? <TailSpin color="#fff" height={20} width={20} /> : "Save Changes"}
                        </Button>
                    </div>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};