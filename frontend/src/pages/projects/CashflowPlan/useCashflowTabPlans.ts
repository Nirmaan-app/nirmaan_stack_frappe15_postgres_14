import { useMemo } from "react";

import {
    useCashflowPlanNumberSource,
    useCashflowPlans,
} from "@/pages/projects/data/cashflow-plan/useCashflowPlanQueries";
import { filterCashflowPlansBySearch } from "@/utils/cashflowPlan/cashflowSearch";
import { planNumbersByCreation } from "@/utils/materialPlan/planNumbers";

/**
 * One Cashflow tab's list, shared by the PO, WO, Misc and Inflow tabs (F3): the plans for the date range,
 * narrowed by the page's search box, and each plan's fixed "Plan N" (oldest = 1, across every plan of the
 * tab's type(s) for the project, so neither the date filter nor the search renumbers them).
 */
export function useCashflowTabPlans(
    projectId: string,
    category: string | string[],
    dateRange: { from?: Date; to?: Date } | undefined,
    searchWords: string[],
) {
    const { data: fetchedPlans, isLoading, mutate: mutateList } = useCashflowPlans(projectId, category, dateRange);
    const { data: numberSource, mutate: mutateNumbers } = useCashflowPlanNumberSource(projectId, category);

    const plans = useMemo(() => filterCashflowPlansBySearch(fetchedPlans, searchWords), [fetchedPlans, searchWords]);
    const planNumbers = useMemo(() => planNumbersByCreation(numberSource), [numberSource]);

    /** After an add, edit or delete: the list and the numbering both change. */
    const refreshPlans = () => Promise.all([mutateList(), mutateNumbers()]);

    return { plans, isLoading, refreshPlans, planNumbers, searchActive: searchWords.length > 0 };
}
