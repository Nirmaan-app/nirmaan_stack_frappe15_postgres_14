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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { useDialogStore } from "@/zustand/useDialogStore";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SCHEDULE_TYPES = ["Monthly", "Quarterly", "Half-Yearly", "Custom Dates"] as const;
// Months each span-based schedule covers (auto-fills the end month from the start).
const SPAN: Record<string, number> = { Quarterly: 3, "Half-Yearly": 6 };

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-all focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50";

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
  const isEdit = !!editReminderScheduleName;
  const loading = creating || updating;

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
    setValue(`due_dates.${index}.from_month`, value);
    const span = SPAN[scheduleType];
    if (span && value) {
      const start = MONTHS.indexOf(value);
      if (start >= 0) setValue(`due_dates.${index}.to_month`, MONTHS[(start + span - 1) % 12]);
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
        await updateDoc("Reminder Schedule", editReminderScheduleName, payload);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
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
              className={`h-10 transition-all focus:ring-2 ${errors.title ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'focus:ring-emerald-500/20 focus:border-emerald-500'}`}
              {...register("title")}
            />
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
              <select id="reminder-type" className={`${selectClass} ${errors.schedule_type ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'focus:ring-emerald-500/20 focus:border-emerald-500'}`} {...register("schedule_type")}>
                {SCHEDULE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
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
                const hasError = !!(rowErr?.due_month || rowErr?.due_day);
                
                return (
                  <div key={row.id} className="flex flex-col gap-1">
                    <div className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${hasError ? 'border-red-200 bg-red-50/30' : 'bg-gray-50/50'}`}>
                      {/* Due Date */}
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-medium w-9 ${hasError ? 'text-red-600' : 'text-gray-700'}`}>Due:</span>
                        <select className={`${selectClass} w-20 bg-white h-8 ${rowErr?.due_month ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'focus:ring-emerald-500/20 focus:border-emerald-500'}`} {...register(`due_dates.${index}.due_month`)}>
                          <option value="">Mon</option>
                          {MONTHS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          placeholder="Day"
                          className={`w-16 h-8 bg-white transition-all focus:ring-2 ${rowErr?.due_day ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'focus:ring-emerald-500/20 focus:border-emerald-500'}`}
                          {...register(`due_dates.${index}.due_day`)}
                        />
                      </div>
                      
                      <div className="w-px h-5 bg-gray-200 mx-1 hidden sm:block"></div>
                      
                      {/* Covers Period */}
                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 flex-1">
                        <span className="text-xs font-medium text-gray-500 hidden sm:inline-block">Covers:</span>
                        <select
                          className={`${selectClass} w-16 sm:w-20 bg-white h-8 text-muted-foreground focus:ring-emerald-500/20 focus:border-emerald-500`}
                          value={watch(`due_dates.${index}.from_month`) || ""}
                          onChange={(e) => handleFromMonthChange(index, e.target.value)}
                        >
                          <option value="">From</option>
                          {MONTHS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        <span className="text-xs text-gray-400 hidden sm:inline-block">-</span>
                        <select className={`${selectClass} w-16 sm:w-20 bg-white h-8 text-muted-foreground focus:ring-emerald-500/20 focus:border-emerald-500`} {...register(`due_dates.${index}.to_month`)}>
                          <option value="">To</option>
                          {MONTHS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>

                      {/* Delete */}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
