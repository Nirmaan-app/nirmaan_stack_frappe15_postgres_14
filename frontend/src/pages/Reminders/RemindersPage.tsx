/**
 * RemindersPage — the dedicated Reminders list (sidebar → /reminders).
 *
 * Shows every Reminder Schedule in a table. Creation is driven by the top-nav
 * "Add Reminder" right-action button (RenderRightActionButton → useDialogStore),
 * whose dialog (NewReminderDialog) is mounted here so a successful create refetches
 * this list. Role profiles are hydrated with ONE extra query over the child table
 * (grouped by parent) — no per-row fetch.
 */
import { useMemo, useState } from "react";
import {
  useFrappeGetCall,
  useFrappeGetDocList,
  useFrappePostCall,
} from "frappe-react-sdk";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import { NewReminderDialog, canRenameReminder } from "./NewReminderDialog";
import { useUserData } from "@/hooks/useUserData";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { Pencil, Trash2 } from "lucide-react";
import { useDialogStore } from "@/zustand/useDialogStore";

interface ReminderScheduleRow {
  name: string;
  title: string;
  enabled: 0 | 1;
  schedule_type: string;
  due_day?: number;
  notify_before_days: number;
  next_due_date?: string;
  reminds_on?: string;
}

interface ReminderRoleProfileRow {
  parent: string;
  role_profile: string;
}

export default function RemindersPage() {
  // Add / Edit / Delete on this page are ALL Admin-only (owner ruling) — one predicate
  // for the whole action surface, mirroring the server's `_require_reminder_editor`.
  // Every other role with sidebar access (PMO Executive, Accountant Lead, Accountant)
  // sees the table read-only. Keeping this to ONE flag also matters because mounting
  // NewReminderDialog fires a Role Profile fetch that non-admins have no permission for.
  // NOTE: the "Add Reminder" right-action button carries the same gate in
  // components/helpers/renderRightActionButton.tsx — change the two together.
  const { user_id, role } = useUserData();
  const canManage = canRenameReminder(role, user_id);
  const { setNewReminderDialog, setEditReminderScheduleName } = useDialogStore();
  const [pendingDelete, setPendingDelete] = useState<ReminderScheduleRow | null>(null);
  const { call: deleteReminder, loading: deleting } = useFrappePostCall<{
    message: {
      deleted: boolean;
      name: string;
      kept_done: number;
      removed_pending: number;
    };
  }>("nirmaan_stack.api.reminders.delete.delete_reminder");

  const { data, isLoading, error, mutate } = useFrappeGetDocList<ReminderScheduleRow>(
    "Reminder Schedule",
    {
      fields: [
        "name",
        "title",
        "enabled",
        "schedule_type",
        "due_day",
        "notify_before_days",
        "next_due_date",
        "reminds_on",
      ],
      orderBy: { field: "next_due_date", order: "asc" },
      limit: 0,
    },
    "reminders-list"
  );

  // Role profiles per schedule — via a whitelisted endpoint, because `Reminder Role Profile`
  // is a CHILD table and the REST get_list path REJECTS a direct child-table query
  // (check_parent_permission), which otherwise leaves this column empty.
  const { data: rpData, mutate: mutateRpData } = useFrappeGetCall<{
    message: { by_schedule: Record<string, string[]> };
  }>(
    "nirmaan_stack.api.reminders.read.get_reminder_schedule_role_profiles",
    undefined,
    "reminder-role-profiles",
    { revalidateOnFocus: false }
  );
  const profilesBySchedule = useMemo(
    () => rpData?.message?.by_schedule ?? {},
    [rpData]
  );

  const rows = data ?? [];
  const colCount = canManage ? 8 : 7;

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      const res = await deleteReminder({ name: pendingDelete.name });
      const kept = res?.message?.kept_done ?? 0;
      const removed = res?.message?.removed_pending ?? 0;
      const parts: string[] = [];
      if (kept) parts.push(`${kept} completed ${kept === 1 ? "entry" : "entries"} kept`);
      if (removed)
        parts.push(`${removed} pending ${removed === 1 ? "entry" : "entries"} removed`);
      toast({
        title: "Reminder deleted",
        description: parts.length
          ? `"${pendingDelete.title}" was deleted — ${parts.join(", ")}.`
          : `"${pendingDelete.title}" was deleted.`,
      });
      setPendingDelete(null);
      mutate();
      mutateRpData();
    } catch (err: any) {
      // Frappe wraps the real message in _server_messages; fall back to .message.
      let msg = err?.message || "Something went wrong.";
      if (err?._server_messages) {
        try {
          msg = JSON.parse(JSON.parse(err._server_messages)[0]).message || msg;
        } catch {
          msg = err._server_messages;
        }
      }
      toast({
        title: "Couldn't delete reminder",
        description: String(msg).replace(/<[^>]*>?/gm, ""),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex-1 space-y-6 p-4">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Reminders
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Recurring compliance reminders (GSTR, TDS, PF…). Use “Add Reminder” to create one.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Next Due</TableHead>
              <TableHead>Reminds On</TableHead>
              <TableHead className="text-center">Notify Before</TableHead>
              <TableHead>Role Profiles</TableHead>
              <TableHead className="text-center">Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(colCount)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-8 text-center text-sm text-destructive">
                  Couldn’t load reminders.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-8 text-center text-sm text-muted-foreground">
                  No reminders yet. Click “Add Reminder” to create the first one.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>
                    {r.schedule_type}
                    {r.schedule_type === "Monthly" && r.due_day ? (
                      <span className="text-muted-foreground"> · day {r.due_day}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>{r.next_due_date ? formatDate(r.next_due_date) : "—"}</TableCell>
                  <TableCell>{r.reminds_on ? formatDate(r.reminds_on) : "—"}</TableCell>
                  <TableCell className="text-center tabular-nums">{r.notify_before_days}d</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(profilesBySchedule[r.name] ?? []).map((p) => (
                        <Badge key={p} variant="secondary" className="font-normal">
                          {p}
                        </Badge>
                      ))}
                      {!(profilesBySchedule[r.name] ?? []).length && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {r.enabled ? (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Enabled</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">Off</Badge>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => {
                          setEditReminderScheduleName(r.name);
                          setNewReminderDialog(true);
                        }}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" /> 
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setPendingDelete(r)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> 
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create dialog — opened by the top-nav "Add Reminder" button */}
      <NewReminderDialog onCreated={() => { mutate(); mutateRpData(); }} />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.title}”?</AlertDialogTitle>
            {/* asChild: Radix renders Description as a <p>, and a <ul> inside a <p> is
                invalid nesting that the browser silently restructures. Swapping in a
                <div> keeps the list valid and keeps aria-describedby pointing here. */}
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Deleting this reminder does four things:
                </p>
                <ul className="space-y-2">
                  <li className="flex gap-2">
                    <span className="text-destructive">•</span>
                    <span className="font-medium text-destructive">
                      The reminder is deleted permanently. This cannot be undone.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-destructive">•</span>
                    <span className="text-muted-foreground">
                      <span className="font-medium text-destructive">
                        Its pending entries are deleted
                      </span>{" "}
                      — nothing can act on them once the reminder is gone.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Its completed entries are kept
                      </span>{" "}
                      as a permanent record.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span className="text-muted-foreground">
                      Those kept entries will{" "}
                      <span className="font-medium text-foreground">
                        no longer appear in the Compliance History
                      </span>
                      .
                    </span>
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog mounted through the await so the pending state shows;
                // handleDelete closes it on success and leaves it open on failure.
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
