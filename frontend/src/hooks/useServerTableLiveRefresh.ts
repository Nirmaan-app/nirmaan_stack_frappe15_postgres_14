import { FrappeConfig, FrappeContext } from "frappe-react-sdk";
import { useCallback, useContext, useEffect, useRef, useState, type MutableRefObject } from "react";

import { subscribeListUpdate } from "./realtime/listUpdateHub";
import {
    createLiveRefreshController,
    createViewerState,
    isOverlayOpen,
    isViewerBusy,
    type LiveRefreshController,
    type LiveRefreshViewerState,
} from "./realtime/liveRefreshController";

export interface UseServerTableLiveRefreshOptions {
    /** The doctype whose inserts, saves and deletes should refresh the table. */
    doctype: string;
    /** Fetch the rows again without a spinner. May change on every render. */
    refresh: () => void;
    /** Off: no subscription at all (client-side tables, or a page that opts out). */
    enabled?: boolean;
    /** Rows are ticked, so moving them could change what a bulk action covers. */
    hasSelection: boolean;
}

export interface ServerTableLiveRefresh {
    /** A change is waiting for the viewer: show the "New changes · Refresh" chip. */
    pending: boolean;
    /** Apply the waiting change now (the chip's click). */
    apply: () => void;
    /** The DataTable writes what the viewer is doing here (scroll, mouse, focus). Writing causes no redraw. */
    viewerRef: MutableRefObject<LiveRefreshViewerState>;
}

/**
 * Keeps an open server table up to date with other users' changes, without disturbing the person using it.
 * Rules: `realtime/liveRefreshController.ts`. Listening: `realtime/listUpdateHub.ts`, which the SDK's listener
 * clean-up cannot remove (Speed Plan bug B1). After a reconnect the table refreshes once, because changes made
 * while the connection was down were not delivered.
 */
export function useServerTableLiveRefresh({
    doctype,
    refresh,
    enabled = true,
    hasSelection,
}: UseServerTableLiveRefreshOptions): ServerTableLiveRefresh {
    const { socket } = useContext(FrappeContext) as FrappeConfig;
    const viewerRef = useRef<LiveRefreshViewerState>(createViewerState());
    const refreshRef = useRef(refresh);
    const hasSelectionRef = useRef(hasSelection);
    useEffect(() => {
        refreshRef.current = refresh;
        hasSelectionRef.current = hasSelection;
    });

    const [pending, setPending] = useState(false);
    const controllerRef = useRef<LiveRefreshController | null>(null);

    useEffect(() => {
        if (!socket || !enabled || !doctype) return;
        const controller = createLiveRefreshController({
            refresh: () => refreshRef.current(),
            isBusy: () =>
                hasSelectionRef.current || isViewerBusy(viewerRef.current, Date.now()) || isOverlayOpen(document),
            isHidden: () => document.visibilityState === "hidden",
            onPendingChange: setPending,
        });
        controllerRef.current = controller;
        const unsubscribe = subscribeListUpdate(socket, doctype, {
            onUpdate: () => controller.notify(),
            onReconnect: () => controller.notify(),
        });
        const onVisibilityChange = () => controller.evaluate();
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            unsubscribe();
            document.removeEventListener("visibilitychange", onVisibilityChange);
            controller.dispose();
            controllerRef.current = null;
            setPending(false);
        };
    }, [socket, doctype, enabled]);

    const apply = useCallback(() => controllerRef.current?.apply(), []);
    return { pending, apply, viewerRef };
}
