import { useMemo, useState } from "react";

import { useFetchAllPOs } from "@/pages/projects/data/material-plan/useMaterialPlanMutations";
import { sortPOsForPlan, type PlanCriticalFields, type ProjectPO } from "@/utils/materialPlan/poLink";

/**
 * The state of a "Link / Change PO" picker, shared by the Material Plan and PO Cashflow Edit dialogs (F3): open or
 * not, "See all project POs" or the task's own, the picked PO, and the project's POs (fetched once, on first open,
 * from `get_all_project_pos`, the same call Add's "See All POs" uses).
 *
 * `currentPO` is the entry's own PO (empty for New PO): picking it again is no change.
 */
export function usePOLinkPicker(projectId: string, plan: PlanCriticalFields, currentPO: string | null | undefined) {
    const [open, setOpen] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const [targetName, setTargetName] = useState<string | null>(null);
    const { fetchAllPOs, allPOsResult, isLoadingAllPOs } = useFetchAllPOs();

    const projectPOs = useMemo<ProjectPO[]>(() => sortPOsForPlan(allPOsResult?.message?.pos, plan), [allPOsResult, plan]);
    const targetPO = targetName ? projectPOs.find((po) => po.name === targetName) ?? null : null;
    const changed = !!targetPO && targetPO.name !== (currentPO || null);

    return {
        open,
        showAll,
        setShowAll,
        projectPOs,
        targetPO,
        /** A PO other than the entry's own is picked (and not saved yet). */
        changed,
        loaded: !!allPOsResult,
        isLoading: isLoadingAllPOs,
        start: () => {
            setOpen(true);
            if (!allPOsResult) fetchAllPOs({ project: projectId });
        },
        pick: (poName: string) => setTargetName(poName),
        reset: () => {
            setOpen(false);
            setShowAll(false);
            setTargetName(null);
        },
    };
}

export type POLinkPicker = ReturnType<typeof usePOLinkPicker>;
