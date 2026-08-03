/**
 * RemindersSection — a self-contained, COLLAPSIBLE compliance-reminders list for the
 * Action Center. Rendered ABOVE the tabs and INDEPENDENT of the active tab; lists the
 * current user's `Reminder Schedule Log` rows (role-profile scoped) from
 * `get_my_reminder_logs`. Each Pending row can be completed in place via
 * `mark_reminder_done` (scoped + ignore_permissions on the server).
 *
 * The server derives per-row `state` (overdue / due_today / upcoming) and, when a
 * configured day does not exist in that month (e.g. the 31st in February), a `due_note`
 * telling the user the real month-end deadline. This component only renders that state.
 */
import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall, useFrappeEventListener } from "frappe-react-sdk";
import { BellRing, ChevronDown, Check, AlertTriangle, History } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import { cn } from "@/lib/utils";
import { CompletedRemindersDialog } from "./CompletedRemindersDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ReminderState = "overdue" | "due_today" | "upcoming" | "completed";

interface ReminderLogRow {
  name: string;
  reminder_schedule: string;
  due_date: string;
  status: "Pending" | "Done";
  notified_at?: string | null;
  remarks?: string | null;
  // derived by get_my_reminder_logs
  state?: ReminderState;
  days?: number;
  from_month?: string;
  to_month?: string;
  clamped?: boolean;
  due_note?: string | null;
  message?: string | null;
}

interface GetMyReminderLogsResponse {
  message: { logs: ReminderLogRow[]; done_count?: number };
}

const STATE: Record<
  ReminderState,
  { label: (d: number) => string; badge: string; dot: string }
> = {
  overdue: {
    label: (d) => `Overdue ${d}d`,
    badge: "border-red-200 bg-red-50 text-red-600",
    dot: "bg-red-500",
  },
  due_today: {
    label: () => "Due today",
    badge: "border-amber-200 bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
  },
  upcoming: {
    label: (d) => `In ${d}d`,
    badge: "border-gray-200 bg-gray-100 text-gray-600",
    dot: "bg-gray-400",
  },
  completed: {
    label: () => "Done",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
};

export function RemindersSection({ className }: { className?: string } = {}) {
  const [open, setOpen] = useState(true); // collapsible, starts open each mount
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  
  // Remarks Dialog State
  const [remarksLog, setRemarksLog] = useState<string | null>(null);
  const [remarksText, setRemarksText] = useState("");

  const { data, isLoading, error, mutate } =
    useFrappeGetCall<GetMyReminderLogsResponse>(
      "nirmaan_stack.api.reminders.read.get_my_reminder_logs",
      undefined,
      "action-center-reminder-logs"
    );
  const logs = useMemo(() => data?.message?.logs ?? [], [data]);
  const doneCount = data?.message?.done_count ?? 0;

  const { call: markDone } = useFrappePostCall(
    "nirmaan_stack.api.reminders.write.mark_reminder_done"
  );

  const handleDone = async () => {
    if (!remarksLog) return;
    setSaving(remarksLog);
    try {
      await markDone({ log: remarksLog, remarks: remarksText.trim() || null });
      await mutate(); // Force immediate refetch
      setRemarksLog(null);
      setRemarksText("");
    } finally {
      setSaving(null);
    }
  };

  // Real-time listener: refetches the list whenever ANY log is created or updated
  useFrappeEventListener("list_update", (d: any) => {
    if (d?.doctype === "Reminder Schedule Log") {
      mutate();
    }
  });

  return (
    <div className={cn("mt-6 border-t border-gray-200 pt-5", className)}>
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <BellRing className="h-4 w-4 text-red-500" />
          <span className="text-md font-semibold uppercase text-gray-800">Reminders</span>
          <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold tabular-nums text-red-600">
            {logs.length}
          </span>
        </button>

        <button
          onClick={() => setHistoryOpen(true)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
        >
          <History className="h-3.5 w-3.5" />
          <span>History ({doneCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              open ? "" : "-rotate-90"
            )}
          />
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-1.5">
          {isLoading ? (
            <>
              <div className="h-10 animate-pulse rounded-md bg-gray-100" />
              <div className="h-10 animate-pulse rounded-md bg-gray-100" />
            </>
          ) : error ? (
            <p className="text-sm text-destructive">Couldn&rsquo;t load reminders.</p>
          ) : logs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-xs text-gray-500">
              No pending reminders.
            </p>
          ) : (
            logs.map((log) => {
              const st = STATE[log.state ?? "upcoming"];
              return (
                <div
                  key={log.name}
                  className={cn(
                    "rounded-md border px-2 py-1.5 transition-colors hover:border-gray-300",
                    log.state === "overdue"
                      ? "border-red-200 bg-red-50/40"
                      : "border-gray-200 bg-white"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", st.dot)} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                      {log.reminder_schedule}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase",
                        st.badge
                      )}
                    >
                      {st.label(log.days ?? 0)}
                    </span>
                    {log.status === "Pending" && (
                      <button
                        type="button"
                        onClick={() => {
                          setRemarksLog(log.name);
                          setRemarksText("");
                        }}
                        disabled={saving === log.name}
                        title="Mark done"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {saving === log.name ? "Saving…" : "Mark Done"}
                      </button>
                    )}
                  </div>
                  <p
                    className="mt-0.5 truncate pl-4 text-[11px] text-gray-500"
                    title={
                      log.message
                        ? `Due ${formatDate(log.due_date)} — ${log.message}`
                        : undefined
                    }
                  >
                    Due {formatDate(log.due_date)}
                    {log.from_month && log.to_month ? (
                      <span className="text-gray-400"> · Covers {log.from_month} - {log.to_month}</span>
                    ) : null}
                    {log.message ? (
                      <span className="text-gray-400"> · {log.message}</span>
                    ) : null}
                  </p>
                  {log.due_note && (
                    <p className="mt-0.5 flex items-start gap-1 pl-4 text-[11px] text-amber-600">
                      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                      <span>{log.due_note}</span>
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <CompletedRemindersDialog open={historyOpen} onOpenChange={setHistoryOpen} />

      {/* Remarks Dialog */}
      <Dialog open={!!remarksLog} onOpenChange={(o) => !o && setRemarksLog(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Complete Task</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <p className="text-sm text-gray-500">
              Add any optional remarks before marking this task as done.
            </p>
            <Textarea
              placeholder="e.g. Paid via NEFT 123456"
              value={remarksText}
              onChange={(e) => setRemarksText(e.target.value)}
              className="resize-none"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemarksLog(null)}
              disabled={!!saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDone}
              disabled={!!saving}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {saving ? "Saving..." : "Mark as Done"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default RemindersSection;
