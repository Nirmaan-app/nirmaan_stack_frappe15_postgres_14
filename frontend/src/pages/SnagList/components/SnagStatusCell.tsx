import * as React from "react";
import { Loader2, Tags } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { SNAG_STATUSES, SnagStatus } from "../types";
import {
  SNAG_NO_REMARK_STATUS,
  SNAG_STATUS_BADGE_STYLES,
} from "../config/snagTable.config";
import { SnagStatusChangeDialog } from "./SnagStatusChangeDialog";

export interface SnagStatusCellProps {
  status: SnagStatus;
  /** The row's stored remark — pre-filled into the change dialog. */
  remark: string | null;
  /**
   * Read-only CONTEXT for the change dialog: what the person is deciding about.
   * The caller already holds the whole row (`snagColumns.tsx` closes over
   * `row.original`), so this costs no fetch and no endpoint change.
   */
  description?: string;
  area?: string;
  category?: string;
  /**
   * `"select"` (default) = the inline dropdown in the Status column.
   * `"icon"` = the compact trigger in the Actions column.
   *
   * ONE component, TWO triggers, ONE dialog — which is the point (owner Q10a).
   * Do NOT reimplement the pick handler for the icon door: the `Not Applicable`
   * carve-out below would then exist twice and be free to drift.
   */
  variant?: "select" | "icon";
  /**
   * Withheld when the actor may not edit — presence of the callback IS the gate.
   *
   * `remark === undefined` means "leave the stored text alone"; `""` CLEARS it.
   * Never collapse the two (ADR-0018).
   */
  onChange?: (
    next: SnagStatus,
    remark: string | undefined
  ) => Promise<boolean> | void;
  /** True while this row's save is in flight. */
  isSaving?: boolean;
}

/**
 * One row's status. Read-only = a badge; editable = a compact select over the four
 * canonical statuses from `types.ts` (never a locally re-typed list).
 *
 * THE SELECT NO LONGER WRITES DIRECTLY. Picking a status opens
 * `SnagStatusChangeDialog`, where the remark that rides the change is edited —
 * except for `Not Applicable`, which takes NO remark at all (owner decision Q2a)
 * and is written straight through. The server REFUSES a remark sent with that
 * status, `""` included, so this branch must send no remark key whatsoever.
 *
 * Cancel needs no revert: the trigger is CONTROLLED on `status`, so an unconfirmed
 * pick was never displayed as the row's value.
 *
 * The dialog stays OPEN on a failed save — an explicit `false` from `onChange` keeps
 * it up so the typed remark is not thrown away alongside the error toast. A `void`
 * return closes it (nothing to report), which is what the `Not Applicable` path and
 * any future fire-and-forget caller get.
 */
export const SnagStatusCell: React.FC<SnagStatusCellProps> = ({
  status,
  remark,
  description,
  area,
  category,
  variant = "select",
  onChange,
  isSaving = false,
}) => {
  const [pending, setPending] = React.useState<SnagStatus | null>(null);
  const isIcon = variant === "icon";

  if (!onChange) {
    // The icon door is rendered only where a callback exists, so a read-only
    // actor never reaches it. Nothing to show in its place — the Status column's
    // badge already says what the status is.
    if (isIcon) return null;
    return (
      <Badge
        variant="outline"
        className={cn(
          "whitespace-nowrap font-medium",
          SNAG_STATUS_BADGE_STYLES[status]
        )}
      >
        {status}
      </Badge>
    );
  }

  const handlePick = (value: string) => {
    const next = value as SnagStatus;
    if (next === status) return;
    if (next === SNAG_NO_REMARK_STATUS) {
      onChange(next, undefined);
      return;
    }
    setPending(next);
  };

  return (
    <div className="flex items-center gap-1">
      <Select value={status} disabled={isSaving} onValueChange={handlePick}>
        <SelectTrigger
          aria-label={isIcon ? "Change snag status" : "Snag status"}
          title={isIcon ? "Change status" : undefined}
          className={cn(
            "text-xs font-medium",
            isIcon
              ? "h-7 w-auto gap-0.5 border-transparent bg-transparent px-1 shadow-none hover:bg-accent"
              : cn("h-7 w-[132px] px-2", SNAG_STATUS_BADGE_STYLES[status])
          )}
        >
          {isIcon ? (
            <Tags className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {SNAG_STATUSES.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isSaving && (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
      )}

      {pending && (
        <SnagStatusChangeDialog
          nextStatus={pending}
          currentStatus={status}
          remark={remark}
          description={description}
          area={area}
          category={category}
          isSaving={isSaving}
          onCancel={() => setPending(null)}
          onConfirm={async (next, nextRemark) => {
            const ok = await onChange(next, nextRemark);
            if (ok !== false) setPending(null);
          }}
        />
      )}
    </div>
  );
};
