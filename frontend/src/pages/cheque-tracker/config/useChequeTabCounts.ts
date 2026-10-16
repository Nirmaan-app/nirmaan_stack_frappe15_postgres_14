import { useCallback } from "react";
import { useFrappeEventListener, useFrappeGetCall, useSWRConfig } from "frappe-react-sdk";

import { CHEQUES_CHANGED_EVENT } from "@/types/NirmaanStack/Cheques";
import { CHEQUE_TRACKER_TAB, chequeTabFilters, type ChequeTrackerTab } from "@/utils/cheques/chequeTabs";

import { CHEQUES_LIST_API } from "./chequePaymentTable.config";

interface ListCount {
    message: { total_count: number };
}

const KEY_PREFIX = "cheque-tab-count-";

/** One tab's badge: the list endpoint's own count over the tab's filters (one row fetched, the rest counted). */
function useTabCount(tab: ChequeTrackerTab): number | undefined {
    const { data } = useFrappeGetCall<ListCount>(
        CHEQUES_LIST_API,
        { filters: JSON.stringify(chequeTabFilters(tab)), limit_page_length: 1 },
        `${KEY_PREFIX}${tab}`,
        { revalidateOnFocus: false },
    );
    return data?.message?.total_count;
}

/**
 * The Cheque Tracker's tab badges (#1483), each read through the same filters its table sends, so a badge and
 * its table always agree. They refresh on the realtime `cheques:changed` event and through `refresh` after
 * this page's own changes. Undefined until loaded (no badge rather than a flash of 0).
 */
export function useChequeTabCounts() {
    const all = useTabCount(CHEQUE_TRACKER_TAB.ALL);
    const issued = useTabCount(CHEQUE_TRACKER_TAB.ISSUED);
    const { mutate } = useSWRConfig();
    const refresh = useCallback(() => {
        mutate((key) => typeof key === "string" && key.startsWith(KEY_PREFIX));
    }, [mutate]);
    useFrappeEventListener(CHEQUES_CHANGED_EVENT, refresh);
    const counts: Record<ChequeTrackerTab, number | undefined> = {
        [CHEQUE_TRACKER_TAB.ALL]: all,
        [CHEQUE_TRACKER_TAB.ISSUED]: issued,
    };
    return { counts, refresh };
}
