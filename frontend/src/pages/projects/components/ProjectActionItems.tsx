import type { KeyboardEvent, ReactNode } from "react";
import { Clock, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDNDCQuantityData } from "@/pages/reports/hooks/useDNDCQuantityData";

/**
 * Project Action Items (Action Center — Surface B, v1).
 *
 * A project-scoped, role-agnostic "what's outstanding here" section. v1 shows two
 * tiles derived live from the DN→DC reconcile report — never reinvented:
 *   - DC Pending = summary.noDCUpdatePOs (POs received but with no Delivery Challan filed)
 *   - DN Pending = summary.pendingDNPOs (POs challan'd but with no Delivery Note created)
 *
 * Both counts come straight from `useDNDCQuantityData`'s summary, which already applies
 * every report filter (Billable-only, dispatch-state, Additional-Charges / zero-activity /
 * non-dispatched exclusions). This component MUST NOT re-filter or re-derive — consuming
 * the two integers verbatim is what keeps it in lock-step with the report.
 *
 * See nirmaan_stack/.claude/context/domain/action-center.md for the frozen v1 scope.
 */
interface ProjectActionItemsProps {
  projectId: string;
  /** Switch the project page to its DC & MIR tab (in-page tab swap — no route round-trip). */
  onNavigateToDCMIR?: () => void;
}

export function ProjectActionItems({ projectId, onNavigateToDCMIR }: ProjectActionItemsProps) {
  const { summary, isLoading, error } = useDNDCQuantityData(projectId);

  // `summary` stays null until all three underlying queries resolve — treat that as loading,
  // not "empty" (otherwise the section flashes "All clear" before the counts arrive).
  const loading = isLoading || (!summary && !error);

  return (
    <section className="flex flex-col gap-2">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Action Items
      </span>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">Couldn&rsquo;t load pending delivery actions.</p>
      ) : summary && summary.noDCUpdatePOs === 0 && summary.pendingDNPOs === 0 ? (
        <p className="text-sm text-muted-foreground">All clear — no pending delivery actions.</p>
      ) : summary ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ActionTile
            count={summary.noDCUpdatePOs}
            label="DC Pending"
            sublabel="Delivery Challans to file"
            icon={<XCircle className="h-5 w-5 text-red-600" />}
            className="border-red-200 bg-red-50 hover:bg-red-100"
            countClassName="text-red-700"
            labelClassName="text-red-600"
            onActivate={onNavigateToDCMIR}
          />
          <ActionTile
            count={summary.pendingDNPOs}
            label="DN Pending"
            sublabel="Delivery Notes to create"
            icon={<Clock className="h-5 w-5 text-blue-600" />}
            className="border-blue-200 bg-blue-50 hover:bg-blue-100"
            countClassName="text-blue-700"
            labelClassName="text-blue-600"
            onActivate={onNavigateToDCMIR}
          />
        </div>
      ) : null}
    </section>
  );
}

interface ActionTileProps {
  count: number;
  label: string;
  sublabel: string;
  icon: ReactNode;
  className: string;
  countClassName: string;
  labelClassName: string;
  onActivate?: () => void;
}

function ActionTile({
  count,
  label,
  sublabel,
  icon,
  className,
  countClassName,
  labelClassName,
  onActivate,
}: ActionTileProps) {
  const clickable = typeof onActivate === "function";
  return (
    <Card
      className={`${className} transition-colors ${clickable ? "cursor-pointer" : ""}`}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={
        clickable
          ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate?.();
              }
            }
          : undefined
      }
    >
      <CardContent className="flex items-center gap-3 p-3">
        {icon}
        <div className="min-w-0">
          <div className={`text-lg font-semibold ${countClassName}`}>{count}</div>
          <div className={`text-xs ${labelClassName}`}>{label}</div>
          <div className="text-[11px] text-muted-foreground">{sublabel}</div>
        </div>
      </CardContent>
    </Card>
  );
}
