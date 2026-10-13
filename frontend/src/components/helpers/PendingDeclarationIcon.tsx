import { forwardRef } from "react";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The hover text everywhere the icon shows -- the sidebar's wording. "Click to sign" only for the
 * person themself: anyone else viewing their profile (Admin, HR) can't sign it.
 */
export const pendingDeclarationLabel = (count: number, canSign = true) => {
  const pending = count === 1 ? "Asset declaration pending." : `${count} asset declarations pending.`;
  if (!canSign) return pending;
  return `${pending} ${count === 1 ? "Click to sign it." : "Click to sign them."}`;
};

interface PendingDeclarationIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** "md" beside the sidebar's name, "sm" in a menu item or a tab. */
  size?: "sm" | "md";
}

/**
 * The amber info mark for asset declarations still to sign: the sidebar beside the person's name,
 * the Profile menu item, and the Project / IT tabs on the profile's Assets tab -- one look
 * everywhere. Forwards its ref and props so the sidebar can make it a Tooltip trigger and a button.
 */
export const PendingDeclarationIcon = forwardRef<HTMLSpanElement, PendingDeclarationIconProps>(
  ({ size = "sm", className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 ring-1 ring-amber-300",
        size === "md" ? "h-6 w-6" : "h-5 w-5",
        className
      )}
      {...props}
    >
      <Info className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} />
    </span>
  )
);
PendingDeclarationIcon.displayName = "PendingDeclarationIcon";

/**
 * The icon with the sidebar's hover tooltip (same look and timing), for the Profile menu item and
 * the Project / IT tabs: hovering it says the declarations are pending.
 */
export function PendingDeclarationTooltip({
  label,
  side = "top",
  className,
}: {
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PendingDeclarationIcon aria-label={label} className={className} />
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
