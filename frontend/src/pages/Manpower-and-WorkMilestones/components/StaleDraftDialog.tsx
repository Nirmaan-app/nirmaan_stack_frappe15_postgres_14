import type { ReactNode } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { AlertTriangle } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { StaleDraftKind } from "../utils/dprSessionStorage";
import { formatServerDateTime } from "../utils/milestoneHelpers";

/** Reply of `get_dpr_draft_deletion`: whether the draft still exists, and if not, who deleted it. */
interface DprDraftDeletion {
  exists: boolean;
  report_status?: string | null;
  deleted_by?: string | null;
  deleted_at?: string | null;
}

interface StaleDraftDialogProps {
  kind: StaleDraftKind;
  /** The server draft the browser copy was loaded from (absent for "started_elsewhere"). */
  staleDraftName: string | null;
  zone: string | null;
  dateLabel: string;
  onClear: () => void;
}

/**
 * Blocks the DPR editor when its browser copy belongs to a draft that is no longer the zone's draft.
 * It has one button and cannot be dismissed (no close icon, Esc and outside clicks do nothing), because
 * saving the old copy would bring a deleted draft back.
 */
export const StaleDraftDialog = ({ kind, staleDraftName, zone, dateLabel, onClear }: StaleDraftDialogProps) => {
  const { data, isLoading } = useFrappeGetCall<{ message: DprDraftDeletion }>(
    "nirmaan_stack.api.milestone.dpr_draft_deletion.get_dpr_draft_deletion",
    { report_name: staleDraftName },
    kind === "draft_gone" && staleDraftName ? undefined : null,
  );
  const deletion = data?.message;

  let title = "This draft was deleted";
  let reason: ReactNode;
  if (kind === "started_elsewhere") {
    title = "A draft already exists for this zone";
    reason = "This zone's report was started in another browser tab or by another user after you opened it.";
  } else if (deletion?.exists && deletion.report_status === "Completed") {
    title = "This report was already submitted";
    reason = "This zone's report was submitted from another browser tab or by another user.";
  } else if (deletion?.exists) {
    title = "This draft was replaced";
    reason = "The draft you were filling is no longer this zone's draft.";
  } else if (deletion?.deleted_by) {
    reason = (
      <>
        The draft you were filling was deleted by <span className="font-semibold">{deletion.deleted_by}</span>
        {deletion.deleted_at ? ` on ${formatServerDateTime(deletion.deleted_at)}` : ""}.
      </>
    );
  } else {
    reason = "The draft you were filling was deleted by another user.";
  }

  return (
    <AlertDialog open>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-gray-600">
              <p className="font-medium text-gray-800">
                {zone || "This zone"} · {dateLabel}
              </p>
              {kind === "draft_gone" && isLoading ? (
                <div className="flex items-center gap-2">
                  <TailSpin height={16} width={16} color="#6b7280" />
                  Checking what happened to the draft…
                </div>
              ) : (
                <p>{reason}</p>
              )}
              <p>
                The entries kept in this browser for this zone will be cleared so you can start a new report.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={onClear} className="bg-red-600 hover:bg-red-700 text-white">
            Clear and start new
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
