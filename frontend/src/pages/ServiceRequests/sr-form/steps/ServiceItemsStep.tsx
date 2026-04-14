import React, { useState, useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import { toast } from "@/components/ui/use-toast";
import { CirclePlus, Pencil, Trash2, AlertCircle, Search, Layers, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SRFormValues, ServiceItemType, createServiceItem } from "../schema";
import { WOServiceItem } from "../hooks/useSRFormData";
import { PLACEHOLDERS, VALIDATION_MESSAGES } from "../constants";
import formatToIndianRupee from "@/utils/FormatPrice";

interface CategoryOption {
    value: string;
    label: string;
    image_url?: string;
}

interface StepProps {
    form: UseFormReturn<SRFormValues>;
    categories: CategoryOption[];
    serviceItems: WOServiceItem[];
    isLoading?: boolean;
}

/**
 * ServiceItemsStep - Step 1 of SR Wizard
 *
 * Allows user to:
 * - Add service items with category, description, unit, and quantity
 * - Edit/delete items from the list
 * - Category is selected via dropdown (no grid selection)
 */
export const ServiceItemsStep: React.FC<StepProps> = ({
    form,
    categories,
    serviceItems,
    isLoading,
}) => {
    const [selectedCategory, setSelectedCategory] = useState<string>("");
    const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
    const [isCustomDialogOpen, setIsCustomDialogOpen] = useState(false);
    const [currentItem, setCurrentItem] = useState({
        category: "",
        description: "",
        uom: "",
        quantity: 0,
        rate: 0,
    });
    const [editingItem, setEditingItem] = useState<ServiceItemType | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [deleteItemId, setDeleteItemId] = useState<string | null>(null);

    const items = form.watch("items") || [];

    // Filter service items for the selected category
    const filteredStandardItems = useMemo(() => {
        if (!selectedCategory || !serviceItems) return [];
        // Get descriptions of items already added to avoid duplicates
        const addedDescriptions = new Set(items.map((i) => i.description));
        return serviceItems.filter(
            (item) => item.category_link === selectedCategory && !addedDescriptions.has(item.item_name)
        );
    }, [selectedCategory, serviceItems, items]);

    // Handle standard item checkbox change
    const handleCheckboxChange = (itemId: string) => {
        const newChecked = new Set(checkedItems);
        if (newChecked.has(itemId)) {
            newChecked.delete(itemId);
        } else {
            newChecked.add(itemId);
        }
        setCheckedItems(newChecked);
    };

    // Memoize grouped errors for precise reporting
    const groupedErrors = useMemo(() => {
        if (form.formState.submitCount === 0 || !form.formState.errors.items || !Array.isArray(form.formState.errors.items)) {
            return null;
        }

        const groups: Record<string, Array<{ name: string; errs: string[] }>> = {};
        const itms = form.getValues("items") || [];

        (form.formState.errors.items as any[]).forEach((err, index) => {
            if (!err) return;
            const item = itms[index];
            if (!item) return;

            const itemErrors: string[] = [];
            if (err.quantity) itemErrors.push("Quantity");
            if (err.rate) itemErrors.push("Rate");

            if (itemErrors.length > 0) {
                if (!groups[item.category]) {
                    groups[item.category] = [];
                }
                groups[item.category].push({
                    name: item.description.split('\n')[0],
                    errs: itemErrors
                });
            }
        });

        return Object.keys(groups).length > 0 ? groups : null;
    }, [form.formState.errors.items, form.formState.submitCount]);

    // Group all selected items for the table display
    const groupedItemsByPackage = useMemo(() => {
        const groups: Record<string, Array<{ originalIndex: number; data: typeof items[0] }>> = {};
        items.forEach((item, index) => {
            if (!groups[item.category]) {
                groups[item.category] = [];
            }
            groups[item.category].push({ originalIndex: index, data: item });
        });
        return groups;
    }, [items]);

    // Add selected standard items
    const handleAddStandardItems = () => {
        const selectedDocs = serviceItems.filter((item) => checkedItems.has(item.name));

        const newItems = selectedDocs.map((doc) =>
            createServiceItem(
                selectedCategory,
                doc.item_name,
                doc.unit || "",
                0, // Qty 0 by default
                undefined, // Rate empty by default as requested
                doc.rate || 0 // standard_rate for reference
            )
        );

        form.setValue("items", [...items, ...newItems]); // Removed shouldValidate: true
        setCheckedItems(new Set()); // Reset selection
        setSelectedCategory(""); // Reset category as requested
        toast({
            title: "Items Added",
            description: `Added ${newItems.length} standard items to the list.`,
        });
    };

    // Add manual custom item
    const handleAddCustomItem = () => {
        const categoryToUse = currentItem.category || selectedCategory;

        if (!categoryToUse || !currentItem.description || !currentItem.uom || currentItem.quantity <= 0 || currentItem.rate <= 0) {
            return;
        }

        const newItem = createServiceItem(
            categoryToUse,
            currentItem.description,
            currentItem.uom,
            currentItem.quantity,
            currentItem.rate,
            0  // Standard rate 0 for custom
        );

        form.setValue("items", [...items, newItem]);
        setCurrentItem({ category: "", description: "", uom: "", quantity: 0, rate: 0 });
        setSelectedCategory(""); // Reset main category
        setIsCustomDialogOpen(false);
    };

    // Open edit dialog
    const handleEditClick = (item: ServiceItemType) => {
        setEditingItem({ ...item });
        setEditDialogOpen(true);
    };

    // Save edited item
    const handleSaveEdit = () => {
        if (!editingItem) return;

        const updatedItems = items.map((item) =>
            item.id === editingItem.id ? editingItem : item
        );
        form.setValue("items", updatedItems);
        setEditDialogOpen(false);
        setEditingItem(null);
    };

    // Delete item
    const handleDeleteItem = () => {
        if (!deleteItemId) return;

        const updatedItems = items.filter((item) => item.id !== deleteItemId);
        form.setValue("items", updatedItems);
        setDeleteItemId(null);
    };

    // Update specific field of an item
    const updateItemField = (index: number, field: keyof ServiceItemType, value: any) => {
        const updatedItems = [...items];
        updatedItems[index] = { ...updatedItems[index], [field]: value };
        form.setValue("items", updatedItems);
    };

    return (
        <div className="space-y-6">
            {/* Category Selection */}
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-end justify-between border-b pb-6">
                <div className="w-full md:w-1/2 space-y-2">
                    <Label htmlFor="category" className="text-sm font-semibold flex items-center gap-2">
                        <Layers className="h-4 w-4 text-primary" />
                        Select Package <span className="text-red-500">*</span>
                    </Label>
                    <Select
                        value={selectedCategory}
                        onValueChange={(val) => {
                            setSelectedCategory(val);
                            // Default to select all items for the new category
                            const addedDescriptions = new Set(items.map((i) => i.description));
                            const itemsToSelect = serviceItems
                                ?.filter((item) => item.category_link === val && !addedDescriptions.has(item.item_name))
                                .map((item) => item.name) || [];
                            setCheckedItems(new Set(itemsToSelect));
                        }}
                        disabled={isLoading}
                    >
                        <SelectTrigger id="category" className="h-10 bg-white shadow-sm border-slate-200">
                            <SelectValue placeholder="Select package" />
                        </SelectTrigger>
                        <SelectContent>
                            {categories?.map((cat) => (
                                <SelectItem key={cat.value} value={cat.value}>
                                    {cat.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            setIsCustomDialogOpen(true);
                        }}
                        className="h-10 bg-white border-primary/20 hover:bg-primary/5 text-primary gap-2"
                    >
                        <CirclePlus className="h-4 w-4" />
                        Add Custom Service
                    </Button>
                </div>
            </div>

            {/* Standard Items Selection Area */}
            {selectedCategory && (
                <div className="space-y-3 animate-in fade-in duration-300">
                    <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium flex items-center gap-2">
                            <ListChecks className="h-4 w-4 text-primary" />
                            Revision Items From Package
                        </Label>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 px-2 py-1 bg-slate-100 rounded border border-slate-200">
                                <Checkbox
                                    id="select-all"
                                    checked={checkedItems.size === filteredStandardItems.length && filteredStandardItems.length > 0}
                                    onCheckedChange={(checked) => {
                                        if (checked) {
                                            setCheckedItems(new Set(filteredStandardItems.map(i => i.name)));
                                        } else {
                                            setCheckedItems(new Set());
                                        }
                                    }}
                                />
                                <Label htmlFor="select-all" className="text-[10px] font-bold text-slate-500 cursor-pointer uppercase">
                                    {checkedItems.size === filteredStandardItems.length ? "Deselect All" : "Select All"}
                                </Label>
                            </div>
                            <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground uppercase tracking-wider">
                                {checkedItems.size} Selected / {filteredStandardItems.length} Items Available
                            </Badge>
                        </div>
                    </div>

                    {filteredStandardItems.length > 0 ? (
                        <Card className="border-slate-200 shadow-none bg-slate-50/50">
                            <CardContent className="p-0">
                                <ScrollArea className="h-[240px] px-4 py-2">
                                    <div className="space-y-1">
                                        {filteredStandardItems.map((item) => (
                                            <div
                                                key={item.name}
                                                className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer group ${checkedItems.has(item.name)
                                                        ? "bg-primary/5 border-primary/20 shadow-sm"
                                                        : "bg-white border-transparent hover:border-slate-200"
                                                    }`}
                                                onClick={() => handleCheckboxChange(item.name)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <Checkbox
                                                        checked={checkedItems.has(item.name)}
                                                        onCheckedChange={() => handleCheckboxChange(item.name)}
                                                        id={`item-${item.name}`}
                                                        className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                                    />
                                                    <div className="space-y-0.5">
                                                        <Label
                                                            htmlFor={`item-${item.name}`}
                                                            className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors"
                                                        >
                                                            {item.item_name}
                                                        </Label>
                                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                            <span className="flex items-center gap-1">
                                                                <span className="text-[10px] opacity-70">UNIT:</span> {item.unit || "--"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-sm font-semibold text-slate-900">
                                                        {item.rate ? formatToIndianRupee(item.rate) : "N/A"}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-tighter">Std Rate</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                                <div className="p-3 bg-white border-t rounded-b-lg flex justify-end">
                                    <Button
                                        size="sm"
                                        disabled={checkedItems.size === 0}
                                        onClick={handleAddStandardItems}
                                        className="gap-2 shadow-sm"
                                    >
                                        <CirclePlus className="h-4 w-4" />
                                        Add Selected Items ({checkedItems.size})
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="border border-dashed rounded-lg p-12 text-center bg-white">
                            <Search className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                            <p className="text-sm text-slate-400">No standard items found in this category.</p>
                            <p className="text-xs text-slate-400 mt-1">Use "Add Custom Service" for non-standard items.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Items Table Section */}
            <div className="space-y-3 pt-4">
                <div className="flex items-center justify-between border-b pb-2">
                    <Label className="text-sm font-semibold flex items-center gap-2">
                        <ListChecks className="h-4 w-4 text-primary" />
                        Selected Service Items
                    </Label>
                    <span className="text-xs font-medium bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                        {items.length} item{items.length !== 1 ? "s" : ""}
                    </span>
                </div>

                {items.length > 0 ? (
                    <div className="border rounded-xl overflow-hidden shadow-sm bg-white border-slate-200">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50/80 border-b border-slate-100 uppercase tracking-tighter">
                                    <TableHead className="w-[45%] text-[10px] font-bold tracking-wider text-slate-500 py-3 px-4">Service Item & Specs</TableHead>
                                    <TableHead className="w-[10%] text-[10px] font-bold tracking-wider text-slate-500 text-center py-3">Unit</TableHead>
                                    <TableHead className="w-[10%] text-[10px] font-bold tracking-wider text-slate-500 text-center py-3">Qty</TableHead>
                                    <TableHead className="w-[12%] text-[10px] font-bold tracking-wider text-slate-500 text-center py-3">Std Rate</TableHead>
                                    <TableHead className="w-[15%] text-[10px] font-bold tracking-wider text-slate-500 text-center py-3">Rate</TableHead>
                                    <TableHead className="w-[8%] text-[10px] font-bold tracking-wider text-slate-500 text-center py-3 px-4">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {Object.entries(groupedItemsByPackage).map(([pkg, pkgItems]) => (
                                    <React.Fragment key={pkg}>
                                        {/* Package Separator Row - Only shown if more than one package exists or it's a multi-package view */}
                                        {Object.keys(groupedItemsByPackage).length > 1 && (
                                            <TableRow className="bg-slate-50/50 border-y border-slate-100/50">
                                                <TableCell colSpan={6} className="py-2 px-4 shadow-sm">
                                                    <div className="flex items-center gap-2">
                                                        <div className="bg-primary/10 text-primary p-1 rounded shadow-sm">
                                                            <Layers className="h-3.5 w-3.5" />
                                                        </div>
                                                        <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-widest">
                                                            Package: {pkg}
                                                        </span>
                                                        <Badge variant="secondary" className="text-[9px] font-medium text-slate-400 py-0 h-4 bg-slate-100/50 hover:bg-slate-100 shadow-none">
                                                            {pkgItems.length} {pkgItems.length === 1 ? "Item" : "Items"}
                                                        </Badge>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}

                                        {/* Item Rows */}
                                        {pkgItems.map(({ originalIndex: index, data: item }, pkgIdx) => (
                                            <TableRow key={item.id} className="hover:bg-slate-50/30 border-b border-slate-50 last:border-0 last:bg-transparent group/row">
                                                <TableCell className="text-sm py-2.5 px-4 transition-colors">
                                                    <div className="flex flex-col gap-0.5 ml-1">
                                                        <span className="font-semibold text-slate-900 leading-tight transition-colors">
                                                            {item.description.split('\n')[0]}
                                                        </span>
                                                        {item.description.includes('\n') && (
                                                            <span className="text-xs text-slate-500 line-clamp-2 leading-relaxed italic opacity-80">
                                                                {item.description.split('\n').slice(1).join('\n')}
                                                            </span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm text-center py-2.5">
                                                    <Badge variant="outline" className="text-[11px] text-slate-500 font-normal border-slate-200 bg-white/50">
                                                        {item.uom}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-sm p-1 py-2.5 text-center">
                                                    <div className="max-w-[70px] mx-auto">
                                                        <Input
                                                            type="number"
                                                            value={item.quantity || ""}
                                                            onChange={(e) => updateItemField(index, "quantity", parseFloat(e.target.value) || 0)}
                                                            className={`h-9 text-center text-xs bg-white transition-all shadow-none ${form.formState.submitCount > 0 && (form.formState.errors.items as any)?.[index]?.quantity
                                                                    ? "border-red-500 ring-1 ring-red-500/10"
                                                                    : "border-slate-200 focus:border-primary/50 focus:ring-1 focus:ring-primary/10"
                                                                }`}
                                                            placeholder="0"
                                                            step="any"
                                                        />
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm text-center py-2.5">
                                                    <span className="text-[11px] font-semibold text-slate-500 bg-slate-50/80 px-2 py-1.5 rounded border border-slate-100">
                                                        {item.standard_rate !== undefined && item.standard_rate !== null
                                                            ? formatToIndianRupee(item.standard_rate)
                                                            : "N/A"}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-sm p-1 py-2.5">
                                                    <div className="relative group/rate max-w-[100px] mx-auto">
                                                        <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-medium tracking-tighter ${form.formState.submitCount > 0 && (form.formState.errors.items as any)?.[index]?.rate ? "text-red-400" : "text-slate-400"
                                                            }`}>₹</span>
                                                        <Input
                                                            type="number"
                                                            value={item.rate || ""}
                                                            onChange={(e) => updateItemField(index, "rate", parseFloat(e.target.value) || 0)}
                                                            className={`h-9 pl-5 text-center text-xs bg-white font-semibold transition-all shadow-none ${form.formState.submitCount > 0 && (form.formState.errors.items as any)?.[index]?.rate
                                                                    ? "border-red-500 ring-1 ring-red-500/10"
                                                                    : "border-slate-200 focus:border-primary/50 focus:ring-1 focus:ring-primary/10"
                                                                }`}
                                                            placeholder="0.00"
                                                            step="any"
                                                        />
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center py-2.5 px-4">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 w-8 p-0 hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors"
                                                            onClick={() => handleEditClick(item)}
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                            onClick={() => setDeleteItemId(item.id)}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </React.Fragment>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <div className="border border-dashed rounded-xl p-12 text-center bg-slate-50/50">
                        <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                        <p className="text-sm font-medium text-slate-500">
                            {VALIDATION_MESSAGES.itemsRequired}
                        </p>
                        <p className="text-xs text-slate-400 mt-2 max-w-[200px] mx-auto">
                            Pick a category above to select standard items or add a custom service.
                        </p>
                    </div>
                )}

                {/* Detailed Validation Summary (Grouped by Package) */}
                {groupedErrors && (
                    <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                            <div className="space-y-3 w-full">
                                <div>
                                    <p className="text-sm font-bold text-red-800">Required fields missing in the following items:</p>
                                    <p className="text-[10px] text-red-600/80 font-medium">Please enter the negotiated rates and quantities for each highlighted row.</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {Object.entries(groupedErrors).map(([pkg, errItems]) => (
                                        <div key={pkg} className="bg-white/50 border border-red-100 rounded p-2 space-y-1.5">
                                            <div className="flex items-center gap-1.5 border-b border-red-100 pb-1 mb-1">
                                                <Layers className="h-3 w-3 text-red-400" />
                                                <span className="text-[10px] font-bold text-red-900 uppercase tracking-tight">{pkg}</span>
                                            </div>
                                            <ul className="space-y-1">
                                                {errItems.map((item, idx) => (
                                                    <li key={idx} className="flex items-start justify-between gap-2 text-[11px]">
                                                        <span className="text-red-700 font-medium line-clamp-1 flex-1">• {item.name}</span>
                                                        <div className="flex gap-1 shrink-0">
                                                            {item.errs.map(type => (
                                                                <span key={type} className="bg-red-100 text-[9px] text-red-600 px-1 rounded font-bold uppercase">
                                                                    {type}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Custom Item Dialog */}
            <Dialog open={isCustomDialogOpen} onOpenChange={setIsCustomDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <CirclePlus className="h-5 w-5 text-primary" />
                            Add Custom Service
                        </DialogTitle>
                        <DialogDescription>
                            Enter details for a service not found in the Rate Card.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="item-category" className="text-sm font-semibold flex items-center gap-2">
                                <Layers className="h-4 w-4 text-primary" />
                                Select Package <span className="text-red-500">*</span>
                            </Label>
                            <Select
                                value={currentItem.category}
                                onValueChange={(val) => setCurrentItem(prev => ({ ...prev, category: val }))}
                            >
                                <SelectTrigger id="item-category" className="h-10 bg-white shadow-sm border-slate-200">
                                    <SelectValue placeholder="Select package" />
                                </SelectTrigger>
                                <SelectContent>
                                    {categories?.map((cat) => (
                                        <SelectItem key={cat.value} value={cat.value}>
                                            {cat.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div>
                            <Label htmlFor="uom" className="text-sm font-medium">
                                Unit of Measure <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="uom"
                                type="text"
                                placeholder="e.g., Sq.ft, Nos, Job"
                                value={currentItem.uom}
                                onChange={(e) => setCurrentItem({ ...currentItem, uom: e.target.value })}
                                className="h-10 border-slate-200"
                            />
                        </div>

                        <div>
                            <Label htmlFor="description" className="text-sm font-medium">
                                Service Description <span className="text-red-500">*</span>
                            </Label>
                            <Textarea
                                id="description"
                                placeholder="Describe the service required..."
                                value={currentItem.description}
                                onChange={(e) => setCurrentItem({ ...currentItem, description: e.target.value })}
                                className="min-h-[100px] border-slate-200 resize-none"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="quantity" className="text-sm font-medium">
                                    Estimated Quantity <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="quantity"
                                    type="number"
                                    placeholder="Enter quantity"
                                    value={currentItem.quantity || ""}
                                    onChange={(e) => setCurrentItem({ ...currentItem, quantity: parseFloat(e.target.value) || 0 })}
                                    className="h-10 border-slate-200"
                                    step="any"
                                    onKeyDown={(e) => {
                                        if (e.key === "e") {
                                            e.preventDefault();
                                        }
                                    }}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="rate" className="text-sm font-medium">
                                    Rate <span className="text-red-500">*</span>
                                </Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                                    <Input
                                        id="rate"
                                        type="number"
                                        placeholder="0.00"
                                        value={currentItem.rate || ""}
                                        onChange={(e) => setCurrentItem({ ...currentItem, rate: parseFloat(e.target.value) || 0 })}
                                        className="h-10 pl-7 border-slate-200 font-semibold"
                                        step="any"
                                        onKeyDown={(e) => {
                                            if (e.key === "e") {
                                                e.preventDefault();
                                            }
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCustomDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleAddCustomItem}
                            disabled={!currentItem.description || !currentItem.uom || currentItem.quantity === 0 || currentItem.rate === 0}
                        >
                            Add to List
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Dialog */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Edit Service Item</DialogTitle>
                        <DialogDescription>
                            Modify the service item details below
                        </DialogDescription>
                    </DialogHeader>

                    {editingItem && (
                        <div className="space-y-4 py-4">
                            {/* Category selector */}
                            <div>
                                <Label htmlFor="edit-category">Category</Label>
                                <Select
                                    value={editingItem.category}
                                    onValueChange={(value) =>
                                        setEditingItem({ ...editingItem, category: value })
                                    }
                                >
                                    <SelectTrigger className="mt-1">
                                        <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories?.map((cat) => (
                                            <SelectItem key={cat.value} value={cat.value}>
                                                {cat.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="edit-description">Service Description</Label>
                                <Textarea
                                    id="edit-description"
                                    value={editingItem.description}
                                    onChange={(e) =>
                                        setEditingItem({ ...editingItem, description: e.target.value })
                                    }
                                    className="mt-1"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="edit-uom">Unit</Label>
                                    <Input
                                        id="edit-uom"
                                        type="text"
                                        placeholder="e.g., Sq.ft, Nos, Job"
                                        value={editingItem.uom}
                                        onChange={(e) =>
                                            setEditingItem({ ...editingItem, uom: e.target.value })
                                        }
                                        className="mt-1"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="edit-quantity">Quantity</Label>
                                    <Input
                                        id="edit-quantity"
                                        type="number"
                                        min={0}
                                        step="any"
                                        value={editingItem.quantity}
                                        onChange={(e) =>
                                            setEditingItem({
                                                ...editingItem,
                                                quantity: parseFloat(e.target.value) || 0,
                                            })
                                        }
                                        className="mt-1"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveEdit}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={!!deleteItemId} onOpenChange={() => setDeleteItemId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Item?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to remove this service item? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteItem}
                            className="bg-red-500 hover:bg-red-600"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ServiceItemsStep;
