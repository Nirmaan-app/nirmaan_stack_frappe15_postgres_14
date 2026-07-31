import { useState, useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/utils/FormatDate";
import { CheckCircle2 } from "lucide-react";

interface ReminderLogRow {
  name: string;
  reminder_schedule: string;
  due_date: string;
  status: "Pending" | "Done";
  completed_by?: string | null;
  completed_at?: string | null;
}

export function CompletedRemindersDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Fetch ALL logs (Pending + Done) by passing include_done: 1
  const { data, isLoading, error } = useFrappeGetCall<{
    message: { logs: ReminderLogRow[] };
  }>(
    "nirmaan_stack.api.reminders.read.get_my_reminder_logs",
    { include_done: 1 },
    open ? "completed-reminder-logs" : null,
    { revalidateOnFocus: false }
  );

  const completedLogs = useMemo(() => {
    const logs = data?.message?.logs ?? [];
    return logs
      .filter((l) => l.status === "Done")
      .sort((a, b) => {
        // sort by completed_at descending (newest first)
        const dateA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const dateB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 30); // Take the last 30 completed jobs
  }, [data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Completed Reminders (Last 30)</DialogTitle>
        </DialogHeader>

        <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-2">
          {isLoading ? (
            <p className="text-sm text-gray-500">Loading history...</p>
          ) : error ? (
            <p className="text-sm text-destructive">Failed to load history.</p>
          ) : completedLogs.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">
              No completed reminders found.
            </p>
          ) : (
            completedLogs.map((log) => (
              <div
                key={log.name}
                className="flex items-start gap-3 rounded-md border p-3"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {log.reminder_schedule}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Due: {formatDate(log.due_date)}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    Completed{" "}
                    {log.completed_at ? formatDate(log.completed_at) : ""}{" "}
                    {log.completed_by ? ` by ${log.completed_by}` : ""}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
