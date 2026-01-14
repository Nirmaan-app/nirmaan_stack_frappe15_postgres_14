import React, { useState, useMemo, useCallback } from "react";
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import ReactSelect from "react-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import {
  Pencil,
  X,
  Unlink,
  AlertTriangle,
} from "lucide-react";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { formatDate } from "@/utils/FormatDate";

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

interface LinkedCriticalPOTagProps {
  poName: string;
  projectId: string;
  onUpdate?: () => Promise<any>;
  canEdit?: boolean; // Controls whether edit/unlink functionality is available
}

interface TaskOption {
  label: string;
  value: string;
  data: CriticalPOTask;
}

// React-Select custom styles
const selectStyles = {
  control: (base: any, state: any) => ({
    ...base,
    minHeight: "36px",
    fontSize: "14px",
    borderColor: state.isFocused ? "#f59e0b" : "#e2e8f0",
    boxShadow: state.isFocused ? "0 0 0 1px #f59e0b" : "none",
    "&:hover": { borderColor: "#f59e0b" },
    backgroundColor: "#fff",
  }),
  option: (base: any, state: any) => ({
    ...base,
    fontSize: "14px",
    backgroundColor: state.isSelected
      ? "#f59e0b"
      : state.isFocused
      ? "#fef3c7"
      : "#fff",
    color: state.isSelected ? "#fff" : "#1e293b",
    "&:active": { backgroundColor: "#fbbf24" },
  }),
  menu: (base: any) => ({
    ...base,
    zIndex: 9999,
    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
    border: "1px solid #e2e8f0",
  }),
  placeholder: (base: any) => ({
    ...base,
    color: "#94a3b8",
  }),
};

export const LinkedCriticalPOTag: React.FC<LinkedCriticalPOTagProps> = ({
  poName,
  projectId,
  onUpdate,
  canEdit = false,
}) => {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
  const [selectedNewTask, setSelectedNewTask] = useState<TaskOption | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  // Track which specific task is being edited (for per-task editing with multiple linked tasks)
  const [taskToEdit, setTaskToEdit] = useState<CriticalPOTask | null>(null);

  const { updateDoc } = useFrappeUpdateDoc();

  // Fetch Critical PO Tasks for the project
  const { data: tasks = [], mutate } = useFrappeGetDocList<CriticalPOTask>(
    "Critical PO Tasks",
    {
      fields: [
        "name",
        "project",
        "critical_po_category",
        "item_name",
        "sub_category",
        "po_release_date",
        "status",
        "associated_pos",
      ],
      filters: [["project", "=", projectId]],
      limit: 0,
    }
  );

  // Find ALL tasks that have this PO linked (supports multiple task links)
  const linkedTasks = useMemo<CriticalPOTask[]>(() => {
    return tasks.filter((task) => {
      const pos = parseAssociatedPOs(task.associated_pos);
      return pos.includes(poName);
    });
  }, [tasks, poName]);

  // Create task options for re-linking (excludes all currently linked tasks)
  const getTaskOptionsExcluding = useCallback((excludeTaskName: string): TaskOption[] => {
    const linkedTaskNames = new Set(linkedTasks.map((t) => t.name));
    return tasks
      .filter((task) => task.name !== excludeTaskName && !linkedTaskNames.has(task.name))
      .map((task) => ({
        label: task.sub_category
          ? `${task.item_name} (${task.sub_category})`
          : task.item_name,
        value: task.name,
        data: task,
      }));
  }, [tasks, linkedTasks]);

  // Get linked POs for a task
  const getLinkedPOs = (task: CriticalPOTask): string[] => {
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
  };

  // Handle unlink - uses taskToEdit for per-task unlinking
  const handleUnlink = useCallback(async () => {
    if (!taskToEdit) return;

    setIsUpdating(true);
    try {
      const currentPOs = getLinkedPOs(taskToEdit);
      const updatedPOs = currentPOs.filter((po) => po !== poName);

      await updateDoc("Critical PO Tasks", taskToEdit.name, {
        associated_pos: JSON.stringify({ pos: updatedPOs }),
      });

      toast({
        title: "Success",
        description: `PO unlinked from "${taskToEdit.item_name}".`,
        variant: "success",
      });

      await mutate();
      if (onUpdate) await onUpdate();
      setUnlinkDialogOpen(false);
      setTaskToEdit(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to unlink PO.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  }, [taskToEdit, poName, updateDoc, mutate, onUpdate]);

  // Handle change to different task - uses taskToEdit for per-task editing
  const handleChangeTask = useCallback(async () => {
    if (!taskToEdit || !selectedNewTask) return;

    setIsUpdating(true);
    try {
      // Remove from old task
      const oldPOs = getLinkedPOs(taskToEdit);
      const updatedOldPOs = oldPOs.filter((po) => po !== poName);

      await updateDoc("Critical PO Tasks", taskToEdit.name, {
        associated_pos: JSON.stringify({ pos: updatedOldPOs }),
      });

      // Add to new task
      const newTaskPOs = getLinkedPOs(selectedNewTask.data);
      const updatedNewPOs = [...newTaskPOs, poName];

      await updateDoc("Critical PO Tasks", selectedNewTask.data.name, {
        associated_pos: JSON.stringify({ pos: updatedNewPOs }),
      });

      toast({
        title: "Success",
        description: `PO moved to "${selectedNewTask.data.item_name}".`,
        variant: "success",
      });

      await mutate();
      if (onUpdate) await onUpdate();
      setEditDialogOpen(false);
      setSelectedNewTask(null);
      setTaskToEdit(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to change linked task.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  }, [taskToEdit, selectedNewTask, poName, updateDoc, mutate, onUpdate]);

  // Helper to open edit dialog for a specific task
  const openEditDialog = useCallback((task: CriticalPOTask) => {
    setTaskToEdit(task);
    setEditDialogOpen(true);
  }, []);

  // Get task options for the currently editing task
  const currentTaskOptions = useMemo(() => {
    if (!taskToEdit) return [];
    return getTaskOptionsExcluding(taskToEdit.name);
  }, [taskToEdit, getTaskOptionsExcluding]);

  // If no linked tasks, don't render anything
  if (linkedTasks.length === 0) {
    return null;
  }

  return (
    <>
      {/* Linked Task Tags - Multiple badges with horizontal wrap */}
      <div className="flex flex-wrap items-center gap-2 mt-1">
        {linkedTasks.map((task) => (
          <Tooltip key={task.name}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={`
                  group relative inline-flex items-center gap-1.5
                  px-2 py-0.5 rounded-md text-xs font-medium
                  bg-gradient-to-r from-red-50 to-amber-50
                  border border-red-200/60
                  text-slate-700
                  shadow-sm shadow-red-100/50
                  transition-all duration-200 ease-out
                  ${canEdit
                    ? "cursor-pointer hover:shadow-md hover:shadow-red-200/40 hover:border-red-300 hover:from-red-100 hover:to-amber-100"
                    : "cursor-default"
                  }
                `}
                onClick={canEdit ? () => openEditDialog(task) : undefined}
              >
                {/* Pulsing critical indicator dot */}
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>

                {/* Task name with truncation */}
                <span className="truncate max-w-[120px] tracking-tight">
                  {task.item_name}
                </span>

                {/* Sub-category in muted style */}
                {task.sub_category && (
                  <span className="text-slate-400 font-normal truncate max-w-[60px]">
                    · {task.sub_category}
                  </span>
                )}

                {/* Edit indicator on hover */}
                {canEdit && (
                  <Pencil className="w-3 h-3 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity duration-150 ml-0.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="bg-slate-900 text-white border-slate-800 shadow-xl"
            >
              <div className="space-y-1.5 text-xs py-0.5">
                <div className="flex items-center gap-1.5 text-red-400 font-semibold">
                  <AlertTriangle className="w-3 h-3" />
                  Critical PO Task
                </div>
                <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-slate-300">
                  <span className="text-slate-500">Category</span>
                  <span>{task.critical_po_category}</span>
                  <span className="text-slate-500">Deadline</span>
                  <span className="text-amber-400">{formatDate(task.po_release_date)}</span>
                  <span className="text-slate-500">Status</span>
                  <span>{task.status}</span>
                </div>
                {canEdit && (
                  <p className="text-slate-500 pt-1 border-t border-slate-700 mt-1">
                    Click to edit link
                  </p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Edit Dialog - Only rendered when canEdit is true and taskToEdit is set */}
      {canEdit && taskToEdit && (
        <Dialog
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) {
              setTaskToEdit(null);
              setSelectedNewTask(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-[450px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                Edit Critical PO Task Link
              </DialogTitle>
              <DialogDescription>
                Change or remove the linked Critical PO Task for this PO.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Current Link Info */}
              <div className="p-3 bg-gradient-to-r from-red-50 to-amber-50 border border-red-200/60 rounded-md">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">
                    Currently Linked To
                  </span>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Item</span>
                    <p className="font-medium text-slate-800">{taskToEdit.item_name}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Category</span>
                    <p className="font-medium text-slate-800">{taskToEdit.critical_po_category}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Sub-Category</span>
                    <p className="font-medium text-slate-800">{taskToEdit.sub_category || "-"}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Deadline</span>
                    <p className="font-medium text-slate-800">{formatDate(taskToEdit.po_release_date)}</p>
                  </div>
                </div>
              </div>

              {/* Change To Different Task */}
              {currentTaskOptions.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Change To Different Task</Label>
                  <ReactSelect<TaskOption>
                    options={currentTaskOptions}
                    placeholder="Select a different task..."
                    isClearable
                    styles={selectStyles}
                    value={selectedNewTask}
                    onChange={(option) => setSelectedNewTask(option)}
                    filterOption={(option, input) =>
                      option.label.toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </div>
              )}
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                onClick={() => {
                  setEditDialogOpen(false);
                  setUnlinkDialogOpen(true);
                }}
              >
                <Unlink className="w-4 h-4 mr-1.5" />
                Unlink
              </Button>
              <div className="flex gap-2 ml-auto">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditDialogOpen(false);
                    setSelectedNewTask(null);
                    setTaskToEdit(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleChangeTask}
                  disabled={!selectedNewTask || isUpdating}
                  className="bg-amber-500 hover:bg-amber-600"
                >
                  {isUpdating ? (
                    <TailSpin width={16} height={16} color="white" />
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Unlink Confirmation Dialog - Only rendered when canEdit is true and taskToEdit is set */}
      {canEdit && taskToEdit && (
        <Dialog
          open={unlinkDialogOpen}
          onOpenChange={(open) => {
            setUnlinkDialogOpen(open);
            if (!open) setTaskToEdit(null);
          }}
        >
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <Unlink className="w-5 h-5" />
                Unlink Critical PO Task?
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to unlink this PO from{" "}
                <span className="font-semibold text-slate-700">
                  "{taskToEdit.item_name}"
                </span>
                ?
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setUnlinkDialogOpen(false);
                  setTaskToEdit(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleUnlink}
                disabled={isUpdating}
              >
                {isUpdating ? (
                  <TailSpin width={16} height={16} color="white" />
                ) : (
                  <>
                    <X className="w-4 h-4 mr-1.5" />
                    Unlink
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
