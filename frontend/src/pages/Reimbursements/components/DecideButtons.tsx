/**
 * Approve (✓) and Reject (✕) on a Pending Approval row: icon-only, each named on hover. Disabled, with the
 * server's reason on hover, when this person can't decide the claim: HR sees every pending claim but decides
 * only those raised outside HR. Whether they may is the server's `can_decide`
 * (`review.get_pending_for_me`), never worked out here.
 */

import { Check, X } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
    canDecide: boolean;
    reason?: string | null;
    onApprove: () => void;
    onReject: () => void;
}

export function DecideButtons({ canDecide, reason, onApprove, onReject }: Props) {
    if (!canDecide) {
        const why = reason ?? "You can't decide this claim.";
        // A disabled button fires no pointer events, so the tooltip hangs on a wrapper around both.
        return (
            <TooltipProvider delayDuration={150}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div tabIndex={0} aria-label={why} className="flex justify-end gap-1.5">
                            <IconButton kind="approve" disabled />
                            <IconButton kind="reject" disabled />
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs">{why}</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }
    return (
        <TooltipProvider delayDuration={150}>
            <div className="flex justify-end gap-1.5">
                <Tooltip>
                    <TooltipTrigger asChild><IconButton kind="approve" onClick={onApprove} /></TooltipTrigger>
                    <TooltipContent>Approve</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild><IconButton kind="reject" onClick={onReject} /></TooltipTrigger>
                    <TooltipContent>Reject</TooltipContent>
                </Tooltip>
            </div>
        </TooltipProvider>
    );
}

interface IconButtonProps extends ComponentPropsWithoutRef<typeof Button> {
    kind: "approve" | "reject";
}

/** One round icon button. Forwards its ref and props, so a Tooltip trigger (`asChild`) can attach to it. */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({ kind, ...props }, ref) =>
    kind === "approve" ? (
        <Button ref={ref} size="icon" aria-label="Approve" className="h-8 w-8 rounded-full bg-emerald-600 hover:bg-emerald-700" {...props}>
            <Check className="h-4 w-4" />
        </Button>
    ) : (
        <Button ref={ref} size="icon" variant="outline" aria-label="Reject"
            className="h-8 w-8 rounded-full border-red-200 text-red-700 hover:bg-red-50 hover:text-red-700" {...props}>
            <X className="h-4 w-4" />
        </Button>
    ),
);
IconButton.displayName = "IconButton";
