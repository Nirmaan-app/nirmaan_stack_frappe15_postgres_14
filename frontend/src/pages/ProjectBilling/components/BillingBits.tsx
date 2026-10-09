import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_CLASSES, Tone, etaTag, inr, inrShort, pct, statusTone } from "../utils/billingFormat";
import { formatDate } from "@/utils/FormatDate";

export function StatusBadge({ status }: { status?: string | null }) {
  const label = status || "Not Started";
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-semibold",
        TONE_CLASSES[statusTone(label)],
      )}
    >
      {label}
    </span>
  );
}

export function ToneTag({ label, tone, className }: { label: string; tone: Tone; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONE_CLASSES[tone], className)}>
      {label}
    </span>
  );
}

/**
 * Rupees in full on wide screens (xl and up), in lakh / crore shorthand below,
 * so a table of amounts fits the page width instead of scrolling sideways.
 */
export function Money({ value }: { value?: number | null }) {
  return (
    <>
      <span className="hidden whitespace-nowrap xl:inline">{inr(value)}</span>
      <span className="whitespace-nowrap xl:hidden" title={inr(value)}>
        {inrShort(value)}
      </span>
    </>
  );
}

export function PackageChip({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700", className)}>
      {label}
    </span>
  );
}

export function PersonChip({ label, className }: { label?: string | null; className?: string }) {
  if (!label) return <span className="text-xs text-muted-foreground">Unassigned</span>;
  return (
    <span className={cn("whitespace-nowrap rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700", className)}>
      {label}
    </span>
  );
}

/** A package's managers as chips; "Unassigned" when there are none. */
export function PersonChips({ names, className }: { names: string[]; className?: string }) {
  if (!names.length) return <PersonChip label={null} />;
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {names.map((name) => (
        <PersonChip key={name} label={name} />
      ))}
    </span>
  );
}

/** ETA date plus an "overdue / today / in Nd" tag. */
/**
 * An ETA date with its "Today / In 3d / 2d overdue" tag. `stacked` puts a smaller tag under the date
 * (the bills table, owner 2026-10-05); otherwise it sits beside the date (Project Wise rows).
 */
export function EtaCell({
  eta,
  done,
  stacked,
  className,
}: {
  eta?: string | null;
  done?: boolean;
  stacked?: boolean;
  className?: string;
}) {
  if (!eta) return <span className="text-sm text-muted-foreground">Not set</span>;
  const tag = done ? null : etaTag(eta);
  if (stacked) {
    return (
      <div className={cn("flex flex-col items-start gap-1 whitespace-nowrap", className)}>
        <span className="text-sm">{formatDate(eta)}</span>
        {tag && <ToneTag label={tag.label} tone={tag.tone} className="px-1.5 py-0 text-[10px] leading-4" />}
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-2 whitespace-nowrap", className)}>
      <span className="text-sm">{formatDate(eta)}</span>
      {tag && <ToneTag label={tag.label} tone={tag.tone} />}
    </div>
  );
}

/**
 * Approved (green) and billed-awaiting-approval (amber) as shares of `total`.
 * Callers pass the PO value, or the billed total when no PO value is entered yet.
 */
export function ApprovalBar({
  approved,
  billed,
  total,
  thick,
}: {
  approved: number;
  billed: number;
  total: number;
  thick?: boolean;
}) {
  const approvedPct = Math.min(100, pct(approved, total));
  const awaitingPct = Math.max(0, Math.min(100 - approvedPct, pct(billed - approved, total)));
  return (
    <div className={cn("flex overflow-hidden rounded-full bg-gray-100", thick ? "h-2.5" : "h-1.5")}>
      <div className="bg-green-700" style={{ width: `${approvedPct}%` }} />
      <div className="bg-amber-500" style={{ width: `${awaitingPct}%` }} />
    </div>
  );
}

export function ApprovalLegend({ approved, billed }: { approved: number; billed: number }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-sm bg-green-700" />
        <span className="font-bold text-green-700">{inrShort(approved)}</span> approved
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-sm bg-amber-500" />
        <span className="font-bold text-amber-700">{inrShort(billed - approved)}</span> awaiting
      </span>
    </div>
  );
}

export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex w-fit overflow-hidden rounded-lg border border-gray-300 bg-white">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors",
            i > 0 && "border-l border-gray-300",
            value === o.value ? "bg-primary text-white" : "bg-white text-gray-700 hover:bg-gray-50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * "All | Electrical | HVAC | …" over a project's bill list, each with its bill count (NA left out,
 * like every other count). `value` is the selected package, or null for All. With `onRemove` (Admin
 * only), each package tab also carries a trash icon that asks to remove the package from the project.
 */
export function PackageTabs({
  packages,
  total,
  value,
  onChange,
  onRemove,
}: {
  packages: { package: string; bill_count: number }[];
  total: number;
  value: string | null;
  onChange: (pkg: string | null) => void;
  onRemove?: (pkg: string) => void;
}) {
  const tabs = [{ key: null as string | null, label: "All", count: total }].concat(
    packages.map((p) => ({ key: p.package, label: p.package, count: p.bill_count })),
  );
  return (
    <div role="tablist" aria-label="Packages" className="flex flex-wrap items-center gap-2.5">
      <span className="mr-1 text-sm font-semibold text-gray-700">Packages:</span>
      {tabs.map((tab) => {
        const active = value === tab.key;
        const pkg = tab.key;
        return (
          // Two buttons side by side, never one inside the other: the tab filters, the icon removes.
          <div
            key={pkg ?? "__all__"}
            className={cn(
              "inline-flex items-center rounded-lg border text-sm font-semibold transition-colors",
              active ? "border-blue-600 bg-blue-600 text-white" : "border-blue-200 bg-white text-blue-700",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(pkg)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5",
                !active && "hover:bg-blue-50",
                onRemove && pkg && "pr-2",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold",
                  active ? "bg-white/25 text-white" : "bg-blue-100 text-blue-700",
                )}
              >
                {tab.count}
              </span>
            </button>
            {onRemove && pkg && (
              <button
                type="button"
                onClick={() => onRemove(pkg)}
                title={`Remove ${pkg} from this project (Admin)`}
                aria-label={`Remove ${pkg} from this project`}
                className={cn(
                  "mr-1.5 rounded p-1 transition-colors",
                  active ? "text-white/80 hover:bg-white/20 hover:text-white" : "text-blue-400 hover:bg-red-50 hover:text-red-600",
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
