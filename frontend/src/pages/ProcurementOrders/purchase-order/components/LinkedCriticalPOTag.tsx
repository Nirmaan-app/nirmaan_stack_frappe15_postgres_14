import React, { useState, useMemo, useCallback } from "react";
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import ReactSelect from "react-select";
import { Badge } from "@/components/ui/badge";
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
  Link2,
  Pencil,
  X,
  CheckCircle2,
  Unlink,
} from "lucide-react";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { formatDate } from "@/utils/FormatDate";

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

  // Find task that has this PO linked
  const linkedTask = useMemo<CriticalPOTask | null>(() => {
    for (const task of tasks) {
      try {
        const associated = task.associated_pos;
        let pos: string[] = [];

        if (typeof associated === "string") {
          const parsed = JSON.parse(associated);
          pos = parsed?.pos || [];
        } else if (associated && typeof associated === "object") {
          pos = associated.pos || [];
        }

        if (pos.includes(poName)) {
          return task;
        }
      } catch {
        continue;
      }
    }
    return null;
  }, [tasks, poName]);

  // Create task options for re-linking
  const taskOptions = useMemo<TaskOption[]>(() => {
    return tasks
      .filter((task) => task.name !== linkedTask?.name) // Exclude currently linked task
      .map((task) => ({
        label: task.sub_category
          ? `${task.item_name} (${task.sub_category})`
          : task.item_name,
        value: task.name,
        data: task,
      }));
  }, [tasks, linkedTask]);

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

  // Handle unlink
  const handleUnlink = useCallback(async () => {
    if (!linkedTask) return;

    setIsUpdating(true);
    try {
      const currentPOs = getLinkedPOs(linkedTask);
      const updatedPOs = currentPOs.filter((po) => po !== poName);

      await updateDoc("Critical PO Tasks", linkedTask.name, {
        associated_pos: JSON.stringify({ pos: updatedPOs }),
      });

      toast({
        title: "Success",
        description: `PO unlinked from "${linkedTask.item_name}".`,
        variant: "success",
      });

      await mutate();
      if (onUpdate) await onUpdate();
      setUnlinkDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to unlink PO.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  }, [linkedTask, poName, updateDoc, mutate, onUpdate]);

  // Handle change to different task
  const handleChangeTask = useCallback(async () => {
    if (!linkedTask || !selectedNewTask) return;

    setIsUpdating(true);
    try {
      // Remove from old task
      const oldPOs = getLinkedPOs(linkedTask);
      const updatedOldPOs = oldPOs.filter((po) => po !== poName);

      await updateDoc("Critical PO Tasks", linkedTask.name, {
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
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to change linked task.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  }, [linkedTask, selectedNewTask, poName, updateDoc, mutate, onUpdate]);

  // If no linked task, don't render anything
  if (!linkedTask) {
    return null;
  }

  return (
    <>
      {/* Linked Task Tag */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-1 mt-1">
            <Badge
              variant="outline"
              className={`bg-emerald-50 border-emerald-200 text-emerald-700 transition-colors ${
                canEdit ? "hover:bg-emerald-100 cursor-pointer group" : ""
              }`}
              onClick={canEdit ? () => setEditDialogOpen(true) : undefined}
            >
              <Link2 className="w-3 h-3 mr-1" />
              <span className="text-xs font-medium truncate max-w-[150px]">
                {linkedTask.item_name}
                {linkedTask.sub_category && (
                  <span className="text-emerald-500 ml-1">
                    ({linkedTask.sub_category})
                  </span>
                )}
              </span>
              {canEdit && (
                <Pencil className="w-3 h-3 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-semibold">Linked Critical PO Task</p>
            <p>Category: {linkedTask.critical_po_category}</p>
            <p>Deadline: {formatDate(linkedTask.po_release_date)}</p>
            <p>Status: {linkedTask.status}</p>
            {canEdit && <p className="text-slate-400 mt-1">Click to edit</p>}
          </div>
        </TooltipContent>
      </Tooltip>

      {/* Edit Dialog - Only rendered when canEdit is true */}
      {canEdit && (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-[450px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Link2 className="w-5 h-5 text-emerald-600" />
                Edit Critical PO Task Link
              </DialogTitle>
              <DialogDescription>
                Change or remove the linked Critical PO Task for this PO.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Current Link Info */}
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                    Currently Linked To
                  </span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Item</span>
                    <p className="font-medium text-slate-800">{linkedTask.item_name}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Category</span>
                    <p className="font-medium text-slate-800">{linkedTask.critical_po_category}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Sub-Category</span>
                    <p className="font-medium text-slate-800">{linkedTask.sub_category || "-"}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Deadline</span>
                    <p className="font-medium text-slate-800">{formatDate(linkedTask.po_release_date)}</p>
                  </div>
                </div>
              </div>

              {/* Change To Different Task */}
              {taskOptions.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Change To Different Task</Label>
                  <ReactSelect<TaskOption>
                    options={taskOptions}
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

      {/* Unlink Confirmation Dialog - Only rendered when canEdit is true */}
      {canEdit && (
        <Dialog open={unlinkDialogOpen} onOpenChange={setUnlinkDialogOpen}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <Unlink className="w-5 h-5" />
                Unlink Critical PO Task?
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to unlink this PO from{" "}
                <span className="font-semibold text-slate-700">
                  "{linkedTask.item_name}"
                </span>
                ?
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setUnlinkDialogOpen(false)}
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
