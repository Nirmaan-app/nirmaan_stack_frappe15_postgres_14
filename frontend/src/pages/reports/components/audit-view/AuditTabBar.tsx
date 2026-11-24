/** Audit View: the Orders / Invoices / Payments tabs, each with its count. */
import { cn } from "@/lib/utils";

import { AUDIT_TAB_META, AUDIT_TABS, AuditTab, AuditView, AuditViewSummary, isAuditTabDisabled } from "../../utils/auditView";

/** The count on a tab, from the summary; undefined until it loads (Orders has none in Non Project View). */
const tabCount = (key: AuditTab, summary: AuditViewSummary | null): number | undefined => {
  if (key === "orders") return summary?.orders?.count;
  if (key === "invoices") return summary?.invoices.count;
  return summary?.payments.count;
};

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
}

/**
 * Plain tabs -- just the name and the count -- attached to the panel below. Locked (greyed, not
 * clickable) until a date range is picked. (The "Show details" figure cards were removed, owner 2026-11-23.)
 */
export function TabBar({ view, tab, locked, onSelect, summary, isLoading }: TabBarProps) {
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
          const count = tabCount(key, summary);
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
    </div>
  );
}
