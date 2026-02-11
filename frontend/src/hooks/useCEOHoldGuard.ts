import { useFrappeGetDoc } from "frappe-react-sdk";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useToast } from "@/components/ui/use-toast";
import { useMemo, useCallback } from "react";

interface CEOHoldGuardResult {
  isCEOHold: boolean;
  isLoading: boolean;
  projectStatus: string | undefined;
  showBlockedToast: () => void;
}

export function useCEOHoldGuard(projectId: string | undefined): CEOHoldGuardResult {
  const { toast } = useToast();

  const { data: project, isLoading } = useFrappeGetDoc<Projects>(
    "Projects",
    projectId,
    { enabled: !!projectId }
  );

  const isCEOHold = useMemo(() =>
    project?.status === "CEO Hold",
    [project?.status]
  );

  const showBlockedToast = useCallback(() => {
    const heldBy = project?.ceo_hold_by;
    toast({
      title: "Action Blocked",
      description: heldBy
        ? `This project is on CEO Hold (set by ${heldBy}). Only they can remove the hold.`
        : "This project is on CEO Hold. Contact Admin to resume operations.",
      variant: "destructive"
    });
  }, [toast, project?.ceo_hold_by]);

  return {
    isCEOHold,
    isLoading,
    projectStatus: project?.status,
    showBlockedToast
  };
}
