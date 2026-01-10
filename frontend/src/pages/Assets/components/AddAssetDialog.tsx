import React, { useState, useEffect, useMemo } from 'react';
import { useFrappeCreateDoc, useFrappeGetDocList } from 'frappe-react-sdk';
import ReactSelect from 'react-select';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Package, ChevronDown, Eye, EyeOff, Monitor, ListChecks } from 'lucide-react';

import {
    ASSET_MASTER_DOCTYPE,
    ASSET_CATEGORY_DOCTYPE,
    ASSET_CONDITION_OPTIONS,
} from '../assets.constants';

interface AddAssetDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onAssetAdded?: () => void;
}

export const AddAssetDialog: React.FC<AddAssetDialogProps> = ({
    isOpen,
    onOpenChange,
    onAssetAdded,
}) => {
    // Form state
    const [assetName, setAssetName] = useState('');
    const [assetDescription, setAssetDescription] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [assetCondition, setAssetCondition] = useState<string>('');
    const [serialNumber, setSerialNumber] = useState('');
    const [assetValue, setAssetValue] = useState<string>('');

    // IT Details state
    const [itDetailsOpen, setItDetailsOpen] = useState(false);
    const [assetEmail, setAssetEmail] = useState('');
    const [assetPassword, setAssetPassword] = useState('');
    const [assetPin, setAssetPin] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showPin, setShowPin] = useState(false);

    const [formError, setFormError] = useState<string | null>(null);

    const { toast } = useToast();
    const { createDoc, loading: isCreating, error: createError } = useFrappeCreateDoc();

    // Fetch categories
    const { data: categoryList, isLoading: categoriesLoading } = useFrappeGetDocList(
        ASSET_CATEGORY_DOCTYPE,
        {
            fields: ['name', 'asset_category'],
            orderBy: { field: 'asset_category', order: 'asc' },
            limit: 0,
        },
        'asset_categories_for_add_dialog'
    );

    const categoryOptions = useMemo(() =>
        categoryList?.map((cat: any) => ({
            value: cat.name,
            label: cat.asset_category,
        })) || [],
        [categoryList]
    );

    useEffect(() => {
        if (createError) {
            toast({
                title: 'Error Creating Asset',
                description: createError.message || 'An unknown error occurred.',
                variant: 'destructive',
            });
        }
    }, [createError, toast]);

    const resetForm = () => {
        setAssetName('');
        setAssetDescription('');
        setSelectedCategory('');
        setAssetCondition('');
        setSerialNumber('');
        setAssetValue('');
        setAssetEmail('');
        setAssetPassword('');
        setAssetPin('');
        setItDetailsOpen(false);
        setShowPassword(false);
        setShowPin(false);
        setFormError(null);
    };

    const handleDialogChange = (open: boolean) => {
        if (!open) resetForm();
        onOpenChange(open);
    };

    const handleSubmit = async () => {
        const trimmedName = assetName.trim();

        if (!trimmedName) {
            setFormError('Asset name is required.');
            return;
        }

        if (!selectedCategory) {
            setFormError('Please select a category.');
            return;
        }

        setFormError(null);

        try {
            await createDoc(ASSET_MASTER_DOCTYPE, {
                asset_name: trimmedName,
                asset_description: assetDescription.trim() || undefined,
                asset_category: selectedCategory,
                asset_condition: assetCondition || undefined,
                asset_serial_number: serialNumber.trim() || undefined,
                asset_value: assetValue ? parseFloat(assetValue) : undefined,
                asset_email: assetEmail.trim() || undefined,
                asset_email_password: assetPassword || undefined,
                asset_pin: assetPin || undefined,
            });

            toast({
                title: 'Asset Created',
                description: `"${trimmedName}" has been added successfully.`,
                variant: 'success',
            });

            resetForm();
            onOpenChange(false);
            // Trigger explicit refetch via callback instead of broad SWR mutate
            onAssetAdded?.();
        } catch (err) {
            console.error('Failed to create asset:', err);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogChange}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                        <Package className="h-6 w-6 text-emerald-600" />
                    </div>
                    <DialogTitle className="text-center text-lg font-semibold">
                        Add New Asset
                    </DialogTitle>
                    <DialogDescription className="text-center text-sm text-gray-500">
                        Register a new asset in the inventory.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Asset Name */}
                    <div className="space-y-1.5">
                        <Label htmlFor="assetName" className="text-sm font-medium text-gray-700">
                            Asset Name <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id="assetName"
                            value={assetName}
                            onChange={(e) => setAssetName(e.target.value)}
                            placeholder="e.g., MacBook Pro 14-inch"
                            autoFocus
                        />
                    </div>

                    {/* Category */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-gray-700">
                            Category <span className="text-red-500">*</span>
                        </Label>
                        <ReactSelect
                            options={categoryOptions}
                            value={categoryOptions.find(opt => opt.value === selectedCategory) || null}
                            onChange={(val) => setSelectedCategory(val?.value || '')}
                            placeholder={categoriesLoading ? 'Loading...' : 'Select category'}
                            isClearable
                            isDisabled={categoriesLoading}
                            classNames={{
                                control: () => 'border-gray-200 hover:border-gray-300',
                            }}
                        />
                    </div>

                    {/* Condition */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-gray-700">
                            Condition
                        </Label>
                        <Select value={assetCondition} onValueChange={setAssetCondition}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select condition" />
                            </SelectTrigger>
                            <SelectContent>
                                {ASSET_CONDITION_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Serial Number */}
                    <div className="space-y-1.5">
                        <Label htmlFor="serialNumber" className="text-sm font-medium text-gray-700">
                            Serial Number
                        </Label>
                        <Input
                            id="serialNumber"
                            value={serialNumber}
                            onChange={(e) => setSerialNumber(e.target.value)}
                            placeholder="e.g., SN-2024-001234"
                            className="font-mono"
                        />
                    </div>

                    {/* Asset Value */}
                    <div className="space-y-1.5">
                        <Label htmlFor="assetValue" className="text-sm font-medium text-gray-700">
                            Purchase Value (₹)
                        </Label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                            <Input
                                id="assetValue"
                                type="number"
                                min="0"
                                step="0.01"
                                value={assetValue}
                                onChange={(e) => setAssetValue(e.target.value)}
                                placeholder="0.00"
                                className="pl-7 tabular-nums"
                            />
                        </div>
                    </div>

                    {/* Description */}
                    <div className="space-y-1.5">
                        <Label htmlFor="assetDescription" className="text-sm font-medium text-gray-700">
                            Description
                        </Label>
                        <Textarea
                            id="assetDescription"
                            value={assetDescription}
                            onChange={(e) => setAssetDescription(e.target.value)}
                            placeholder="Additional details about this asset..."
                            rows={2}
                            className="resize-none"
                        />
                    </div>

                    {/* IT Asset Details - Collapsible */}
                    <Collapsible open={itDetailsOpen} onOpenChange={setItDetailsOpen}>
                        <CollapsibleTrigger asChild>
                            <Button
                                variant="ghost"
                                className="w-full justify-between px-3 py-2 h-auto text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 border border-dashed border-gray-200 rounded-lg"
                            >
                                <span className="flex items-center gap-2">
                                    <Monitor className="h-4 w-4" />
                                    IT Asset Details
                                </span>
                                <ChevronDown
                                    className={`h-4 w-4 transition-transform duration-200 ${itDetailsOpen ? 'rotate-180' : ''}`}
                                />
                            </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-3 space-y-4">
                            <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 space-y-4">
                                {/* Asset Email */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="assetEmail" className="text-sm font-medium text-gray-700">
                                        Associated Email
                                    </Label>
                                    <Input
                                        id="assetEmail"
                                        type="email"
                                        value={assetEmail}
                                        onChange={(e) => setAssetEmail(e.target.value)}
                                        placeholder="asset@company.com"
                                    />
                                </div>

                                {/* Asset Password */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="assetPassword" className="text-sm font-medium text-gray-700">
                                        Email Password
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            id="assetPassword"
                                            type={showPassword ? 'text' : 'password'}
                                            value={assetPassword}
                                            onChange={(e) => setAssetPassword(e.target.value)}
                                            placeholder="••••••••"
                                            className="pr-10"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                                            onClick={() => setShowPassword(!showPassword)}
                                        >
                                            {showPassword ? (
                                                <EyeOff className="h-4 w-4 text-gray-400" />
                                            ) : (
                                                <Eye className="h-4 w-4 text-gray-400" />
                                            )}
                                        </Button>
                                    </div>
                                </div>

                                {/* Asset PIN */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="assetPin" className="text-sm font-medium text-gray-700">
                                        Device PIN
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            id="assetPin"
                                            type={showPin ? 'text' : 'password'}
                                            value={assetPin}
                                            onChange={(e) => setAssetPin(e.target.value)}
                                            placeholder="••••"
                                            className="pr-10 font-mono"
                                            maxLength={10}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                                            onClick={() => setShowPin(!showPin)}
                                        >
                                            {showPin ? (
                                                <EyeOff className="h-4 w-4 text-gray-400" />
                                            ) : (
                                                <Eye className="h-4 w-4 text-gray-400" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CollapsibleContent>
                    </Collapsible>

                    {formError && (
                        <p className="text-sm text-red-600 text-center">{formError}</p>
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
                        disabled={isCreating || !assetName.trim() || !selectedCategory}
                        className="gap-2"
                    >
                        {isCreating ? 'Creating...' : 'Create Asset'}
                        <ListChecks className="h-4 w-4" />
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
