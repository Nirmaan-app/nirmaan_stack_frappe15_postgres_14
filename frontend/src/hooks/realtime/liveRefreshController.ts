/**
 * When an open table should apply another user's change: the rules behind `useServerTableLiveRefresh`, kept free
 * of React so they can be tested on their own.
 *
 * A change is never applied under the viewer's hand. Changes are grouped for `groupMs`, then:
 *  - tab hidden: wait, and refresh once when the tab is shown again (`evaluate` on visibilitychange);
 *  - viewer busy (scrolled down, mouse or focus in the rows, rows ticked, a dialog or menu open): show the
 *    "New changes" chip (`pending`) and check again every `idleCheckMs`; refresh once the viewer is idle, or at
 *    once when they click the chip (`apply`);
 *  - otherwise: refresh now.
 * However many changes arrive while waiting, they give one refresh.
 */

/** What the table knows about the viewer, written by the DataTable without causing a redraw. */
export interface LiveRefreshViewerState {
    /** The list is scrolled away from its first row. */
    scrolledDown: boolean;
    /** The mouse is over the table's rows. */
    pointerInRows: boolean;
    /** When the mouse last left the rows (ms since epoch); 0 = never. */
    pointerLeftAt: number;
    /** Keyboard focus is inside the rows (for example typing in a cell). */
    focusInRows: boolean;
}

/** How long the mouse must stay off the rows before a change may move them. */
export const POINTER_QUIET_MS = 3000;
/** Changes arriving within this window give one refresh. */
export const GROUP_MS = 1000;
/** While a change waits for a busy viewer, how often to check whether they are idle. */
export const IDLE_CHECK_MS = 1000;

export const createViewerState = (): LiveRefreshViewerState => ({
    scrolledDown: false,
    pointerInRows: false,
    pointerLeftAt: 0,
    focusInRows: false,
});

/** True while moving the rows could disturb the viewer. */
export function isViewerBusy(viewer: LiveRefreshViewerState, now: number, quietMs = POINTER_QUIET_MS): boolean {
    return viewer.scrolledDown || viewer.pointerInRows || viewer.focusInRows || now - viewer.pointerLeftAt < quietMs;
}

/**
 * True while a dialog, alert, menu or any floating Radix layer (popover, hover card, select, tooltip) is open.
 * Such a layer may belong to a row, and a refresh could change or close it.
 */
const OPEN_OVERLAY_SELECTOR = [
    '[role="dialog"][data-state="open"]',
    '[role="alertdialog"][data-state="open"]',
    '[role="menu"][data-state="open"]',
    "[data-radix-popper-content-wrapper]",
].join(", ");

export function isOverlayOpen(doc: Pick<Document, "querySelector">): boolean {
    return doc.querySelector(OPEN_OVERLAY_SELECTOR) !== null;
}

export interface LiveRefreshControllerDeps {
    /** Fetch the table's rows again, quietly. */
    refresh: () => void;
    isBusy: () => boolean;
    isHidden: () => boolean;
    /** Called only when the chip should appear (true) or go (false). */
    onPendingChange: (pending: boolean) => void;
    groupMs?: number;
    idleCheckMs?: number;
}

export interface LiveRefreshController {
    /** A change arrived (a `list_update`, or a reconnect that may have missed some). */
    notify(): void;
    /** Re-check now, for example when the tab becomes visible. */
    evaluate(): void;
    /** The viewer clicked the chip: apply waiting changes now, busy or not. */
    apply(): void;
    dispose(): void;
}

export function createLiveRefreshController(deps: LiveRefreshControllerDeps): LiveRefreshController {
    const groupMs = deps.groupMs ?? GROUP_MS;
    const idleCheckMs = deps.idleCheckMs ?? IDLE_CHECK_MS;
    let waiting = false; // a change has arrived that the rows do not show yet
    let pending = false; // the chip is showing
    let groupTimer: ReturnType<typeof setTimeout> | null = null;
    let idleTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const setPending = (next: boolean) => {
        if (pending === next) return;
        pending = next;
        deps.onPendingChange(next);
    };

    const stopIdleChecks = () => {
        if (idleTimer !== null) clearInterval(idleTimer);
        idleTimer = null;
    };

    const run = () => {
        waiting = false;
        stopIdleChecks();
        setPending(false);
        try {
            deps.refresh();
        } catch (error) {
            console.error("[liveRefresh] refresh failed:", error);
        }
    };

    const evaluate = () => {
        if (disposed || !waiting || groupTimer !== null) return;
        if (deps.isHidden()) return; // visibilitychange calls evaluate again
        if (!deps.isBusy()) {
            run();
            return;
        }
        setPending(true);
        if (idleTimer === null) {
            idleTimer = setInterval(() => {
                if (!waiting) stopIdleChecks();
                else if (!deps.isHidden() && !deps.isBusy()) run();
            }, idleCheckMs);
        }
    };

    return {
        notify() {
            if (disposed) return;
            waiting = true;
            if (groupTimer !== null) return;
            groupTimer = setTimeout(() => {
                groupTimer = null;
                evaluate();
            }, groupMs);
        },
        evaluate,
        apply() {
            if (disposed || !waiting) return;
            if (groupTimer !== null) clearTimeout(groupTimer);
            groupTimer = null;
            run();
        },
        dispose() {
            disposed = true;
            if (groupTimer !== null) clearTimeout(groupTimer);
            groupTimer = null;
            stopIdleChecks();
        },
    };
}
