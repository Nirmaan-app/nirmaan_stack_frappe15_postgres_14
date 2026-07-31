/**
 * RemindersPage — the dedicated Reminders list (sidebar → /reminders).
 *
 * Shows every Reminder Schedule in a table. Creation is driven by the top-nav
 * "Add Reminder" right-action button (RenderRightActionButton → useDialogStore),
 * whose dialog (NewReminderDialog) is mounted here so a successful create refetches
 * this list. Role profiles are hydrated with ONE extra query over the child table
 * (grouped by parent) — no per-row fetch.
 */
import { useMemo } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import { NewReminderDialog } from "./NewReminderDialog";
import { useUserData } from "@/hooks/useUserData";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
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
  // Create is limited to these roles (mirrors the "Add Reminder" right-action button).
  // Accountants can VIEW this page but not create — and mounting NewReminderDialog for them
  // would fire a Role Profile fetch they have no permission for.
  const { user_id, role } = useUserData();
  const canCreate =
    user_id === "Administrator" ||
    [
      "Nirmaan Admin Profile",
      "Nirmaan PMO Executive Profile",
      "Nirmaan Accountant Lead Profile",
    ].includes(role);
  const { setNewReminderDialog, setEditReminderScheduleName } = useDialogStore();

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
  const colCount = canCreate ? 8 : 7;

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
              {canCreate && <TableHead className="text-right">Actions</TableHead>}
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
                  {canCreate && (
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
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
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
    </div>
  );
}
