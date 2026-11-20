/** Audit View: a small ⓘ that shows a note on hover or keyboard focus (notes kept off the page itself). */
import { Info } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function InfoTip({ note, className }: { note: string; className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            role="img"
            aria-label={note}
            className={cn(
              "inline-grid h-4 w-4 flex-none cursor-help place-items-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            <Info className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs font-normal normal-case tracking-normal">{note}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
