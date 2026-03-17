import { Badge } from "@/components/ui/badge";
import { Check, Minus } from "lucide-react";

interface Condition {
  label: string;
  met: boolean;
  detail?: string;
}

interface MergeEligibilityBannerProps {
  conditions: Condition[];
  matchCount: number;
}

/**
 * Compact status-line showing why this PO qualifies for merging.
 * Renders inside the Alert banner above the PO detail page.
 */
export function MergeEligibilityBanner({
  conditions,
  matchCount,
}: MergeEligibilityBannerProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
      {conditions.map((c) => (
        <span
          key={c.label}
          className="inline-flex items-center gap-1 text-xs text-yellow-800/80"
        >
          {c.met ? (
            <Check className="h-3 w-3 text-green-600 shrink-0" strokeWidth={2.5} />
          ) : (
            <Minus className="h-3 w-3 text-muted-foreground/50 shrink-0" strokeWidth={2.5} />
          )}
          <span className={c.met ? "text-yellow-900" : "text-muted-foreground line-through"}>
            {c.label}
          </span>
          {c.detail && (
            <span className="text-yellow-700/60 font-mono text-[10px]">
              {c.detail}
            </span>
          )}
        </span>
      ))}
      <Badge variant="yellow" className="ml-auto text-[10px] px-1.5 py-0 font-mono tracking-wide">
        {matchCount} PO{matchCount !== 1 ? "s" : ""} eligible
      </Badge>
    </div>
  );
}

interface MergeMatchCriteriaProps {
  project: string;
  vendor: string;
  paymentType: string;
  matchCount: number;
}

/**
 * Header card inside the merge sheet showing the matching criteria
 * that all POs in this sheet share.
 */
export function MergeMatchCriteria({
  project,
  vendor,
  paymentType,
  matchCount,
}: MergeMatchCriteriaProps) {
  const criteria = [
    { label: "Project", value: project },
    { label: "Vendor", value: vendor },
    { label: "Payment", value: paymentType },
  ];

  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3 mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Match Criteria
        </span>
        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
          {matchCount + 1} POs total
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {criteria.map((c) => (
          <div key={c.label} className="min-w-0">
            <span className="block text-[10px] text-muted-foreground uppercase tracking-wide">
              {c.label}
            </span>
            <span className="block text-sm font-medium truncate" title={c.value}>
              {c.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
