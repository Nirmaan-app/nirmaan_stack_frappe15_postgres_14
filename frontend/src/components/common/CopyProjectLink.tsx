import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, ButtonProps } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * Absolute, shareable URL of a project's Overview page, e.g.
 * `http://localhost:8080/projects/NEW_DELHI-PROJ-00261?page=overview` in dev and
 * `https://<host>/frontend/projects/...` in production.
 *
 * ⚠️ The router's `basename` comes from `VITE_BASE_NAME` ("" in dev, 'frontend' in production), so it
 * must be prefixed here by hand -- this string leaves the app, React Router never sees it.
 */
export const projectOverviewUrl = (projectId: string): string => {
  const base = (import.meta.env.VITE_BASE_NAME || "").replace(/^\/+|\/+$/g, "");
  const prefix = base ? `/${base}` : "";
  return `${window.location.origin}${prefix}/projects/${encodeURIComponent(projectId)}?page=overview`;
};

/** How long the green "Copied" state holds, in ms (owner asked for 5 s). */
const COPIED_HOLD_MS = 5000;

/** Copy + the timed "copied" flag -- ONE implementation, so the button and the menu item behave alike. */
const useCopyProjectLink = (projectId: string) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await copyTextToClipboard(projectOverviewUrl(projectId));
    if (!ok) {
      toast({ title: "Copy failed", description: "Could not copy the project link.", variant: "destructive" });
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_HOLD_MS);
  };

  return { copied, copy };
};

/** `⧉ Copy Project Link` / `✓ Copied` -- the one label both surfaces render. */
const CopyLabel: React.FC<{ copied: boolean; iconClassName?: string }> = ({ copied, iconClassName }) => {
  const Icon = copied ? Check : Copy;
  return (
    <>
      <Icon className={cn("h-4 w-4", iconClassName)} />
      {copied ? "Copied" : "Copy Project Link"}
    </>
  );
};

/**
 * Styled like the neighbouring Edit button (plain outline, one leading icon); flips to a green
 * "Copied" for COPIED_HOLD_MS. The tooltip shows the exact URL being copied.
 */
export const CopyProjectLinkButton: React.FC<
  { projectId: string } & Pick<ButtonProps, "size" | "className">
> = ({ projectId, size = "sm", className }) => {
  const { copied, copy } = useCopyProjectLink(projectId);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size={size}
            variant="outline"
            onClick={copy}
            aria-label="Copy project link"
            className={cn(
              // Wide enough for "Copy Project Link", so flipping to the shorter "Copied" does not
              // shrink the button and shift its neighbours (Edit / Delete).
              "min-w-[176px] justify-center gap-1 transition-colors",
              copied && "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700",
              className
            )}
          >
            <CopyLabel copied={copied} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs break-all text-xs">
          {projectOverviewUrl(projectId)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/**
 * The same control for a row-actions dropdown. `preventDefault` on select keeps the menu open, so the
 * green "Copied" is actually seen instead of vanishing with the menu.
 */
export const CopyProjectLinkMenuItem: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { copied, copy } = useCopyProjectLink(projectId);

  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        copy();
      }}
      className={cn(
        "transition-colors",
        copied && "bg-emerald-50 text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700"
      )}
    >
      <CopyLabel copied={copied} iconClassName="mr-2" />
    </DropdownMenuItem>
  );
};
