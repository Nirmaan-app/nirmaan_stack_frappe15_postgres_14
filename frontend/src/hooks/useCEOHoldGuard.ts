import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Projects } from "@/types/NirmaanStack/Projects";
import { CEOHoldReason } from "@/types/NirmaanStack/CEOHoldReason";
import { useToast } from "@/components/ui/use-toast";
import { useMemo, useCallback } from "react";

interface CEOHoldGuardResult {
  isCEOHold: boolean;
  isLoading: boolean;
  projectStatus: string | undefined;
  ceoHoldBy: string | undefined;  // Projects.ceo_hold_by — pass to <CEOHoldBanner heldBy={...} />
  holdReasons: CEOHoldReason[];   // active automatic (system) hold reasons — pass to <CEOHoldBanner reasons={...} />
  showBlockedToast: () => void;
}

export function useCEOHoldGuard(projectId: string | undefined): CEOHoldGuardResult {
  const { toast } = useToast();

  const { data: project, isLoading } = useFrappeGetDoc<Projects>(
    "Projects",
    projectId,
    { enabled: !!projectId }
  );

  // Active system hold reasons (cashflow / delivery-pending). A standalone projection, so
  // it does not ride the Projects doc — fetch it separately. swrKey null disables the
  // fetch until projectId is known (the documented useFrappe* swrKey pattern).
  const { data: holdReasonsData } = useFrappeGetDocList<CEOHoldReason>(
    "CEO Hold Reason",
    {
      fields: ["name", "project", "source", "reason_text", "set_at"],
      filters: [["project", "=", projectId || ""]],
      limit: 0,
    },
    projectId ? `ceo-hold-reasons-${projectId}` : null
  );
  const holdReasons = useMemo(() => holdReasonsData ?? [], [holdReasonsData]);

  const isCEOHold = useMemo(() =>
    project?.status === "CEO Hold",
    [project?.status]
  );

  const showBlockedToast = useCallback(() => {
    const heldBy = project?.ceo_hold_by;
    const reasonLine = holdReasons.length
      ? ` Reason: ${holdReasons.map((r: CEOHoldReason) => r.reason_text).filter(Boolean).join("; ")}.`
      : "";
    toast({
      title: "Action Blocked",
      description: (heldBy
        ? `This project is on CEO Hold (set by ${heldBy}). Only they can remove the hold.`
        : "This project is on CEO Hold. Contact Admin to resume operations.") + reasonLine,
      variant: "destructive"
    });
  }, [toast, project?.ceo_hold_by, holdReasons]);

  return {
    isCEOHold,
    isLoading,
    projectStatus: project?.status,
    ceoHoldBy: project?.ceo_hold_by,
    holdReasons,
    showBlockedToast
  };
}
