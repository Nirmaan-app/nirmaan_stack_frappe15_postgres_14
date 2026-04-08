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
import { useFrappePostCall, useFrappeFileUpload } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { FileText } from "lucide-react";

interface TaskData {
  name: string;
  task_name: string;
  category: string;
  status: string;
  expected_completion_date: string | null;
  completion_date: string | null;
  attachment: string | null;
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
  const [attachment, setAttachment] = useState<File | null>(null);

  const { call, loading } = useFrappePostCall(
    "nirmaan_stack.api.pmo_dashboard.update_task_status"
  );
  const { upload, loading: uploadLoading } = useFrappeFileUpload();

  useEffect(() => {
    if (task && open) {
      setStatus(task.status || "");
      setExpectedDate(task.expected_completion_date || "");
      setCompletionDate(
        task.completion_date || new Date().toISOString().split("T")[0]
      );
      setAttachment(null);
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

    if (status === "WIP" && !expectedDate) {
      toast({
        title: "Validation Error",
        description: "Expected Completion Date is required for WIP status.",
        variant: "destructive",
      });
      return;
    }

    if ((status === "Sent/Submision" || status === "Approve by client") && !attachment && !task?.attachment) {
      toast({
        title: "Validation Error",
        description: `Attachment is required for ${status}.`,
        variant: "destructive",
      });
      return;
    }

    try {
      let fileUrl = "";
      if (attachment) {
        const fileArgs = {
          doctype: "PMO Project Task",
          docname: task?.name,
          fieldname: "attachment",
          isPrivate: true,
        };
        const uploadedFile = await upload(attachment, fileArgs);
        fileUrl = uploadedFile.file_url;
      }
      await call({
        task_name: task?.name,
        status: status,
        expected_completion_date:
          status === "WIP" ? expectedDate || null : null,
        completion_date:
          status === "Sent/Submision" ? completionDate || null : null,
        attachment: fileUrl || undefined,
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
                <SelectItem value="WIP">WIP</SelectItem>
                <SelectItem value="Sent/Submision">Sent/Submision</SelectItem>
                <SelectItem value="Approve by client">Approve by client</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Expected Completion Date — shown when "WIP" */}
          {status === "WIP" && (
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

          {/* Submison Date — shown when "Sent/Submision" */}
          {status === "Sent/Submision" && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">
                Submison Date
              </label>
              <Input
                type="date"
                value={completionDate}
                onChange={(e) => setCompletionDate(e.target.value)}
                className="border-gray-300"
              />
            </div>
          )}
          
          {/* Info shown for "Approve by client" */}
          {status === "Approve by client" && (
            <div className="bg-green-50 border border-green-200 rounded-md p-3">
              <p className="text-sm text-green-800">
                This will approve the task and update status progress.
                {task.completion_date && ` Submission Date: ${task.completion_date}`}
              </p>
            </div>
          )}

          {/* Attachment UI — shown for "Sent/Submision" or "Approve by client" */}
          {(status === "Sent/Submision" || status === "Approve by client") && (
            <div className="space-y-1.5 mt-4">
              <label className="text-sm font-medium text-gray-700 block mb-1.5 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-gray-400" />
                Proof of Submission / Approval
                {(status === "Sent/Submision" || status === "Approve by client") && <span className="text-red-500">*</span>}
              </label>
              <CustomAttachment
                selectedFile={attachment}
                onFileSelect={setAttachment}
                maxFileSize={5 * 1024 * 1024}
              />
              {task?.attachment && (
                <p className="text-[10px] text-gray-500 italic mt-1">
                  Current attachment: {task.attachment.split("/").pop()}
                </p>
              )}
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
            disabled={loading || uploadLoading}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {loading || uploadLoading ? (
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
