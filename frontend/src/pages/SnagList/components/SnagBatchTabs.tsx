import * as React from "react";

import { cn } from "@/lib/utils";

import { SnagBatchTab, SnagBatchTabValue } from "../config/snagBatchTabs";

export interface SnagBatchTabsProps {
  /** Built by `buildSnagBatchTabs` — "All", then one per batch, oldest first. */
  tabs: SnagBatchTab[];
  value: SnagBatchTabValue;
  onChange: (value: SnagBatchTabValue) => void;
  /** Counts are still in flight; the tab labels are already correct. */
  isLoading?: boolean;
  /**
   * Rendered at the RIGHT END of the strip, on the tab row itself.
   *
   * It exists so the action group can sit BESIDE the tabs rather than on the stats
   * row below them. Sharing a row with the stats made one row do two jobs, and it
   * put the buttons UNDER the tab underline — where they read as belonging to the
   * selected tab, which is wrong for Import (it creates a NEW batch; it is not
   * scoped to the tab you are on).
   *
   * BOTH mount points fill it — the Project page tab and `/snag-list/:id` render
   * the identical strip. It stays optional so the strip is still usable without it.
   */
  trailing?: React.ReactNode;
}

/**
 * The batch tab strip above the snag table — one tab per imported worksheet.
 *
 * PRESENTATION ONLY. Which tab is selected, what it filters and what the counts mean
 * all live outside this file (`config/snagBatchTabs.ts` for the rules, `SnagListTab`
 * for the state), so the strip cannot develop an opinion of its own.
 *
 * The tab list SCROLLS rather than wraps. A project accumulates a batch per imported
 * sheet over a job, and a wrapping strip would silently push the table down the
 * screen as the list grew — the one thing a header must not do.
 *
 * A count is rendered for every tab INCLUDING zero. A batch whose snags have all
 * been deleted still exists and its tab must say so; hiding the 0 would read as
 * "still loading".
 */
export const SnagBatchTabs: React.FC<SnagBatchTabsProps> = ({
  tabs,
  value,
  onChange,
  isLoading = false,
  trailing,
}) => {
  // ONE tab is no choice at all, so the tabs hide themselves — but the trailing slot
  // must survive that, or a project with a single batch would lose its Import button.
  const showTabs = tabs.length > 1;
  if (!showTabs && !trailing) return null;

  return (
    <div className="flex items-end gap-3 border-b border-gray-200">
      {/* `min-w-0` is what lets the tab list SCROLL instead of pushing the trailing
          actions off the row as batches accumulate. */}
      <div
        role="tablist"
        aria-label="Snag batches"
        className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto"
      >
        {showTabs &&
          tabs.map((tab) => {
            const active = tab.value === value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                title={tab.title}
                onClick={() => onChange(tab.value)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:border-gray-300 hover:text-foreground"
                )}
              >
                {/* The batch name is the FILE's, so it is routinely far wider than a
                    tab — an upload is named things like
                    `VRB_Food Box_Snag_List_04.09.2026be17ff (1)`. Kept SHORT on purpose:
                    with several imports the strip is a row of near-identical long names
                    where only the tail differs, and wide tabs push the later ones off
                    screen entirely. The full text is on the `title` above, and the
                    count badge stays visible whatever the name does. */}
                <span className="max-w-[140px] truncate">{tab.label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    active
                      ? "bg-primary/10 text-primary"
                      : "bg-gray-100 text-gray-500",
                    isLoading && "opacity-50"
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
      </div>

      {trailing && <div className="shrink-0 pb-2">{trailing}</div>}
    </div>
  );
};
