import { useRef, useState } from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TruncatedTextProps {
  text?: string | null;
  /** Rendered when `text` is blank. */
  fallback?: string;
  /** Width cap for the ellipsis. Pass a `max-w-*` class to override the default. */
  className?: string;
}

/**
 * One line of text cut with an ellipsis, the full value in a hover tooltip.
 *
 * Built for references (`utr` / `payment_ref`), which may hold a whole bank narration (#1254).
 * The tooltip opens only when the text is actually cut, so short values stay quiet.
 */
export function TruncatedText({ text, fallback = "--", className }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const value = text || fallback;

  const handleOpenChange = (next: boolean) => {
    const el = ref.current;
    setOpen(next && !!el && el.scrollWidth > el.clientWidth);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={handleOpenChange}>
        <TooltipTrigger asChild>
          <span ref={ref} className={cn("inline-block max-w-[12rem] truncate align-bottom", className)}>
            {value}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm break-all">{value}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
