import { useCallback } from "react";
import { useFrappeGetCall, useSWRConfig } from "frappe-react-sdk";
import { useSocketEventListener } from "@/lib/frappe";

import { CHEQUES_CHANGED_EVENT } from "@/types/NirmaanStack/Cheques";
import { CHEQUE_TRACKER_TAB, chequeTabFiltersFor, type ChequeTrackerTab } from "@/utils/cheques/chequeTabs";

import { CHEQUES_LIST_API } from "./chequePaymentTable.config";

interface ListCount {
    message: { total_count: number };
}

const KEY_PREFIX = "cheque-tab-count-";

/** One tab's badge: the list endpoint's own count over the tab's filters (one row fetched, the rest counted). */
function useTabCount(tab: ChequeTrackerTab, vendorId?: string): number | undefined {
    const { data } = useFrappeGetCall<ListCount>(
        CHEQUES_LIST_API,
        { filters: JSON.stringify(chequeTabFiltersFor(tab, vendorId)), limit_page_length: 1 },
        `${KEY_PREFIX}${tab}${vendorId ? `-${vendorId}` : ""}`,
        { revalidateOnFocus: false },
    );
    return data?.message?.total_count;
}

/**
 * The Cheque Tracker's tab badges (#1483), each read through the same filters its table sends, so a badge and
 * its table always agree; with `vendorId`, only that vendor's cheques (the Vendor page's Cheques tab). They refresh
 * on the realtime `cheques:changed` event and through `refresh` after this page's own changes. Undefined until
 * loaded (no badge rather than a flash of 0).
 */
export function useChequeTabCounts(vendorId?: string) {
    const all = useTabCount(CHEQUE_TRACKER_TAB.ALL, vendorId);
    const issued = useTabCount(CHEQUE_TRACKER_TAB.ISSUED, vendorId);
    const deposits = useTabCount(CHEQUE_TRACKER_TAB.DEPOSITS, vendorId);
    const { mutate } = useSWRConfig();
    const refresh = useCallback(() => {
        mutate((key) => typeof key === "string" && key.startsWith(KEY_PREFIX));
    }, [mutate]);
    useSocketEventListener(CHEQUES_CHANGED_EVENT, refresh);
    const counts: Record<ChequeTrackerTab, number | undefined> = {
        [CHEQUE_TRACKER_TAB.ALL]: all,
        [CHEQUE_TRACKER_TAB.ISSUED]: issued,
        [CHEQUE_TRACKER_TAB.DEPOSITS]: deposits,
    };
    return { counts, refresh };
}
