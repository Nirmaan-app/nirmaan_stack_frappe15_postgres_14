import type { ReactNode } from "react";
import { Folder, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";

interface TransferRouteCardProps {
  /** "From" or "To". */
  side: "From" | "To";
  /** What sits on this side: a project picker or the fixed warehouse. */
  kind: "Project" | "Warehouse";
  /** The picker, or the fixed warehouse box. */
  children: ReactNode;
  /** One muted line under the picker (stock count, a rule, an error). */
  hint?: ReactNode;
  /** Red hint, for a load error. */
  hintIsError?: boolean;
}

/**
 * One side of the New Transfer route, styled like the "from account" / "to account" cards
 * of a bank transfer: a labelled header ("From Project", "To Warehouse"), the picker,
 * and a hint line.
 */
export function TransferRouteCard({ side, kind, children, hint, hintIsError }: TransferRouteCardProps) {
  const Icon = kind === "Warehouse" ? Warehouse : Folder;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {side} {kind}
        </span>
      </div>
      {children}
      {hint && (
        <p className={cn("text-xs", hintIsError ? "text-destructive" : "text-muted-foreground")}>{hint}</p>
      )}
    </div>
  );
}
