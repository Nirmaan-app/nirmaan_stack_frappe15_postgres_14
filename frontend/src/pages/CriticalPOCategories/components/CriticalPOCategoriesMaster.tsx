import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Pencil, PlusCircle, Trash2, FileEdit, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
export interface CriticalPOCategory {
  name: string; // Frappe ID
  category_name: string;
  creation?: string;
  modified?: string;
}

export interface CriticalPOItem {
  name: string; // Frappe ID
  item_name: string;
  sub_category?: string;
  critical_po_category: string; // Link to Critical PO Category
  release_timeline_offset?: number;
  creation?: string;
  modified?: string;
}

// --- Zod Schemas ---
const categoryFormSchema = z.object({
  category_name: z.string().min(1, "Category Name is required."),
});
type CategoryFormValues = z.infer<typeof categoryFormSchema>;

const itemFormSchema = z.object({
  item_name: z.string().min(1, "Item Name is required."),
  sub_category: z.string().optional(),
  release_timeline_offset: z.coerce.number().min(1, "Offset must be at least 1 day"),
});
type ItemFormValues = z.infer<typeof itemFormSchema>;


// =========================================================================
// Main Component: CriticalPOCategoriesMaster
// =========================================================================

export const CriticalPOCategoriesMaster: React.FC = () => {
  // 1. Fetch Categories
  const {
    data: categories,
    isLoading: catLoading,
    error: catError,
    mutate: mutateCategories
  } = useFrappeGetDocList<CriticalPOCategory>(
    "Critical PO Category",
    { fields: ["name", "category_name"], limit: 0, orderBy: { field: "creation", order: "asc" } }
  );

  // 2. Fetch Items
  const {
    data: items,
    isLoading: itemLoading,
    error: itemError,
    mutate: mutateItems
  } = useFrappeGetDocList<CriticalPOItem>(
    "Critical PO Items",
    { fields: ["name", "item_name", "sub_category", "critical_po_category", "release_timeline_offset"], limit: 0, orderBy: { field: "creation", order: "asc" } }
  );

  if (catLoading || itemLoading) {
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
    <div className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-800">Critical PO Categories</h2>
          <p className="text-sm text-gray-500">Manage critical PO categories and their initial template items.</p>
        </div>
        <CreateCategoryDialog mutate={mutateCategories} />
      </div>

      <Separator />

      <div className="space-y-6">
        {categories?.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-gray-500 mb-4">No Critical PO Categories found.</p>
            <CreateCategoryDialog mutate={mutateCategories} />
          </div>
        ) : (
          categories?.map((cat) => (
            <CategoryCard
              key={cat.name}
              category={cat}
              items={items?.filter(t => t.critical_po_category === cat.name) || []}
              mutateCategories={mutateCategories}
              mutateItems={mutateItems}
            />
          ))
        )}
      </div>
    </div>
  );
};


// =========================================================================
// Sub-components
// =========================================================================

// --- 1. Dialog: Create Category ---
interface CreateCategoryDialogProps {
  mutate: () => Promise<any>;
}

const CreateCategoryDialog: React.FC<CreateCategoryDialogProps> = ({ mutate }) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { category_name: "" },
  });

  const onSubmit = async (values: CategoryFormValues) => {
    try {
      await createDoc("Critical PO Category", { category_name: values.category_name });
      toast({ title: "Success", description: "Category created successfully.", variant: "success" });
      form.reset();
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-primary hover:bg-primary/90">
          <PlusCircle className="mr-2 h-4 w-4" /> Add New Critical PO Category
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Critical PO Category</DialogTitle>
          <DialogDescription>
            e.g., Structural, Electrical, HVAC, Plumbing
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="category_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Category Name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <TailSpin height={20} width={20} color="white" /> : "Create"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- 2. Dialog: Edit Category (Rename) ---
interface EditCategoryDialogProps {
  category: CriticalPOCategory;
  mutate: () => Promise<any>;
  mutateItems: () => Promise<any>;
}

const EditCategoryDialog: React.FC<EditCategoryDialogProps> = ({ category, mutate, mutateItems }) => {
  const [open, setOpen] = useState(false);
  const { call: renameDoc, loading: renameLoading } = useFrappePostCall(
    'frappe.model.rename_doc.update_document_title'
  );

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { category_name: category.category_name },
  });

  const onSubmit = async (values: CategoryFormValues) => {
    // Check if the name actually changed
    if (values.category_name === category.category_name) {
      toast({ title: "Info", description: "No changes detected.", variant: "default" });
      setOpen(false);
      return;
    }

    try {
      const payload = {
        doctype: "Critical PO Category",
        docname: category.name,
        name: values.category_name,
        merge: 0,
        freeze: true,
        freeze_message: `Renaming Category "${category.category_name}" and updating related records...`,
      };

      await renameDoc(payload);

      toast({ title: "Success", description: "Category updated.", variant: "success" });
      await mutate();
      await mutateItems();
      setOpen(false);
    } catch (error: any) {
      console.error("Failed to rename Critical PO Category:", error);
      toast({ title: "Error", description: `Failed to rename category: ${error.message || 'Unknown error'}`, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <FileEdit className="h-4 w-4 text-gray-500 hover:text-blue-600" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Category</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="category_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category Name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={renameLoading}>
                {renameLoading ? <TailSpin height={20} width={20} color="white" /> : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- 3. Dialog: Create Item ---
interface CreateItemDialogProps {
  categoryId: string;
  mutate: () => Promise<any>;
}

const CreateItemDialog: React.FC<CreateItemDialogProps> = ({ categoryId, mutate }) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: { item_name: "", sub_category: "", release_timeline_offset: undefined },
  });

  const onSubmit = async (values: ItemFormValues) => {
    try {
      await createDoc("Critical PO Items", {
        item_name: values.item_name,
        sub_category: values.sub_category,
        release_timeline_offset: values.release_timeline_offset,
        critical_po_category: categoryId,
      });
      toast({ title: "Success", description: "Item added successfully.", variant: "success" });
      form.reset();
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PlusCircle className="mr-2 h-3 w-3" /> Add New Item
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Critical PO Item</DialogTitle>
          <DialogDescription>Add a template item for this category.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="item_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Item Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Steel Beams, Electrical Panels" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sub_category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sub Category (Optional)</FormLabel>
                  <FormControl><Input placeholder="e.g. Grade A, Type 1" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="release_timeline_offset"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Release Timeline Offset (Days)</FormLabel>
                  <FormControl><Input type="number" placeholder="0" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <TailSpin height={20} width={20} color="white" /> : "Create"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- 4. Dialog: Edit Item ---
interface EditItemDialogProps {
  item: CriticalPOItem;
  mutate: () => Promise<any>;
}

const EditItemDialog: React.FC<EditItemDialogProps> = ({ item, mutate }) => {
  const [open, setOpen] = useState(false);
  const { updateDoc, loading } = useFrappeUpdateDoc();
  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: {
      item_name: item.item_name,
      sub_category: item.sub_category || "",
      release_timeline_offset: item.release_timeline_offset && item.release_timeline_offset >= 1
        ? item.release_timeline_offset
        : undefined
    },
  });

  const onSubmit = async (values: ItemFormValues) => {
    try {
      await updateDoc("Critical PO Items", item.name, {
        item_name: values.item_name,
        sub_category: values.sub_category,
        release_timeline_offset: values.release_timeline_offset
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
        <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Critical PO Item</DialogTitle>
        </DialogHeader>
        <Alert variant="destructive" className="bg-amber-50 border-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-sm">
            Changes will be applied to all existing Critical PO Tasks across projects.
            Modifying the release timeline offset will recalculate PO release deadlines.
          </AlertDescription>
        </Alert>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="item_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Item Name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sub_category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sub Category (Optional)</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="release_timeline_offset"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Release Timeline Offset (Days)</FormLabel>
                  <FormControl><Input type="number" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <TailSpin height={20} width={20} color="white" /> : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- 5. Dialog: Delete Item ---
interface DeleteItemDialogProps {
  item: CriticalPOItem;
  mutate: () => Promise<any>;
}

const DeleteItemDialog: React.FC<DeleteItemDialogProps> = ({ item, mutate }) => {
  const [open, setOpen] = useState(false);
  const { deleteDoc, loading } = useFrappeDeleteDoc();

  const handleDelete = async () => {
    try {
      await deleteDoc("Critical PO Items", item.name);
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
        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-800">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Item?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Are you sure you want to delete "<span className="font-semibold">{item.item_name}</span>"?
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-amber-800 text-sm">
                <div className="flex gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">This will affect all projects:</p>
                    <ul className="list-disc list-inside text-xs space-y-0.5">
                      <li>All linked POs will be unlinked from this task type</li>
                      <li>This entry will be removed from all existing Critical PO setups</li>
                    </ul>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500">This action cannot be undone.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={loading} className="bg-red-600 hover:bg-red-700">
            {loading ? <TailSpin height={20} width={20} color="white" /> : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

// --- 6. Card Component: Category Card ---
interface CategoryCardProps {
  category: CriticalPOCategory;
  items: CriticalPOItem[];
  mutateCategories: () => Promise<any>;
  mutateItems: () => Promise<any>;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ category, items, mutateCategories, mutateItems }) => {
  return (
    <Card className="hover:animate-shadow-drop-center transition-all duration-300">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2 text-gray-800">
          {category.category_name}
          <EditCategoryDialog category={category} mutate={mutateCategories} mutateItems={mutateItems} />
        </CardTitle>
        <CreateItemDialog categoryId={category.name} mutate={mutateItems} />
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-gray-400 text-sm italic">No items defined. Click "Add New Item" to start.</p>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-gray-100">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[40%] pl-4">Item Name</TableHead>
                <TableHead className="w-[20%] text-center">Sub Category</TableHead>
                <TableHead className="w-[20%] text-center">Release Timeline Offset (Days)</TableHead>
                <TableHead className="w-[20%] text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.name} className="group">
                  <TableCell className="pl-4 font-medium text-gray-700">{item.item_name}</TableCell>
                  <TableCell className="text-center text-gray-500">{item.sub_category || '-'}</TableCell>
                  <TableCell className="text-center text-gray-500">{item.release_timeline_offset == 0 ? '-' : `T + ${item.release_timeline_offset}`}</TableCell>
                  <TableCell className="text-right flex items-center justify-end space-x-2">
                    <EditItemDialog item={item} mutate={mutateItems} />
                    <DeleteItemDialog item={item} mutate={mutateItems} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
