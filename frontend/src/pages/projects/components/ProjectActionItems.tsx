import type { KeyboardEvent, ReactNode } from "react";
import { Clock, XCircle } from "lucide-react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { GetActionItemsResponse } from "@/types/NirmaanStack/ProjectActionItem";

/**
 * Project Action Items (Action Center — Surface B, v1).
 *
 * A project-scoped, role-agnostic "what's outstanding here" section. v1 shows two tiles
 * COUNTED from the durable `Project Action Item` projection — the recompute-from-truth
 * table kept current by the reconcile engine (PO/DN/DC events + the nightly sweep) — read
 * through the permission-scoped `get_project_action_items` endpoint:
 *   - DC Pending = # Open rows with action_type "DC_PENDING" (PO received, no Delivery Challan filed)
 *   - DN Pending = # Open rows with action_type "DN_PENDING" (PO dispatched, not yet fully delivered)
 *
 * This reads the SAME rows that drive the >4-deliveries CEO Hold, so the tile, the hold
 * banner, and the hold itself can never diverge. It REPLACES the former derive-on-read
 * `useDNDCQuantityData` path — note the intended redefinition of "DN Pending" from the old
 * report sense ("challan'd, no Delivery Note") to the worklist sense ("dispatched, not
 * fully delivered"). See docs/adr/0002-project-action-items-materialized-projection.md.
 */
interface ProjectActionItemsProps {
  projectId: string;
  /** Switch the project page to its DC & MIR tab (in-page tab swap — no route round-trip). */
  onNavigateToDCMIR?: () => void;
}

export function ProjectActionItems({ projectId, onNavigateToDCMIR }: ProjectActionItemsProps) {
  // Open action items for this project, straight from the projection. swrKey is null while
  // projectId is unknown (the documented conditional-fetch idiom) so we never call the
  // endpoint — which requires project_name — with an empty argument.
  const { data, isLoading, error } = useFrappeGetCall<GetActionItemsResponse>(
    "nirmaan_stack.api.action_items.read.get_project_action_items",
    { project_name: projectId },
    projectId ? `project-action-items-${projectId}` : null,
    { revalidateOnFocus: false }
  );

  const rows = data?.message?.action_items ?? [];
  const dcPending = rows.filter((r) => r.action_type === "DC_PENDING").length;
  const dnPending = rows.filter((r) => r.action_type === "DN_PENDING").length;

  return (
    <section className="flex flex-col gap-2">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Action Items
      </span>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">Couldn&rsquo;t load pending delivery actions.</p>
      ) : dcPending === 0 && dnPending === 0 ? (
        <p className="text-sm text-muted-foreground">All clear — no pending delivery actions.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ActionTile
            count={dcPending}
            label="DC Pending"
            sublabel="Delivery Challans to file"
            icon={<XCircle className="h-5 w-5 text-red-600" />}
            className="border-red-200 bg-red-50 hover:bg-red-100"
            countClassName="text-red-700"
            labelClassName="text-red-600"
            onActivate={onNavigateToDCMIR}
          />
          <ActionTile
            count={dnPending}
            label="DN Pending"
            sublabel="Delivery Notes to create"
            icon={<Clock className="h-5 w-5 text-blue-600" />}
            className="border-blue-200 bg-blue-50 hover:bg-blue-100"
            countClassName="text-blue-700"
            labelClassName="text-blue-600"
            onActivate={onNavigateToDCMIR}
          />
        </div>
      )}
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
