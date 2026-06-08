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
import { Boxes, ListChecks, Briefcase, Laptop } from 'lucide-react';

import {
    ASSET_CATEGORY_DOCTYPE,
    ASSET_CATEGORY_TYPE_OPTIONS,
    AssetCategoryType,
} from '../assets.constants';

interface AddAssetCategoryDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onCategoryAdded?: () => void;
}

const typeIconMap: Record<AssetCategoryType, React.ReactNode> = {
    Project: <Briefcase className="h-4 w-4" />,
    IT: <Laptop className="h-4 w-4" />,
};

export const AddAssetCategoryDialog: React.FC<AddAssetCategoryDialogProps> = ({
    isOpen,
    onOpenChange,
    onCategoryAdded,
}) => {
    const [categoryName, setCategoryName] = useState('');
    const [categoryType, setCategoryType] = useState<AssetCategoryType | ''>('');
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
        setCategoryType('');
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

        if (!categoryType) {
            setFormError('Please select a category type (Project or IT).');
            return;
        }

        setFormError(null);

        try {
            await createDoc(ASSET_CATEGORY_DOCTYPE, {
                asset_category: trimmedName,
                category_type: categoryType,
            });

            toast({
                title: 'Category Created',
                description: `"${trimmedName}" (${categoryType}) has been added successfully.`,
                variant: 'success',
            });

            resetForm();
            onOpenChange(false);
            onCategoryAdded?.();
        } catch (err) {
            console.error('Failed to create category:', err);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !isCreating && categoryName.trim() && categoryType) {
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

                <div className="space-y-4 py-4">
                    <div>
                        <Label htmlFor="newCategoryName" className="text-sm font-medium text-gray-700">
                            Category Name <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id="newCategoryName"
                            value={categoryName}
                            onChange={(e) => setCategoryName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="e.g., Laptops, Drill Machines, Ladders"
                            className="mt-1.5"
                            autoFocus
                        />
                    </div>

                    <div>
                        <Label className="text-sm font-medium text-gray-700">
                            Category Type <span className="text-red-500">*</span>
                        </Label>
                        <div className="mt-1.5 grid grid-cols-2 gap-2">
                            {ASSET_CATEGORY_TYPE_OPTIONS.map((opt) => {
                                const isSelected = categoryType === opt.value;
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setCategoryType(opt.value)}
                                        className={`
                                            inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium
                                            transition-colors
                                            ${isSelected
                                                ? opt.value === 'Project'
                                                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                                                    : 'border-purple-500 bg-purple-50 text-purple-700'
                                                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                            }
                                        `}
                                    >
                                        {typeIconMap[opt.value]}
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {formError && (
                        <p className="text-sm text-red-600">{formError}</p>
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
                        disabled={isCreating || !categoryName.trim() || !categoryType}
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
