import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

interface TaskData {
  name: string;
  task_name: string;
  category: string;
  status: string;
  expected_completion_date: string | null;
  completion_date: string | null;
}

interface EditTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskData | null;
  onSuccess: () => void;
}

const EditTaskModal: React.FC<EditTaskModalProps> = ({
  open,
  onOpenChange,
  task,
  onSuccess,
}) => {
  const [status, setStatus] = useState<string>("");
  const [expectedDate, setExpectedDate] = useState("");
  const [completionDate, setCompletionDate] = useState("");

  const { call, loading } = useFrappePostCall(
    "nirmaan_stack.api.pmo_dashboard.update_task_status"
  );

  useEffect(() => {
    if (task && open) {
      setStatus(task.status === "Done" || task.status === "Not Done" ? task.status : "");
      setExpectedDate(task.expected_completion_date || "");
      setCompletionDate(
        task.completion_date || new Date().toISOString().split("T")[0]
      );
    }
  }, [task, open]);

  const handleSave = async () => {
    if (!status) {
      toast({
        title: "Validation Error",
        description: "Please select a status.",
        variant: "destructive",
      });
      return;
    }

    if (status === "Not Done" && !expectedDate) {
      toast({
        title: "Validation Error",
        description: "Expected Completion Date is required for Not Done status.",
        variant: "destructive",
      });
      return;
    }

    try {
      await call({
        task_name: task?.name,
        status: status,
        expected_completion_date:
          status === "Not Done" ? expectedDate || null : null,
        completion_date: status === "Done" ? completionDate || null : null,
      });
      toast({
        title: "Success",
        description: "Task status updated successfully.",
        variant: "success",
      });
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update task.",
        variant: "destructive",
      });
    }
  };

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-gray-900">
            Edit {task.task_name}
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            Update the status of {task.task_name} Task.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Status */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">
              Status
            </label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="border-gray-300">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Not Done">Not Done</SelectItem>
                <SelectItem value="Done">Done</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Expected Completion Date — shown when "Not Done" */}
          {status === "Not Done" && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">
                Expected Completion Date
              </label>
              <Input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                required
                className="border-gray-300"
              />
            </div>
          )}

          {/* Completion Date — shown when "Done" */}
          {status === "Done" && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">
                Completion Date
              </label>
              <Input
                type="date"
                value={completionDate}
                onChange={(e) => setCompletionDate(e.target.value)}
                className="border-gray-300"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="text-gray-600"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {loading ? (
              <TailSpin height={16} width={16} color="white" />
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditTaskModal;
