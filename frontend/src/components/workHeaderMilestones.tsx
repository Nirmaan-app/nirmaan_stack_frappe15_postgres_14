// src/components/workHeaderMilestones.tsx
// Enterprise Minimalist Work Headers & Milestones Configuration

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import {
  Pencil,
  PlusCircle,
  Trash2,
  GripVertical,
  Save,
  ArrowLeft,
  Package,
  Layers,
  ChevronRight,
  X,
} from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  useFrappeUpdateDoc,
  useFrappePostCall,
} from "frappe-react-sdk";

// --- Types ---
export interface WorkHeaders {
  name: string;
  work_header_name: string;
  work_package_link?: string;
  order?: number;
  creation?: string;
  modified?: string;
  owner?: string;
  modified_by?: string;
}

export interface WorkMilestone {
  name: string;
  work_milestone_name: string;
  work_header: string;
  work_milestone_order?: number;
  weightage?: number;
  creation?: string;
  modified?: string;
  owner?: string;
  modified_by?: string;
}

export interface WorkPackage {
  name: string;
  work_package_name: string;
}

// --- Schemas ---
const workHeaderFormSchema = z.object({
  work_header_name: z.string().min(1, "Work Header Name is required."),
  work_package_link: z.string().optional(),
});
type WorkHeaderFormValues = z.infer<typeof workHeaderFormSchema>;

const workMilestoneFormSchema = z.object({
  work_milestone_name: z.string().min(1, "Milestone Name is required."),
  weightage: z.coerce.number().positive("Weightage must be greater than 0."),
});
type WorkMilestoneFormValues = z.infer<typeof workMilestoneFormSchema>;

// --- Main Component ---
export const WorkHeaderMilestones: React.FC = () => {
  // Fetch Work Headers
  const {
    data: workHeaders,
    isLoading: workHeadersLoading,
    error: workHeadersError,
    mutate: workHeadersMutate,
  } = useFrappeGetDocList<WorkHeaders>("Work Headers", {
    fields: ["name", "work_header_name", "order", "work_package_link"],
    limit: 0,
    orderBy: { field: "`order`", order: "asc" },
  });

  // Fetch Work Milestones
  const {
    data: workMilestones,
    isLoading: workMilestonesLoading,
    error: workMilestonesError,
    mutate: workMilestonesMutate,
  } = useFrappeGetDocList<WorkMilestone>("Work Milestones", {
    fields: [
      "name",
      "work_milestone_name",
      "work_header",
      "work_milestone_order",
      "weightage",
    ],
    limit: 0,
    orderBy: { field: "work_milestone_order", order: "asc" },
  });

  // Fetch Work Packages for dropdown
  const { data: workPackagesList } = useFrappeGetDocList<WorkPackage>(
    "Work Packages",
    {
      fields: ["name", "work_package_name"],
      limit: 0,
      orderBy: { field: "work_package_name", order: "asc" },
    }
  );

  // Reordering state
  const [isReordering, setIsReordering] = useState(false);
  const [reorderedList, setReorderedList] = useState<WorkHeaders[]>([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  // Drag refs
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const { updateDoc } = useFrappeUpdateDoc();

  // Initialize reordered list
  useEffect(() => {
    if (workHeaders) {
      const sorted = [...workHeaders].sort(
        (a, b) => (a.order || 9999) - (b.order || 9999)
      );
      setReorderedList(sorted);
    }
  }, [workHeaders]);

  // Max order calculation
  const maxOrder = useMemo(() => {
    if (!workHeaders || workHeaders.length === 0) return 0;
    return Math.max(...workHeaders.map((h) => h.order || 0));
  }, [workHeaders]);

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
      const updatePromises = reorderedList.map((header, index) => {
        const newOrder = index + 1;
        if (header.order !== newOrder) {
          return updateDoc("Work Headers", header.name, { order: newOrder });
        }
        return Promise.resolve();
      });

      await Promise.all(updatePromises);
      toast({
        title: "Order Updated",
        description: "Work Headers have been reordered successfully.",
        variant: "success",
      });
      await workHeadersMutate();
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

  // Loading state
  if (workHeadersLoading || workMilestonesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <TailSpin width={32} height={32} color="#475569" />
          <span className="text-sm text-slate-500 font-medium tracking-wide">
            Loading configuration...
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (workHeadersError || workMilestonesError) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <p className="text-slate-800 font-medium">Failed to load data</p>
          <p className="text-sm text-slate-500">
            {workHeadersError?.message || workMilestonesError?.message}
          </p>
        </div>
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
                  Reorder Work Headers
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (workHeaders) {
                      setReorderedList(
                        [...workHeaders].sort(
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
                    Work Header
                  </TableHead>
                  <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider">
                    Work Package
                  </TableHead>
                  <TableHead className="w-20 text-center text-slate-500 font-medium text-xs uppercase tracking-wider">
                    Drag
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reorderedList.map((header, index) => (
                  <TableRow
                    key={header.name}
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
                      {header.work_header_name}
                    </TableCell>
                    <TableCell>
                      {header.work_package_link ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium">
                          <Package className="w-3 h-3" />
                          {header.work_package_link}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-sm">—</span>
                      )}
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

  // Main view
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
                Work Headers & Milestones
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Configure work categories and their milestones
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
                Reorder
              </Button>
              <CreateWorkHeaderDialog
                mutate={workHeadersMutate}
                maxOrder={maxOrder}
                workPackages={workPackagesList || []}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {workHeaders?.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mb-4">
              <Layers className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-1">
              No Work Headers
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Create your first work header to get started
            </p>
            <CreateWorkHeaderDialog
              mutate={workHeadersMutate}
              maxOrder={0}
              workPackages={workPackagesList || []}
            />
          </div>
        ) : (
          <div className="space-y-4">
            {workHeaders?.map((header) => (
              <WorkHeaderCard
                key={header.name}
                header={header}
                milestones={
                  workMilestones?.filter(
                    (m) => m.work_header === header.name
                  ) || []
                }
                workHeadersMutate={workHeadersMutate}
                workMilestonesMutate={workMilestonesMutate}
                workPackages={workPackagesList || []}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Create Work Header Dialog ---
interface CreateWorkHeaderDialogProps {
  mutate: () => Promise<any>;
  maxOrder: number;
  workPackages: WorkPackage[];
}

const CreateWorkHeaderDialog: React.FC<CreateWorkHeaderDialogProps> = ({
  mutate,
  maxOrder,
  workPackages,
}) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<WorkHeaderFormValues>({
    resolver: zodResolver(workHeaderFormSchema),
    defaultValues: {
      work_header_name: "",
      work_package_link: "",
    },
  });

  const onSubmit = async (values: WorkHeaderFormValues) => {
    try {
      await createDoc("Work Headers", {
        work_header_name: values.work_header_name,
        work_package_link: values.work_package_link || null,
        order: maxOrder + 1,
      });

      toast({
        title: "Work Header Created",
        description: `"${values.work_header_name}" has been created.`,
        variant: "success",
      });
      form.reset();
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create work header.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="bg-slate-900 hover:bg-slate-800 text-white"
        >
          <PlusCircle className="w-4 h-4 mr-1.5" />
          Add Work Header
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Create Work Header
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Define a new category of work for project milestones.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="work_header_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Work Header Name
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Civil Work, Electrical, Plumbing"
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
                    <span className="text-slate-400 font-normal">
                      (Optional)
                    </span>
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

// --- Edit Work Header Dialog ---
interface EditWorkHeaderDialogProps {
  header: WorkHeaders;
  mutate: () => Promise<any>;
  milestoneMutate: () => Promise<any>;
  workPackages: WorkPackage[];
}

const EditWorkHeaderDialog: React.FC<EditWorkHeaderDialogProps> = ({
  header,
  mutate,
  milestoneMutate,
  workPackages,
}) => {
  const [open, setOpen] = useState(false);
  const { call: renameDoc, loading: renameLoading } = useFrappePostCall(
    "frappe.model.rename_doc.update_document_title"
  );
  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

  const form = useForm<WorkHeaderFormValues>({
    resolver: zodResolver(workHeaderFormSchema),
    defaultValues: {
      work_header_name: header.work_header_name,
      work_package_link: header.work_package_link || "",
    },
  });

  // Reset form when header changes
  useEffect(() => {
    form.reset({
      work_header_name: header.work_header_name,
      work_package_link: header.work_package_link || "",
    });
  }, [header, form]);

  const onSubmit = async (values: WorkHeaderFormValues) => {
    const nameChanged = values.work_header_name !== header.work_header_name;
    const packageChanged =
      (values.work_package_link || null) !== (header.work_package_link || null);

    if (!nameChanged && !packageChanged) {
      toast({
        title: "No Changes",
        description: "No changes were detected.",
      });
      setOpen(false);
      return;
    }

    try {
      // Handle rename if name changed
      if (nameChanged) {
        await renameDoc({
          doctype: "Work Headers",
          docname: header.name,
          name: values.work_header_name,
          merge: 0,
          freeze: true,
          freeze_message: `Renaming "${header.work_header_name}"...`,
        });
      }

      // Handle work package update separately
      if (packageChanged) {
        const docName = nameChanged ? values.work_header_name : header.name;
        await updateDoc("Work Headers", docName, {
          work_package_link: values.work_package_link || null,
        });
      }

      toast({
        title: "Work Header Updated",
        description: `Changes have been saved.`,
        variant: "success",
      });
      await mutate();
      await milestoneMutate();
      setOpen(false);
    } catch (error: any) {
      console.error("Failed to update Work Header:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update work header.",
        variant: "destructive",
      });
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
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Edit Work Header
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Update the work header name or associated work package.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="work_header_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Work Header Name
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
                  <div className="flex gap-2">
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger className="border-slate-300 focus:border-slate-500 focus:ring-slate-500 flex-1">
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
                    {field.value && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => field.onChange("")}
                        className="h-10 w-10 text-slate-400 hover:text-slate-600"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
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
                {isLoading ? (
                  <TailSpin height={16} width={16} color="white" />
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- Create Work Milestone Dialog ---
interface CreateWorkMilestoneDialogProps {
  workHeaderId: string;
  mutate: () => Promise<any>;
  nextOrder: number;
}

const CreateWorkMilestoneDialog: React.FC<CreateWorkMilestoneDialogProps> = ({
  workHeaderId,
  mutate,
  nextOrder,
}) => {
  const [open, setOpen] = useState(false);
  const { createDoc, loading } = useFrappeCreateDoc();

  const form = useForm<WorkMilestoneFormValues>({
    resolver: zodResolver(workMilestoneFormSchema),
    defaultValues: {
      work_milestone_name: "",
      weightage: 1.0,
    },
  });

  const onSubmit = async (values: WorkMilestoneFormValues) => {
    try {
      await createDoc("Work Milestones", {
        work_milestone_name: values.work_milestone_name,
        work_header: workHeaderId,
        work_milestone_order: nextOrder,
        weightage: values.weightage,
      });
      toast({
        title: "Milestone Created",
        description: `"${values.work_milestone_name}" has been added.`,
        variant: "success",
      });
      form.reset();
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create milestone.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-slate-600 border-slate-300"
        >
          <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
          Add Milestone
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Add Milestone
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Create a new milestone for this work header.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="work_milestone_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Milestone Name
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Foundation, Rough-in Wiring"
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
              name="weightage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Weightage
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
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

// --- Edit Work Milestone Dialog ---
interface EditWorkMilestoneDialogProps {
  milestone: WorkMilestone;
  mutate: () => Promise<any>;
}

const EditWorkMilestoneDialog: React.FC<EditWorkMilestoneDialogProps> = ({
  milestone,
  mutate,
}) => {
  const [open, setOpen] = useState(false);
  const { updateDoc, loading } = useFrappeUpdateDoc();

  const form = useForm<WorkMilestoneFormValues>({
    resolver: zodResolver(workMilestoneFormSchema),
    defaultValues: {
      work_milestone_name: milestone.work_milestone_name,
      weightage: milestone.weightage || 1.0,
    },
  });

  const onSubmit = async (values: WorkMilestoneFormValues) => {
    try {
      await updateDoc("Work Milestones", milestone.name, {
        work_milestone_name: values.work_milestone_name,
        weightage: values.weightage,
      });
      toast({
        title: "Milestone Updated",
        description: "Changes have been saved.",
        variant: "success",
      });
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update milestone.",
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
            Edit Milestone
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Update the milestone details.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="work_milestone_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Milestone Name
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
              name="weightage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Weightage
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
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
                  "Save Changes"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// --- Delete Milestone Alert Dialog ---
interface DeleteMilestoneAlertDialogProps {
  milestone: WorkMilestone;
  mutate: () => Promise<any>;
}

const DeleteMilestoneAlertDialog: React.FC<DeleteMilestoneAlertDialogProps> = ({
  milestone,
  mutate,
}) => {
  const [open, setOpen] = useState(false);
  const { deleteDoc, loading } = useFrappeDeleteDoc();

  const handleDelete = async () => {
    try {
      await deleteDoc("Work Milestones", milestone.name);
      toast({
        title: "Milestone Deleted",
        description: `"${milestone.work_milestone_name}" has been removed.`,
        variant: "success",
      });
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete milestone.",
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
            Delete Milestone
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-slate-500">
            Are you sure you want to delete "
            <span className="font-medium text-slate-700">
              {milestone.work_milestone_name}
            </span>
            "? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={loading}
            className="text-slate-600"
          >
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

// --- Work Header Card ---
interface WorkHeaderCardProps {
  header: WorkHeaders;
  milestones: WorkMilestone[];
  workHeadersMutate: () => Promise<any>;
  workMilestonesMutate: () => Promise<any>;
  workPackages: WorkPackage[];
}

const WorkHeaderCard: React.FC<WorkHeaderCardProps> = ({
  header,
  milestones,
  workHeadersMutate,
  workMilestonesMutate,
  workPackages,
}) => {
  const [isReordering, setIsReordering] = useState(false);
  const [milestoneList, setMilestoneList] = useState<WorkMilestone[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const { updateDoc } = useFrappeUpdateDoc();

  // Sort milestones
  useEffect(() => {
    const sorted = [...milestones].sort(
      (a, b) => (a.work_milestone_order || 9999) - (b.work_milestone_order || 9999)
    );
    setMilestoneList(sorted);
  }, [milestones]);

  const maxOrder = useMemo(() => {
    if (!milestones || milestones.length === 0) return 0;
    return Math.max(...milestones.map((m) => m.work_milestone_order || 0));
  }, [milestones]);

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
      const copyList = [...milestoneList];
      const dragItemContent = copyList[dragItem.current];
      copyList.splice(dragItem.current, 1);
      copyList.splice(dragOverItem.current, 0, dragItemContent);
      dragItem.current = null;
      dragOverItem.current = null;
      setMilestoneList(copyList);
    }
  };

  const handleSaveOrder = async () => {
    setIsSaving(true);
    try {
      const updatePromises = milestoneList.map((m, index) => {
        const newOrder = index + 1;
        if (m.work_milestone_order !== newOrder) {
          return updateDoc("Work Milestones", m.name, {
            work_milestone_order: newOrder,
          });
        }
        return Promise.resolve();
      });

      await Promise.all(updatePromises);
      toast({
        title: "Order Updated",
        description: "Milestone order has been saved.",
        variant: "success",
      });
      await workMilestonesMutate();
      setIsReordering(false);
    } catch (error: any) {
      console.error("Failed to save milestone order", error);
      toast({
        title: "Error",
        description: "Failed to save order.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelReorder = () => {
    const sorted = [...milestones].sort(
      (a, b) => (a.work_milestone_order || 9999) - (b.work_milestone_order || 9999)
    );
    setMilestoneList(sorted);
    setIsReordering(false);
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      {/* Card Header */}
      <div
        className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronRight
            className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-slate-900 truncate">
                {header.work_header_name}
              </h3>
              {header.work_package_link && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium">
                  <Package className="w-3 h-3" />
                  {header.work_package_link}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {milestones.length} milestone{milestones.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <EditWorkHeaderDialog
            header={header}
            mutate={workHeadersMutate}
            milestoneMutate={workMilestonesMutate}
            workPackages={workPackages}
          />
          {isReordering ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancelReorder}
                disabled={isSaving}
                className="h-7 text-xs text-slate-600"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveOrder}
                disabled={isSaving}
                className="h-7 text-xs bg-slate-900 hover:bg-slate-800 text-white"
              >
                {isSaving ? (
                  <TailSpin height={12} width={12} color="white" />
                ) : (
                  <>
                    <Save className="w-3 h-3 mr-1" />
                    Save
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsReordering(true)}
                disabled={milestoneList.length <= 1}
                className="h-7 text-xs text-slate-600 hover:bg-slate-100"
              >
                <GripVertical className="w-3.5 h-3.5 mr-1" />
                Reorder
              </Button>
              <CreateWorkMilestoneDialog
                workHeaderId={header.name}
                mutate={workMilestonesMutate}
                nextOrder={maxOrder + 1}
              />
            </>
          )}
        </div>
      </div>

      {/* Card Content */}
      {isExpanded && (
        <div className="border-t border-slate-100">
          {milestoneList.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-slate-500">
                No milestones defined. Add your first milestone above.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50 border-b border-slate-100">
                  {isReordering && (
                    <TableHead className="w-12 text-center text-slate-500 font-medium text-xs uppercase tracking-wider">
                      #
                    </TableHead>
                  )}
                  <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider">
                    Milestone
                  </TableHead>
                  {!isReordering && (
                    <TableHead className="w-24 text-slate-500 font-medium text-xs uppercase tracking-wider">
                      Weightage
                    </TableHead>
                  )}
                  <TableHead
                    className={`${
                      isReordering ? "w-16" : "w-24"
                    } text-right text-slate-500 font-medium text-xs uppercase tracking-wider`}
                  >
                    {isReordering ? "Drag" : "Actions"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {milestoneList.map((milestone, index) => (
                  <TableRow
                    key={milestone.name}
                    draggable={isReordering}
                    onDragStart={(e) =>
                      isReordering && handleDragStart(e, index)
                    }
                    onDragEnter={(e) =>
                      isReordering && handleDragEnter(e, index)
                    }
                    onDragEnd={isReordering ? handleDragEnd : undefined}
                    onDragOver={(e) => isReordering && e.preventDefault()}
                    className={`border-b border-slate-50 last:border-0 transition-colors ${
                      isReordering
                        ? "cursor-move hover:bg-slate-50"
                        : "hover:bg-slate-50/50"
                    }`}
                  >
                    {isReordering && (
                      <TableCell className="text-center">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-slate-100 text-slate-500 text-xs font-medium">
                          {index + 1}
                        </span>
                      </TableCell>
                    )}
                    <TableCell className="font-medium text-slate-800">
                      {milestone.work_milestone_name}
                    </TableCell>
                    {!isReordering && (
                      <TableCell className="text-slate-600">
                        {(milestone.weightage || 1.0).toFixed(2)}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {isReordering ? (
                        <GripVertical className="w-4 h-4 text-slate-400 ml-auto" />
                      ) : (
                        <div className="flex items-center justify-end gap-0.5">
                          <EditWorkMilestoneDialog
                            milestone={milestone}
                            mutate={workMilestonesMutate}
                          />
                          <DeleteMilestoneAlertDialog
                            milestone={milestone}
                            mutate={workMilestonesMutate}
                          />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkHeaderMilestones;
