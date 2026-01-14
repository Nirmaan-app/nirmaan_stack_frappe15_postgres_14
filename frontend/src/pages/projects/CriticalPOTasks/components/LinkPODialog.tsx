import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Link as LinkIcon, AlertCircle, AlertTriangle } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useFrappeGetDocList, useFrappeUpdateDoc, useFrappeGetDoc } from "frappe-react-sdk";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { Badge } from "@/components/ui/badge";
import ReactSelect from "react-select";

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

interface LinkPODialogProps {
  task: CriticalPOTask;
  projectId: string;
  mutate: () => Promise<any>;
}

export const LinkPODialog: React.FC<LinkPODialogProps> = ({ task, projectId, mutate }) => {
  const [open, setOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<string>("");
  const [selectedPOs, setSelectedPOs] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState(false);

  // State for cross-task conflict detection
  const [conflictingPOs, setConflictingPOs] = useState<POConflictInfo[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);

  const { updateDoc } = useFrappeUpdateDoc();

  // Custom styles for react-select
  const selectStyles = {
    control: (base: any) => ({
      ...base,
      minHeight: '40px',
      borderColor: 'hsl(var(--input))',
      '&:hover': {
        borderColor: 'hsl(var(--ring))',
      },
    }),
    menu: (base: any) => ({
      ...base,
      zIndex: 9999,
    }),
  };

  // Fetch project data to get work packages
  const { data: projectData } = useFrappeGetDoc<Projects>("Projects", projectId);

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

  // Fetch all POs for the project (we'll filter by work package on the frontend)
  const {
    data: procurementOrders,
    isLoading: posLoading,
  } = useFrappeGetDocList<ProcurementOrder>(
    "Procurement Orders",
    {
      fields: [
        "name",
        "status",
        "total_amount",
        "procurement_request",
      ],
      filters: selectedPackage
        ? [
            ["project", "=", projectId],
            ["status", "not in", ["Merged", "Inactive", "PO Amendment"]],
          ]
        : undefined,
      limit: 0,
      orderBy: { field: "creation", order: "desc" },
    },
    selectedPackage ? `POs-${projectId}` : null
  );

  // Fetch PRs to get work_package information
  const {
    data: procurementRequests,
    isLoading: prsLoading,
  } = useFrappeGetDocList<ProcurementRequest>(
    "Procurement Requests",
    {
      fields: ["name", "work_package"],
      filters: [["project", "=", projectId]],
      limit: 0,
    },
    selectedPackage ? `PRs-${projectId}` : null
  );

  // Fetch ALL Critical PO Tasks for the project (for cross-task conflict detection)
  const { data: allProjectTasks } = useFrappeGetDocList<CriticalPOTask>(
    "Critical PO Tasks",
    {
      fields: ["name", "item_name", "critical_po_category", "associated_pos"],
      filters: [["project", "=", projectId]],
      limit: 0,
    },
    open ? `all-tasks-${projectId}-link` : null
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
        return new Set(parsed?.pos || []);
      } else if (associated && typeof associated === "object") {
        return new Set(associated.pos || []);
      }
      return new Set<string>();
    } catch {
      return new Set<string>();
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
    return filteredPOs.filter((po) => !currentlyLinkedPOs.has(po.name));
  }, [procurementOrders, procurementRequests, currentlyLinkedPOs, selectedPackage]);

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
    setIsUpdating(true);
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
      setConflictingPOs([]);
      await mutate();
      setOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to link POs.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
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

  // Extract PO ID (2nd part after /)
  const extractPOId = (fullName: string) => {
    const parts = fullName.split("/");
    return parts.length > 1 ? parts[1] : fullName;
  };

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-green-600 hover:text-green-800 w-full">
          <LinkIcon className="h-4 w-4 mr-1" />
          Link PO
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] sm:max-w-[900px] max-h-[90vh] min-h-[500px] flex flex-col">
        <DialogHeader>
          <DialogTitle>Link Purchase Orders</DialogTitle>
          <DialogDescription>
            Select a package to filter POs, then choose which POs to link to this task.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-[350px]">
          {/* Package Selector */}
          <div className="mb-4">
            <label className="text-sm font-medium mb-2 block">Select Package</label>
            <div className="w-full">
              <ReactSelect
                options={packageOptions}
                value={packageOptions.find((opt) => opt.value === selectedPackage) || null}
                onChange={(option) => setSelectedPackage(option?.value || "")}
                placeholder="Choose a package..."
                isClearable
                menuPosition="auto"
                styles={selectStyles}
              />
            </div>
          </div>

          {/* PO List or Instruction */}
          {!selectedPackage ? (
            <Alert className="bg-blue-50 border-blue-200">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                Please select a package from the dropdown above to view available Purchase Orders for linking.
              </AlertDescription>
            </Alert>
          ) : (
            <div>
              <h3 className="text-sm font-semibold mb-3 text-gray-700">
                Available Purchase Orders ({availablePOs.length})
              </h3>

              {posLoading || prsLoading ? (
                <div className="flex justify-center items-center h-32">
                  <TailSpin width={40} height={40} color="#dc2626" />
                </div>
              ) : availablePOs.length === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No unlinked POs found for this package. All POs may already be linked to this task.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-2 max-h-[50vh] overflow-y-auto border rounded-md p-3">
                  {availablePOs.map((po) => (
                    <div
                      key={po.name}
                      className="flex items-start space-x-3 p-3 border rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <Checkbox
                        id={`po-${po.name}`}
                        checked={selectedPOs.has(po.name)}
                        onCheckedChange={() => handlePOToggle(po.name)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <label
                              htmlFor={`po-${po.name}`}
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
                          >
                            {po.status}
                          </Badge>
                        </div>
                        <div className="text-sm text-gray-500 mt-1">
                          Amount: {formatToRoundedIndianRupee(po.total_amount || 0)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex justify-between items-center w-full">
            <span className="text-sm text-gray-500">
              {selectedPOs.size > 0
                ? `${selectedPOs.size} PO(s) selected`
                : "No POs selected"}
            </span>
            <div className="space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSelectedPOs(new Set());
                  setSelectedPackage("");
                  setOpen(false);
                }}
                disabled={isUpdating}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleLinkPOs}
                disabled={isUpdating || selectedPOs.size === 0}
              >
                {isUpdating ? (
                  <>
                    <TailSpin height={16} width={16} color="white" />
                    <span className="ml-2">Linking...</span>
                  </>
                ) : (
                  "Link Selected"
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
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
