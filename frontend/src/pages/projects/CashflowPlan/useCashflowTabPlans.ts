import { useMemo } from "react";

import { useCashflowPlans } from "@/pages/projects/data/cashflow-plan/useCashflowPlanQueries";
import { filterCashflowPlansBySearch } from "@/utils/cashflowPlan/cashflowSearch";
import { planNumbersByPosition } from "@/utils/materialPlan/planNumbers";

/**
 * One Cashflow tab's list, shared by the PO, WO, Misc and Inflow tabs (F3): the plans for the date range (newest
 * first), narrowed by the page's search box. "Plan N" is the position in the date-filtered list, as on develop and in
 * the Cashflow PDF downloaded with the same dates; the search only hides cards and never renumbers them.
 */
export function useCashflowTabPlans(
    projectId: string,
    category: string | string[],
    dateRange: { from?: Date; to?: Date } | undefined,
    searchWords: string[],
) {
    const { data: fetchedPlans, isLoading, mutate } = useCashflowPlans(projectId, category, dateRange);
    /** After an add, edit or delete: refetch the list (and so the numbers). */
    const refreshPlans = () => mutate();

    const plans = useMemo(() => filterCashflowPlansBySearch(fetchedPlans, searchWords), [fetchedPlans, searchWords]);
    const planNumbers = useMemo(() => planNumbersByPosition(fetchedPlans), [fetchedPlans]);

    return { plans, isLoading, refreshPlans, planNumbers, searchActive: searchWords.length > 0 };
}
