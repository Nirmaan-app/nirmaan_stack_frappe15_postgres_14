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
        // sort by completed_at descending (newest first). 
        // Note: replace space with T to handle Frappe datetime string in all browsers
        const timeA = a.completed_at ? new Date(a.completed_at.replace(" ", "T")).getTime() : 0;
        const timeB = b.completed_at ? new Date(b.completed_at.replace(" ", "T")).getTime() : 0;
        return (timeB || 0) - (timeA || 0);
      })
      .slice(0, 30); // Take the last 30 completed jobs
  }, [data]);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden bg-white shadow-lg sm:rounded-xl">
        <DialogHeader className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <DialogTitle className="flex items-center text-base font-semibold text-gray-900">
            Reminders History
            <span className="ml-3 inline-flex items-center rounded-md bg-white border border-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600 shadow-sm">
              Last 30 Records
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-800 mb-3" />
              <p className="text-sm font-medium">Loading ledger...</p>
            </div>
          ) : error ? (
            <div className="rounded-md bg-red-50 p-4 text-sm text-red-600 border border-red-100 my-4">
              Failed to load history. Please try again.
            </div>
          ) : completedLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-50 border border-gray-100 mb-3">
                <CheckCircle2 className="h-5 w-5 text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-900">No records found</p>
              <p className="mt-1 text-xs text-gray-500">Completed Reminders tasks will appear here.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {completedLogs.map((log) => (
                <div
                  key={log.name}
                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-3.5 border-b border-gray-100 last:border-0 hover:bg-gray-50/80 transition-colors px-2 -mx-2 rounded-md"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={2.5} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-900">
                        {log.reminder_schedule}
                      </span>
                      <span className="mt-1 text-[11px] font-medium tracking-wide uppercase text-gray-500">
                        Due: {formatDate(log.due_date)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:items-end border-t sm:border-t-0 border-gray-100 pt-2 sm:pt-0">
                    <span className="text-sm font-medium text-gray-700">
                      {log.completed_by || "System"}
                    </span>
                    <span className="mt-1 text-[11px] font-medium tracking-wide uppercase text-gray-400">
                      {log.completed_at ? formatDate(log.completed_at) : "Unknown"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
