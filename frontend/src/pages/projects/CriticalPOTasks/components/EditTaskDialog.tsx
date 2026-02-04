import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { TailSpin } from "react-loader-spinner";
import { Pencil, X, ChevronDown, ChevronUp, AlertCircle, Link as LinkIcon, AlertTriangle } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useFrappeUpdateDoc, useFrappeGetDocList, useFrappeGetDoc } from "frappe-react-sdk";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { DatePicker } from "antd";
import dayjs from "dayjs";
import ReactSelect from "react-select";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";

// Zod Schema
const editTaskFormSchema = z.object({
  status: z.enum(["PR Not Released", "Not Released", "Released", "Not Applicable"]),
  revised_date: z.string().optional(),
  remarks: z.string().optional(),
});

type EditTaskFormValues = z.infer<typeof editTaskFormSchema>;

// Type for cross-task PO conflict info
interface POConflictInfo {
  poName: string;
  linkedTo: {
    taskName: string;
    itemName: string;
    category: string;
  }[];
}

// Helper to parse associated_pos from string or object
const parseAssociatedPOs = (associated: any): string[] => {
  try {
    if (typeof associated === "string") {
      const parsed = JSON.parse(associated);
      return parsed?.pos || [];
    } else if (associated && typeof associated === "object") {
      return associated.pos || [];
    }
    return [];
  } catch {
    return [];
  }
};

interface EditTaskDialogProps {
  task: CriticalPOTask;
  projectId: string;
  mutate: () => Promise<any>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const EditTaskDialog: React.FC<EditTaskDialogProps> = ({
  task,
  projectId,
  mutate,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange
}) => {
  const [internalOpen, setInternalOpen] = useState(false);

  // Support both controlled and uncontrolled modes
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (controlledOnOpenChange ?? (() => {})) : setInternalOpen;
  const [linkSectionOpen, setLinkSectionOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<string>("");
  const [selectedPOs, setSelectedPOs] = useState<Set<string>>(new Set());
  const [isLinking, setIsLinking] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [poToUnlink, setPoToUnlink] = useState<string | null>(null);

  // State for cross-task conflict detection
  const [conflictingPOs, setConflictingPOs] = useState<POConflictInfo[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);

  const { updateDoc, loading } = useFrappeUpdateDoc();

  const form = useForm<EditTaskFormValues>({
    resolver: zodResolver(editTaskFormSchema),
    defaultValues: {
      status: task.status,
      revised_date: task.revised_date || "",
      remarks: task.remarks || "",
    },
  });

  // Custom styles for react-select
  const selectStyles = {
    control: (base: any) => ({
      ...base,
      minHeight: '36px',
      borderColor: 'hsl(var(--input))',
      '&:hover': {
        borderColor: 'hsl(var(--ring))',
      },
    }),
    menu: (base: any) => ({
      ...base,
      zIndex: 9999,
    }),
    menuPortal: (base: any) => ({
      ...base,
      zIndex: 9999,
    }),
  };

  // Fetch project data to get work packages
  const { data: projectData } = useFrappeGetDoc<Projects>(
    "Projects",
    projectId,
    open ? undefined : null
  );

  // Extract unique work packages from project_wp_category_makes child table
  const workPackages = useMemo(() => {
    if (!projectData?.project_wp_category_makes) return [];

    const uniqueWPDocNames = new Set<string>();
    projectData.project_wp_category_makes.forEach((item) => {
      if (item.procurement_package) {
        uniqueWPDocNames.add(item.procurement_package);
      }
    });

    return Array.from(uniqueWPDocNames).map((wpDocName) => ({
      work_package_name: wpDocName,
    }));
  }, [projectData]);

  // Create options for react-select
  const packageOptions = useMemo(() => {
    const options = workPackages.map((pkg) => ({
      label: pkg.work_package_name,
      value: pkg.work_package_name,
    }));
    return [...options, { label: "Custom", value: "Custom" }];
  }, [workPackages]);

  // Fetch all POs for the project
  const { data: procurementOrders, isLoading: posLoading } = useFrappeGetDocList<ProcurementOrder>(
    "Procurement Orders",
    {
      fields: ["name", "status", "total_amount", "procurement_request"],
      filters: selectedPackage
        ? [
            ["project", "=", projectId],
            ["status", "not in", ["Merged", "Inactive", "PO Amendment"]],
          ]
        : undefined,
      limit: 0,
      orderBy: { field: "creation", order: "desc" },
    },
    selectedPackage && open ? `POs-${projectId}-edit` : null
  );

  // Fetch PRs to get work_package information
  const { data: procurementRequests, isLoading: prsLoading } = useFrappeGetDocList<ProcurementRequest>(
    "Procurement Requests",
    {
      fields: ["name", "work_package"],
      filters: [["project", "=", projectId]],
      limit: 0,
    },
    selectedPackage && open ? `PRs-${projectId}-edit` : null
  );

  // Fetch ALL Critical PO Tasks for the project (for cross-task conflict detection)
  const { data: allProjectTasks } = useFrappeGetDocList<CriticalPOTask>(
    "Critical PO Tasks",
    {
      fields: ["name", "item_name", "critical_po_category", "associated_pos"],
      filters: [["project", "=", projectId]],
      limit: 0,
    },
    open ? `all-tasks-${projectId}-edit` : null
  );

  // Build a map of PO → other tasks it's linked to (excluding current task)
  const poToOtherTasksMap = useMemo(() => {
    const map = new Map<string, { taskName: string; itemName: string; category: string }[]>();

    allProjectTasks
      ?.filter((t) => t.name !== task.name) // Exclude current task
      .forEach((t) => {
        const pos = parseAssociatedPOs(t.associated_pos);
        pos.forEach((po) => {
          if (!map.has(po)) {
            map.set(po, []);
          }
          map.get(po)!.push({
            taskName: t.name,
            itemName: t.item_name,
            category: t.critical_po_category,
          });
        });
      });

    return map;
  }, [allProjectTasks, task.name]);

  // Get currently linked POs from task
  const currentlyLinkedPOs = useMemo(() => {
    try {
      const associated = task.associated_pos;
      if (typeof associated === "string") {
        const parsed = JSON.parse(associated);
        return parsed?.pos || [];
      } else if (associated && typeof associated === "object") {
        return associated.pos || [];
      }
      return [];
    } catch {
      return [];
    }
  }, [task.associated_pos]);

  // Filter POs by work package and already linked status
  const availablePOs = useMemo(() => {
    if (!procurementOrders || !procurementRequests) return [];

    // Create a map from PO -> work_package via PR
    const poToWorkPackageMap = new Map<string, string>();
    procurementOrders.forEach((po) => {
      const pr = procurementRequests.find((pr) => pr.name === po.procurement_request);
      const workPackage = pr?.work_package?.trim() ? pr.work_package : "Custom";
      poToWorkPackageMap.set(po.name, workPackage);
    });

    // Filter POs by selected work package
    let filteredPOs = procurementOrders;

    if (selectedPackage) {
      filteredPOs = procurementOrders.filter((po) => {
        const poWorkPackage = poToWorkPackageMap.get(po.name);
        return poWorkPackage === selectedPackage;
      });
    }

    // Filter out already linked POs
    const linkedSet = new Set(currentlyLinkedPOs);
    return filteredPOs.filter((po) => !linkedSet.has(po.name));
  }, [procurementOrders, procurementRequests, currentlyLinkedPOs, selectedPackage]);

  // Extract PO ID (2nd part after /)
  const extractPOId = (fullName: string) => {
    const parts = fullName.split("/");
    return parts.length > 1 ? parts[1] : fullName;
  };

  const handlePOToggle = (poId: string) => {
    const newSelected = new Set(selectedPOs);
    if (newSelected.has(poId)) {
      newSelected.delete(poId);
    } else {
      newSelected.add(poId);
    }
    setSelectedPOs(newSelected);
  };

  // Actual linking logic (called after conflict confirmation or if no conflicts)
  const proceedWithLinking = async () => {
    setIsLinking(true);
    setShowConflictDialog(false);

    try {
      // Merge with existing linked POs
      const updatedPOs = Array.from(new Set([...currentlyLinkedPOs, ...selectedPOs]));

      await updateDoc("Critical PO Tasks", task.name, {
        associated_pos: JSON.stringify({ pos: updatedPOs }),
      });

      toast({
        title: "Success",
        description: `Linked ${selectedPOs.size} PO(s) successfully.`,
        variant: "success",
      });

      setSelectedPOs(new Set());
      setSelectedPackage("");
      setLinkSectionOpen(false);
      setConflictingPOs([]);
      await mutate();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to link POs.",
        variant: "destructive",
      });
    } finally {
      setIsLinking(false);
    }
  };

  const handleLinkPOs = async () => {
    if (selectedPOs.size === 0) {
      toast({
        title: "No POs Selected",
        description: "Please select at least one PO to link.",
        variant: "destructive",
      });
      return;
    }

    // Check for cross-task conflicts
    const conflicts: POConflictInfo[] = Array.from(selectedPOs)
      .filter((po) => poToOtherTasksMap.has(po))
      .map((po) => ({
        poName: po,
        linkedTo: poToOtherTasksMap.get(po)!,
      }));

    if (conflicts.length > 0) {
      // Show confirmation dialog with conflict details
      setConflictingPOs(conflicts);
      setShowConflictDialog(true);
      return; // Wait for user confirmation
    }

    // No conflicts, proceed directly
    await proceedWithLinking();
  };

  const handleUnlinkPO = async (poName: string) => {
    setPoToUnlink(poName);
    setIsUnlinking(true);

    try {
      const updatedPOs = currentlyLinkedPOs.filter((po: string) => po !== poName);

      await updateDoc("Critical PO Tasks", task.name, {
        associated_pos: JSON.stringify({ pos: updatedPOs }),
      });

      toast({
        title: "Success",
        description: "PO unlinked successfully.",
        variant: "success",
      });

      await mutate();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to unlink PO.",
        variant: "destructive",
      });
    } finally {
      setIsUnlinking(false);
      setPoToUnlink(null);
    }
  };

  const onSubmit = async (values: EditTaskFormValues) => {
    try {
      await updateDoc("Critical PO Tasks", task.name, {
        status: values.status,
        revised_date: values.revised_date || null,
        remarks: values.remarks || "",
      });
      toast({ title: "Success", description: "Task updated successfully.", variant: "success" });
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  // Reset state when dialog closes
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setLinkSectionOpen(false);
      setSelectedPackage("");
      setSelectedPOs(new Set());
      form.reset({
        status: task.status,
        revised_date: task.revised_date || "",
        remarks: task.remarks || "",
      });
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800 w-full">
          <Pencil className="h-4 w-4 mr-1" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Critical PO Task</DialogTitle>
          <DialogDescription>
            Update status, revised deadline, remarks, and manage associated POs for "{task.item_name}"
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Item Name (Read-only) */}
            <FormItem>
              <FormLabel>Item Name</FormLabel>
              <Input value={task.item_name} disabled className="bg-gray-50" />
            </FormItem>

            {/* Category (Read-only) */}
            <FormItem>
              <FormLabel>Category</FormLabel>
              <Input value={task.critical_po_category} disabled className="bg-gray-50" />
            </FormItem>

            {/* Sub Category (Read-only) */}
            <FormItem>
              <FormLabel>Sub Category</FormLabel>
              <Input value={task.sub_category || "-"} disabled className="bg-gray-50" />
            </FormItem>

            {/* Status (Editable) */}
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="PR Not Released">PR Not Released</SelectItem>
                      <SelectItem value="Not Released">Not Released</SelectItem>
                      <SelectItem value="Released">Released</SelectItem>
                      <SelectItem value="Not Applicable">Not Applicable</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Original PO Release Deadline (Read-only) */}
            <FormItem>
              <FormLabel>Original PO Release Deadline</FormLabel>
              <Input value={task.po_release_date} disabled className="bg-gray-50" />
            </FormItem>

            {/* Revised Deadline (Editable) */}
            <FormField
              control={form.control}
              name="revised_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Revised Deadline (Optional)</FormLabel>
                  <FormControl>
                    <DatePicker
                      format="YYYY-MM-DD"
                      className="w-full"
                      value={field.value ? dayjs(field.value) : null}
                      onChange={(date) => {
                        field.onChange(date ? date.format("YYYY-MM-DD") : "");
                      }}
                      placeholder="Select revised deadline"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Remarks (Editable) */}
            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add any remarks or notes..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Associated POs Section */}
            <div className="border rounded-md p-4 space-y-3">
              <FormLabel className="text-base font-semibold">Associated POs</FormLabel>

              {/* Currently Linked POs */}
              <div className="min-h-[32px]">
                {currentlyLinkedPOs.length === 0 ? (
                  <p className="text-sm text-gray-500">No POs linked yet</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {currentlyLinkedPOs.map((poName: string) => (
                      <Badge
                        key={poName}
                        variant="secondary"
                        className="flex items-center gap-1 pr-1 group hover:bg-red-100 transition-colors"
                      >
                        <span className="text-blue-600">{extractPOId(poName)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-4 w-4 p-0 hover:bg-transparent group-hover:text-red-600"
                          onClick={() => handleUnlinkPO(poName)}
                          disabled={isUnlinking && poToUnlink === poName}
                        >
                          {isUnlinking && poToUnlink === poName ? (
                            <TailSpin height={12} width={12} color="#dc2626" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                        </Button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Collapsible Link New POs Section */}
              <Collapsible open={linkSectionOpen} onOpenChange={setLinkSectionOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <LinkIcon className="h-4 w-4" />
                      Link New POs
                    </span>
                    {linkSectionOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 space-y-3">
                  {/* Package Selector */}
                  <div>
                    <label className="text-sm font-medium mb-1 block">Select Package</label>
                    <ReactSelect
                      options={packageOptions}
                      value={packageOptions.find((opt) => opt.value === selectedPackage) || null}
                      onChange={(option) => {
                        setSelectedPackage(option?.value || "");
                        setSelectedPOs(new Set());
                      }}
                      placeholder="Choose a package..."
                      isClearable
                      menuPlacement="top"
                      styles={selectStyles}
                    />
                  </div>

                  {/* PO List or Instruction */}
                  {!selectedPackage ? (
                    <Alert className="bg-blue-50 border-blue-200">
                      <AlertCircle className="h-4 w-4 text-blue-600" />
                      <AlertDescription className="text-blue-800 text-sm">
                        Select a package to view available POs for linking.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div>
                      <h4 className="text-sm font-medium mb-2 text-gray-700">
                        Available POs ({availablePOs.length})
                      </h4>

                      {posLoading || prsLoading ? (
                        <div className="flex justify-center items-center h-20">
                          <TailSpin width={30} height={30} color="#dc2626" />
                        </div>
                      ) : availablePOs.length === 0 ? (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription className="text-sm">
                            No unlinked POs found for this package.
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-md p-2">
                          {availablePOs.map((po) => (
                            <div
                              key={po.name}
                              className="flex items-start space-x-2 p-2 border rounded hover:bg-gray-50 transition-colors"
                            >
                              <Checkbox
                                id={`po-edit-${po.name}`}
                                checked={selectedPOs.has(po.name)}
                                onCheckedChange={() => handlePOToggle(po.name)}
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <label
                                      htmlFor={`po-edit-${po.name}`}
                                      className="text-sm font-medium cursor-pointer"
                                    >
                                      {extractPOId(po.name)}
                                    </label>
                                    <ItemsHoverCard
                                      parentDoc={{ name: po.name }}
                                      parentDoctype="Procurement Orders"
                                      childTableName="items"
                                    />
                                  </div>
                                  <Badge
                                    variant={
                                      po.status === "Delivered"
                                        ? "default"
                                        : po.status === "PO Approved"
                                        ? "secondary"
                                        : "outline"
                                    }
                                    className="text-xs"
                                  >
                                    {po.status}
                                  </Badge>
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {formatToRoundedIndianRupee(po.total_amount || 0)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Link Selected Button */}
                      {availablePOs.length > 0 && (
                        <div className="flex justify-between items-center mt-3">
                          <span className="text-xs text-gray-500">
                            {selectedPOs.size > 0
                              ? `${selectedPOs.size} PO(s) selected`
                              : "No POs selected"}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleLinkPOs}
                            disabled={isLinking || selectedPOs.size === 0}
                          >
                            {isLinking ? (
                              <>
                                <TailSpin height={14} width={14} color="white" />
                                <span className="ml-1">Linking...</span>
                              </>
                            ) : (
                              "Link Selected"
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? <TailSpin height={20} width={20} color="white" /> : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>

      {/* Cross-Task Conflict Confirmation Dialog */}
      <AlertDialog open={showConflictDialog} onOpenChange={setShowConflictDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              PO Already Linked to Other Tasks
            </AlertDialogTitle>
            <AlertDialogDescription>
              The following PO(s) are already linked to other Critical PO Tasks.
              Linking will associate them with multiple tasks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-[200px] overflow-y-auto space-y-2 my-2">
            {conflictingPOs.map((conflict) => (
              <div
                key={conflict.poName}
                className="p-3 bg-amber-50 rounded-md border border-amber-200"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="font-mono">
                    {extractPOId(conflict.poName)}
                  </Badge>
                  <span className="text-sm text-gray-500">is linked to:</span>
                </div>
                <ul className="ml-2 space-y-1">
                  {conflict.linkedTo.map((linkedTask) => (
                    <li
                      key={linkedTask.taskName}
                      className="text-sm text-gray-700 flex items-start gap-1"
                    >
                      <span className="text-amber-600">•</span>
                      <span>
                        {linkedTask.itemName}{" "}
                        <span className="text-gray-500">({linkedTask.category})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConflictingPOs([])}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={proceedWithLinking}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Link Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
