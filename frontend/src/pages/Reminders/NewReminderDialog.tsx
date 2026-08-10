/**
 * NewReminderDialog — create a Reminder Schedule from the Reminders page.
 *
 * Opened by the "Add Reminder" right-action button (via useDialogStore). Writes
 * directly through the SDK's createDoc — the child tables (role_profiles, due_dates)
 * are sent as arrays, so no custom backend endpoint is needed. For Quarterly /
 * Half-Yearly the end month auto-fills from the start month (mirrors the desk form and
 * the server's fill_end_months); for Custom Dates the user sets both.
 */
import { useEffect, useMemo } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useFrappeCreateDoc,
  useFrappeGetCall,
  useFrappeGetDoc,
  useFrappePostCall,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import ReactSelect from "react-select";
import { Trash2, Plus } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useUserData } from "@/hooks/useUserData";
import { cn } from "@/lib/utils";

/**
 * May this user RENAME a Reminder Schedule? Mirrors the server gate
 * `_require_reminder_editor` (Administrator user OR the Nirmaan Admin Profile) by
 * construction — CONVENIENCE ONLY; `rename_reminder` is the real boundary.
 *
 * The `role === "Loading"` guard is load-bearing: `useUserData` returns the literal
 * "Loading" while the Nirmaan Users doc is in flight, and without it an ADMIN would
 * see the Title field flash read-only on open.
 */
export function canRenameReminder(role: string, userId: string): boolean {
  if (role === "Loading") return false;
  return userId === "Administrator" || role === "Nirmaan Admin Profile";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SCHEDULE_TYPES = ["Monthly", "Quarterly", "Half-Yearly", "Custom Dates"] as const;
// Months each span-based schedule covers (auto-fills the end month from the start).
const SPAN: Record<string, number> = { Quarterly: 3, "Half-Yearly": 6 };

// Dropdowns use the app's Radix <Select>, never a native <select>. A native select's
// popup is drawn by the browser and mis-anchors inside DialogContent (which is
// `fixed` + `translate-x-[-50%] translate-y-[-50%]`) — the list rendered detached in
// the top-left of the viewport. Radix anchors to the trigger, so it stays put.
const errorRing = "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/20";
const okRing = "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500";

const dueDateRowSchema = z.object({
  from_month: z.string().optional(),
  to_month: z.string().optional(),
  due_month: z.string().min(1, "Required"),
  due_day: z.coerce.number().min(1, "1-31").max(31, "1-31"),
});

const schema = z
  .object({
    title: z.string().min(1, "Title is required"),
    role_profiles: z.array(z.string()).min(1, "Select at least one role profile"),
    schedule_type: z.enum(SCHEDULE_TYPES),
    due_day: z.union([z.coerce.number().min(1).max(31), z.literal(""), z.literal(0)]).optional(),
    due_dates: z.array(dueDateRowSchema).optional(),
    notify_before_days: z.coerce.number().min(0, "0-365").max(365, "0-365"),
    message: z.string().optional(),
    enabled: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.schedule_type === "Monthly") {
      if (!val.due_day || val.due_day === "") {
        ctx.addIssue({ path: ["due_day"], code: z.ZodIssueCode.custom, message: "Due day is required" });
      }
    } else if (!val.due_dates || val.due_dates.length === 0) {
      ctx.addIssue({ path: ["due_dates"], code: z.ZodIssueCode.custom, message: "Add at least one due date" });
    } else {
      // from_month/to_month stay .optional() on the row schema ON PURPOSE: a Monthly
      // schedule keeps its due_dates rows in form state (useFieldArray does not drop
      // them on type switch), and requiring them there would block a Monthly submit on
      // hidden fields. Every non-Monthly type needs both, so the check belongs here.
      val.due_dates.forEach((row, i) => {
        if (!row.from_month) {
          ctx.addIssue({
            path: ["due_dates", i, "from_month"],
            code: z.ZodIssueCode.custom,
            message: "Covers From is required",
          });
        }
        if (!row.to_month) {
          ctx.addIssue({
            path: ["due_dates", i, "to_month"],
            code: z.ZodIssueCode.custom,
            message: "Covers To is required",
          });
        }
      });
    }
  });

type FormValues = z.infer<typeof schema>;

interface NewReminderDialogProps {
  /** Called after a reminder is successfully created (e.g. to refetch the table). */
  onCreated?: () => void;
}

export function NewReminderDialog({ onCreated }: NewReminderDialogProps) {
  const {
    newReminderDialog,
    setNewReminderDialog,
    editReminderScheduleName,
    setEditReminderScheduleName,
  } = useDialogStore();
  const { toast } = useToast();
  const { createDoc, loading: creating } = useFrappeCreateDoc();
  const { updateDoc, loading: updating } = useFrappeUpdateDoc();
  // Title changes cannot ride updateDoc (autoname `field:title` — see onSubmit).
  const { call: renameReminder, loading: renaming } = useFrappePostCall<{
    message: { name: string; renamed: boolean };
  }>("nirmaan_stack.api.reminders.write.rename_reminder");
  const isEdit = !!editReminderScheduleName;
  const loading = creating || updating || renaming;

  // Rename is Admin-only. The lock is EDIT-ONLY on purpose: creating goes through
  // createDoc, where autoname derives the name from the title — no rename involved —
  // so every create-capable role must still be able to name a new reminder.
  const { user_id, role } = useUserData();
  const canRename = canRenameReminder(role, user_id);
  const titleLocked = isEdit && !canRename;

  // In EDIT mode, load the schedule — get_doc hydrates the child tables (role_profiles,
  // due_dates) one level deep, so no child-table list query is needed.
  const { data: editDoc } = useFrappeGetDoc(
    "Reminder Schedule",
    editReminderScheduleName ?? undefined,
    editReminderScheduleName ? undefined : null
  );

  // Role Profile is a System-Manager-only doctype — fetch the names via a login-required
  // endpoint so any create-capable user (not just admins) can populate the picker.
  const { data: roleProfilesData } = useFrappeGetCall<{
    message: { role_profiles: string[] };
  }>(
    "nirmaan_stack.api.reminders.read.get_role_profiles",
    undefined,
    "reminder-role-profile-options",
    { revalidateOnFocus: false }
  );
  const roleProfileOptions = useMemo(
    () =>
      (roleProfilesData?.message?.role_profiles ?? []).map((name) => ({
        label: name,
        value: name,
      })),
    [roleProfilesData]
  );

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      role_profiles: [],
      schedule_type: "Monthly",
      due_day: "" as any,
      due_dates: [],
      notify_before_days: 3,
      message: "",
      enabled: true,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "due_dates" });
  const scheduleType = watch("schedule_type");
  const isMonthly = scheduleType === "Monthly";

  // Prefill the form when opening in EDIT mode (once the schedule doc loads).
  useEffect(() => {
    if (isEdit && editDoc) {
      reset({
        title: editDoc.title,
        role_profiles: (editDoc.role_profiles ?? []).map(
          (r: { role_profile: string }) => r.role_profile
        ),
        schedule_type: editDoc.schedule_type,
        due_day: editDoc.due_day || undefined,
        due_dates: (editDoc.due_dates ?? []).map(
          (d: {
            from_month?: string;
            to_month?: string;
            due_month: string;
            due_day: number;
          }) => ({
            from_month: d.from_month || "",
            to_month: d.to_month || "",
            due_month: d.due_month,
            due_day: d.due_day,
          })
        ),
        notify_before_days: editDoc.notify_before_days ?? 3,
        message: editDoc.message || "",
        enabled: !!editDoc.enabled,
      });
    }
  }, [isEdit, editDoc, reset]);

  // Quarterly/Half-Yearly: derive the end month from the picked start month.
  const handleFromMonthChange = (index: number, value: string) => {
    // shouldValidate: unlike a Controller's field.onChange, a bare setValue does not
    // re-run the resolver, so a "Covers From is required" error would stay red after
    // the user picked a month.
    setValue(`due_dates.${index}.from_month`, value, { shouldValidate: true });
    const span = SPAN[scheduleType];
    if (span && value) {
      const start = MONTHS.indexOf(value);
      if (start >= 0)
        setValue(`due_dates.${index}.to_month`, MONTHS[(start + span - 1) % 12], {
          shouldValidate: true,
        });
    }
  };

  const close = () => {
    reset({
      title: "",
      role_profiles: [],
      schedule_type: "Monthly",
      due_day: "" as any,
      due_dates: [],
      notify_before_days: 3,
      message: "",
      enabled: true,
    });
    setNewReminderDialog(false);
    setEditReminderScheduleName(null);
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const payload: Record<string, unknown> = {
        title: values.title,
        schedule_type: values.schedule_type,
        notify_before_days: values.notify_before_days,
        message: values.message || "",
        enabled: values.enabled ? 1 : 0,
        role_profiles: values.role_profiles.map((rp) => ({ role_profile: rp })),
      };
      if (values.schedule_type === "Monthly") {
        payload.due_day = values.due_day;
      } else {
        payload.due_dates = (values.due_dates ?? []).map((d) => ({
          from_month: d.from_month || "",
          to_month: d.to_month || "",
          due_month: d.due_month,
          due_day: d.due_day,
        }));
      }
      if (isEdit && editReminderScheduleName) {
        // `Reminder Schedule` is autonamed `field:title`, so the doc NAME *is* the title
        // and Frappe force-syncs name -> title on every save — a `title` in the payload is
        // silently reverted. A real rename must go through `rename_doc` FIRST, and the
        // returned new name becomes the target of the field update below (the old name no
        // longer exists). `rename_doc` repoints the linked Reminder Schedule Log rows.
        let targetName = editReminderScheduleName;
        // `canRename &&` makes "a non-admin never calls rename" a property of the code,
        // not of a DOM attribute — so their save can never fail on the Admin-only gate.
        if (canRename && values.title !== editReminderScheduleName) {
          const res = await renameReminder({
            name: editReminderScheduleName,
            new_title: values.title,
          });
          targetName = res?.message?.name || editReminderScheduleName;
          setEditReminderScheduleName(targetName);
        }
        await updateDoc("Reminder Schedule", targetName, payload);
        toast({ title: "Reminder updated", description: `"${values.title}" was saved.` });
      } else {
        await createDoc("Reminder Schedule", payload);
        toast({ title: "Reminder created", description: `"${values.title}" was added.` });
      }
      
      // Force SWR to invalidate and refetch the Action Center logs by matching the API method
      import("swr").then(({ mutate }) => {
        mutate(
          (key: any) => Array.isArray(key) && key[0] === "nirmaan_stack.api.reminders.read.get_my_reminder_logs",
          undefined,
          { revalidate: true }
        );
      });
      
      onCreated?.();
      close();
    } catch (err: any) {
      let errMsg = "Something went wrong.";
      if (err) {
        if (typeof err === "string") errMsg = err;
        else if (err.message && typeof err.message === "string") errMsg = err.message;
        
        if (err._server_messages) {
          try {
            const msgs = JSON.parse(err._server_messages);
            if (msgs.length > 0) {
              const parsed = JSON.parse(msgs[0]);
              errMsg = parsed.message || errMsg;
            }
          } catch (e) {
            errMsg = err._server_messages;
          }
        } else if (err.exc_type) {
            errMsg = err.exc_type; // Fallback to exception type if no specific message
        }
      }

      // Strip HTML tags like <strong> or <b> from Frappe messages
      if (typeof errMsg === "string") {
        errMsg = errMsg.replace(/<[^>]*>?/gm, "");
      }

      toast({
        title: isEdit ? "Couldn't update reminder" : "Couldn't create reminder",
        description: errMsg,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={newReminderDialog} onOpenChange={(open) => (open ? setNewReminderDialog(true) : close())}>
      {/* max-w-2xl (not the base lg): a due-date row is ~540px of fixed content, so at
          lg the row overflowed — and overflow-y-auto computes overflow-x to auto, which
          is what put a horizontal scrollbar on the whole dialog. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Reminder" : "Add Reminder"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="reminder-title" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Title <span className="text-red-500">*</span>
            </Label>
            <Input
              id="reminder-title"
              placeholder="e.g. GSTR-3B"
              // readOnly, NEVER disabled: a disabled input drops out of the form value
              // pipeline, so `title` would arrive undefined and the zod min(1) rule would
              // fail EVERY non-admin save — the exact breakage this lock removes.
              readOnly={titleLocked}
              aria-readonly={titleLocked || undefined}
              className={cn(
                "h-10 transition-all focus:ring-2",
                errors.title
                  ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                  : "focus:ring-emerald-500/20 focus:border-emerald-500",
                titleLocked && "bg-muted cursor-not-allowed"
              )}
              {...register("title")}
            />
            {titleLocked && (
              <p className="text-xs text-muted-foreground">
                Only an Admin can rename a reminder.
              </p>
            )}
            {errors.title && <p className="text-xs text-red-500">{errors.title.message}</p>}
          </div>

          {/* Role profiles */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Role Profiles <span className="text-red-500">*</span>
            </Label>
            <Controller
              control={control}
              name="role_profiles"
              render={({ field }) => (
                <ReactSelect
                  isMulti
                  options={roleProfileOptions}
                  value={roleProfileOptions.filter((o) => field.value?.includes(o.value))}
                  onChange={(selected) => field.onChange((selected ?? []).map((s) => s.value))}
                  placeholder="Who gets this reminder…"
                  className="text-sm"
                  styles={{
                    control: (base, state) => ({
                      ...base,
                      minHeight: '40px',
                      borderColor: errors.role_profiles ? '#ef4444' : state.isFocused ? '#10b981' : base.borderColor,
                      boxShadow: state.isFocused ? (errors.role_profiles ? '0 0 0 2px rgba(239, 68, 68, 0.2)' : '0 0 0 2px rgba(16, 185, 129, 0.2)') : 'none',
                      '&:hover': { borderColor: errors.role_profiles ? '#ef4444' : state.isFocused ? '#10b981' : base.borderColor }
                    })
                  }}
                />
              )}
            />
            {errors.role_profiles && <p className="text-xs text-red-500">{errors.role_profiles.message}</p>}
          </div>

          {/* Schedule type + notify before */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reminder-type" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Schedule Type <span className="text-red-500">*</span>
              </Label>
              <Controller
                control={control}
                name="schedule_type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="reminder-type"
                      className={cn("h-10 transition-all", errors.schedule_type ? errorRing : okRing)}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notify-before" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Notify Before (days) <span className="text-red-500">*</span>
              </Label>
              <Input 
                id="notify-before" 
                type="number" 
                min={0} 
                className={`h-10 transition-all focus:ring-2 ${errors.notify_before_days ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'focus:ring-emerald-500/20 focus:border-emerald-500'}`}
                {...register("notify_before_days")} 
              />
              {errors.notify_before_days && (
                <p className="text-xs text-red-500">{errors.notify_before_days.message}</p>
              )}
            </div>
          </div>

          {/* Monthly → due day */}
          {isMonthly ? (
            <div className="space-y-1.5">
              <Label htmlFor="due-day" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Due Day (of every month) <span className="text-red-500">*</span>
              </Label>
              <Input 
                id="due-day" 
                type="number" 
                min={1} 
                max={31} 
                placeholder="e.g. 20" 
                className={`h-10 transition-all focus:ring-2 ${errors.due_day ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'focus:ring-emerald-500/20 focus:border-emerald-500'}`}
                {...register("due_day")} 
              />
              {errors.due_day && <p className="text-xs text-red-500">{errors.due_day.message}</p>}
            </div>
          ) : (
            /* Fixed dates editor — the DUE DATE (month + day) is what we notify against. */
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Due Dates <span className="text-red-500">*</span>
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => append({ from_month: "", to_month: "", due_month: "", due_day: 1 })}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add date
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Set the <b>due date</b> (month + day) for each period — the reminder is sent{" "}
                <b>{watch("notify_before_days") || 0}</b> day(s) before it.
              </p>
              {typeof errors.due_dates?.message === "string" && (
                <p className="text-xs text-destructive">{errors.due_dates.message}</p>
              )}
              {fields.map((row, index) => {
                const rowErr = errors.due_dates?.[index];
                const hasError = !!(
                  rowErr?.due_month ||
                  rowErr?.due_day ||
                  rowErr?.from_month ||
                  rowErr?.to_month
                );

                return (
                  <div key={row.id} className="flex flex-col gap-1">
                    {/* Stacks to two lines below sm (the single row needs ~540px); the
                        delete button pins to the corner so it never eats a whole line. */}
                    <div
                      className={cn(
                        "relative flex flex-col gap-2 rounded-md border py-2 pl-2 pr-10 transition-colors sm:flex-row sm:items-center sm:gap-2 sm:py-1.5 sm:pr-2",
                        hasError ? "border-red-200 bg-red-50/30" : "bg-gray-50/50"
                      )}
                    >
                      {/* Due Date */}
                      <div className="flex items-center gap-1.5 sm:shrink-0">
                        <span
                          className={cn(
                            "w-14 shrink-0 text-xs font-medium sm:w-9",
                            hasError ? "text-red-600" : "text-gray-700"
                          )}
                        >
                          Due:
                        </span>
                        <Controller
                          control={control}
                          name={`due_dates.${index}.due_month`}
                          render={({ field }) => (
                            <Select value={field.value || ""} onValueChange={field.onChange}>
                              <SelectTrigger
                                className={cn(
                                  "h-8 w-24 shrink-0 bg-white px-2 transition-all",
                                  rowErr?.due_month ? errorRing : okRing
                                )}
                              >
                                <SelectValue placeholder="Month" />
                              </SelectTrigger>
                              <SelectContent>
                                {MONTHS.map((m) => (
                                  <SelectItem key={m} value={m}>
                                    {m}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          placeholder="Day"
                          className={cn(
                            "h-8 w-14 shrink-0 bg-white transition-all",
                            rowErr?.due_day ? errorRing : okRing
                          )}
                          {...register(`due_dates.${index}.due_day`)}
                        />
                      </div>

                      <div className="mx-1 hidden h-5 w-px bg-gray-200 sm:block"></div>

                      {/* Covers Period */}
                      <div className="flex items-center gap-1.5 sm:flex-1">
                        <span
                          className={cn(
                            "w-14 shrink-0 text-xs font-medium sm:w-auto",
                            rowErr?.from_month || rowErr?.to_month ? "text-red-600" : "text-gray-500"
                          )}
                        >
                          Covers:
                        </span>
                        <Select
                          value={watch(`due_dates.${index}.from_month`) || ""}
                          onValueChange={(v) => handleFromMonthChange(index, v)}
                        >
                          <SelectTrigger
                            className={cn(
                              "h-8 min-w-0 flex-1 bg-white px-2 transition-all",
                              rowErr?.from_month ? errorRing : okRing
                            )}
                          >
                            <SelectValue placeholder="From" />
                          </SelectTrigger>
                          <SelectContent>
                            {MONTHS.map((m) => (
                              <SelectItem key={m} value={m}>
                                {m}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-gray-400">-</span>
                        <Controller
                          control={control}
                          name={`due_dates.${index}.to_month`}
                          render={({ field }) => (
                            <Select value={field.value || ""} onValueChange={field.onChange}>
                              <SelectTrigger
                                className={cn(
                                  "h-8 min-w-0 flex-1 bg-white px-2 transition-all",
                                  rowErr?.to_month ? errorRing : okRing
                                )}
                              >
                                <SelectValue placeholder="To" />
                              </SelectTrigger>
                              <SelectContent>
                                {MONTHS.map((m) => (
                                  <SelectItem key={m} value={m}>
                                    {m}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>

                      {/* Delete */}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="absolute right-1 top-1 h-8 w-8 shrink-0 text-gray-400 hover:bg-red-50 hover:text-red-600 sm:static sm:right-auto sm:top-auto"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {hasError && (
                      <p className="pl-2 text-xs text-red-500">
                        {rowErr?.due_month?.message ||
                          rowErr?.due_day?.message ||
                          rowErr?.from_month?.message ||
                          rowErr?.to_month?.message}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Message */}
          <div className="space-y-1.5">
            <Label htmlFor="reminder-message" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Message <span className="text-xs font-normal text-slate-400 ml-1">(Optional)</span>
            </Label>
            <Textarea 
              id="reminder-message" 
              rows={2} 
              placeholder="Extra note shown with the reminder" 
              className="transition-all focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              {...register("message")} 
            />
          </div>

          {/* Enabled */}
          <Controller
            control={control}
            name="enabled"
            render={({ field }) => (
              <div className="flex items-center gap-3 py-2">
                <Switch 
                  id="reminder-enabled" 
                  checked={field.value} 
                  onCheckedChange={(v) => field.onChange(!!v)} 
                  className="data-[state=checked]:bg-emerald-600" 
                />
                <Label htmlFor="reminder-enabled" className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">
                  Enabled
                </Label>
              </div>
            )}
          />

          <DialogFooter className="pt-4 border-t border-slate-200 mt-6">
            <Button type="button" variant="outline" className="h-10 px-4 text-sm font-medium" onClick={close}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={loading}
              className="h-10 px-5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20 transition-all duration-200"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Saving...
                </div>
              ) : isEdit ? "Save Changes" : "Create Reminder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default NewReminderDialog;
