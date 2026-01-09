import React, { useState, useEffect } from 'react';
import { useFrappeCreateDoc } from 'frappe-react-sdk';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Boxes, ListChecks } from 'lucide-react';

import { ASSET_CATEGORY_DOCTYPE } from '../assets.constants';

interface AddAssetCategoryDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onCategoryAdded?: () => void;
}

export const AddAssetCategoryDialog: React.FC<AddAssetCategoryDialogProps> = ({
    isOpen,
    onOpenChange,
    onCategoryAdded,
}) => {
    const [categoryName, setCategoryName] = useState('');
    const [formError, setFormError] = useState<string | null>(null);

    const { toast } = useToast();
    const { createDoc, loading: isCreating, error: createError } = useFrappeCreateDoc();

    useEffect(() => {
        if (createError) {
            toast({
                title: 'Error Creating Category',
                description: createError.message || 'An unknown error occurred.',
                variant: 'destructive',
            });
        }
    }, [createError, toast]);

    const resetForm = () => {
        setCategoryName('');
        setFormError(null);
    };

    const handleDialogChange = (open: boolean) => {
        if (!open) resetForm();
        onOpenChange(open);
    };

    const handleSubmit = async () => {
        const trimmedName = categoryName.trim();

        if (!trimmedName) {
            setFormError('Category name is required.');
            return;
        }

        if (trimmedName.length < 2) {
            setFormError('Category name must be at least 2 characters.');
            return;
        }

        setFormError(null);

        try {
            await createDoc(ASSET_CATEGORY_DOCTYPE, {
                asset_category: trimmedName,
            });

            toast({
                title: 'Category Created',
                description: `"${trimmedName}" has been added successfully.`,
                variant: 'success',
            });

            resetForm();
            onOpenChange(false);
            // Trigger explicit refetch via callback instead of broad SWR mutate
            onCategoryAdded?.();
        } catch (err) {
            console.error('Failed to create category:', err);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !isCreating && categoryName.trim()) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                        <Boxes className="h-6 w-6 text-gray-600" />
                    </div>
                    <DialogTitle className="text-center text-lg font-semibold">
                        Add Asset Category
                    </DialogTitle>
                    <DialogDescription className="text-center text-sm text-gray-500">
                        Create a new category to organize your assets.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    <Label htmlFor="newCategoryName" className="text-sm font-medium text-gray-700">
                        Category Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                        id="newCategoryName"
                        value={categoryName}
                        onChange={(e) => setCategoryName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="e.g., Laptops, Vehicles, Furniture"
                        className="mt-1.5"
                        autoFocus
                    />
                    {formError && (
                        <p className="mt-2 text-sm text-red-600">{formError}</p>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isCreating}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={isCreating || !categoryName.trim()}
                        className="gap-2"
                    >
                        {isCreating ? 'Creating...' : 'Create Category'}
                        <ListChecks className="h-4 w-4" />
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
