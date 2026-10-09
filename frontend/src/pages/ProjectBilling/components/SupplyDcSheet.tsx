import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";
import { cn } from "@/lib/utils";
import { useBillingMutations } from "../data/useBillingQueries";
import type { BillingTracker } from "../types";
import { type DcEntryMode, dcEntryPlan, dcFreshness, inr, parsePlainAmount, pct } from "../utils/billingFormat";
import { PackageChip, SegmentedTabs, ToneTag } from "./BillingBits";

interface SupplyDcSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackers: BillingTracker[];
  /** Show the project name on each row (My Bills spans projects). */
  showProject?: boolean;
}

/**
 * Daily Supply DC entry, one row per package. "Add today's" logs the day's
 * delivered value; "Correct total" logs the difference to a corrected total.
 * Either way one DC log row is appended; past rows are never edited here.
 */
export function SupplyDcSheet({ open, onOpenChange, trackers, showProject }: SupplyDcSheetProps) {
  const [mode, setMode] = useState<DcEntryMode>("add");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { addDcEntry } = useBillingMutations();

  const rows = useMemo(() => {
    const withFresh = trackers.map((t) => ({ t, fresh: dcFreshness(t.dc_updated_on) }));
    withFresh.sort((a, b) => Number(a.fresh.isToday) - Number(b.fresh.isToday));
    return withFresh;
  }, [trackers]);
  const doneCount = rows.filter((r) => r.fresh.isToday).length;
  const visible = pendingOnly ? rows.filter((r) => !r.fresh.isToday) : rows;

  const commit = async (t: BillingTracker, amount: number, label: string) => {
    setSaving(t.name);
    try {
      await addDcEntry(t.name, amount);
      setDrafts((d) => {
        const next = { ...d };
        delete next[t.name];
        return next;
      });
      toast({ title: `${label} — ${t.package}`, variant: "success" });
    } catch (e: any) {
      toast({
        title: "Could not save Supply DC",
        description: getFrappeError(e),
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[520px]">
        <SheetHeader>
          <SheetTitle>Supply DC — daily update</SheetTitle>
          <SheetDescription>
            Enter today's delivered value for each package in rupees; the running total updates itself. It can't go
            above the package's PO value.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <SegmentedTabs<DcEntryMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "add", label: "Add today's" },
              { value: "correct", label: "Correct total" },
            ]}
          />
          <span className={cn("text-xs font-semibold", doneCount === rows.length ? "text-green-700" : "text-amber-700")}>
            {doneCount} of {rows.length} updated today
          </span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setPendingOnly((v) => !v)}>
            {pendingOnly ? "Show all" : "Show pending only"}
          </Button>
        </div>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div
            className={doneCount === rows.length ? "h-full bg-green-700" : "h-full bg-amber-500"}
            style={{ width: `${rows.length ? Math.round((doneCount / rows.length) * 100) : 0}%` }}
          />
        </div>

        <div className="mt-5 space-y-2.5">
          {!visible.length && (
            <div className="py-10 text-center">
              <p className="text-sm font-semibold text-green-700">Every package updated today</p>
              <p className="mt-1 text-xs text-muted-foreground">Use "Show all" to add to a figure again.</p>
            </div>
          )}
          {visible.map(({ t, fresh }) => {
            const draft = drafts[t.name] ?? "";
            const current = t.supply_dc || 0;
            // No PO value, no Supply DC: there is nothing to measure it against (owner, 2026-10-05).
            const noPo = !(t.po_value > 0);
            const typed = parsePlainAmount(draft);
            const plan = dcEntryPlan(mode, typed, current, t.po_value || 0);
            const { amount, newTotal } = plan;
            const problem = draft.trim() && typed === null ? "Numbers only, e.g. 250000" : plan.problem;
            const save = () => {
              if (amount === null || problem) return;
              commit(t, amount, mode === "add" ? "Supply DC added" : "Supply DC corrected");
            };
            return (
              <div key={t.name} className={cn("rounded-lg border p-3.5", fresh.isToday && "bg-green-50/40")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {showProject && <span className="text-sm font-semibold">{t.project_name || t.project}</span>}
                    <PackageChip label={t.package} />
                  </div>
                  <ToneTag label={fresh.label} tone={fresh.tone} />
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  {t.po_value > 0 ? `PO ${inr(t.po_value)}` : "PO not set"} · till date{" "}
                  <span className="font-semibold text-gray-700">{inr(current)}</span>
                  {t.po_value > 0 && <span className="ml-1">{pct(current, t.po_value)}% of PO</span>}
                </div>
                {noPo ? (
                  <>
                    <p className="mt-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      Set this package's PO value before logging Supply DC (project Billing tab → Packages).
                    </p>
                    {/* A zero day needs no PO value, so it can still be marked (owner, 2026-10-05). */}
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        disabled={saving === t.name}
                        onClick={() => commit(t, 0, "Marked no delivery today")}
                        className="text-[11px] font-semibold text-muted-foreground underline hover:text-gray-900"
                      >
                        No delivery today
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-2.5 flex items-center gap-2">
                      <Input
                        className="w-32"
                        inputMode="decimal"
                        placeholder={mode === "add" ? "e.g. 250000" : "e.g. 8660000"}
                        aria-label={`Supply DC for ${t.package}`}
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [t.name]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && save()}
                      />
                      {newTotal !== null && (
                        <span className="text-sm text-muted-foreground">
                          → <span className={cn("font-bold", problem ? "text-red-700" : "text-green-700")}>{inr(newTotal)}</span>
                        </span>
                      )}
                      <Button
                        size="sm"
                        className="ml-auto"
                        disabled={amount === null || !!problem || saving === t.name}
                        onClick={save}
                      >
                        {saving === t.name ? "Saving…" : "Save"}
                      </Button>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {problem ? <span className="text-[11px] font-semibold text-red-700">{problem}</span> : <span />}
                      {/* Logs a ₹0 DC row dated today, so the package counts as updated today. */}
                      <button
                        type="button"
                        disabled={saving === t.name}
                        onClick={() => commit(t, 0, "Marked no delivery today")}
                        className="text-[11px] font-semibold text-muted-foreground underline hover:text-gray-900"
                      >
                        No delivery today
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
