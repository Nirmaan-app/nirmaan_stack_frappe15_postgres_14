import { useEffect, useMemo, useRef, useState } from "react";
import ReactSelect, { type MultiValue, type StylesConfig } from "react-select";
import { Lock, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";
import { cn } from "@/lib/utils";
import { useBillingManagers, useBillingMutations, useBillingPackages } from "../data/useBillingQueries";
import type { BillingTracker } from "../types";
import { type PackageSetup, inr, poAmount, poInputOf, setupSummary } from "../utils/billingFormat";

export interface ManagerOption {
  value: string;
  label: string;
}

/** Package | Billing managers | PO value | remove, from md up; rows stack on a phone. */
const ROW_GRID = "md:grid md:grid-cols-[170px_minmax(0,1fr)_190px_32px] md:items-start md:gap-4";

// The menu is portalled to <body>, where a modal Radix dialog has switched pointer
// events off; without `pointerEvents: "auto"` its options are keyboard-only.
export const managerSelectStyles: StylesConfig<ManagerOption, true> = {
  control: (base, state) => ({
    ...base,
    minHeight: 36,
    fontSize: 13,
    borderColor: state.isFocused ? "#94a3b8" : "#e2e8f0",
    boxShadow: "none",
    "&:hover": { borderColor: "#94a3b8" },
  }),
  valueContainer: (base) => ({ ...base, gap: 4, padding: "3px 6px" }),
  multiValue: (base) => ({ ...base, margin: 0, borderRadius: 9999, backgroundColor: "#eff6ff" }),
  multiValueLabel: (base) => ({ ...base, padding: "2px 2px 2px 9px", fontSize: 12, fontWeight: 600, color: "#1d4ed8" }),
  multiValueRemove: (base) => ({
    ...base,
    borderRadius: 9999,
    color: "#1d4ed8",
    ":hover": { backgroundColor: "#dbeafe", color: "#1e3a8a" },
  }),
  placeholder: (base) => ({ ...base, color: "#94a3b8" }),
  menu: (base) => ({ ...base, fontSize: 13 }),
  menuPortal: (base) => ({ ...base, zIndex: 9999, pointerEvents: "auto" }),
};

// Same picker with an amber outline: the package has no manager yet.
const missingManagerStyles: StylesConfig<ManagerOption, true> = {
  ...managerSelectStyles,
  control: (base, state) => ({
    ...managerSelectStyles.control!(base, state),
    borderColor: state.isFocused ? "#94a3b8" : "#fbbf24",
  }),
};

const sameManagers = (a: string[], b: string[]) => a.length === b.length && a.every((user) => b.includes(user));

function StepLabel({ step, title, aside }: { step: string; title: string; aside?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] text-slate-700">
          {step}
        </span>
        {title}
      </p>
      {aside && <span className="text-xs font-semibold tabular-nums text-slate-600">{aside}</span>}
    </div>
  );
}

interface SetupBillingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  projectLabel: string;
  trackers: BillingTracker[];
}

/**
 * Pick the billing packages in scope (step 1), then give each its managers and PO value
 * (step 2). Saving creates one Project Billing Tracker per new package and updates the
 * managers and PO value of packages already set up. A set-up package cannot be removed here.
 */
export function SetupBillingDialog({ open, onOpenChange, project, projectLabel, trackers }: SetupBillingDialogProps) {
  const { data: packages } = useBillingPackages();
  const { data: managers, isLoading: managersLoading } = useBillingManagers();
  const { setupBilling, loading } = useBillingMutations();

  const existing = useMemo(() => new Set(trackers.map((t) => t.package)), [trackers]);
  const [picked, setPicked] = useState<Record<string, PackageSetup>>({});

  // Fill from the saved trackers when the dialog opens, and only then: a background
  // refetch while it is open must not wipe what is being typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const initial: Record<string, PackageSetup> = {};
      trackers.forEach((t) => {
        initial[t.package] = { managers: t.billing_managers.map((m) => m.user), po: poInputOf(t.po_value) };
      });
      setPicked(initial);
    }
    wasOpen.current = open;
  }, [open, trackers]);

  // Billing users can be picked; a saved manager outside that list still shows by name.
  const managerOptions = useMemo<ManagerOption[]>(
    () => (managers || []).map((m) => ({ value: m.email, label: m.full_name || m.email })),
    [managers],
  );
  const optionByUser = useMemo(() => {
    const map = new Map<string, ManagerOption>();
    trackers.forEach((t) => t.billing_managers.forEach((m) => map.set(m.user, { value: m.user, label: m.full_name || m.user })));
    managerOptions.forEach((option) => map.set(option.value, option));
    return map;
  }, [trackers, managerOptions]);

  const packageNames = (packages || []).map((p) => p.name);
  const ticked = packageNames.filter((name) => picked[name]);
  const summary = setupSummary(picked);
  const newCount = ticked.filter((name) => !existing.has(name)).length;

  // "Use these managers for all" sits under the first ticked package that has managers,
  // and only while another ticked package has a different set.
  const copySource = ticked.find((name) => picked[name].managers.length);
  const canCopy =
    !!copySource &&
    ticked.some((name) => name !== copySource && !sameManagers(picked[name].managers, picked[copySource].managers));

  const toggle = (pkg: string) => {
    if (existing.has(pkg)) return;
    setPicked((p) => {
      const next = { ...p };
      if (pkg in next) delete next[pkg];
      else next[pkg] = { managers: [], po: "" };
      return next;
    });
  };
  const update = (pkg: string, patch: Partial<PackageSetup>) =>
    setPicked((p) => ({ ...p, [pkg]: { ...p[pkg], ...patch } }));
  const copyManagers = () => {
    if (!copySource) return;
    setPicked((p) => {
      const next = { ...p };
      ticked.forEach((name) => {
        next[name] = { ...next[name], managers: [...p[copySource].managers] };
      });
      return next;
    });
  };

  const handleSave = async () => {
    try {
      await setupBilling(
        project,
        Object.entries(picked).map(([pkg, row]) => ({
          package: pkg,
          billing_managers: row.managers,
          po_value: poAmount(row.po) ?? 0,
        })),
      );
      toast({ title: "Billing packages saved", variant: "success" });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Could not save billing packages",
        description: getFrappeError(e),
        variant: "destructive",
      });
    }
  };

  const toFill = [
    summary.noManager.length ? `a manager for ${summary.noManager.join(", ")}` : "",
    summary.noPoValue.length ? `a PO value for ${summary.noPoValue.join(", ")}` : "",
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-[820px]">
        <DialogHeader className="space-y-1 px-6 pb-3 pt-5 text-left">
          <DialogTitle>Billing packages</DialogTitle>
          <DialogDescription>
            {projectLabel} · pick the packages in scope, then add their billing managers and PO value. Type 45L or
            1.2cr if you prefer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-4">
          {/* Step 1: which packages are in scope */}
          <section>
            <StepLabel step="1" title="Packages in scope" aside={`${summary.count} of ${packageNames.length}`} />
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-5">
              {packageNames.map((name) => {
                const on = !!picked[name];
                const locked = existing.has(name);
                return (
                  <label
                    key={name}
                    title={locked ? "Already set up. A set-up package can't be removed here." : name}
                    className={cn(
                      "flex h-8 items-center gap-2 rounded-md border px-2.5 text-[13px] transition-colors",
                      locked
                        ? "cursor-default border-slate-200 bg-slate-50 font-medium text-slate-700"
                        : on
                          ? "cursor-pointer border-primary/40 bg-primary/5 font-medium text-gray-900"
                          : "cursor-pointer border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50",
                    )}
                  >
                    <Checkbox
                      checked={on}
                      disabled={locked}
                      onCheckedChange={() => toggle(name)}
                      aria-label={`Include ${name}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {locked && <Lock className="h-3 w-3 shrink-0 text-slate-400" aria-label="Already set up" />}
                  </label>
                );
              })}
            </div>
          </section>

          {/* Step 2: managers and PO value of each picked package */}
          <section>
            <StepLabel step="2" title="Managers and PO value" />
            {!ticked.length ? (
              <div className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
                Pick packages above to add their managers and PO value.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <div className={cn("hidden bg-red-50 px-4 py-2.5 text-xs font-semibold text-gray-700", ROW_GRID)}>
                  <span>Package</span>
                  <span>Billing managers</span>
                  <span className="text-right">PO value (incl. GST)</span>
                  <span />
                </div>

                {ticked.map((name) => {
                  const row = picked[name];
                  const locked = existing.has(name);
                  const po = poAmount(row.po);
                  return (
                    <div key={name} className={cn("space-y-2 border-t px-4 py-2.5 md:space-y-0", ROW_GRID)}>
                      <div className="flex min-h-9 items-center justify-between gap-2 md:justify-start">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">{name}</span>
                          {locked && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                              Set up
                            </span>
                          )}
                        </span>
                        {!locked && (
                          <button
                            type="button"
                            onClick={() => toggle(name)}
                            aria-label={`Remove ${name}`}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 md:hidden"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      <div className="min-w-0">
                        <ReactSelect<ManagerOption, true>
                          isMulti
                          isLoading={managersLoading}
                          options={managerOptions}
                          value={row.managers.map((user) => optionByUser.get(user) ?? { value: user, label: user })}
                          onChange={(chosen: MultiValue<ManagerOption>) =>
                            update(name, { managers: chosen.map((option) => option.value) })
                          }
                          placeholder="Add billing managers…"
                          noOptionsMessage={() => "No billing users found"}
                          aria-label={`Billing managers for ${name}`}
                          classNamePrefix="react-select"
                          menuPortalTarget={document.body}
                          menuPlacement="auto"
                          styles={row.managers.length ? managerSelectStyles : missingManagerStyles}
                        />
                        {canCopy && copySource === name && (
                          <button
                            type="button"
                            onClick={copyManagers}
                            className="mt-1 text-[11px] font-semibold text-blue-700 hover:underline"
                          >
                            Use these managers for all packages
                          </button>
                        )}
                      </div>

                      <div>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                            ₹
                          </span>
                          <Input
                            className={cn(
                              "h-9 pl-7 text-right tabular-nums",
                              po === null && "border-red-400 focus-visible:ring-red-400",
                              po === 0 && "border-amber-400",
                            )}
                            inputMode="decimal"
                            placeholder="e.g. 45L"
                            aria-label={`PO value for ${name}`}
                            value={row.po}
                            onChange={(e) => update(name, { po: e.target.value })}
                          />
                        </div>
                        <p
                          className={cn(
                            "mt-1 text-right text-[11px] tabular-nums",
                            po === null ? "font-semibold text-red-700" : po ? "text-muted-foreground" : "text-amber-700",
                          )}
                        >
                          {po === null ? "Can't read this amount" : po ? inr(po) : "Not entered yet"}
                        </p>
                      </div>

                      <div className="hidden min-h-9 items-center justify-center md:flex">
                        {!locked && (
                          <button
                            type="button"
                            onClick={() => toggle(name)}
                            aria-label={`Remove ${name}`}
                            title={`Remove ${name}`}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div
                  className={cn(
                    "flex items-center justify-between border-t-2 border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold",
                    ROW_GRID,
                    "md:items-center",
                  )}
                >
                  <span className="md:col-span-2">
                    Total · {summary.count} package{summary.count === 1 ? "" : "s"}
                  </span>
                  <span className="text-right tabular-nums text-gray-900">{inr(summary.total)}</span>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-background px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p
            className={cn(
              "text-xs",
              summary.unreadable.length
                ? "font-semibold text-red-700"
                : toFill.length
                  ? "text-amber-700"
                  : summary.count
                    ? "text-emerald-700"
                    : "text-muted-foreground",
            )}
          >
            {summary.unreadable.length
              ? `Can't read the PO value for ${summary.unreadable.join(", ")}.`
              : toFill.length
                ? `Still to add: ${toFill.join(" · ")}. You can save now and add these later.`
                : summary.count
                  ? "Every package has a manager and a PO value."
                  : "Pick at least one package."}
          </p>
          <div className="flex shrink-0 gap-2.5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={loading || !summary.count || summary.unreadable.length > 0} onClick={handleSave}>
              {loading
                ? "Saving…"
                : newCount
                  ? `Set up ${newCount} new package${newCount === 1 ? "" : "s"}`
                  : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
