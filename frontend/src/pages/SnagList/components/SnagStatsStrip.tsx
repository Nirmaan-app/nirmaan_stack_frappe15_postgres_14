import * as React from "react";

import { cn } from "@/lib/utils";
import { SnagStatsSummary } from "../types";

export interface SnagStatsStripProps {
  stats: SnagStatsSummary;
  isLoading?: boolean;
}

/**
 * Total / Pending / WIP / Completed / Not Applicable.
 *
 * `Not Applicable` is a disposal rather than progress, so it sits last and in a
 * muted tone — it is still counted inside `Total`.
 * There is NO Risk Level tally in this feature (plan § 2) — do not add one.
 */
export const SnagStatsStrip: React.FC<SnagStatsStripProps> = ({
  stats,
  isLoading = false,
}) => {
  const tiles: Array<{ label: string; value: number; tone: string }> = [
    { label: "Total", value: stats.total, tone: "bg-white text-gray-900" },
    {
      label: "Pending",
      value: stats.by_status.Pending,
      tone: "bg-amber-50/70 text-amber-700",
    },
    {
      label: "WIP",
      value: stats.by_status.WIP,
      tone: "bg-sky-50/70 text-sky-700",
    },
    {
      label: "Completed",
      value: stats.by_status.Completed,
      tone: "bg-green-50/70 text-green-700",
    },
    {
      label: "Not Applicable",
      value: stats.by_status["Not Applicable"],
      tone: "bg-gray-50 text-gray-500",
    },
  ];

  return (
    <div className="flex items-stretch gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={cn(
            "flex min-w-[76px] flex-1 flex-col items-center justify-center px-4 py-2 sm:flex-none",
            t.tone
          )}
        >
          <span className="text-lg font-bold leading-none tabular-nums">
            {isLoading ? "—" : t.value}
          </span>
          <span className="mt-1 whitespace-nowrap text-[10px] font-medium uppercase tracking-wider opacity-70">
            {t.label}
          </span>
        </div>
      ))}
    </div>
  );
};
