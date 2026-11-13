/**
 * Live refresh for the sidebar counts and the tab badges that read them (Speed Plan task 14, step 3c).
 *
 * `sidebar_counts` (api/sidebar_counts.py) counts these record types. When any user inserts, saves or deletes one,
 * the counts are fetched again, grouped (a burst of changes, such as a bulk approval, gives one fetch) and only
 * while the tab is visible (a hidden tab fetches once when it is shown again). Without this, another user's change
 * reached the badges only on the 5-minute poll.
 *
 * Child tables never send `list_update`, so the two the counts also read arrive with their parent's save:
 * PO Payment Terms with Procurement Orders, Procurement Request Item Detail with Procurement Requests.
 */
import { subscribeListUpdate, type ListUpdateSocket } from "./listUpdateHub";
import { createLiveRefreshController } from "./liveRefreshController";

/** The record types `sidebar_counts` counts and that send `list_update` of their own. */
export const SIDEBAR_COUNT_DOCTYPES = [
    "Procurement Orders",
    "Procurement Requests",
    "Sent Back Category",
    "Service Requests",
    "PO Revisions",
    "Project Payments",
    "Cheques",
] as const;

/** Changes arriving within this window give one counts fetch. */
export const COUNTS_GROUP_MS = 2000;

export interface CountsLiveRefresh {
    /** Re-check now, for example when the tab becomes visible. */
    evaluate(): void;
    /** Stop listening. Safe to call more than once. */
    dispose(): void;
}

/**
 * Calls `refresh` (fetch the counts again) after another user changes a counted record. A user who cannot read one
 * of these record types is never joined to its room by Frappe, so receives no events for it.
 */
export function subscribeCountsLiveRefresh(
    socket: ListUpdateSocket,
    refresh: () => void,
    isHidden: () => boolean,
    groupMs: number = COUNTS_GROUP_MS,
): CountsLiveRefresh {
    const controller = createLiveRefreshController({
        refresh,
        isBusy: () => false, // counts move no rows under the viewer's hand
        isHidden,
        onPendingChange: () => {},
        groupMs,
    });
    const unsubscribes = SIDEBAR_COUNT_DOCTYPES.map(doctype =>
        subscribeListUpdate(socket, doctype, {
            onUpdate: () => controller.notify(),
            onReconnect: () => controller.notify(), // changes made while disconnected were not delivered
        }),
    );
    let disposed = false;
    return {
        evaluate: () => controller.evaluate(),
        dispose: () => {
            if (disposed) return;
            disposed = true;
            unsubscribes.forEach(unsubscribe => unsubscribe());
            controller.dispose();
        },
    };
}
