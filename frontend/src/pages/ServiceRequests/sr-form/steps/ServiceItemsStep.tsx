import { useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { CirclePlus, Pencil, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { PLACEHOLDERS, VALIDATION_MESSAGES } from "../constants";

interface CategoryOption {
    value: string;
    label: string;
    image_url?: string;
}

interface StepProps {
    form: UseFormReturn<SRFormValues>;
    categories: CategoryOption[];
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
    isLoading,
}) => {
    const [selectedCategory, setSelectedCategory] = useState<string>("");
    const [currentItem, setCurrentItem] = useState({
        description: "",
        uom: "",
        quantity: 0,
    });
    const [editingItem, setEditingItem] = useState<ServiceItemType | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [deleteItemId, setDeleteItemId] = useState<string | null>(null);

    const items = form.watch("items") || [];

    // Add item to the list
    const handleAddItem = () => {
        if (!selectedCategory || !currentItem.description || !currentItem.uom || currentItem.quantity <= 0) {
            return;
        }

        const newItem = createServiceItem(
            selectedCategory,
            currentItem.description,
            currentItem.uom,
            currentItem.quantity
        );

        form.setValue("items", [...items, newItem], { shouldValidate: true });
        // Reset form but keep category for convenience when adding multiple items of same category
        setCurrentItem({ description: "", uom: "", quantity: 0 });
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
        form.setValue("items", updatedItems, { shouldValidate: true });
        setEditDialogOpen(false);
        setEditingItem(null);
    };

    // Delete item
    const handleDeleteItem = () => {
        if (!deleteItemId) return;

        const updatedItems = items.filter((item) => item.id !== deleteItemId);
        form.setValue("items", updatedItems, { shouldValidate: true });
        setDeleteItemId(null);
    };

    const isAddDisabled =
        !selectedCategory ||
        !currentItem.description ||
        !currentItem.uom ||
        currentItem.quantity <= 0;

    return (
        <div className="space-y-6">
            {/* Add Item Form - Always Visible */}
            <div className="border rounded-lg p-4 bg-gray-50/50 space-y-4">
                <Label className="text-sm font-semibold">Add Service Item</Label>

                {/* Row 1: Category + Unit */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <Label htmlFor="category" className="text-sm">
                            Category <span className="text-red-500">*</span>
                        </Label>
                        <Select
                            value={selectedCategory}
                            onValueChange={setSelectedCategory}
                            disabled={isLoading}
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
                        <Label htmlFor="uom" className="text-sm">
                            Unit <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id="uom"
                            type="text"
                            placeholder="e.g., Sq.ft, Nos, Job"
                            value={currentItem.uom}
                            onChange={(e) =>
                                setCurrentItem({ ...currentItem, uom: e.target.value })
                            }
                            className="mt-1"
                        />
                    </div>
                </div>

                {/* Row 2: Description (full width) */}
                <div>
                    <Label htmlFor="description" className="text-sm">
                        Service Description <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                        id="description"
                        placeholder={PLACEHOLDERS.description}
                        value={currentItem.description}
                        onChange={(e) =>
                            setCurrentItem({ ...currentItem, description: e.target.value })
                        }
                        className="mt-1 min-h-[80px]"
                    />
                </div>

                {/* Row 3: Quantity + Add Button */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <Label htmlFor="quantity" className="text-sm">
                            Quantity <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id="quantity"
                            type="number"
                            min={0}
                            step="any"
                            placeholder={PLACEHOLDERS.quantity}
                            value={currentItem.quantity || ""}
                            onChange={(e) =>
                                setCurrentItem({
                                    ...currentItem,
                                    quantity: parseFloat(e.target.value) || 0,
                                })
                            }
                            className="mt-1"
                            onKeyDown={(e) => {
                                if (e.key === "-" || e.key === "e") {
                                    e.preventDefault();
                                }
                            }}
                        />
                    </div>
                    <div className="flex items-end">
                        <Button
                            type="button"
                            onClick={handleAddItem}
                            disabled={isAddDisabled}
                            className="w-full md:w-auto"
                        >
                            <CirclePlus className="h-4 w-4 mr-1" />
                            Add Item
                        </Button>
                    </div>
                </div>
            </div>

            {/* Items Table */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Added Service Items</Label>
                    <span className="text-xs text-muted-foreground">
                        {items.length} item{items.length !== 1 ? "s" : ""}
                    </span>
                </div>

                {items.length > 0 ? (
                    <div className="border rounded-lg overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-gray-50">
                                    <TableHead className="w-[30%] text-xs">Category</TableHead>
                                    <TableHead className="w-[40%] text-xs">Description</TableHead>
                                    <TableHead className="w-[10%] text-xs text-center">Unit</TableHead>
                                    <TableHead className="w-[10%] text-xs text-center">Qty</TableHead>
                                    <TableHead className="w-[10%] text-xs text-center">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item, index) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="text-sm">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-muted-foreground">
                                                    {String(index + 1).padStart(2, "0")}
                                                </span>
                                                <span className="font-medium">{item.category}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            <span className="line-clamp-2">{item.description}</span>
                                        </TableCell>
                                        <TableCell className="text-sm text-center">{item.uom}</TableCell>
                                        <TableCell className="text-sm text-center">{item.quantity}</TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 w-7 p-0"
                                                    onClick={() => handleEditClick(item)}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                                                    onClick={() => setDeleteItemId(item.id)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <div className="border rounded-lg p-8 text-center bg-gray-50/50">
                        <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                            {VALIDATION_MESSAGES.itemsRequired}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Fill in the form above to add service items
                        </p>
                    </div>
                )}

                {/* Validation error from form */}
                {form.formState.errors.items && (
                    <p className="text-sm text-red-500 flex items-center gap-1">
                        <AlertCircle className="h-4 w-4" />
                        {form.formState.errors.items.message}
                    </p>
                )}
            </div>

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
