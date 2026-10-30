/**
 * RemindersPage — the dedicated Reminders list (sidebar → /reminders).
 *
 * Shows every Reminder Schedule: a full table from xl, a condensed table from md, and
 * one card per reminder on phones. Next Due carries a chip coloured by how soon it is
 * (utils/reminderDue). Creation is driven by the top-nav
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
import { DUE_TONE_CLASS, dueChip, roleChipClass, shortRoleProfile } from "@/utils/reminderDue";
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

const LOAD_ERROR = "Couldn’t load reminders.";
const EMPTY = "No reminders yet. Click “Add Reminder” to create the first one.";

// Small pill under its value (always on its own line, so every row lines up the same).
const PILL = "w-fit whitespace-nowrap rounded-full px-1.5 text-[11px] font-medium leading-4 tabular-nums";

/** "Monthly" with a coloured "day 7" pill under it (the day only exists for Monthly schedules).
 *  `inline` keeps the pill beside the type, for the compact sub-lines (tablet, phone card). */
function ScheduleLabel({ row, inline = false }: { row: ReminderScheduleRow; inline?: boolean }) {
  const day =
    row.schedule_type === "Monthly" && row.due_day ? (
      <span className={`${PILL} bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300`}>
        day {row.due_day}
      </span>
    ) : null;
  return (
    <span className={inline ? "inline-flex items-center gap-1.5" : "flex flex-col items-start gap-1"}>
      <span>{row.schedule_type}</span>
      {day}
    </span>
  );
}

/** Next Due date with a chip under it, coloured by how soon it is (none for a disabled reminder). */
function NextDue({ row }: { row: ReminderScheduleRow }) {
  if (!row.next_due_date) return <span className="text-muted-foreground">—</span>;
  const chip = row.enabled ? dueChip(row.next_due_date, row.reminds_on) : null;
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="whitespace-nowrap font-medium tabular-nums">{formatDate(row.next_due_date)}</span>
      {chip && <span className={`${PILL} ${DUE_TONE_CLASS[chip.tone]}`}>{chip.label}</span>}
    </span>
  );
}

/** Every Role Profile as a compact chip with its short name, all visible at once (no click
 *  or hover needed), in alphabetical order so every row reads the same. The chips wrap inside
 *  a fixed width, so a reminder with many roles takes a few tidy lines instead of stretching
 *  the table. */
function RoleChips({ profiles }: { profiles: string[] }) {
  if (!profiles.length) return <span className="text-xs text-muted-foreground">—</span>;
  const sorted = [...profiles].sort((a, b) => shortRoleProfile(a).localeCompare(shortRoleProfile(b)));
  return (
    <div className="flex max-w-[22rem] flex-wrap gap-1">
      {sorted.map((p) => (
        <span
          key={p}
          className={`whitespace-nowrap rounded px-2 text-[12px] font-medium leading-5 ring-1 ring-inset ${roleChipClass(p)}`}
        >
          {shortRoleProfile(p)}
        </span>
      ))}
    </div>
  );
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300">
      Enabled
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">Off</Badge>
  );
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

  const openEdit = (name: string) => {
    setEditReminderScheduleName(name);
    setNewReminderDialog(true);
  };

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

      {/* Tablet and up: a table. From xl every column shows; between md and xl, Schedule,
          Reminds On, Notify Before and Role Profiles fold into sub-lines under Title and
          Next Due (the `xl:hidden` spans) so nothing is squeezed or cut off. */}
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader className="bg-slate-100 dark:bg-slate-900 [&_th]:h-10 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-slate-800 dark:[&_th]:text-slate-100">
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <span className="xl:hidden">Reminder</span>
                <span className="hidden xl:inline">Title</span>
              </TableHead>
              <TableHead className="hidden xl:table-cell">Schedule</TableHead>
              <TableHead>Next Due</TableHead>
              <TableHead className="hidden xl:table-cell">Reminds On</TableHead>
              <TableHead className="hidden text-center xl:table-cell">Notify Before</TableHead>
              <TableHead className="hidden xl:table-cell">Role Profiles</TableHead>
              <TableHead className="text-center">Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={colCount}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-8 text-center text-sm text-destructive">
                  {LOAD_ERROR}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-8 text-center text-sm text-muted-foreground">
                  {EMPTY}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const profiles = profilesBySchedule[r.name] ?? [];
                return (
                  <TableRow
                    key={r.name}
                    className={`even:bg-slate-50/70 hover:bg-blue-50/60 dark:even:bg-slate-900/40 dark:hover:bg-blue-950/30 ${r.enabled ? "" : "opacity-60"}`}
                  >
                    <TableCell>
                      <div className="font-medium">{r.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground xl:hidden">
                        <ScheduleLabel row={r} inline />
                        <span>· {profiles.length} {profiles.length === 1 ? "role" : "roles"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <ScheduleLabel row={r} />
                    </TableCell>
                    <TableCell>
                      <NextDue row={r} />
                      <div className="mt-1 text-xs text-muted-foreground xl:hidden">
                        {r.reminds_on ? `Reminds ${formatDate(r.reminds_on)}` : "—"} · {r.notify_before_days}d before
                      </div>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap tabular-nums xl:table-cell">
                      {r.reminds_on ? formatDate(r.reminds_on) : "—"}
                    </TableCell>
                    <TableCell className="hidden text-center tabular-nums xl:table-cell">
                      {r.notify_before_days}d
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <RoleChips profiles={profiles} />
                    </TableCell>
                    <TableCell className="text-center">
                      <StatusBadge enabled={!!r.enabled} />
                    </TableCell>
                    {canManage && (
                      <TableCell className="whitespace-nowrap text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          aria-label={`Edit ${r.title}`}
                          onClick={() => openEdit(r.name)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Delete ${r.title}`}
                          onClick={() => setPendingDelete(r)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Phone: one card per reminder, so nothing scrolls sideways. */}
      <div className="space-y-3 md:hidden">
        {isLoading ? (
          [...Array(3)].map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-lg" />)
        ) : error ? (
          <p className="rounded-lg border py-8 text-center text-sm text-destructive">{LOAD_ERROR}</p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border py-8 text-center text-sm text-muted-foreground">{EMPTY}</p>
        ) : (
          rows.map((r) => (
            <div key={r.name} className={`space-y-3 rounded-lg border p-3 ${r.enabled ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{r.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <ScheduleLabel row={r} inline />
                  </div>
                </div>
                <StatusBadge enabled={!!r.enabled} />
              </div>
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Next due</dt>
                <dd className="min-w-0">
                  <NextDue row={r} />
                </dd>
                <dt className="text-muted-foreground">Reminds on</dt>
                <dd className="tabular-nums">
                  {r.reminds_on ? formatDate(r.reminds_on) : "—"}
                  <span className="text-muted-foreground"> · {r.notify_before_days}d before</span>
                </dd>
                <dt className="text-muted-foreground">Roles</dt>
                <dd className="min-w-0">
                  <RoleChips profiles={profilesBySchedule[r.name] ?? []} />
                </dd>
              </dl>
              {canManage && (
                <div className="flex gap-2 border-t pt-3">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(r.name)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setPendingDelete(r)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
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
                        no longer appear in the Reminders History
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
