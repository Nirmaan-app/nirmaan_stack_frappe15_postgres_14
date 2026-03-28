import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Pencil, PlusCircle, Trash2, FileEdit, Package } from "lucide-react";
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
}

interface PMOTaskMaster {
  name: string;
  task_name: string;
  category_link: string;
}

// --- Zod Schemas ---
const categoryFormSchema = z.object({
  category_name: z.string().min(1, "Category Name is required."),
});
type CategoryFormValues = z.infer<typeof categoryFormSchema>;

const taskFormSchema = z.object({
  task_name: z.string().min(1, "Task Name is required."),
});
type TaskFormValues = z.infer<typeof taskFormSchema>;

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
    fields: ["name", "category_name"],
    limit: 0,
    orderBy: { field: "creation", order: "asc" },
  });

  const {
    data: tasks,
    isLoading: taskLoading,
    error: taskError,
    mutate: mutateTasks,
  } = useFrappeGetDocList<PMOTaskMaster>("PMO Task Master", {
    fields: ["name", "task_name", "category_link"],
    limit: 0,
    orderBy: { field: "creation", order: "asc" },
  });

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
            <CreateCategoryDialog mutate={mutateCategories} />
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
            <CreateCategoryDialog mutate={mutateCategories} />
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
const CreateCategoryDialog: React.FC<{ mutate: () => Promise<any> }> = ({
  mutate,
}) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { category_name: "" },
  });

  const onSubmit = async (values: CategoryFormValues) => {
    try {
      await createDoc("PMO Task Category", {
        category_name: values.category_name,
      });
      toast({
        title: "Success",
        description: "Category created successfully.",
        variant: "success",
      });
      form.reset();
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

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { category_name: category.category_name },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ category_name: category.category_name });
    }
  }, [open, category]);

  const onSubmit = async (values: CategoryFormValues) => {
    if (values.category_name === category.category_name) {
      toast({
        title: "Info",
        description: "No changes detected.",
        variant: "default",
      });
      setOpen(false);
      return;
    }

    try {
      await renameDoc({
        doctype: "PMO Task Category",
        docname: category.name,
        name: values.category_name,
        merge: 0,
        freeze: true,
        freeze_message: `Renaming Category "${category.category_name}"...`,
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
}> = ({ categoryId, mutate }) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: { task_name: "" },
  });

  const onSubmit = async (values: TaskFormValues) => {
    try {
      await createDoc("PMO Task Master", {
        task_name: values.task_name,
        category_link: categoryId,
      });
      toast({
        title: "Success",
        description: "Task added successfully.",
        variant: "success",
      });
      form.reset();
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
    defaultValues: { task_name: task.task_name },
  });

  const onSubmit = async (values: TaskFormValues) => {
    try {
      await updateDoc("PMO Task Master", task.name, {
        task_name: values.task_name,
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
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      {/* Card Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900 truncate">
              {category.category_name}
            </h3>
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
          />
          <CreateTaskDialog categoryId={category.name} mutate={mutateTasks} />
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
                <TableHead className="text-xs font-medium text-slate-500 uppercase">
                  Task Name
                </TableHead>
                <TableHead className="w-[100px] text-right text-xs font-medium text-slate-500 uppercase">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.name} className="hover:bg-slate-50/50">
                  <TableCell className="text-sm text-slate-700 font-medium">
                    {task.task_name}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-0.5">
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
