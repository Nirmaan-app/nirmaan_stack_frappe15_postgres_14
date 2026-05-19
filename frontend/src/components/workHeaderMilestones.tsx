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
  Edit3,
  Scale,
  Network,
  GitBranch,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
  useFrappePostCall,
} from "frappe-react-sdk";
import ReactSelect from "react-select";
import { Textarea } from "@/components/ui/textarea";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

// --- Types ---
export interface WorkHeaders {
  name: string;
  work_header_name: string;
  work_package_link?: string;
  order?: number;
  header_weightage?: number;
  creation?: string;
  modified?: string;
  owner?: string;
  modified_by?: string;
}

export type DependencyType = "Full Dependence" | "Partial Dependence";

export interface WorkMilestoneDependency {
  name?: string;
  dependent_milestone: string;
  milestone_name?: string;
  dependent_milestone_order?: number;
  dependency_type?: DependencyType;
  dependency_percentage?: number;
}

export interface WorkMilestoneCriticalPODependency {
  name?: string;
  critical_po_item: string;
  item_name?: string;
  sub_category?: string;
  critical_po_category?: string;
  delivery_percentage?: number;
  remarks?: string;
}

export interface WorkMilestone {
  name: string;
  work_milestone_name: string;
  work_header: string;
  work_milestone_order?: number;
  weightage?: number;
  week_1?: number;
  week_2?: number;
  week_3?: number;
  week_4?: number;
  week_5?: number;
  week_6?: number;
  week_7?: number;
  week_8?: number;
  week_9?: number;
  dependent_milestones?: WorkMilestoneDependency[];
  critical_po_dependencies?: WorkMilestoneCriticalPODependency[];
  creation?: string;
  modified?: string;
  owner?: string;
  modified_by?: string;
}

export interface WorkPackage {
  name: string;
  work_package_name: string;
}

export interface CriticalPOItemOption {
  name: string;
  item_name?: string;
  sub_category?: string;
  critical_po_category?: string;
}

// --- Schemas ---
const workHeaderFormSchema = z.object({
  work_header_name: z.string().min(1, "Work Header Name is required."),
  work_package_link: z.string().optional(),
  header_weightage: z.coerce
    .number({ invalid_type_error: "Header Weightage must be a number." })
    .min(0, "Header Weightage cannot be negative."),
});
type WorkHeaderFormValues = z.infer<typeof workHeaderFormSchema>;

const workMilestoneFormSchema = z.object({
  work_milestone_name: z.string().min(1, "Milestone Name is required."),
  weightage: z.coerce.number().positive("Weightage must be greater than 0."),
  week_1: z.coerce.number().min(0).max(100).default(0),
  week_2: z.coerce.number().min(0).max(100).default(0),
  week_3: z.coerce.number().min(0).max(100).default(0),
  week_4: z.coerce.number().min(0).max(100).default(0),
  week_5: z.coerce.number().min(0).max(100).default(0),
  week_6: z.coerce.number().min(0).max(100).default(0),
  week_7: z.coerce.number().min(0).max(100).default(0),
  week_8: z.coerce.number().min(0).max(100).default(0),
  week_9: z.coerce.number().min(0).max(100).default(0),
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
    fields: [
      "name",
      "work_header_name",
      "order",
      "work_package_link",
      "header_weightage",
    ],
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
      "week_1",
      "week_2",
      "week_3",
      "week_4",
      "week_5",
      "week_6",
      "week_7",
      "week_8",
      "week_9",
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
          <div className="max-w-[1600px] mx-auto px-6 py-4">
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
        <div className="max-w-[1600px] mx-auto px-6 py-8">
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
        <div className="max-w-[1600px] mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
                DPR Work Headers & Milestones
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
                Reorder Work Header
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
      <div className="max-w-[1600px] mx-auto px-6 py-8">
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
      header_weightage: 0,
    },
  });

  const onSubmit = async (values: WorkHeaderFormValues) => {
    try {
      await createDoc("Work Headers", {
        work_header_name: values.work_header_name,
        work_package_link: values.work_package_link || null,
        order: maxOrder + 1,
        header_weightage: values.header_weightage,
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

            <FormField
              control={form.control}
              name="header_weightage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Header Weightage
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g., 10"
                      className="border-slate-300 focus:border-slate-500 focus:ring-slate-500"
                      {...field}
                      value={field.value ?? ""}
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
      header_weightage: header.header_weightage ?? 0,
    },
  });

  // Reset form when header changes
  useEffect(() => {
    form.reset({
      work_header_name: header.work_header_name,
      work_package_link: header.work_package_link || "",
      header_weightage: header.header_weightage ?? 0,
    });
  }, [header, form]);

  const onSubmit = async (values: WorkHeaderFormValues) => {
    const nameChanged = values.work_header_name !== header.work_header_name;
    const packageChanged =
      (values.work_package_link || null) !== (header.work_package_link || null);
    const weightageChanged =
      (values.header_weightage ?? 0) !== (header.header_weightage ?? 0);

    if (!nameChanged && !packageChanged && !weightageChanged) {
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

      // Handle work package / weightage update
      if (packageChanged || weightageChanged) {
        const docName = nameChanged ? values.work_header_name : header.name;
        const updatePayload: Record<string, any> = {};
        if (packageChanged) {
          updatePayload.work_package_link = values.work_package_link || null;
        }
        if (weightageChanged) {
          updatePayload.header_weightage = values.header_weightage;
        }
        await updateDoc("Work Headers", docName, updatePayload);
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

            <FormField
              control={form.control}
              name="header_weightage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-slate-700">
                    Header Weightage
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g., 10"
                      className="border-slate-300 focus:border-slate-500 focus:ring-slate-500"
                      {...field}
                      value={field.value ?? ""}
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
      week_1: 0,
      week_2: 0,
      week_3: 0,
      week_4: 0,
      week_5: 0,
      week_6: 0,
      week_7: 0,
      week_8: 0,
      week_9: 0,
    },
  });

  const onSubmit = async (values: WorkMilestoneFormValues) => {
    // Validate Timeline
    const weeks = [values.week_1, values.week_2, values.week_3, values.week_4, values.week_5, values.week_6, values.week_7, values.week_8, values.week_9];

    let firstStartedIdx = -1;
    let lastEnteredIdx = -1;
    for (let i = 0; i < 9; i++) {
      if ((weeks[i] || 0) > 0) {
        if (firstStartedIdx === -1) firstStartedIdx = i;
        lastEnteredIdx = i;
      }
    }

    if (firstStartedIdx !== -1) {
      let lastVal = 0;
      let lastWeekNum = 0;
      for (let w = 0; w < 9; w++) {
        const currentVal = weeks[w] || 0;

        // Gap detection
        if (w > firstStartedIdx && w < lastEnteredIdx && currentVal === 0) {
          toast({
            title: "Timeline Error",
            description: `Week ${w + 1} is empty. Progressive weeks cannot be zero once a milestone starts.`,
            variant: "destructive",
          });
          return;
        }

        if (currentVal > 0) {
          if (currentVal <= lastVal && lastVal !== 100) {
            toast({
              title: "Timeline Error",
              description: `Week ${w + 1} (${currentVal}%) must be greater than Week ${lastWeekNum} (${lastVal}%).`,
              variant: "destructive",
            });
            return;
          }
          lastVal = currentVal;
          lastWeekNum = w + 1;
        }
      }
    }

    try {
      await createDoc("Work Milestones", {
        work_milestone_name: values.work_milestone_name,
        work_header: workHeaderId,
        work_milestone_order: nextOrder,
        weightage: values.weightage,
        week_1: values.week_1,
        week_2: values.week_2,
        week_3: values.week_3,
        week_4: values.week_4,
        week_5: values.week_5,
        week_6: values.week_6,
        week_7: values.week_7,
        week_8: values.week_8,
        week_9: values.week_9,
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

  const watchedWeeks = form.watch(["week_1", "week_2", "week_3", "week_4", "week_5", "week_6", "week_7", "week_8", "week_9"]);
  const invalidWeeks = useMemo(() => {
    return getTimelineInvalidWeeks(form.getValues());
  }, [watchedWeeks]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start rounded-none h-8 text-xs text-slate-600 hover:bg-slate-50 border-b border-slate-100 px-3"
        >
          <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
          Add Milestone
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
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

            <div className="grid grid-cols-3 gap-2 border-t pt-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((week) => (
                <FormField
                  key={`week_${week}`}
                  control={form.control}
                  name={`week_${week}` as any}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                        Week {week}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          className={`h-8 text-xs border-slate-200 ${invalidWeeks.has(week) ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`}
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            if (e.target.value === "100") {
                              for (let w = week + 1; w <= 9; w++) {
                                form.setValue(`week_${w}` as any, 100, { shouldDirty: true });
                              }
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

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

// --- Bulk Edit Milestones Dialog ---
interface BulkEditMilestonesDialogProps {
  workHeaderId: string;
  headerName: string;
  milestones: WorkMilestone[];
  mutate: () => Promise<any>;
}

const BulkEditMilestonesDialog: React.FC<BulkEditMilestonesDialogProps> = ({
  workHeaderId,
  headerName,
  milestones,
  mutate,
}) => {
  const [open, setOpen] = useState(false);
  const [editedMilestones, setEditedMilestones] = useState<WorkMilestone[]>([]);
  const { updateDoc } = useFrappeUpdateDoc();
  const { createDoc } = useFrappeCreateDoc();
  const [isSaving, setIsSaving] = useState(false);

  const dragItemModal = useRef<number | null>(null);
  const dragOverItemModal = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<number | null>(null);

  const startAutoScroll = (direction: 'up' | 'down') => {
    if (scrollIntervalRef.current) return;
    scrollIntervalRef.current = window.setInterval(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop += (direction === 'up' ? -12 : 12);
      }
    }, 16); // ~60fps
  };

  const stopAutoScroll = () => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  };

  const handleDragStartModal = (e: React.DragEvent<HTMLTableRowElement>, position: number) => {
    dragItemModal.current = position;
  };

  const handleDragEnterModal = (e: React.DragEvent<HTMLTableRowElement>, position: number) => {
    dragOverItemModal.current = position;
  };

  const handleDragOverModal = (e: React.DragEvent) => {
    e.preventDefault();
    if (!scrollContainerRef.current) return;

    const { top, bottom } = scrollContainerRef.current.getBoundingClientRect();
    const threshold = 100; // broader area to trigger scroll

    if (e.clientY < top + threshold) {
      startAutoScroll('up');
    } else if (e.clientY > bottom - threshold) {
      startAutoScroll('down');
    } else {
      stopAutoScroll();
    }
  };

  const handleDragEndModal = () => {
    stopAutoScroll();
    if (dragItemModal.current !== null && dragOverItemModal.current !== null) {
      const copyList = [...editedMilestones];
      const dragItemContent = copyList[dragItemModal.current];
      copyList.splice(dragItemModal.current, 1);
      copyList.splice(dragOverItemModal.current, 0, dragItemContent);
      dragItemModal.current = null;
      dragOverItemModal.current = null;
      setEditedMilestones(copyList);
    }
  };

  useEffect(() => {
    if (open) {
      setEditedMilestones(JSON.parse(JSON.stringify(milestones)));
    }
  }, [open, milestones]);

  const duplicateNames = useMemo(() => {
    const names = editedMilestones.map(m => m.work_milestone_name.trim());
    const seen = new Set<string>();
    const dupes = new Set<string>();
    names.forEach(name => {
      if (!name) return;
      const lowerName = name.toLowerCase();
      if (seen.has(lowerName)) {
        dupes.add(lowerName);
      } else {
        seen.add(lowerName);
      }
    });
    return dupes;
  }, [editedMilestones]);

  const handleUpdateField = (rowIndex: number, field: keyof WorkMilestone, value: any) => {
    setEditedMilestones((prev) => {
      const updated = [...prev];
      updated[rowIndex] = { ...updated[rowIndex], [field]: value };
      return updated;
    });
  };

  const handleAddNewRow = () => {
    const newRow: any = {
      name: `new-${Date.now()}`, // Temporary ID
      work_milestone_name: "",
      weightage: 1,
      is_new: true,
      week_1: 0,
      week_2: 0,
      week_3: 0,
      week_4: 0,
      week_5: 0,
      week_6: 0,
      week_7: 0,
      week_8: 0,
      week_9: 0,
    };
    setEditedMilestones((prev) => [...prev, newRow]);
  };

  const handleRemoveNewRow = (rowIndex: number) => {
    setEditedMilestones((prev) => prev.filter((_, idx) => idx !== rowIndex));
  };

  const handleWeekUpdate = (rowIndex: number, weekNum: number, valueStr: string) => {
    const rawVal = valueStr === "" ? "" : parseInt(valueStr) || 0;

    setEditedMilestones((prev) => {
      const updated = [...prev];
      const row = { ...updated[rowIndex] };

      if (rawVal === "") {
        row[`week_${weekNum}` as keyof WorkMilestone] = 0 as never;
        updated[rowIndex] = row;
        return updated;
      }

      let val = Math.min(100, Math.max(0, rawVal as number));
      row[`week_${weekNum}` as keyof WorkMilestone] = val as never;

      // Auto-fill logic: Only fill forward if the value reaches 100% completion.
      if (val === 100) {
        for (let w = weekNum + 1; w <= 9; w++) {
          row[`week_${w}` as keyof WorkMilestone] = 100 as never;
        }
      }

      updated[rowIndex] = row;
      return updated;
    });
  };

  const handleWeekBlur = (rowIndex: number, weekNum: number) => {
    // Standard validation or formatting on blur if needed
  };

  const getInvalidWeeks = (milestone: WorkMilestone) => {
    const weeks = [milestone.week_1, milestone.week_2, milestone.week_3, milestone.week_4, milestone.week_5, milestone.week_6, milestone.week_7, milestone.week_8, milestone.week_9];
    const invalidIndices = new Set<number>();

    let firstStartedIdx = -1;
    let lastEnteredIdx = -1;

    for (let i = 0; i < 9; i++) {
      if ((weeks[i] || 0) > 0) {
        if (firstStartedIdx === -1) firstStartedIdx = i;
        lastEnteredIdx = i;
      }
    }

    if (firstStartedIdx !== -1) {
      let lastVal = 0;
      let lastValidWeekNum = 0;

      for (let i = 0; i < 9; i++) {
        const current = weeks[i] || 0;

        // Gap detection: If we are between the first non-zero and last non-zero week, 0 is invalid.
        if (i > firstStartedIdx && i < lastEnteredIdx && current === 0) {
          invalidIndices.add(i + 1);
        }

        if (current > 0) {
          if (current <= lastVal && lastVal !== 100) {
            invalidIndices.add(i + 1);
          }
          lastVal = current;
          lastValidWeekNum = i + 1;
        }
      }
    }
    return invalidIndices;
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      // Validate Basic Info
      for (const m of editedMilestones) {
        if (!m.work_milestone_name.trim()) {
          toast({ title: "Validation Error", description: "All milestones must have a name.", variant: "destructive" });
          setIsSaving(false);
          return;
        }
        if ((m.weightage || 0) <= 0) {
          toast({ title: "Validation Error", description: `"${m.work_milestone_name}" must have a positive weightage.`, variant: "destructive" });
          setIsSaving(false);
          return;
        }
      }

      if (duplicateNames.size > 0) {
        const dupeList = Array.from(duplicateNames).map(name => `"${name}"`).join(", ");
        toast({
          title: "Duplicate Names Found",
          description: `The following milestone names are repeated: ${dupeList}. Please ensure all names are unique before saving.`,
          variant: "destructive",
        });
        setIsSaving(false);
        return;
      }

      // Validate Timeline for gaps and sequence
      for (const m of editedMilestones) {
        const weeks = [m.week_1, m.week_2, m.week_3, m.week_4, m.week_5, m.week_6, m.week_7, m.week_8, m.week_9];
        const invalidWeeks = getInvalidWeeks(m);

        if (invalidWeeks.size > 0) {
          const firstInvalid = Array.from(invalidWeeks).sort((a, b) => a - b)[0];
          const currentVal = weeks[firstInvalid - 1] || 0;

          let lastVal = 0;
          let lastWeekNum = 0;
          for (let j = 0; j < firstInvalid - 1; j++) {
            if ((weeks[j] || 0) > 0) {
              lastVal = weeks[j] || 0;
              lastWeekNum = j + 1;
            }
          }

          let errorDesc = "";
          if (currentVal === 0) {
            errorDesc = `Week ${firstInvalid} is empty. Progressive weeks cannot be zero once a milestone starts.`;
          } else {
            errorDesc = `Week ${firstInvalid} (${currentVal}%) must be greater than Week ${lastWeekNum} (${lastVal}%).`;
          }

          toast({
            title: "Timeline Error",
            description: `"${m.work_milestone_name}": ${errorDesc}`,
            variant: "destructive",
          });
          setIsSaving(false);
          return;
        }
      }

      const savePromises = editedMilestones.map((m, index) => {
        const payload = {
          work_milestone_name: m.work_milestone_name,
          weightage: m.weightage,
          work_milestone_order: index + 1,
          week_1: m.week_1,
          week_2: m.week_2,
          week_3: m.week_3,
          week_4: m.week_4,
          week_5: m.week_5,
          week_6: m.week_6,
          week_7: m.week_7,
          week_8: m.week_8,
          week_9: m.week_9,
        };

        if ((m as any).is_new) {
          return createDoc("Work Milestones", {
            ...payload,
            work_header: workHeaderId,
          });
        } else {
          return updateDoc("Work Milestones", m.name, payload);
        }
      });

      await Promise.all(savePromises);
      toast({
        title: "Changes Saved",
        description: `Successfully updated milestones for "${headerName}".`,
        variant: "success",
      });
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save milestone updates.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start rounded-none h-8 text-xs text-slate-600 hover:bg-slate-50 px-3">
          <Edit3 className="w-3.5 h-3.5 mr-1" />
          Edit Milestones
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[75vw] w-full max-h-[85vh] overflow-hidden flex flex-col p-0 border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 bg-white flex items-center justify-between">
          <div>
            <DialogTitle className="text-lg font-semibold text-slate-900 border-none m-0">
              Bulk Edit Milestones
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500 m-0">
              Editing {editedMilestones.length} milestones for <strong className="text-slate-700">{headerName}</strong>
            </DialogDescription>
            <div className="mt-2 flex gap-4 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Drag handle to reorder
              </span>
              <span className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Weekly values are cumulative %
              </span>
              <span className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Weightage must be &gt; 0
              </span>
              <span className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                We can Add New Milestone.
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddNewRow}
            disabled={isSaving || editedMilestones.some(m => (m as any).is_new && !m.work_milestone_name.trim())}
            className="text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlusCircle className="w-3.5 h-3.5 mr-2" />
            Add Milestone
          </Button>
        </div>
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto bg-slate-50/30"
          onDragOver={handleDragOverModal}
        >
          <div className="bg-white">
            <Table className="min-w-[1000px] border-collapse">
              <TableHeader className="sticky top-0 z-10 shadow-sm">
                <TableRow className="bg-slate-50 text-[10px] uppercase text-slate-500 hover:bg-slate-50 border-b border-slate-200">
                  <TableHead className="w-[40px] text-center sticky top-0 bg-slate-50 z-10">Order</TableHead>
                  <TableHead className="w-[280px] sticky top-0 bg-slate-50 z-10">Milestone Name</TableHead>
                  <TableHead className="w-[90px] sticky top-0 bg-slate-50 z-10">Weightage</TableHead>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((w) => (
                    <TableHead key={w} className="w-[70px] text-center sticky top-0 bg-slate-50 z-10">W{w}</TableHead>
                  ))}
                  <TableHead className="w-[40px] sticky top-0 bg-slate-50 z-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editedMilestones.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-slate-500 text-sm">
                      No milestones to edit.
                    </TableCell>
                  </TableRow>
                ) : (
                  editedMilestones.map((milestone, idx) => {
                    const invalidWeeks = getTimelineInvalidWeeks(milestone);
                    return (
                      <TableRow
                        key={milestone.name}
                        className="hover:bg-slate-50/50 border-b border-slate-50 last:border-0 cursor-move"
                        draggable
                        onDragStart={(e) => handleDragStartModal(e, idx)}
                        onDragEnter={(e) => handleDragEnterModal(e, idx)}
                        onDragEnd={handleDragEndModal}
                        onDragOver={handleDragOverModal}
                      >
                        <TableCell className="p-1.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <span className="text-[10px] font-bold text-slate-400 min-w-[12px]">{idx + 1}</span>
                            <GripVertical className="w-3.5 h-3.5 text-slate-400" />
                          </div>
                        </TableCell>
                        <TableCell className="p-1.5 px-3">
                          <Input
                            placeholder="Milestone Name"
                            autoFocus={(milestone as any).is_new}
                            value={milestone.work_milestone_name}
                            onChange={(e) => handleUpdateField(idx, "work_milestone_name", e.target.value)}
                            className={`h-8 text-xs border-slate-200 focus-visible:ring-1 ${duplicateNames.has(milestone.work_milestone_name.trim().toLowerCase()) ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`}
                          />
                        </TableCell>
                        <TableCell className="p-1.5">
                          <Input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={milestone.weightage || ""}
                            onChange={(e) => handleUpdateField(idx, "weightage", parseFloat(e.target.value) || 0)}
                            className="h-8 text-xs border-slate-200 focus-visible:ring-1"
                          />
                        </TableCell>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((w) => {
                          const weekVal = milestone[`week_${w}` as keyof WorkMilestone] as number | undefined;
                          return (
                            <TableCell key={w} className="p-1.5 px-2">
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                value={weekVal === 0 || weekVal === undefined ? "" : weekVal}
                                onChange={(e) => handleWeekUpdate(idx, w, e.target.value)}
                                onBlur={() => handleWeekBlur(idx, w)}
                                placeholder="0"
                                className={`h-8 text-xs px-0 text-center border-slate-200 focus-visible:ring-1 placeholder:text-slate-300 ${invalidWeeks.has(w) ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`}
                              />
                            </TableCell>
                          )
                        })}
                        <TableCell className="p-1.5 px-3 text-center">
                          {(milestone as any).is_new && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveNewRow(idx)}
                              className="h-7 w-7 text-slate-400 hover:text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-white flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Progress updates will automatically carry forward to subsequent weeks to ensure cumulative totals.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isSaving} className="text-sm">
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveAll} disabled={isSaving || editedMilestones.length === 0} className="bg-slate-900 hover:bg-slate-800 text-sm">
              {isSaving ? <TailSpin height={14} width={14} color="white" /> : "Save All Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};


const getTimelineInvalidWeeks = (values: any) => {
  const weeks = [values.week_1, values.week_2, values.week_3, values.week_4, values.week_5, values.week_6, values.week_7, values.week_8, values.week_9];
  const invalidIndices = new Set<number>();

  let firstStartedIdx = -1;
  let lastEnteredIdx = -1;

  for (let i = 0; i < 9; i++) {
    if ((weeks[i] || 0) > 0) {
      if (firstStartedIdx === -1) firstStartedIdx = i;
      lastEnteredIdx = i;
    }
  }

  if (firstStartedIdx !== -1) {
    let lastVal = 0;
    for (let i = 0; i < 9; i++) {
      const current = weeks[i] || 0;
      if (i > firstStartedIdx && i < lastEnteredIdx && current === 0) {
        invalidIndices.add(i + 1);
      }
      if (current > 0) {
        if (current <= lastVal && lastVal !== 100) {
          invalidIndices.add(i + 1);
        }
        lastVal = current;
      }
    }
  }
  return invalidIndices;
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
      week_1: milestone.week_1 || 0,
      week_2: milestone.week_2 || 0,
      week_3: milestone.week_3 || 0,
      week_4: milestone.week_4 || 0,
      week_5: milestone.week_5 || 0,
      week_6: milestone.week_6 || 0,
      week_7: milestone.week_7 || 0,
      week_8: milestone.week_8 || 0,
      week_9: milestone.week_9 || 0,
    },
  });

  // Reset form when milestone changes
  useEffect(() => {
    form.reset({
      work_milestone_name: milestone.work_milestone_name,
      weightage: milestone.weightage || 1.0,
      week_1: milestone.week_1 || 0,
      week_2: milestone.week_2 || 0,
      week_3: milestone.week_3 || 0,
      week_4: milestone.week_4 || 0,
      week_5: milestone.week_5 || 0,
      week_6: milestone.week_6 || 0,
      week_7: milestone.week_7 || 0,
      week_8: milestone.week_8 || 0,
      week_9: milestone.week_9 || 0,
    });
  }, [milestone, form]);

  const onSubmit = async (values: WorkMilestoneFormValues) => {
    // Validate Timeline
    const weeks = [values.week_1, values.week_2, values.week_3, values.week_4, values.week_5, values.week_6, values.week_7, values.week_8, values.week_9];

    let firstStartedIdx = -1;
    let lastEnteredIdx = -1;
    for (let i = 0; i < 9; i++) {
      if ((weeks[i] || 0) > 0) {
        if (firstStartedIdx === -1) firstStartedIdx = i;
        lastEnteredIdx = i;
      }
    }

    if (firstStartedIdx !== -1) {
      let lastVal = 0;
      let lastWeekNum = 0;
      for (let w = 0; w < 9; w++) {
        const currentVal = weeks[w] || 0;

        // Gap detection
        if (w > firstStartedIdx && w < lastEnteredIdx && currentVal === 0) {
          toast({
            title: "Timeline Error",
            description: `Week ${w + 1} is empty. Progressive weeks cannot be zero once a milestone starts.`,
            variant: "destructive",
          });
          return;
        }

        if (currentVal > 0) {
          if (currentVal <= lastVal && lastVal !== 100) {
            toast({
              title: "Timeline Error",
              description: `Week ${w + 1} (${currentVal}%) must be greater than Week ${lastWeekNum} (${lastVal}%).`,
              variant: "destructive",
            });
            return;
          }
          lastVal = currentVal;
          lastWeekNum = w + 1;
        }
      }
    }

    try {
      await updateDoc("Work Milestones", milestone.name, {
        work_milestone_name: values.work_milestone_name,
        weightage: values.weightage,
        week_1: values.week_1,
        week_2: values.week_2,
        week_3: values.week_3,
        week_4: values.week_4,
        week_5: values.week_5,
        week_6: values.week_6,
        week_7: values.week_7,
        week_8: values.week_8,
        week_9: values.week_9,
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

  const watchedWeeks = form.watch(["week_1", "week_2", "week_3", "week_4", "week_5", "week_6", "week_7", "week_8", "week_9"]);
  const invalidWeeks = useMemo(() => {
    return getTimelineInvalidWeeks(form.getValues());
  }, [watchedWeeks]);

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
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
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

            <div className="grid grid-cols-3 gap-2 border-t pt-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((week) => (
                <FormField
                  key={`week_${week}`}
                  control={form.control}
                  name={`week_${week}` as any}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                        Week {week}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          className={`h-8 text-xs border-slate-200 ${invalidWeeks.has(week) ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`}
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            if (e.target.value === "100") {
                              for (let w = week + 1; w <= 9; w++) {
                                form.setValue(`week_${w}` as any, 100, { shouldDirty: true });
                              }
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

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

// --- Milestone Dependencies Dialog ---
interface MilestoneDependenciesDialogProps {
  milestone: WorkMilestone;
  mutate: () => Promise<any>;
}

const MilestoneDependenciesDialog: React.FC<MilestoneDependenciesDialogProps> = ({
  milestone,
  mutate,
}) => {
  const [open, setOpen] = useState(false);
  const { updateDoc, loading } = useFrappeUpdateDoc();

  const { data: fullMilestone, mutate: refetchFullMilestone } =
    useFrappeGetDoc<WorkMilestone>(
      "Work Milestones",
      milestone.name,
      open ? undefined : null
    );

  // Only same-header milestones are eligible — filter at the query level.
  const { data: allMilestonesForPicker } = useFrappeGetDocList<WorkMilestone>(
    "Work Milestones",
    {
      fields: [
        "name",
        "work_milestone_name",
        "work_header",
        "work_milestone_order",
      ],
      filters: [["work_header", "=", milestone.work_header]],
      limit: 0,
      orderBy: { field: "work_milestone_order", order: "asc" },
    },
    open ? undefined : null
  );

  const { data: criticalPOItems } = useFrappeGetDocList<CriticalPOItemOption>(
    "Critical PO Items",
    {
      fields: ["name", "item_name", "sub_category", "critical_po_category"],
      limit: 0,
      orderBy: { field: "item_name", order: "asc" },
    },
    open ? undefined : null
  );

  // Fetch the milestone's Work Header to learn its Work Package, and the full
  // Critical PO Category list so we can map category -> work_package.
  // Together these let us filter Critical PO Items to the same package only.
  const { data: workHeader } = useFrappeGetDoc<WorkHeaders>(
    "Work Headers",
    milestone.work_header,
    open && milestone.work_header ? undefined : null
  );

  const { data: criticalPOCategories } = useFrappeGetDocList<{
    name: string;
    work_package?: string;
  }>(
    "Critical PO Category",
    {
      fields: ["name", "work_package"],
      limit: 0,
    },
    open ? undefined : null
  );

  const milestoneWorkPackage = workHeader?.work_package_link;
  const categoryToPackage = useMemo(() => {
    const m = new Map<string, string | undefined>();
    (criticalPOCategories || []).forEach((c) => m.set(c.name, c.work_package));
    return m;
  }, [criticalPOCategories]);

  const filteredCriticalPOItems = useMemo(() => {
    if (!milestoneWorkPackage) return criticalPOItems || [];
    return (criticalPOItems || []).filter((it) => {
      const cat = it.critical_po_category;
      if (!cat) return false;
      return categoryToPackage.get(cat) === milestoneWorkPackage;
    });
  }, [criticalPOItems, categoryToPackage, milestoneWorkPackage]);

  const [dependentRows, setDependentRows] = useState<WorkMilestoneDependency[]>(
    []
  );
  const [criticalRows, setCriticalRows] = useState<
    WorkMilestoneCriticalPODependency[]
  >([]);

  useEffect(() => {
    if (fullMilestone) {
      setDependentRows(
        (fullMilestone.dependent_milestones || []).map((r) => ({
          ...r,
          dependency_type: r.dependency_type || "Full Dependence",
          dependency_percentage:
            r.dependency_percentage != null ? r.dependency_percentage : 100,
        }))
      );
      setCriticalRows(
        (fullMilestone.critical_po_dependencies || []).map((r) => ({ ...r }))
      );
    }
  }, [fullMilestone]);

  const milestonePickerOptions = useMemo(() => {
    return (allMilestonesForPicker || [])
      .filter((m) => m.name !== milestone.name)
      .map((m) => ({
        value: m.name,
        label: m.work_milestone_name,
        order: m.work_milestone_order,
      }));
  }, [allMilestonesForPicker, milestone.name]);

  const criticalPOItemsByName = useMemo(() => {
    const map = new Map<string, CriticalPOItemOption>();
    // Keep ALL items in the lookup so already-saved rows still render their
    // metadata (item_name, sub_category) even if they fall outside the filter.
    (criticalPOItems || []).forEach((it) => map.set(it.name, it));
    return map;
  }, [criticalPOItems]);

  const criticalPickerOptions = useMemo<CriticalPickerOption[]>(() => {
    return filteredCriticalPOItems.map((it) => ({
      value: it.name,
      label: it.item_name || it.name,
      itemName: it.item_name,
      subCategory: it.sub_category,
      category: it.critical_po_category,
    }));
  }, [filteredCriticalPOItems]);

  const handleSave = async () => {
    const cleanDeps = dependentRows.filter((r) => r.dependent_milestone);
    const cleanCritical = criticalRows.filter((r) => r.critical_po_item);
    for (const r of cleanDeps) {
      if (r.dependency_type === "Partial Dependence") {
        const pct = r.dependency_percentage;
        if (pct == null || pct < 1 || pct > 99) {
          toast({
            title: "Invalid Dependency %",
            description: `For Partial Dependence, % must be between 1 and 99 (${r.milestone_name || r.dependent_milestone
              }).`,
            variant: "destructive",
          });
          return;
        }
      }
    }
    for (const r of cleanCritical) {
      const pct = r.delivery_percentage;
      if (pct == null || pct <= 0 || pct > 100) {
        toast({
          title: "Delivery % required",
          description: `Enter a Delivery % between 1 and 100 for ${r.item_name || r.critical_po_item
            }.`,
          variant: "destructive",
        });
        return;
      }
    }

    try {
      await updateDoc("Work Milestones", milestone.name, {
        dependent_milestones: cleanDeps.map((r) => {
          const type: DependencyType = r.dependency_type || "Full Dependence";
          return {
            dependent_milestone: r.dependent_milestone,
            dependency_type: type,
            dependency_percentage:
              type === "Full Dependence" ? 100 : r.dependency_percentage ?? 0,
          };
        }),
        critical_po_dependencies: cleanCritical.map((r) => ({
          critical_po_item: r.critical_po_item,
          delivery_percentage: r.delivery_percentage ?? 0,
          remarks: r.remarks || "",
        })),
      });
      toast({
        title: "Dependencies Updated",
        description: "Changes have been saved.",
        variant: "success",
      });
      await mutate();
      await refetchFullMilestone();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update dependencies.",
        variant: "destructive",
      });
    }
  };

  const depCount = dependentRows.filter((r) => r.dependent_milestone).length;
  const poCount = criticalRows.filter((r) => r.critical_po_item).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
          title="Manage dependencies"
        >
          <Network className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Dependencies
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500 truncate">
            {milestone.work_milestone_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <DependentMilestonesSection
            rows={dependentRows}
            setRows={setDependentRows}
            pickerOptions={milestonePickerOptions}
          />
          <CriticalPODependenciesSection
            rows={criticalRows}
            setRows={setCriticalRows}
            pickerOptions={criticalPickerOptions}
            itemsByName={criticalPOItemsByName}
            workPackage={milestoneWorkPackage}
          />
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <span className="text-xs text-slate-500">
            {depCount} milestone{depCount !== 1 ? "s" : ""} · {poCount} critical PO
            {poCount !== 1 ? "s" : ""}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="text-slate-600"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// --- Dependent Milestones Section ---
interface PickerOption {
  value: string;
  label: string;
  order?: number;
}

interface CriticalPickerOption {
  value: string;
  label: string;
  itemName?: string;
  subCategory?: string;
  category?: string;
}

interface DependentMilestonesSectionProps {
  rows: WorkMilestoneDependency[];
  setRows: React.Dispatch<React.SetStateAction<WorkMilestoneDependency[]>>;
  pickerOptions: PickerOption[];
}

const DependentMilestonesSection: React.FC<DependentMilestonesSectionProps> = ({
  rows,
  setRows,
  pickerOptions,
}) => {
  const optionByValue = useMemo(() => {
    const m = new Map<string, PickerOption>();
    pickerOptions.forEach((o) => m.set(o.value, o));
    return m;
  }, [pickerOptions]);

  const pickedIds = useMemo(
    () => new Set(rows.map((r) => r.dependent_milestone).filter(Boolean)),
    [rows]
  );

  const availableOptions = useMemo<PickerOption[]>(
    () => pickerOptions.filter((o) => !pickedIds.has(o.value)),
    [pickerOptions, pickedIds]
  );

  const addRow = (opt: PickerOption) => {
    if (pickedIds.has(opt.value)) return;
    setRows((prev) => [
      ...prev,
      {
        dependent_milestone: opt.value,
        milestone_name: opt.label,
        dependent_milestone_order: opt.order,
        dependency_type: "Full Dependence",
        dependency_percentage: 100,
      },
    ]);
  };

  const updateRow = (
    id: string,
    patch: Partial<WorkMilestoneDependency>
  ) => {
    setRows((prev) =>
      prev.map((r) => (r.dependent_milestone === id ? { ...r, ...patch } : r))
    );
  };

  const setType = (id: string, type: DependencyType) => {
    if (type === "Full Dependence") {
      updateRow(id, { dependency_type: type, dependency_percentage: 100 });
    } else {
      // Switching to Partial: clear the 100 default so the user types 1-99.
      const current = rows.find((r) => r.dependent_milestone === id);
      const keep =
        current?.dependency_percentage != null &&
        current.dependency_percentage > 0 &&
        current.dependency_percentage < 100;
      updateRow(id, {
        dependency_type: type,
        dependency_percentage: keep ? current!.dependency_percentage : undefined,
      });
    }
  };

  const formatOptionLabel = (option: PickerOption) => (
    <div className="flex items-center gap-1.5">
      {option.order != null && (
        <span className="inline-flex items-center justify-center min-w-[20px] h-4 px-1 rounded bg-slate-100 text-slate-500 text-[10px] font-medium tabular-nums">
          {option.order}
        </span>
      )}
      <span className="text-slate-800">{option.label}</span>
    </div>
  );

  return (
    <div className="border-t pt-4 space-y-2">
      <h4 className="text-sm font-semibold text-slate-800">Milestones</h4>
      <ReactSelect<PickerOption, false>
        value={null}
        options={availableOptions}
        onChange={(opt) => {
          if (opt) addRow(opt as PickerOption);
        }}
        formatOptionLabel={formatOptionLabel}
        placeholder={
          availableOptions.length === 0
            ? "All milestones added"
            : "Search & add a milestone..."
        }
        isDisabled={availableOptions.length === 0}
        classNamePrefix="react-select"
        styles={{
          menuPortal: (base) => ({ ...base, zIndex: 9999 }),
          menu: (base) => ({ ...base, zIndex: 9999 }),
          control: (base) => ({ ...base, minHeight: 36, fontSize: 13 }),
        }}
      />
      {rows.filter((r) => r.dependent_milestone).length === 0 ? (
        <p className="text-xs text-slate-400">
          No dependencies. This milestone can start independently.
        </p>
      ) : (
        <div className="space-y-2 pt-1">
          {rows
            .filter((r) => r.dependent_milestone)
            .map((row) => {
              const id = row.dependent_milestone;
              const label =
                row.milestone_name ||
                optionByValue.get(id)?.label ||
                id;
              const order =
                row.dependent_milestone_order ?? optionByValue.get(id)?.order;
              const type: DependencyType =
                row.dependency_type || "Full Dependence";
              const isPartial = type === "Partial Dependence";
              const partialPct = row.dependency_percentage;
              const rowInvalid =
                isPartial &&
                (partialPct == null || partialPct < 1 || partialPct > 99);
              return (
                <div
                  key={id}
                  className={`rounded-md border bg-white px-2.5 py-2 transition-colors ${rowInvalid
                      ? "border-red-300"
                      : isPartial
                        ? "border-amber-300"
                        : "border-emerald-300"
                    }`}
                >
                  <div className="flex items-center gap-2">
                    {order != null && (
                      <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1 rounded bg-indigo-50 text-indigo-700 text-[11px] font-semibold tabular-nums shrink-0 ring-1 ring-inset ring-indigo-100">
                        {order}
                      </span>
                    )}
                    <span className="text-xs text-slate-800 truncate flex-1">
                      {label}
                    </span>
                    <span
                      className={`shrink-0 inline-flex items-center h-5 px-1.5 rounded text-[10px] font-semibold tabular-nums ${rowInvalid
                          ? "bg-red-50 text-red-700"
                          : isPartial
                            ? "bg-amber-50 text-amber-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                    >
                      {rowInvalid
                        ? "% required"
                        : isPartial
                          ? `Partial · ${partialPct}%`
                          : "Full · 100%"}
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setRows((prev) =>
                          prev.filter((r) => r.dependent_milestone !== id)
                        )
                      }
                      className="h-7 w-7 text-slate-400 hover:text-red-600 shrink-0"
                      aria-label="Remove dependency"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5 pl-[26px]">
                    <span className="text-[11px] font-medium text-slate-600">
                      Dependency Percentage:
                    </span>
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name={`deptype-${id}`}
                        checked={!isPartial}
                        onChange={() => setType(id, "Full Dependence")}
                        className="h-3 w-3"
                      />
                      Full (100%)
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name={`deptype-${id}`}
                        checked={isPartial}
                        onChange={() => setType(id, "Partial Dependence")}
                        className="h-3 w-3"
                      />
                      Partial
                    </label>
                    {isPartial && (() => {
                      const pct = row.dependency_percentage;
                      const invalid =
                        pct == null || pct < 1 || pct > 99;
                      return (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={99}
                            required
                            aria-required="true"
                            aria-invalid={invalid}
                            value={pct == null ? "" : pct}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateRow(id, {
                                dependency_percentage:
                                  v === "" ? undefined : Number(v),
                              });
                            }}
                            placeholder="1-99"
                            className={`h-6 w-16 rounded border px-1.5 text-[11px] tabular-nums focus:outline-none focus:ring-1 ${invalid
                                ? "border-red-400 focus:ring-red-400 bg-red-50"
                                : "border-slate-300 focus:ring-indigo-400"
                              }`}
                          />
                          <span className="text-[11px] text-slate-500">%</span>
                          <span
                            className="text-red-500 text-[11px] font-semibold"
                            aria-hidden="true"
                            title="Required"
                          >
                            *
                          </span>
                          {invalid && (
                            <span className="text-[10px] text-red-600">
                              Required (1-99)
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};

// --- Critical PO Dependencies Section ---
interface CriticalPODependenciesSectionProps {
  rows: WorkMilestoneCriticalPODependency[];
  setRows: React.Dispatch<
    React.SetStateAction<WorkMilestoneCriticalPODependency[]>
  >;
  pickerOptions: CriticalPickerOption[];
  itemsByName: Map<string, CriticalPOItemOption>;
  workPackage?: string;
}

const CriticalPODependenciesSection: React.FC<
  CriticalPODependenciesSectionProps
> = ({ rows, setRows, pickerOptions, itemsByName, workPackage }) => {
  const pickedIds = useMemo(
    () => new Set(rows.map((r) => r.critical_po_item).filter(Boolean)),
    [rows]
  );

  const availableOptions = useMemo<CriticalPickerOption[]>(
    () => pickerOptions.filter((o) => !pickedIds.has(o.value)),
    [pickerOptions, pickedIds]
  );

  const addRow = (opt: CriticalPickerOption) => {
    if (pickedIds.has(opt.value)) return;
    const meta = itemsByName.get(opt.value);
    setRows((prev) => [
      ...prev,
      {
        critical_po_item: opt.value,
        item_name: meta?.item_name,
        sub_category: meta?.sub_category,
        critical_po_category: meta?.critical_po_category,
        delivery_percentage: undefined,
        remarks: "",
      },
    ]);
  };

  const removeRow = (itemId: string) => {
    setRows((prev) => prev.filter((r) => r.critical_po_item !== itemId));
  };

  const updateField = (
    itemId: string,
    field: keyof WorkMilestoneCriticalPODependency,
    val: any
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        r.critical_po_item === itemId ? { ...r, [field]: val } : r
      )
    );
  };

  const formatOptionLabel = (option: CriticalPickerOption) => (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="text-slate-800">
        {option.itemName || option.label}
      </span>
      {option.subCategory && (
        <>
          <span className="text-slate-300">·</span>
          <span className="text-blue-600">{option.subCategory}</span>
        </>
      )}
    </div>
  );

  return (
    <div className="border-t pt-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-800">
          Critical PO Dependencies
        </h4>
        {workPackage && (
          <span className="inline-flex items-center h-5 px-1.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">
            Package: {workPackage}
          </span>
        )}
      </div>
      <ReactSelect<CriticalPickerOption, false>
        value={null}
        options={availableOptions}
        onChange={(opt) => {
          if (opt) addRow(opt as CriticalPickerOption);
        }}
        formatOptionLabel={formatOptionLabel}
        placeholder={
          availableOptions.length === 0
            ? pickerOptions.length === 0 && workPackage
              ? `No Critical PO Items in "${workPackage}"`
              : "All Critical PO Items added"
            : "Search & add Critical PO Item..."
        }
        isDisabled={availableOptions.length === 0}
        classNamePrefix="react-select"
        styles={{
          menuPortal: (base) => ({ ...base, zIndex: 9999 }),
          menu: (base) => ({ ...base, zIndex: 9999 }),
          control: (base) => ({ ...base, minHeight: 36, fontSize: 13 }),
        }}
      />
      {rows.filter((r) => r.critical_po_item).length === 0 ? (
        <p className="text-xs text-slate-400">
          No critical PO gates configured.
        </p>
      ) : (
        <div className="space-y-2 pt-1">
          {rows
            .filter((r) => r.critical_po_item)
            .map((row, idx) => {
              const subCategory =
                row.sub_category ||
                itemsByName.get(row.critical_po_item)?.sub_category;
              const itemName =
                row.item_name ||
                itemsByName.get(row.critical_po_item)?.item_name ||
                row.critical_po_item;
              const pct = row.delivery_percentage;
              const invalid = pct == null || pct <= 0 || pct > 100;
              return (
                <div
                  key={row.critical_po_item}
                  className={`rounded-md border bg-white p-2.5 space-y-2 transition-colors ${invalid ? "border-red-300" : "border-emerald-300"
                    }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-sm flex-wrap min-w-0 flex-1">
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded bg-slate-100 text-slate-600 text-[11px] font-semibold tabular-nums shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-medium text-slate-800 truncate">
                        {itemName}
                      </span>
                      {subCategory && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="text-blue-600">{subCategory}</span>
                        </>
                      )}
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center h-5 px-1.5 rounded text-[10px] font-semibold tabular-nums ${invalid
                          ? "bg-red-50 text-red-700"
                          : "bg-emerald-50 text-emerald-700"
                        }`}
                    >
                      {invalid ? "% required" : `${pct}%`}
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeRow(row.critical_po_item)}
                      className="h-7 w-7 text-slate-400 hover:text-red-600 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="space-y-1 shrink-0">
                      <label
                        htmlFor={`pct-${row.critical_po_item}`}
                        className="block text-[11px] font-medium text-slate-600"
                      >
                        Delivery %{" "}
                        <span className="text-red-500" aria-hidden="true">
                          *
                        </span>
                      </label>
                      <div className="flex items-center gap-1">
                        <Input
                          id={`pct-${row.critical_po_item}`}
                          type="number"
                          min={1}
                          max={100}
                          step="0.01"
                          required
                          aria-required="true"
                          aria-invalid={invalid}
                          value={pct == null ? "" : pct}
                          onChange={(e) =>
                            updateField(
                              row.critical_po_item,
                              "delivery_percentage",
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value)
                            )
                          }
                          className={`h-8 w-20 text-xs ${invalid
                              ? "border-red-400 focus-visible:ring-red-400 bg-white"
                              : "bg-white"
                            }`}
                          placeholder="1-100"
                        />
                        <span className="text-xs text-slate-500">%</span>
                      </div>
                      {invalid && (
                        <span className="block text-[10px] text-red-600">
                          Required (1-100)
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 flex-1 min-w-0">
                      <label
                        htmlFor={`remarks-${row.critical_po_item}`}
                        className="block text-[11px] font-medium text-slate-600"
                      >
                        Remarks{" "}
                        <span className="text-slate-400 font-normal">
                          (optional)
                        </span>
                      </label>
                      <Textarea
                        id={`remarks-${row.critical_po_item}`}
                        value={row.remarks || ""}
                        onChange={(e) =>
                          updateField(
                            row.critical_po_item,
                            "remarks",
                            e.target.value
                          )
                        }
                        placeholder="Notes about this critical PO dependency..."
                        className="text-xs min-h-[44px]"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
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
            className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? "rotate-90" : ""
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
              <div onClick={(e) => e.stopPropagation()} className="flex items-center">
                <EditWorkHeaderDialog
                  header={header}
                  mutate={workHeadersMutate}
                  milestoneMutate={workMilestonesMutate}
                  workPackages={workPackages}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-slate-500">
                {milestones.length} milestone{milestones.length !== 1 ? "s" : ""}
              </p>
              {header.header_weightage != null && header.header_weightage > 0 && (
                <span className="inline-flex items-center gap-1.5 pl-2 pr-0.5 py-0.5 rounded bg-amber-50 text-amber-700 text-xs font-medium ring-1 ring-inset ring-amber-200">
                  <Scale className="w-3 h-3" />
                  <span className="uppercase tracking-wide text-[10px] text-amber-600/80">
                    Weightage
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-amber-500 text-white text-xs font-semibold tabular-nums">
                    {header.header_weightage.toFixed(2)}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div
          className="flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {isReordering ? (
            <div className="flex items-stretch border border-slate-200 rounded-md shadow-sm overflow-hidden bg-white">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancelReorder}
                disabled={isSaving}
                className="rounded-none h-8 px-3 text-xs text-slate-600 border-r border-slate-100 hover:bg-slate-50"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveOrder}
                disabled={isSaving}
                className="rounded-none h-8 px-3 text-xs bg-slate-900 hover:bg-slate-800 text-white"
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
            </div>
          ) : (
            <>
              {/* <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsReordering(true)}
                disabled={milestoneList.length <= 1}
                className="h-8 text-xs text-slate-600 hover:bg-slate-100 border border-slate-200 shadow-sm"
              >
                <GripVertical className="w-3.5 h-3.5 mr-1" />
                Reorder
              </Button> */}

              <div className="flex flex-col items-stretch border border-slate-200 rounded-md shadow-sm overflow-hidden bg-white w-36">
                {/* <CreateWorkMilestoneDialog
                  workHeaderId={header.name}
                  mutate={workMilestonesMutate}
                  nextOrder={maxOrder + 1}
                /> */}
                <BulkEditMilestonesDialog
                  workHeaderId={header.name}
                  headerName={header.work_header_name}
                  milestones={milestoneList}
                  mutate={workMilestonesMutate}
                />
              </div>
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
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow className="bg-slate-50/50 border-b border-slate-100">
                    {isReordering && (
                      <TableHead className="w-12 text-center text-slate-500 font-medium text-xs uppercase tracking-wider">
                        #
                      </TableHead>
                    )}
                    {!isReordering && (
                      <TableHead className="w-12 text-center text-slate-500 font-medium text-xs uppercase tracking-wider">
                        #
                      </TableHead>
                    )}
                    <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider">
                      Milestone
                    </TableHead>
                    {!isReordering && (
                      <>
                        <TableHead className="w-24 text-slate-500 font-medium text-xs uppercase tracking-wider">
                          Weightage
                        </TableHead>
                        <TableHead className="w-20 text-center text-slate-500 font-medium text-xs uppercase tracking-wider">
                          Dependence
                        </TableHead>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((w) => (
                          <TableHead key={w} className="w-12 text-center text-slate-500 font-medium text-[10px] uppercase tracking-wider">
                            W{w}
                          </TableHead>
                        ))}
                      </>
                    )}
                    <TableHead
                      className={`${isReordering ? "w-16" : "w-24"
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
                      className={`border-b border-slate-50 last:border-0 transition-colors ${isReordering
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
                      {!isReordering && (
                        <TableCell className="text-center">
                          <span className="inline-flex items-center justify-center w-6 h-5 rounded bg-slate-100 text-slate-500 text-[11px] font-medium tabular-nums">
                            {milestone.work_milestone_order ?? index + 1}
                          </span>
                        </TableCell>
                      )}
                      <TableCell className="font-medium text-slate-800">
                        {milestone.work_milestone_name}
                      </TableCell>
                      {!isReordering && (
                        <>
                          <TableCell className="text-slate-600">
                            {(milestone.weightage || 1.0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-center">
                            <DependencePreviewCell
                              milestoneName={milestone.name}
                            />
                          </TableCell>
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((w) => (
                            <TableCell key={w} className="text-center text-slate-500 text-xs">
                              {(milestone[`week_${w}` as keyof WorkMilestone] as number | undefined) || 0}
                            </TableCell>
                          ))}
                        </>
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
                            <MilestoneDependenciesDialog
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
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// --- Dependence Preview Cell (hover-card icon shown in milestone list) ---
interface DependencePreviewCellProps {
  milestoneName: string;
}

const DependencePreviewCell: React.FC<DependencePreviewCellProps> = ({
  milestoneName,
}) => {
  // Lazy fetch: only request the full doc once the user has interacted.
  const [shouldFetch, setShouldFetch] = useState(false);
  // Controlled open so we can support both hover (desktop) and click (touch).
  const [open, setOpen] = useState(false);

  const { data: fullMilestone, isLoading } = useFrappeGetDoc<WorkMilestone>(
    "Work Milestones",
    milestoneName,
    shouldFetch ? undefined : null
  );

  const deps = fullMilestone?.dependent_milestones || [];
  const critical = fullMilestone?.critical_po_dependencies || [];
  const hasAny = deps.length > 0 || critical.length > 0;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !shouldFetch) setShouldFetch(true);
  };

  // On touch devices there is no pointer-leave to auto-close the card.
  // Listen for a tap outside both the trigger and the content to close it.
  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: TouchEvent) => {
      if (!(e.target as HTMLElement).closest("[data-hover-card]")) {
        setOpen(false);
      }
    };
    document.addEventListener("touchstart", handleOutside);
    return () => document.removeEventListener("touchstart", handleOutside);
  }, [open]);

  return (
    <HoverCard open={open} onOpenChange={handleOpenChange} delayDuration={150}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => {
            // Tap support for tablet/mobile (and desktop click as a bonus).
            handleOpenChange(!open);
          }}
          className="inline-flex items-center justify-center h-6 w-6 rounded text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
          aria-label={open ? "Hide dependencies" : "View dependencies"}
        >
          {open ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="center" className="w-80 p-0 overflow-hidden">
        {!shouldFetch || isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 p-4">
            <TailSpin width={12} height={12} color="#64748b" />
            Loading…
          </div>
        ) : !hasAny ? (
          <p className="text-xs text-slate-500 p-4">
            No dependencies configured.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {deps.length > 0 && (
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                      Dependent Milestones
                    </span>
                  </div>
                  <span className="inline-flex items-center justify-center min-w-[20px] h-4 px-1.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-semibold tabular-nums">
                    {deps.length}
                  </span>
                </div>
                <ul className="space-y-1 max-h-[180px] overflow-y-auto pr-1">
                  {deps.map((d) => {
                    const isPartial =
                      d.dependency_type === "Partial Dependence" ||
                      (d.dependency_percentage != null &&
                        d.dependency_percentage < 100);
                    const pct =
                      d.dependency_percentage != null
                        ? d.dependency_percentage
                        : 100;
                    return (
                      <li
                        key={d.name || d.dependent_milestone}
                        className="flex items-center gap-2 text-xs"
                      >
                        {d.dependent_milestone_order != null && (
                          <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1 rounded bg-indigo-50 text-indigo-700 text-[11px] font-semibold tabular-nums shrink-0 ring-1 ring-inset ring-indigo-100">
                            {d.dependent_milestone_order}
                          </span>
                        )}
                        <span className="text-slate-700 font-normal truncate flex-1">
                          {d.milestone_name || d.dependent_milestone}
                        </span>
                        <span
                          className={`shrink-0 inline-flex items-center h-4 px-1.5 rounded text-[10px] font-semibold tabular-nums ring-1 ring-inset ${isPartial
                              ? "bg-amber-50 text-amber-700 ring-amber-100"
                              : "bg-emerald-50 text-emerald-700 ring-emerald-100"
                            }`}
                          title={isPartial ? "Partial Dependence" : "Full Dependence"}
                        >
                          {pct}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {critical.length > 0 && (
              <div className="p-3 bg-slate-50/40">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-amber-600" />
                    <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                      Critical PO Gates
                    </span>
                  </div>
                  <span className="inline-flex items-center justify-center min-w-[20px] h-4 px-1.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-semibold tabular-nums">
                    {critical.length}
                  </span>
                </div>
                <ul className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {critical.map((c, idx) => {
                    const pct = c.delivery_percentage ?? 0;
                    const pillCls =
                      pct >= 70
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : pct >= 30
                          ? "bg-amber-50 text-amber-700 ring-amber-200"
                          : "bg-rose-50 text-rose-700 ring-rose-200";
                    return (
                      <li
                        key={c.name || c.critical_po_item}
                        className="text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1 rounded bg-amber-50 text-amber-700 text-[11px] font-semibold tabular-nums shrink-0 ring-1 ring-inset ring-amber-100">
                              {idx + 1}
                            </span>
                            <span className="min-w-0 truncate">
                              <span className="text-slate-700 font-normal">
                                {c.item_name || c.critical_po_item}
                              </span>
                              {c.sub_category && (
                                <span className="text-blue-600 font-normal ml-1">
                                  · {c.sub_category}
                                </span>
                              )}
                            </span>
                          </div>
                          <span
                            className={`inline-flex items-center justify-center min-w-[44px] h-5 px-1.5 rounded text-[11px] font-semibold tabular-nums ring-1 ring-inset shrink-0 ${pillCls}`}
                            title="Required delivery %"
                          >
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                        {c.remarks && (
                          <div className="text-[9px] text-slate-500 leading-snug mt-0.5 ml-7 text-left">
                            <span className="text-slate-400 mr-1">Remarks:</span>
                            {c.remarks}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
};

export default WorkHeaderMilestones;
