/**
 * VAV-2c1 (R5 c; owner 2026-11-22 11:02 "yes for both", the mockup approved 20:04 "optoin a"): the Scope choice as a box a pricer cannot miss
 * -- bordered, first in the card, on the helper panel and on the Calculator, in every category that has a scope choice. The app's red
 * accent for supply + installation, the panel's amber for the others. Display only: the choices, the pick and every figure are the
 * view's (`scope.picker`).
 */
import { cn } from "@/lib/utils";

export const SCOPE_BOX_LABEL = "Scope of this rate";

/** PURE. The one line under the choice: what the picked scope leaves out (the first choice leaves nothing out). */
export function scopeBoxLine(picker: { options: string[]; value: string }): string {
  if (picker.value === picker.options[0]) return "What this rate covers. Every line below follows it.";
  return /^supply only/i.test(picker.value) ? "Installation is not in scope: 0 on every line below." : "Supply is not in scope: 0 on every line below.";
}

export function ScopeBox({ picker, wide, onScope }: { picker: { options: string[]; value: string }; /** the Calculator's wide card */ wide: boolean; onScope?: (value: string) => void }) {
  const plain = picker.value === picker.options[0];
  return (
    <div
      className={cn("rounded-md border-2 px-2.5 py-2", wide ? "flex flex-wrap items-center gap-3" : "space-y-1",
        plain ? "border-primary bg-primary/5" : "border-amber-500 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/40")}
      data-testid="item-scope-picker"
      data-scope={plain ? "both" : "one"}
    >
      <div className={cn("text-xs font-bold", plain ? "text-primary" : "text-amber-900 dark:text-amber-200")}>{SCOPE_BOX_LABEL}</div>
      <select
        className={cn("h-9 rounded border bg-background px-2 text-sm font-semibold", wide ? "min-w-64" : "w-full", plain ? "border-primary" : "border-amber-500")}
        value={picker.value}
        onChange={(e) => onScope?.(e.target.value)}
        aria-label={SCOPE_BOX_LABEL}
      >
        {picker.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <div className={cn("text-[11px] leading-snug", plain ? "text-muted-foreground" : "font-medium text-amber-900 dark:text-amber-200")} data-testid="item-scope-line">
        {scopeBoxLine(picker)}
      </div>
    </div>
  );
}
