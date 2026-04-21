import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Pencil, PlusCircle, Trash2, FileEdit, Package, GripVertical, ArrowLeft, Save } from "lucide-react";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useFrappeCreateDoc,
  useFrappeDeleteDoc,
  useFrappeGetDocList,
  useFrappePostCall,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";

// --- Types ---
interface PMOTaskCategory {
  name: string;
  category_name: string;
  order?: number;
  is_handover_restricted?: 0 | 1;
}

interface PMOTaskMaster {
  name: string;
  task_name: string;
  category_link: string;
  order?: number;
  deadline_offset?: number;
}

// --- Zod Schemas ---
const categoryFormSchema = z.object({
  category_name: z.string().min(1, "Category Name is required."),
  is_handover_restricted: z.boolean().default(false),
});
type CategoryFormValues = z.infer<typeof categoryFormSchema>;

const taskFormSchema = z.object({
  task_name: z.string().min(1, "Task Name is required."),
  deadline_offset: z.coerce.number().min(0, "Offset must be positive").optional(),
});
type TaskFormValues = z.infer<typeof taskFormSchema>;

const isHandoverCategory = (categoryName?: string) =>
  (categoryName || "").trim().toLowerCase() === "handover";

// =========================================================================
// Main Component
// =========================================================================
export const PMOPackagesMaster: React.FC = () => {
  const {
    data: categories,
    isLoading: catLoading,
    error: catError,
    mutate: mutateCategories,
  } = useFrappeGetDocList<PMOTaskCategory>("PMO Task Category", {
    fields: ["name", "category_name", "order", "is_handover_restricted"],
    limit: 0,
    orderBy: { field: "`order`", order: "asc" },
  });

  const {
    data: tasks,
    isLoading: taskLoading,
    error: taskError,
    mutate: mutateTasks,
  } = useFrappeGetDocList<PMOTaskMaster>("PMO Task Master", {
    fields: ["name", "task_name", "category_link", "order", "deadline_offset"],
    limit: 0,
    orderBy: { field: "`order`", order: "asc" },
  });

  // Reordering state
  const [isReordering, setIsReordering] = useState(false);
  const [reorderedList, setReorderedList] = useState<PMOTaskCategory[]>([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  // Drag refs
  const dragItem = React.useRef<number | null>(null);
  const dragOverItem = React.useRef<number | null>(null);

  const { updateDoc } = useFrappeUpdateDoc();

  // Initialize reordered list
  React.useEffect(() => {
    if (categories) {
      const sorted = [...categories].sort(
        (a, b) => (a.order || 9999) - (b.order || 9999)
      );
      setReorderedList(sorted);
    }
  }, [categories]);

  // Max order calculation
  const maxOrder = React.useMemo(() => {
    if (!categories || categories.length === 0) return 0;
    return Math.max(...categories.map((c) => c.order || 0));
  }, [categories]);

  // Drag handlers
  const handleDragStart = (
    e: React.DragEvent<HTMLTableRowElement>,
    position: number
  ) => {
    dragItem.current = position;
  };

  const handleDragEnter = (
    e: React.DragEvent<HTMLTableRowElement>,
    position: number
  ) => {
    dragOverItem.current = position;
  };

  const handleDragEnd = () => {
    if (dragItem.current !== null && dragOverItem.current !== null) {
      const copyListItems = [...reorderedList];
      const dragItemContent = copyListItems[dragItem.current];
      copyListItems.splice(dragItem.current, 1);
      copyListItems.splice(dragOverItem.current, 0, dragItemContent);
      dragItem.current = null;
      dragOverItem.current = null;
      setReorderedList(copyListItems);
    }
  };

  const handleSaveOrder = async () => {
    setIsSavingOrder(true);
    try {
      const updatePromises = reorderedList.map((cat, index) => {
        const newOrder = index + 1;
        if (cat.order !== newOrder) {
          return updateDoc("PMO Task Category", cat.name, { order: newOrder });
        }
        return Promise.resolve();
      });

      await Promise.all(updatePromises);
      toast({
        title: "Order Updated",
        description: "PMO Packages have been reordered successfully.",
        variant: "success",
      });
      await mutateCategories();
      setIsReordering(false);
    } catch (error: any) {
      console.error("Order Save Error", error);
      toast({
        title: "Error",
        description: "Failed to save order.",
        variant: "destructive",
      });
    } finally {
      setIsSavingOrder(false);
    }
  };

  if (catLoading || taskLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <TailSpin width={40} height={40} color="#dc2626" />
      </div>
    );
  }

  if (catError || taskError) {
    return (
      <div className="p-4 text-center text-red-600 border border-red-200 rounded-md bg-red-50">
        Error loading data: {catError?.message || taskError?.message}
      </div>
    );
  }

  // Reordering view
  if (isReordering) {
    return (
      <div className="min-h-screen bg-slate-50">
        {/* Header */}
        <div className="bg-white border-b border-slate-200">
          <div className="max-w-5xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsReordering(false)}
                  className="text-slate-600 hover:text-slate-900 -ml-2"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <div className="h-6 w-px bg-slate-200" />
                <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
                  Reorder PMO Packages
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (categories) {
                      setReorderedList(
                        [...categories].sort(
                          (a, b) => (a.order || 9999) - (b.order || 9999)
                        )
                      );
                    }
                    setIsReordering(false);
                  }}
                  disabled={isSavingOrder}
                  className="text-slate-600"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveOrder}
                  disabled={isSavingOrder}
                  className="bg-slate-900 hover:bg-slate-800 text-white"
                >
                  {isSavingOrder ? (
                    <TailSpin height={14} width={14} color="white" />
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-1.5" />
                      Save Order
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 border-b border-slate-200">
                  <TableHead className="w-16 text-center text-slate-500 font-medium text-xs uppercase tracking-wider">
                    #
                  </TableHead>
                  <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider">
                    Package Name
                  </TableHead>
                  <TableHead className="w-20 text-center text-slate-500 font-medium text-xs uppercase tracking-wider">
                    Drag
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reorderedList.map((cat, index) => (
                  <TableRow
                    key={cat.name}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragEnter={(e) => handleDragEnter(e, index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => e.preventDefault()}
                    className="cursor-move hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
                  >
                    <TableCell className="text-center">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-100 text-slate-600 text-xs font-medium">
                        {index + 1}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">
                      {cat.category_name}
                    </TableCell>
                    <TableCell className="text-center">
                      <GripVertical className="w-4 h-4 text-slate-400 mx-auto" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-sm text-slate-500 text-center mt-6">
            Drag rows to reorder. Changes are saved when you click "Save Order".
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
                PMO Packages
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Configure PMO task categories and their default tasks
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsReordering(true)}
                className="text-slate-600 border-slate-300"
              >
                <GripVertical className="w-4 h-4 mr-1.5" />
                Reorder Packages
              </Button>
              <CreateCategoryDialog mutate={mutateCategories} maxOrder={maxOrder} />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {categories?.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mb-4">
              <Package className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-1">
              No PMO Categories
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Create your first PMO category to get started.
            </p>
            <CreateCategoryDialog mutate={mutateCategories} maxOrder={0} />
          </div>
        ) : (
          <div className="space-y-4">
            {categories?.map((cat) => (
              <CategoryCard
                key={cat.name}
                category={cat}
                tasks={
                  tasks?.filter((t) => t.category_link === cat.name) || []
                }
                mutateCategories={mutateCategories}
                mutateTasks={mutateTasks}
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

// --- Create Category Dialog ---
const CreateCategoryDialog: React.FC<{
  mutate: () => Promise<any>;
  maxOrder: number;
}> = ({ mutate, maxOrder }) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { category_name: "", is_handover_restricted: false },
  });

  const onSubmit = async (values: CategoryFormValues) => {
    const trimmedName = values.category_name.trim();
    const forceHandoverRestricted = trimmedName.toLowerCase() === "handover";

    try {
      await createDoc("PMO Task Category", {
        category_name: trimmedName,
        order: maxOrder + 1,
        is_handover_restricted: forceHandoverRestricted || values.is_handover_restricted ? 1 : 0,
      });
      toast({
        title: "Success",
        description: "Category created successfully.",
        variant: "success",
      });
      form.reset({ category_name: "", is_handover_restricted: false });
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) form.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white">
          <PlusCircle className="w-4 h-4 mr-1.5" />
          Add PMO Package
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Create PMO Category
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Define a new category for PMO task tracking.
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
                      placeholder="e.g., Communication, Material Planning"
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
              name="is_handover_restricted"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-slate-200 p-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm font-medium text-slate-700">
                      Show only in Handover/Completed
                    </FormLabel>
                    <p className="text-xs text-slate-500">
                      Restricts this category to projects in Handover or Completed status.
                    </p>
                  </div>
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  form.reset({ category_name: "", is_handover_restricted: false });
                }}
                className="text-slate-600"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-slate-900 hover:bg-slate-800 text-white"
              >
                {loading ? (
                  <TailSpin height={16} width={16} color="white" />
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- Edit Category Dialog ---
const EditCategoryDialog: React.FC<{
  category: PMOTaskCategory;
  mutate: () => Promise<any>;
  mutateTasks: () => Promise<any>;
}> = ({ category, mutate, mutateTasks }) => {
  const [open, setOpen] = useState(false);
  const { call: renameDoc, loading } = useFrappePostCall(
    "frappe.model.rename_doc.update_document_title"
  );
  const { updateDoc } = useFrappeUpdateDoc();

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      category_name: category.category_name,
      is_handover_restricted: Boolean(category.is_handover_restricted),
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        category_name: category.category_name,
        is_handover_restricted: Boolean(category.is_handover_restricted),
      });
    }
  }, [open, category]);

  const onSubmit = async (values: CategoryFormValues) => {
    const trimmedName = values.category_name.trim();
    const nextRestriction = values.is_handover_restricted;

    const noNameChange = trimmedName === category.category_name;
    const noRestrictionChange =
      Boolean(category.is_handover_restricted) === nextRestriction;

    if (noNameChange && noRestrictionChange) {
      toast({
        title: "Info",
        description: "No changes detected.",
        variant: "default",
      });
      setOpen(false);
      return;
    }

    try {
      if (!noNameChange) {
        await renameDoc({
          doctype: "PMO Task Category",
          docname: category.name,
          name: trimmedName,
          merge: 0,
          freeze: true,
          freeze_message: `Renaming Category "${category.category_name}"...`,
        });
      }

      await updateDoc("PMO Task Category", trimmedName || category.name, {
        is_handover_restricted: nextRestriction ? 1 : 0,
      });
      toast({
        title: "Success",
        description: "Category updated.",
        variant: "success",
      });
      await mutate();
      await mutateTasks();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

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
              name="is_handover_restricted"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-slate-200 p-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm font-medium text-slate-700">
                      Show only in Handover/Completed
                    </FormLabel>
                    <p className="text-xs text-slate-500">
                      Restricts this category to projects in Handover or Completed status.
                    </p>
                  </div>
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                className="text-slate-600"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-slate-900 hover:bg-slate-800 text-white"
              >
                {loading ? (
                  <TailSpin height={16} width={16} color="white" />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- Create Task Dialog ---
const CreateTaskDialog: React.FC<{
  categoryId: string;
  mutate: () => Promise<any>;
  maxOrder: number;
}> = ({ categoryId, mutate, maxOrder }) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: { task_name: "", deadline_offset: 0 },
  });

  const onSubmit = async (values: TaskFormValues) => {
    try {
      await createDoc("PMO Task Master", {
        task_name: values.task_name,
        category_link: categoryId,
        order: maxOrder + 1,
        deadline_offset: values.deadline_offset || 0,
      });
      toast({
        title: "Success",
        description: "Task added successfully.",
        variant: "success",
      });
      form.reset({ task_name: "", deadline_offset: 0 });
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) form.reset({ task_name: "", deadline_offset: 0 });
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-slate-600 hover:bg-slate-100"
        >
          <PlusCircle className="w-3.5 h-3.5 mr-1" />
          Add Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Add New Task
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Define a default task for this PMO category.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="task_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Task Name
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Welcome Email, Material Schedule"
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
              name="deadline_offset"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Deadline Offset{" "}
                    <span className="text-slate-400 font-normal">(days from project creation)</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="0"
                      className="border-slate-300 focus:border-slate-500 focus:ring-slate-500"
                      {...field}
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
                onClick={() => {
                  setOpen(false);
                  form.reset();
                }}
                className="text-slate-600"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-slate-900 hover:bg-slate-800 text-white"
              >
                {loading ? (
                  <TailSpin height={16} width={16} color="white" />
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- Edit Task Dialog ---
const EditTaskDialog: React.FC<{
  task: PMOTaskMaster;
  mutate: () => Promise<any>;
}> = ({ task, mutate }) => {
  const [open, setOpen] = useState(false);
  const { updateDoc, loading } = useFrappeUpdateDoc();
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: { task_name: task.task_name, deadline_offset: task.deadline_offset || 0 },
  });

  const onSubmit = async (values: TaskFormValues) => {
    try {
      await updateDoc("PMO Task Master", task.name, {
        task_name: values.task_name,
        deadline_offset: values.deadline_offset || 0,
      });
      toast({
        title: "Success",
        description: "Task updated.",
        variant: "success",
      });
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
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
            Edit Task
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="task_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Task Name
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
              name="deadline_offset"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Deadline Offset{" "}
                    <span className="text-slate-400 font-normal">(days from project creation)</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      className="border-slate-300 focus:border-slate-500 focus:ring-slate-500"
                      {...field}
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
                onClick={() => setOpen(false)}
                className="text-slate-600"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-slate-900 hover:bg-slate-800 text-white"
              >
                {loading ? (
                  <TailSpin height={16} width={16} color="white" />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- Delete Task Dialog ---
const DeleteTaskDialog: React.FC<{
  task: PMOTaskMaster;
  mutate: () => Promise<any>;
}> = ({ task, mutate }) => {
  const [open, setOpen] = useState(false);
  const { deleteDoc, loading } = useFrappeDeleteDoc();

  const handleDelete = async () => {
    try {
      await deleteDoc("PMO Task Master", task.name);
      toast({
        title: "Success",
        description: "Task deleted.",
        variant: "success",
      });
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
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
            Delete Task?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-slate-500">
            Are you sure you want to delete "
            <span className="font-semibold text-slate-700">
              {task.task_name}
            </span>
            "? This action cannot be undone.
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
            {loading ? (
              <TailSpin height={16} width={16} color="white" />
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

// --- Category Card ---
const CategoryCard: React.FC<{
  category: PMOTaskCategory;
  tasks: PMOTaskMaster[];
  mutateCategories: () => Promise<any>;
  mutateTasks: () => Promise<any>;
}> = ({ category, tasks, mutateCategories, mutateTasks }) => {
  const [isReorderingTasks, setIsReorderingTasks] = useState(false);
  const [taskOrderList, setTaskOrderList] = useState<PMOTaskMaster[]>([]);
  const [isSavingTaskOrder, setIsSavingTaskOrder] = useState(false);

  const dragItem = React.useRef<number | null>(null);
  const dragOverItem = React.useRef<number | null>(null);

  const { updateDoc } = useFrappeUpdateDoc();

  // Initialize task order list
  React.useEffect(() => {
    const sorted = [...tasks].sort(
      (a, b) => (a.order || 9999) - (b.order || 9999)
    );
    setTaskOrderList(sorted);
  }, [tasks]);

  const maxTaskOrder = React.useMemo(() => {
    if (!tasks || tasks.length === 0) return 0;
    return Math.max(...tasks.map((t) => t.order || 0));
  }, [tasks]);

  // Drag handlers for tasks
  const handleDragStartTask = (
    e: React.DragEvent<HTMLTableRowElement>,
    position: number
  ) => {
    dragItem.current = position;
  };

  const handleDragEnterTask = (
    e: React.DragEvent<HTMLTableRowElement>,
    position: number
  ) => {
    dragOverItem.current = position;
  };

  const handleDragEndTask = () => {
    if (dragItem.current !== null && dragOverItem.current !== null) {
      const copyListItems = [...taskOrderList];
      const dragItemContent = copyListItems[dragItem.current];
      copyListItems.splice(dragItem.current, 1);
      copyListItems.splice(dragOverItem.current, 0, dragItemContent);
      dragItem.current = null;
      dragOverItem.current = null;
      setTaskOrderList(copyListItems);
    }
  };

  const saveTaskOrder = async () => {
    setIsSavingTaskOrder(true);
    try {
      const updatePromises = taskOrderList.map((t, index) => {
        const newOrder = index + 1;
        if (t.order !== newOrder) {
          return updateDoc("PMO Task Master", t.name, { order: newOrder });
        }
        return Promise.resolve();
      });

      await Promise.all(updatePromises);
      toast({
        title: "Success",
        description: "Task order updated.",
        variant: "success",
      });
      await mutateTasks();
      setIsReorderingTasks(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to save task order.",
        variant: "destructive",
      });
    } finally {
      setIsSavingTaskOrder(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      {/* Card Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900 truncate">
                {category.category_name}
              </h3>
              {Boolean(category.is_handover_restricted) && (
                <span className="inline-flex items-center rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-100">
                  Handover Only
                </span>
              )}
              <EditCategoryDialog
                category={category}
                mutate={mutateCategories}
                mutateTasks={mutateTasks}
              />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isReorderingTasks ? (
            <div className="flex items-center gap-1 border border-slate-200 rounded-md overflow-hidden bg-white">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTaskOrderList([...tasks].sort((a,b) => (a.order || 9999) - (b.order || 9999)));
                  setIsReorderingTasks(false);
                }}
                disabled={isSavingTaskOrder}
                className="h-7 text-[10px] px-2 rounded-none border-r border-slate-100"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={saveTaskOrder}
                disabled={isSavingTaskOrder}
                className="h-7 text-[10px] px-2 rounded-none bg-slate-900 text-white"
              >
                {isSavingTaskOrder ? <TailSpin height={10} width={10} color="white" /> : "Save"}
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsReorderingTasks(true)}
                disabled={tasks.length <= 1}
                className="h-7 text-xs text-slate-600 hover:bg-slate-100"
              >
                <GripVertical className="w-3.5 h-3.5 mr-1" />
                Reorder
              </Button>
              <CreateTaskDialog categoryId={category.name} mutate={mutateTasks} maxOrder={maxTaskOrder} />
            </>
          )}
        </div>
      </div>

      {/* Card Content */}
      <div className="border-t border-slate-100">
        {tasks.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-slate-500">
              No tasks yet. Click "Add Task" to add one.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50">
                <TableHead className="w-12 text-center text-xs font-medium text-slate-500 uppercase">
                  #
                </TableHead>
                <TableHead className="text-xs font-medium text-slate-500 uppercase">
                  Task Name
                </TableHead>
                <TableHead className="w-32 text-xs font-medium text-slate-500 uppercase">
                  Offset
                </TableHead>
                <TableHead className="w-[100px] text-right text-xs font-medium text-slate-500 uppercase">
                  {isReorderingTasks ? "Drag" : "Actions"}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(isReorderingTasks ? taskOrderList : tasks).map((task, idx) => (
                <TableRow 
                  key={task.name} 
                  draggable={isReorderingTasks}
                  onDragStart={(e) => isReorderingTasks && handleDragStartTask(e, idx)}
                  onDragEnter={(e) => isReorderingTasks && handleDragEnterTask(e, idx)}
                  onDragEnd={isReorderingTasks ? handleDragEndTask : undefined}
                  onDragOver={(e) => isReorderingTasks && e.preventDefault()}
                  className={`hover:bg-slate-50/50 ${isReorderingTasks ? 'cursor-move bg-slate-50/30' : ''}`}
                >
                  <TableCell className="text-center text-[10px] text-slate-400 font-bold">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="text-sm text-slate-700 font-medium">
                    {task.task_name}
                  </TableCell>
                  <TableCell>
                    {!task.deadline_offset || task.deadline_offset === 0 ? (
                      <span className="text-slate-400 text-sm">—</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-xs font-medium">
                        T + {task.deadline_offset}d
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isReorderingTasks ? (
                       <GripVertical className="w-4 h-4 text-slate-300 ml-auto" />
                    ) : (
                      <div className="flex items-center justify-end gap-0.5">
                        <EditTaskDialog task={task} mutate={mutateTasks} />
                        <DeleteTaskDialog task={task} mutate={mutateTasks} />
                      </div>
                    )}
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
