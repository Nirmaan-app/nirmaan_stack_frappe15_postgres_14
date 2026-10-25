import { forwardRef } from "react";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The icon's hover text. "Click to sign" only for the person themself: anyone else viewing their
 * profile (Admin, HR) can't sign it.
 */
export const pendingDeclarationLabel = (count: number, canSign = true) => {
  const pending = count === 1 ? "Asset declaration pending." : `${count} asset declarations pending.`;
  if (!canSign) return pending;
  return `${pending} ${count === 1 ? "Click to sign it." : "Click to sign them."}`;
};

/**
 * The same hover text once monthly audits count too (owner, 2026-10-14): declarations to sign and
 * audits to send, either or both, and how many of those audits are overdue (`isAuditOverdue`).
 * "Click to ..." only for the person themself.
 */
export const pendingAssetActionsLabel = (declarations: number, audits: number, canAct = true, overdueAudits = 0) => {
  if (audits === 0) return pendingDeclarationLabel(declarations, canAct);
  const overdue = Math.min(overdueAudits, audits);
  const auditWord = `asset audit${audits === 1 ? "" : "s"}`;
  const auditState =
    overdue === 0 ? "pending" : overdue === audits ? "overdue" : `pending, ${overdue} overdue`;
  if (declarations === 0) {
    const pending = audits === 1 ? `Asset audit ${auditState}.` : `${audits} ${auditWord} ${auditState}.`;
    if (!canAct) return pending;
    return `${pending} ${audits === 1 ? "Click to submit it." : "Click to submit them."}`;
  }
  const declarationsText = `${declarations} asset declaration${declarations === 1 ? "" : "s"}`;
  const pending =
    overdue === 0
      ? `${declarationsText} and ${audits} ${auditWord} pending.`
      : `${declarationsText} pending; ${audits} ${auditWord} ${auditState}.`;
  return canAct ? `${pending} Click to open your assets.` : pending;
};

interface PendingDeclarationIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** A monthly audit is waiting to be sent (owner, 2026-10-14): red instead of amber. */
  auditPending?: boolean;
}

/**
 * The amber info mark on the Project / IT tabs of the profile's Assets tab, for asset declarations
 * still to sign; red while a monthly audit is waiting to be sent. (The sidebar and Profile menu marks
 * were removed on 2026-10-21: the app access gate replaced them.) Forwards its ref and props so it can
 * be a Tooltip trigger.
 */
export const PendingDeclarationIcon = forwardRef<HTMLSpanElement, PendingDeclarationIconProps>(
  ({ auditPending = false, className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1",
        auditPending ? "bg-red-100 text-red-600 ring-red-300" : "bg-amber-100 text-amber-600 ring-amber-300",
        className
      )}
      {...props}
    >
      <Info className="h-3.5 w-3.5" />
    </span>
  )
);
PendingDeclarationIcon.displayName = "PendingDeclarationIcon";

/**
 * The icon with its hover tooltip, for the Project / IT tabs: hovering it says what is pending or
 * overdue.
 */
export function PendingDeclarationTooltip({
  label,
  side = "top",
  auditPending = false,
  className,
}: {
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  auditPending?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PendingDeclarationIcon aria-label={label} auditPending={auditPending} className={className} />
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
