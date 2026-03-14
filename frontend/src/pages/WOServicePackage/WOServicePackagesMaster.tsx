import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Pencil, PlusCircle, Trash2, FileEdit, Layers } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
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
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";

// --- Types ---
export interface WOServiceCategory {
    name: string;
    category_name: string;
    work_package?: string;
    creation?: string;
    modified?: string;
}

export interface WOServiceItem {
    name: string;
    item_name: string;
    category_link: string;
    unit?: string;
    rate?: number;
    creation?: string;
    modified?: string;
}

export interface WorkPackage {
    name: string;
    work_package_name: string;
}

// --- Zod Schemas ---
const categoryFormSchema = z.object({
    category_name: z.string().min(1, "Category Name is required."),
    work_package_link: z.string().min(1, "Work Package is required."),
});
type CategoryFormValues = z.infer<typeof categoryFormSchema>;

const itemFormSchema = z.object({
    item_name: z.string().min(1, "Item Name is required."),
    unit: z.string().min(1, "Unit is required."),
    rate: z.coerce.number({ invalid_type_error: "Rate is required" }).min(0, "Rate must be positive"),
});
type ItemFormValues = z.infer<typeof itemFormSchema>;

// =========================================================================
// Main Component: WOServicePackagesMaster
// =========================================================================

export const WOServicePackagesMaster: React.FC = () => {
    const {
        data: categories,
        isLoading: catLoading,
        error: catError,
        mutate: mutateCategories,
    } = useFrappeGetDocList<WOServiceCategory>(
        "WO Service Category",
        { fields: ["name", "category_name", "work_package"], limit: 0, orderBy: { field: "creation", order: "asc" } }
    );

    const {
        data: items,
        isLoading: itemLoading,
        error: itemError,
        mutate: mutateItems,
    } = useFrappeGetDocList<WOServiceItem>(
        "WO Service Item",
        { fields: ["name", "item_name", "category_link", "unit", "rate"], limit: 0, orderBy: { field: "creation", order: "asc" } }
    );

    const {
        data: workPackages,
        isLoading: wpLoading,
    } = useFrappeGetDocList<WorkPackage>(
        "Work Packages",
        { fields: ["name", "work_package_name"], limit: 0, orderBy: { field: "work_package_name", order: "asc" } }
    );

    if (catLoading || itemLoading || wpLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <TailSpin width={40} height={40} color="#dc2626" />
            </div>
        );
    }

    if (catError || itemError) {
        return (
            <div className="p-4 text-center text-red-600 border border-red-200 rounded-md bg-red-50">
                Error loading data: {catError?.message || itemError?.message}
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-5xl mx-auto px-6 py-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
                                Work Order Rate Card
                            </h1>
                            <p className="text-sm text-slate-500 mt-0.5">
                                Configure WO service categories and their items (with unit and rate)
                            </p>
                        </div>
                        <CreateCategoryDialog mutate={mutateCategories} workPackages={workPackages || []} />
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-6 py-8">
                {categories?.length === 0 ? (
                    <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mb-4">
                            <Layers className="w-6 h-6 text-slate-400" />
                        </div>
                        <h3 className="text-lg font-medium text-slate-900 mb-1">No WO Service Categories</h3>
                        <p className="text-sm text-slate-500 mb-4">Create your first category to get started.</p>
                        <CreateCategoryDialog mutate={mutateCategories} workPackages={workPackages || []} />
                    </div>
                ) : (
                    <div className="space-y-4">
                        {categories?.map((cat) => (
                            <CategoryCard
                                key={cat.name}
                                category={cat}
                                items={items?.filter((i) => i.category_link === cat.name) || []}
                                mutateCategories={mutateCategories}
                                mutateItems={mutateItems}
                                workPackages={workPackages || []}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// =========================================================================
// Sub-components
// =========================================================================

interface CreateCategoryDialogProps {
    mutate: () => Promise<any>;
}

const CreateCategoryDialog: React.FC<CreateCategoryDialogProps & { workPackages: WorkPackage[] }> = ({ mutate, workPackages }) => {
    const [open, setOpen] = useState(false);
    const { createDoc, loading } = useFrappeCreateDoc();

    const form = useForm<CategoryFormValues>({
        resolver: zodResolver(categoryFormSchema),
        defaultValues: { category_name: "", work_package_link: "" },
    });

    const onSubmit = async (values: CategoryFormValues) => {
        try {
            await createDoc("WO Service Category", {
                category_name: values.category_name,
                work_package: values.work_package_link || null,
            });
            toast({ title: "Success", description: "Category created successfully.", variant: "success" });
            form.reset({ category_name: "", work_package_link: "" });
            await mutate();
            setOpen(false);
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={(val) => {
            setOpen(val);
            if (!val) form.reset({ category_name: "", work_package_link: "" });
        }}>
            <DialogTrigger asChild>
                <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white">
                    <PlusCircle className="w-4 h-4 mr-1.5" />
                    Add Category
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-lg font-semibold text-slate-900">
                        Create WO Service Category
                    </DialogTitle>
                    <DialogDescription className="text-sm text-slate-500">
                        Define a new category for WO service items.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="category_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-medium text-slate-700">
                                        Category Name
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="e.g., Plumbing, Electrical, HVAC"
                                            className="border-slate-300 focus:border-slate-500 focus:ring-slate-500"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="work_package_link"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-medium text-slate-700">
                                        Work Package
                                    </FormLabel>
                                    <Select
                                        onValueChange={field.onChange}
                                        value={field.value || ""}
                                    >
                                        <FormControl>
                                            <SelectTrigger className="border-slate-300 focus:border-slate-500 focus:ring-slate-500">
                                                <SelectValue placeholder="Select a work package" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {workPackages.map((wp) => (
                                                <SelectItem key={wp.name} value={wp.name}>
                                                    {wp.work_package_name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <div className="flex justify-end gap-2 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => { setOpen(false); form.reset({ category_name: "", work_package_link: "" }); }}
                                className="text-slate-600"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="bg-slate-900 hover:bg-slate-800 text-white"
                            >
                                {loading ? <TailSpin height={16} width={16} color="white" /> : "Create"}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

interface EditCategoryDialogProps {
    category: WOServiceCategory;
    mutate: () => Promise<any>;
    mutateItems: () => Promise<any>;
}

const EditCategoryDialog: React.FC<EditCategoryDialogProps & { workPackages: WorkPackage[] }> = ({ category, mutate, mutateItems, workPackages }) => {
    const [open, setOpen] = useState(false);
    const { call: renameDoc, loading: renameLoading } = useFrappePostCall(
        "frappe.model.rename_doc.update_document_title"
    );
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

    const form = useForm<CategoryFormValues>({
        resolver: zodResolver(categoryFormSchema),
        defaultValues: {
            category_name: category.category_name,
            work_package_link: category.work_package || "",
        },
    });

    React.useEffect(() => {
        if (open) {
            form.reset({
                category_name: category.category_name,
                work_package_link: category.work_package || "",
            });
        }
    }, [open, category, form]);

    const onSubmit = async (values: CategoryFormValues) => {
        const nameChanged = values.category_name !== category.category_name;
        const packageChanged = (values.work_package_link || null) !== (category.work_package || null);

        if (!nameChanged && !packageChanged) {
            toast({ title: "Info", description: "No changes detected.", variant: "default" });
            setOpen(false);
            return;
        }
        try {
            if (nameChanged) {
                const payload = {
                    doctype: "WO Service Category",
                    docname: category.name,
                    name: values.category_name,
                    merge: 0,
                    freeze: true,
                    freeze_message: `Renaming Category "${category.category_name}"...`,
                };
                await renameDoc(payload);
            }

            if (packageChanged) {
                const docName = nameChanged ? values.category_name : category.name;
                await updateDoc("WO Service Category", docName, {
                    work_package: values.work_package_link || null,
                });
            }

            toast({ title: "Success", description: "Category updated.", variant: "success" });
            await mutate();
            await mutateItems();
            setOpen(false);
        } catch (error: any) {
            console.error("Failed to update category:", error);
            toast({ title: "Error", description: `Failed to update category: ${error.message || "Unknown error"}`, variant: "destructive" });
        }
    };

    const isLoading = renameLoading || updateLoading;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                    <FileEdit className="h-3.5 w-3.5" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-lg font-semibold text-slate-900">
                        Edit Category
                    </DialogTitle>
                    <DialogDescription className="text-sm text-slate-500">
                        Update the category name or change its linked work package.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="category_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-medium text-slate-700">
                                        Category Name
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            className="border-slate-300 focus:border-slate-500 focus:ring-slate-500"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="work_package_link"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-medium text-slate-700">
                                        Work Package
                                    </FormLabel>
                                    <Select
                                        onValueChange={field.onChange}
                                        value={field.value || ""}
                                    >
                                        <FormControl>
                                            <SelectTrigger className="border-slate-300 focus:border-slate-500 focus:ring-slate-500">
                                                <SelectValue placeholder="Select a work package" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {workPackages.map((wp) => (
                                                <SelectItem key={wp.name} value={wp.name}>
                                                    {wp.work_package_name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <div className="flex justify-end gap-2 pt-2">
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="text-slate-600">
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="bg-slate-900 hover:bg-slate-800 text-white"
                            >
                                {isLoading ? <TailSpin height={16} width={16} color="white" /> : "Save"}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

interface CreateItemDialogProps {
    categoryId: string;
    mutate: () => Promise<any>;
}

const CreateItemDialog: React.FC<CreateItemDialogProps> = ({ categoryId, mutate }) => {
    const [open, setOpen] = useState(false);
    const { createDoc, loading } = useFrappeCreateDoc();

    const form = useForm<ItemFormValues>({
        resolver: zodResolver(itemFormSchema),
        defaultValues: { item_name: "", unit: "", rate: undefined },
    });

    const onSubmit = async (values: ItemFormValues) => {
        try {
            await createDoc("WO Service Item", {
                item_name: values.item_name,
                category_link: categoryId,
                unit: values.unit || null,
                rate: values.rate,
            });
            toast({ title: "Success", description: "Item added successfully.", variant: "success" });
            form.reset({ item_name: "", unit: "", rate: undefined });
            await mutate();
            setOpen(false);
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={(val) => {
            setOpen(val);
            if (!val) form.reset({ item_name: "", unit: "", rate: undefined });
        }}>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-slate-600 hover:bg-slate-100"
                >
                    <PlusCircle className="w-3.5 h-3.5 mr-1" />
                    Add Item
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-lg font-semibold text-slate-900">
                        Add WO Service Item
                    </DialogTitle>
                    <DialogDescription className="text-sm text-slate-500">
                        Add an item with unit and rate for this category.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="item_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-medium text-slate-700">
                                        Item Name
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="e.g., Pipe Fitting, Cable Run"
                                            className="border-slate-300 focus:border-slate-500 focus:ring-slate-500"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="unit"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-medium text-slate-700">
                                        Unit
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="e.g., Nos, m, Sq.m"
                                            className="border-slate-300 focus:border-slate-500 focus:ring-slate-500"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="rate"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-medium text-slate-700">
                                        Rate
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            step="any"
                                            placeholder="0.00"
                                            className="border-slate-300 focus:border-slate-500 focus:ring-slate-500"
                                            {...field}
                                            value={field.value === undefined || field.value === null ? "" : field.value}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                field.onChange(v === "" ? undefined : (Number(v) || v));
                                            }}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <div className="flex justify-end gap-2 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => { setOpen(false); form.reset({ item_name: "", unit: "", rate: undefined }); }}
                                className="text-slate-600"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="bg-slate-900 hover:bg-slate-800 text-white"
                            >
                                {loading ? <TailSpin height={16} width={16} color="white" /> : "Create"}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

interface EditItemDialogProps {
    item: WOServiceItem;
    mutate: () => Promise<any>;
}

const EditItemDialog: React.FC<EditItemDialogProps> = ({ item, mutate }) => {
    const [open, setOpen] = useState(false);
    const { updateDoc, loading } = useFrappeUpdateDoc();
    const form = useForm<ItemFormValues>({
        resolver: zodResolver(itemFormSchema),
        defaultValues: {
            item_name: item.item_name,
            unit: item.unit || "",
            rate: item.rate ?? undefined,
        },
    });

    React.useEffect(() => {
        if (open) {
            form.reset({
                item_name: item.item_name,
                unit: item.unit || "",
                rate: item.rate ?? undefined,
            });
        }
    }, [open, item, form]);

    const onSubmit = async (values: ItemFormValues) => {
        try {
            await updateDoc("WO Service Item", item.name, {
                item_name: values.item_name,
                unit: values.unit || null,
                rate: values.rate,
            });
            toast({ title: "Success", description: "Item updated.", variant: "success" });
            await mutate();
            setOpen(false);
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                >
                    <Pencil className="h-3.5 w-3.5" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-lg font-semibold text-slate-900">
                        Edit Item
                    </DialogTitle>
                    <DialogDescription className="text-sm text-slate-500">
                        Update item name, unit, or rate.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="item_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-medium text-slate-700">Item Name</FormLabel>
                                    <FormControl>
                                        <Input className="border-slate-300 focus:border-slate-500 focus:ring-slate-500" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="unit"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-medium text-slate-700">Unit</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="e.g., Nos, m"
                                            className="border-slate-300 focus:border-slate-500 focus:ring-slate-500"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="rate"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-medium text-slate-700">Rate</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            step="any"
                                            className="border-slate-300 focus:border-slate-500 focus:ring-slate-500"
                                            {...field}
                                            value={field.value === undefined || field.value === null ? "" : field.value}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                field.onChange(v === "" ? undefined : (Number(v) || v));
                                            }}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <div className="flex justify-end gap-2 pt-2">
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="text-slate-600">
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="bg-slate-900 hover:bg-slate-800 text-white"
                            >
                                {loading ? <TailSpin height={16} width={16} color="white" /> : "Save"}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

interface DeleteItemDialogProps {
    item: WOServiceItem;
    mutate: () => Promise<any>;
}

const DeleteItemDialog: React.FC<DeleteItemDialogProps> = ({ item, mutate }) => {
    const [open, setOpen] = useState(false);
    const { deleteDoc, loading } = useFrappeDeleteDoc();

    const handleDelete = async () => {
        try {
            await deleteDoc("WO Service Item", item.name);
            toast({ title: "Success", description: "Item deleted.", variant: "success" });
            await mutate();
            setOpen(false);
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-lg font-semibold text-slate-900">
                        Delete Item?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-sm text-slate-500">
                        Are you sure you want to delete &quot;<span className="font-semibold text-slate-700">{item.item_name}</span>&quot;?
                        This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading} className="text-slate-600">
                        Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleDelete}
                        disabled={loading}
                        className="bg-red-600 hover:bg-red-700 text-white"
                    >
                        {loading ? <TailSpin height={16} width={16} color="white" /> : "Delete"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

interface CategoryCardProps {
    category: WOServiceCategory;
    items: WOServiceItem[];
    mutateCategories: () => Promise<any>;
    mutateItems: () => Promise<any>;
}

const CategoryCard: React.FC<CategoryCardProps & { workPackages: WorkPackage[] }> = ({ category, items, mutateCategories, mutateItems, workPackages }) => {
    const linkedWorkPackage = category.work_package
        ? workPackages.find((wp) => wp.name === category.work_package)
        : null;

    return (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-semibold text-slate-900 truncate">
                                {category.category_name}
                            </h3>
                            {category.work_package && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium">
                                    <Layers className="w-3 h-3" />
                                    {linkedWorkPackage?.work_package_name || category.work_package}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {items.length} item{items.length !== 1 ? "s" : ""}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <EditCategoryDialog
                        category={category}
                        mutate={mutateCategories}
                        mutateItems={mutateItems}
                        workPackages={workPackages}
                    />
                    <CreateItemDialog categoryId={category.name} mutate={mutateItems} />
                </div>
            </div>

            <div className="border-t border-slate-100">
                {items.length === 0 ? (
                    <div className="px-5 py-8 text-center">
                        <p className="text-sm text-slate-500">
                            No items defined. Add your first item above.
                        </p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-slate-50/50 border-b border-slate-100">
                                <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider">
                                    Item
                                </TableHead>
                                <TableHead className="w-24 text-slate-500 font-medium text-xs uppercase tracking-wider">
                                    Unit
                                </TableHead>
                                <TableHead className="w-28 text-slate-500 font-medium text-xs uppercase tracking-wider">
                                    Rate
                                </TableHead>

                                <TableHead className="w-24 text-right text-slate-500 font-medium text-xs uppercase tracking-wider">
                                    Actions
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((item) => (
                                <TableRow
                                    key={item.name}
                                    className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors"
                                >
                                    <TableCell className="font-medium text-slate-900">
                                        {item.item_name}
                                    </TableCell>
                                    <TableCell>
                                        {item.unit ? (
                                            <span className="text-slate-700 text-sm px-2">{item.unit}</span>
                                        ) : (
                                            <span className="text-slate-400 text-sm">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {item.rate != null && item.rate !== undefined ? (
                                            <span className="text-slate-700 text-sm px-2">{Number(item.rate).toLocaleString()}</span>
                                        ) : (
                                            <span className="text-slate-400 text-sm">—</span>
                                        )}
                                    </TableCell>

                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <EditItemDialog item={item} mutate={mutateItems} />
                                            <DeleteItemDialog item={item} mutate={mutateItems} />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>
        </div>
    );
};
