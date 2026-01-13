import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Pencil, PlusCircle, Trash2, FileEdit, Package } from "lucide-react";
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
export interface DesignTrackerCategory {
  name: string; // Frappe ID
  category_name: string;
  work_package?: string; // Link to Work Packages
  creation?: string;
  modified?: string;
}

export interface DesignTrackerTask {
  name: string; // Frappe ID
  task_name: string;
  category_link: string; // Link to Design Tracker Category
  deadline_offset?: number;
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
  work_package_link: z.string().optional(),
});
type CategoryFormValues = z.infer<typeof categoryFormSchema>;

const taskFormSchema = z.object({
  task_name: z.string().min(1, "Task Name is required."),
  deadline_offset: z.coerce.number().min(0, "Offset must be positive").optional(),
});
type TaskFormValues = z.infer<typeof taskFormSchema>;


// =========================================================================
// Main Component: DesignPackagesMaster
// =========================================================================

export const DesignPackagesMaster: React.FC = () => {
  // 1. Fetch Categories
  const {
    data: categories,
    isLoading: catLoading,
    error: catError,
    mutate: mutateCategories
  } = useFrappeGetDocList<DesignTrackerCategory>(
    "Design Tracker Category",
    { fields: ["name", "category_name", "work_package"], limit: 0, orderBy: { field: "creation", order: "asc" } }
  );

  // 2. Fetch Tasks
  const {
    data: tasks,
    isLoading: taskLoading,
    error: taskError,
    mutate: mutateTasks
  } = useFrappeGetDocList<DesignTrackerTask>(
    "Design Tracker Tasks",
    { fields: ["name", "task_name", "category_link", "deadline_offset"], limit: 0, orderBy: { field: "creation", order: "asc" } }
  );

  // 3. Fetch Work Packages for dropdown
  const {
    data: workPackages,
    isLoading: wpLoading,
  } = useFrappeGetDocList<WorkPackage>(
    "Work Packages",
    { fields: ["name", "work_package_name"], limit: 0, orderBy: { field: "work_package_name", order: "asc" } }
  );

  if (catLoading || taskLoading || wpLoading) {
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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
                Design Packages
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Configure design categories and their default tasks
              </p>
            </div>
            <CreateCategoryDialog mutate={mutateCategories} workPackages={workPackages || []} />
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
            <h3 className="text-lg font-medium text-slate-900 mb-1">No Design Categories</h3>
            <p className="text-sm text-slate-500 mb-4">Create your first design category to get started.</p>
            <CreateCategoryDialog mutate={mutateCategories} workPackages={workPackages || []} />
          </div>
        ) : (
          <div className="space-y-4">
            {categories?.map((cat) => (
              <CategoryCard
                key={cat.name}
                category={cat}
                tasks={tasks?.filter(t => t.category_link === cat.name) || []}
                mutateCategories={mutateCategories}
                mutateTasks={mutateTasks}
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

// --- 1. Dialog: Create Category ---
interface CreateCategoryDialogProps {
  mutate: () => Promise<any>;
  workPackages: WorkPackage[];
}

const CreateCategoryDialog: React.FC<CreateCategoryDialogProps> = ({ mutate, workPackages }) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { category_name: "", work_package_link: "" },
  });

  const onSubmit = async (values: CategoryFormValues) => {
    try {
      await createDoc("Design Tracker Category", {
        category_name: values.category_name,
        work_package: values.work_package_link || null,
      });
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
        <Button size="sm" className="bg-slate-900 hover:bg-slate-800 text-white">
          <PlusCircle className="w-4 h-4 mr-1.5" />
          Add Design Package
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Create Design Category
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Define a new category for design deliverables.
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
                      placeholder="e.g., Architecture, Structural, MEP"
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
                    Work Package{" "}
                    <span className="text-slate-400 font-normal">(Optional)</span>
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
                {loading ? <TailSpin height={16} width={16} color="white" /> : "Create"}
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
  category: DesignTrackerCategory;
  mutate: () => Promise<any>;
  mutateTasks: () => Promise<any>;
  workPackages: WorkPackage[];
}

const EditCategoryDialog: React.FC<EditCategoryDialogProps> = ({ category, mutate, mutateTasks, workPackages }) => {
  const [open, setOpen] = useState(false);
  const { call: renameDoc, loading: renameLoading } = useFrappePostCall(
    'frappe.model.rename_doc.update_document_title'
  );
  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      category_name: category.category_name,
      work_package_link: category.work_package || "",
    },
  });

  // Reset form when dialog opens with current values
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
      // Handle rename if name changed
      if (nameChanged) {
        const payload = {
          doctype: "Design Tracker Category",
          docname: category.name,
          name: values.category_name,
          merge: 0,
          freeze: true,
          freeze_message: `Renaming Category "${category.category_name}"...`,
        };
        await renameDoc(payload);
      }

      // Handle work package update (after rename if name changed)
      if (packageChanged) {
        const docName = nameChanged ? values.category_name : category.name;
        await updateDoc("Design Tracker Category", docName, {
          work_package: values.work_package_link || null,
        });
      }

      toast({ title: "Success", description: "Category updated.", variant: "success" });
      await mutate();
      await mutateTasks();
      setOpen(false);
    } catch (error: any) {
      console.error("Failed to update category:", error);
      toast({ title: "Error", description: `Failed to update category: ${error.message || 'Unknown error'}`, variant: "destructive" });
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

// --- 3. Dialog: Create Task ---
interface CreateTaskDialogProps {
  categoryId: string;
  mutate: () => Promise<any>;
}

const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({ categoryId, mutate }) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: { task_name: "", deadline_offset: 0 },
  });

  const onSubmit = async (values: TaskFormValues) => {
    try {
      await createDoc("Design Tracker Tasks", {
        task_name: values.task_name,
        deadline_offset: values.deadline_offset,
        category_link: categoryId, // Linking to parent category
      });
      toast({ title: "Success", description: "Task added successfully.", variant: "success" });
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
            Define a default task for this design category.
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
                      placeholder="e.g., Concept Design, 3D Render"
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
                    <span className="text-slate-400 font-normal">(days)</span>
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
                {loading ? <TailSpin height={16} width={16} color="white" /> : "Create"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- 4. Dialog: Edit Task ---
interface EditTaskDialogProps {
  task: DesignTrackerTask;
  mutate: () => Promise<any>;
}

const EditTaskDialog: React.FC<EditTaskDialogProps> = ({ task, mutate }) => {
  const [open, setOpen] = useState(false);
  const { updateDoc, loading } = useFrappeUpdateDoc();
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: { task_name: task.task_name, deadline_offset: task.deadline_offset || 0 },
  });

  const onSubmit = async (values: TaskFormValues) => {
    try {
      await updateDoc("Design Tracker Tasks", task.name, {
        task_name: values.task_name,
        deadline_offset: values.deadline_offset
      });
      toast({ title: "Success", description: "Task updated.", variant: "success" });
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
                    <span className="text-slate-400 font-normal">(days)</span>
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
                {loading ? <TailSpin height={16} width={16} color="white" /> : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- 5. Dialog: Delete Task ---
interface DeleteTaskDialogProps {
  task: DesignTrackerTask;
  mutate: () => Promise<any>;
}

const DeleteTaskDialog: React.FC<DeleteTaskDialogProps> = ({ task, mutate }) => {
  const [open, setOpen] = useState(false);
  const { deleteDoc, loading } = useFrappeDeleteDoc();

  const handleDelete = async () => {
    try {
      await deleteDoc("Design Tracker Tasks", task.name);
      toast({ title: "Success", description: "Task deleted.", variant: "success" });
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
            Delete Task?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-slate-500">
            Are you sure you want to delete "<span className="font-semibold text-slate-700">{task.task_name}</span>"?
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

// --- 6. Card Component: Category Card ---
interface CategoryCardProps {
  category: DesignTrackerCategory;
  tasks: DesignTrackerTask[];
  mutateCategories: () => Promise<any>;
  mutateTasks: () => Promise<any>;
  workPackages: WorkPackage[];
}

const CategoryCard: React.FC<CategoryCardProps> = ({ category, tasks, mutateCategories, mutateTasks, workPackages }) => {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      {/* Card Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-slate-900 truncate">
                {category.category_name}
              </h3>
              {category.work_package && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium">
                  <Package className="w-3 h-3" />
                  {category.work_package}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <EditCategoryDialog
            category={category}
            mutate={mutateCategories}
            mutateTasks={mutateTasks}
            workPackages={workPackages}
          />
          <CreateTaskDialog categoryId={category.name} mutate={mutateTasks} />
        </div>
      </div>

      {/* Card Content */}
      <div className="border-t border-slate-100">
        {tasks.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-slate-500">
              No tasks defined. Add your first task above.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50 border-b border-slate-100">
                <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider">
                  Task
                </TableHead>
                <TableHead className="w-32 text-slate-500 font-medium text-xs uppercase tracking-wider">
                  Offset
                </TableHead>
                <TableHead className="w-24 text-right text-slate-500 font-medium text-xs uppercase tracking-wider">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow
                  key={task.name}
                  className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors"
                >
                  <TableCell className="font-medium text-slate-900">
                    {task.task_name}
                  </TableCell>
                  <TableCell>
                    {task.deadline_offset == 0 ? (
                      <span className="text-slate-400 text-sm">—</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-xs font-medium">
                        T + {task.deadline_offset}d
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <EditTaskDialog task={task} mutate={mutateTasks} />
                      <DeleteTaskDialog task={task} mutate={mutateTasks} />
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