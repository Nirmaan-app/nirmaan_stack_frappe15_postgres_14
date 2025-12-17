import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Pencil, PlusCircle, Trash2, FileEdit } from "lucide-react";
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
export interface DesignTrackerCategory {
    name: string; // Frappe ID
    category_name: string;
    creation?: string;
    modified?: string;
}

export interface DesignTrackerTask {
    name: string; // Frappe ID
    task_name: string;
    category_link: string; // Link to Design Tracker Category
    creation?: string;
    modified?: string;
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
    { fields: ["name", "category_name"], limit: 0, orderBy: { field: "creation", order: "asc" } }
  );

  // 2. Fetch Tasks
  const { 
    data: tasks, 
    isLoading: taskLoading, 
    error: taskError, 
    mutate: mutateTasks 
  } = useFrappeGetDocList<DesignTrackerTask>(
    "Design Tracker Tasks",
    { fields: ["name", "task_name", "category_link"], limit: 0, orderBy: { field: "creation", order: "asc" } }
  );

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
    <div className="flex-1 space-y-6 p-4 md:p-6 bg-white rounded-lg shadow-sm border">
      <div className="flex justify-between items-center mb-6">
        <div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-800">Design Category & Tasks</h2>
            <p className="text-sm text-gray-500">Manage master categories and their default tasks.</p>
        </div>
        <CreateCategoryDialog mutate={mutateCategories} />
      </div>

      <Separator />

      <div className="space-y-6">
        {categories?.length === 0 ? (
          <div className="text-center py-10">
              <p className="text-gray-500 mb-4">No Design Categories found.</p>
              <CreateCategoryDialog mutate={mutateCategories} />
          </div>
        ) : (
          categories?.map((cat) => (
            <CategoryCard
              key={cat.name}
              category={cat}
              tasks={tasks?.filter(t => t.category_link === cat.name) || []}
              mutateCategories={mutateCategories}
              mutateTasks={mutateTasks}
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
      await createDoc("Design Tracker Category", { category_name: values.category_name });
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
          <PlusCircle className="mr-2 h-4 w-4" /> Add New Category
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Design Category</DialogTitle>
          <DialogDescription>
            e.g., Architecture, Structural, MEP, Landscape
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
  category: DesignTrackerCategory;
  mutate: () => Promise<any>;
  mutateTasks: () => Promise<any>;
}

const EditCategoryDialog: React.FC<EditCategoryDialogProps> = ({ category, mutate, mutateTasks }) => {
  const [open, setOpen] = useState(false);
  // Using updateDoc to change the field 'category_name'
 const { call: renameDoc, loading: renameLoading } = useFrappePostCall( // <-- Using useFrappePostCall
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
          doctype: "Design Tracker Category", // The DocType to rename
          docname: category.name,      // The old Frappe 'name' (ID)
          name: values.category_name, // The new Frappe 'name' (ID) and title
          merge: 0,                  // Do not merge with an existing document
          // enqueue: true,            // Removing enqueue makes it synchronous
          freeze: true,              // Freeze UI during rename on Frappe's side
          freeze_message: `Renaming Category "${category.category_name}" and updating related records...`,
        };
  
        await renameDoc(payload); // <-- Calling the rename API
     
  
         toast({ title: "Success", description: "Category updated.", variant: "success" });
      await mutate();
      await mutateTasks(); // Refetch tasks in case logic depends on it
        setOpen(false);
      } catch (error: any) {
        console.error("Failed to rename Work Header:", error);
        toast({ title: "Error", description: `Failed to rename Work Header: ${error.message || 'Unknown error'}`, variant: "destructive" });
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
    defaultValues: { task_name: "" },
  });

  const onSubmit = async (values: TaskFormValues) => {
    try {
      await createDoc("Design Tracker Tasks", { 
        task_name: values.task_name,
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
        <Button variant="outline" size="sm">
          <PlusCircle className="mr-2 h-3 w-3" /> Add Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Task</DialogTitle>
          <DialogDescription>Add a default task for this category.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="task_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Concept Design, 3D Render" {...field} /></FormControl>
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
    defaultValues: { task_name: task.task_name },
  });

  const onSubmit = async (values: TaskFormValues) => {
    try {
      await updateDoc("Design Tracker Tasks", task.name, { task_name: values.task_name });
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
        <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="task_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
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
        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-800">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Task?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "<span className="font-bold">{task.task_name}</span>"?
            This action cannot be undone.
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
  category: DesignTrackerCategory;
  tasks: DesignTrackerTask[];
  mutateCategories: () => Promise<any>;
  mutateTasks: () => Promise<any>;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ category, tasks, mutateCategories, mutateTasks }) => {
  return (
    <Card className="hover:animate-shadow-drop-center">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-gray-50/50 border-b">
        <CardTitle className="text-lg font-semibold flex items-center gap-2 text-gray-800">
          {category.category_name}
          <EditCategoryDialog category={category} mutate={mutateCategories} mutateTasks={mutateTasks} />
        </CardTitle>
        <CreateTaskDialog categoryId={category.name} mutate={mutateTasks} />
      </CardHeader>
      <CardContent className="pt-0">
        {tasks.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-gray-400 text-sm italic">No default tasks defined. Click "Add Task" to start.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[80%] pl-4">Task Name</TableHead>
                {/* <TableHead className="w-[20%] text-right pr-4">Actions</TableHead> */}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.name} className="group">
                  <TableCell className="pl-4 font-medium text-gray-700">{task.task_name}</TableCell>
                   <TableCell className="text-right flex items-center justify-end space-x-2">
                    {/* <EditTaskDialog task={task} mutate={mutateTasks} /> */}
                    {/* <DeleteTaskDialog task={task} mutate={mutateTasks} /> */}
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