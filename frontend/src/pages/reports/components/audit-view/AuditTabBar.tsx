/** Audit View: the Orders / Invoices / Payments tabs and the figures behind "Show details". */
import { ReactNode } from "react";
import { CheckCircle2, ChevronDown, Info, LucideIcon, Percent, Receipt } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { AGAINST_BAR } from "./auditViewStyles";
import { AUDIT_TAB_META, AUDIT_TABS, AuditAgainst, AuditByAgainst, AuditTab, AuditView, AuditViewSummary, auditAgainstFor, compactRupees, invoicedPercent, isAuditTabDisabled } from "../../utils/auditView";

const rupees = formatToRoundedIndianRupee;

// ---------------------------------------------------------------------------------------------
// Tab cards
// ---------------------------------------------------------------------------------------------

interface CardFigures {
  count: number;
  amount: number;
  unit: string;
  byAgainst: AuditByAgainst;
  signal: ReactNode;
  signalIcon: LucideIcon;
  signalClass?: string;
}

/** The headline figure, unit, count, type mix and one-line signal of one tab card. */
const cardFigures = (key: AuditTab, summary: AuditViewSummary | null): CardFigures | null => {
  if (key === "orders") {
    const o = summary?.orders;
    if (!o) return null;
    const pct = invoicedPercent(o.total_invoiced, o.incl_gst);
    return {
      count: o.count,
      amount: o.incl_gst,
      unit: "incl. GST",
      byAgainst: o.by_against ?? {},
      signalIcon: Receipt,
      signal: (
        <>
          Invoiced <b className="font-semibold text-foreground">{compactRupees(o.total_invoiced)}</b>
          {pct === null ? "" : ` · ${pct}% of value`}
        </>
      ),
    };
  }
  if (key === "invoices") {
    const i = summary?.invoices;
    if (!i) return null;
    return {
      count: i.count,
      amount: i.invoice_amount,
      unit: "invoiced",
      byAgainst: i.by_against ?? {},
      signalIcon: CheckCircle2,
      signalClass: "text-green-700 dark:text-green-400",
      signal: "Approved invoices only",
    };
  }
  const p = summary?.payments;
  if (!p) return null;
  return {
    count: p.count,
    amount: p.net_paid,
    unit: "net paid",
    byAgainst: p.by_against ?? {},
    signalIcon: Percent,
    signal: (
      <>
        TDS <b className="font-semibold text-foreground">{compactRupees(p.tds)}</b> · paid{" "}
        <b className="font-semibold text-foreground">{compactRupees(p.amount_paid)}</b>
      </>
    ),
  };
};

/** A thin bar split by Against, each part as wide as its share of the tab's headline figure. */
function MixBar({ against, byAgainst }: { against: AuditAgainst[]; byAgainst: AuditByAgainst }) {
  const parts = against.map((a) => ({ a, v: byAgainst[a] ?? 0 })).filter((p) => p.v > 0);
  return (
    <span className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      {parts.map(({ a, v }) => (
        <i key={a} className={cn("block min-w-[2px]", AGAINST_BAR[a])} style={{ flex: v }} title={`${a}: ${rupees(v)}`} />
      ))}
    </span>
  );
}

const COMPACT_COUNT = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
/** A tab count short enough for a phone: 980, 6.6K, 13K, 1.2L. */
const compactCount = (n: number): string => (n < 1000 ? n.toLocaleString("en-IN") : COMPACT_COUNT.format(n));

interface TabBarProps {
  view: AuditView;
  tab: AuditTab | null;
  locked: boolean;
  onSelect: (tab: AuditTab) => void;
  summary: AuditViewSummary | null;
  isLoading: boolean;
  showDetails: boolean;
  onToggleDetails: () => void;
}

/**
 * Plain tabs -- just the name and the count -- attached to the panel below, with "Show details" on the
 * right to expand the figures. Locked (greyed, not clickable) until a date range is picked.
 */
export function TabBar({ view, tab, locked, onSelect, summary, isLoading, showDetails, onToggleDetails }: TabBarProps) {
  return (
    <div className="flex flex-col gap-1 border-b px-3 sm:px-4 lg:flex-row lg:items-end lg:gap-3">
      {/* No overflow-x-auto here: the tabs overlap the bar's bottom border by 1px (-mb-px) so the open tab
          joins the panel, and a scroll container turns that 1px into a vertical scrollbar. */}
      <div role="tablist" aria-label="Audit View tabs" className="flex min-w-0 flex-1 gap-1 sm:gap-1.5">
        {/* A tab that does not apply to this view (Orders in Non Project View: overheads have no PO / WO)
            is not shown at all, rather than as a greyed "n/a" tab. */}
        {AUDIT_TABS.filter((key) => !isAuditTabDisabled(view, key)).map((key) => {
          const notApplicable = false;
          const disabled = locked || notApplicable;
          const selected = key === tab;
          const count = cardFigures(key, summary)?.count;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`audit-tab-${key}`}
              aria-selected={selected}
              aria-controls="audit-view-panel"
              aria-disabled={disabled || undefined}
              tabIndex={disabled ? -1 : selected || (!tab && key === AUDIT_TABS.find((t) => !isAuditTabDisabled(view, t))) ? 0 : -1}
              title={notApplicable ? "Non-project expenses have no PO or WO" : locked ? "Pick a date range first" : undefined}
              onClick={() => !disabled && onSelect(key)}
              className={cn(
                // Below lg (phones, tablets, or a laptop with the sidebar open): the tabs share the row by content
                // width and never wrap onto separate lines. lg+: natural width.
                "-mb-px inline-flex min-w-0 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-t-lg border px-1.5 py-2.5 text-[13px] font-semibold",
                // Colours only: animating the border width / padding / lift on switch made the tabs jump.
                "transition-colors duration-150",
                "sm:gap-1.5 sm:px-3 sm:text-sm lg:flex-none lg:gap-2 lg:px-5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1",
                // The open tab's red line IS its top border (3px), so it curves into the rounded corners and
                // meets the side borders; pt-2 offsets the 2 extra pixels so its label lines up with the others.
                // Its bottom border is the card colour, so it merges into the panel below (-mb-px).
                selected
                  ? "border-border border-t-[3px] border-t-red-600 border-b-card bg-card pt-2 text-foreground"
                  : "border-transparent bg-muted/70 text-muted-foreground",
                !selected && !disabled && "hover:bg-card hover:text-foreground",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {AUDIT_TAB_META[key].title}
              {!locked && !notApplicable && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums",
                    selected ? "bg-red-600 text-white" : "hidden bg-background text-muted-foreground sm:inline",
                  )}
                >
                  {/* Phones show only the open tab's count; below lg the count is short (13,172 -> 13K). */}
                  {isLoading ? "…" : count === undefined ? "—" : (
                    <>
                      <span className="lg:hidden">{compactCount(count)}</span>
                      <span className="hidden lg:inline">{count.toLocaleString("en-IN")}</span>
                    </>
                  )}
                </span>
              )}
              {notApplicable && <span className="text-[11px] font-normal">n/a</span>}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onToggleDetails}
        disabled={locked}
        aria-expanded={showDetails && !locked}
        aria-controls="audit-view-details"
        className={cn(
          // Below lg: on its own line above the tabs, at the right (order-first); lg+: right of the tabs.
          "order-first mt-1.5 inline-flex flex-none items-center gap-1.5 self-end rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
          "lg:order-none lg:mb-1.5 lg:mt-0 lg:self-auto",
          "hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent",
          showDetails && !locked && "text-foreground",
        )}
      >
        {showDetails && !locked ? "Hide details" : "Show details"}
        <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", showDetails && !locked && "rotate-180")} />
      </button>
    </div>
  );
}

/** The figures each tab used to carry on its face, behind "Show details". A card opens its tab. */
export function TabDetails({ view, tab, onSelect, summary, isLoading }: {
  view: AuditView; tab: AuditTab | null; onSelect: (tab: AuditTab) => void; summary: AuditViewSummary | null; isLoading: boolean;
}) {
  const keys = AUDIT_TABS.filter((k) => !isAuditTabDisabled(view, k));
  return (
    <div id="audit-view-details" className="grid gap-3 border-b bg-muted/30 px-3 py-3.5 animate-in fade-in slide-in-from-top-1 duration-200 sm:grid-cols-3 sm:px-4">
      {keys.map((key) => {
        const meta = AUDIT_TAB_META[key];
        const f = cardFigures(key, summary);
        const SignalIcon = f?.signalIcon ?? Info;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-label={`Open ${meta.title}`}
            className={cn(
              "flex min-w-0 flex-col gap-2.5 rounded-lg border bg-card p-3.5 text-left transition-shadow hover:shadow-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
              key === tab && "border-red-500 shadow-[0_0_0_1px_rgb(239_68_68)]",
            )}
          >
            <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <b className="text-sm font-semibold text-foreground">{meta.title}{f ? ` · ${f.count.toLocaleString("en-IN")}` : ""}</b>
              <span className="truncate">By {meta.basis}</span>
            </span>
            {isLoading ? (
              <><Skeleton className="h-6 w-28" /><Skeleton className="h-1.5 w-full" /><Skeleton className="h-3 w-40" /></>
            ) : f ? (
              <>
                <span className="flex items-baseline gap-1.5 tabular-nums" title={`${rupees(f.amount)} ${f.unit}`}>
                  <span className="text-xl font-bold leading-none tracking-tight">{compactRupees(f.amount)}</span>
                  <span className="text-xs text-muted-foreground">{f.unit}</span>
                </span>
                <MixBar against={auditAgainstFor(view, key)} byAgainst={f.byAgainst} />
                <span className={cn("flex min-w-0 items-center gap-1.5 border-t border-dashed pt-2 text-xs text-muted-foreground", f.signalClass)}>
                  <SignalIcon className="h-3.5 w-3.5 flex-none" />
                  <span className="truncate">{f.signal}</span>
                </span>
              </>
            ) : (
              <span className="text-xl font-bold text-muted-foreground">—</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
