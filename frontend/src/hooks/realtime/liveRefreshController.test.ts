// The rules that keep a live refresh from disturbing the person using a table: grouping, waiting while busy or
// hidden, the chip, and applying exactly once.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
    createLiveRefreshController,
    createViewerState,
    isOverlayOpen,
    isViewerBusy,
    POINTER_QUIET_MS,
    type LiveRefreshController,
} from "./liveRefreshController";

describe("createLiveRefreshController", () => {
    let busy: boolean;
    let hidden: boolean;
    let refresh: Mock<() => void>;
    let pendingCalls: boolean[];
    let controller: LiveRefreshController;

    beforeEach(() => {
        vi.useFakeTimers();
        busy = false;
        hidden = false;
        refresh = vi.fn<() => void>();
        pendingCalls = [];
        controller = createLiveRefreshController({
            refresh,
            isBusy: () => busy,
            isHidden: () => hidden,
            onPendingChange: p => pendingCalls.push(p),
        });
    });
    afterEach(() => {
        controller.dispose();
        vi.useRealTimers();
    });

    it("refreshes an idle table once, after the 1 s grouping window", () => {
        controller.notify();
        vi.advanceTimersByTime(999);
        expect(refresh).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(pendingCalls).toEqual([]);
    });

    it("turns 20 changes inside the window into one refresh", () => {
        for (let i = 0; i < 20; i++) {
            controller.notify();
            vi.advanceTimersByTime(40);
        }
        vi.advanceTimersByTime(1000);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("gives a second refresh for a change after the first was applied", () => {
        controller.notify();
        vi.advanceTimersByTime(1000);
        controller.notify();
        vi.advanceTimersByTime(1000);
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("does nothing without a change", () => {
        vi.advanceTimersByTime(10_000);
        controller.evaluate();
        controller.apply();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("shows the chip once while the viewer is busy, however many changes arrive", () => {
        busy = true;
        controller.notify();
        vi.advanceTimersByTime(1000);
        for (let i = 0; i < 5; i++) {
            controller.notify();
            vi.advanceTimersByTime(1000);
        }
        expect(refresh).not.toHaveBeenCalled();
        expect(pendingCalls).toEqual([true]);
    });

    it("applies once by itself when the viewer becomes idle, and hides the chip", () => {
        busy = true;
        controller.notify();
        vi.advanceTimersByTime(5000);
        expect(refresh).not.toHaveBeenCalled();

        busy = false;
        vi.advanceTimersByTime(1000);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(pendingCalls).toEqual([true, false]);

        vi.advanceTimersByTime(10_000); // the idle checks have stopped
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("applies at once when the chip is clicked, even while busy, and stops checking", () => {
        busy = true;
        controller.notify();
        vi.advanceTimersByTime(1000);

        controller.apply();
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(pendingCalls).toEqual([true, false]);

        busy = false;
        vi.advanceTimersByTime(10_000);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("a chip click inside the grouping window applies once, not twice", () => {
        controller.notify();
        vi.advanceTimersByTime(300);
        controller.apply();
        vi.advanceTimersByTime(5000);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("still refreshes for changes that arrive after a chip click", () => {
        controller.notify();
        vi.advanceTimersByTime(300);
        controller.apply();

        controller.notify();
        vi.advanceTimersByTime(1000);
        expect(refresh).toHaveBeenCalledTimes(2);

        busy = true;
        controller.notify();
        vi.advanceTimersByTime(1000);
        controller.apply();
        controller.notify();
        busy = false;
        vi.advanceTimersByTime(1000);
        expect(refresh).toHaveBeenCalledTimes(4);
    });

    it("waits while the tab is hidden and refreshes once when it is shown", () => {
        hidden = true;
        for (let i = 0; i < 10; i++) {
            controller.notify();
            vi.advanceTimersByTime(1500);
        }
        expect(refresh).not.toHaveBeenCalled();
        expect(pendingCalls).toEqual([]);

        hidden = false;
        controller.evaluate(); // visibilitychange
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("does not apply while hidden even if a chip is waiting, then applies once when shown and idle", () => {
        busy = true;
        controller.notify();
        vi.advanceTimersByTime(1000);
        hidden = true;
        busy = false;
        vi.advanceTimersByTime(5000);
        expect(refresh).not.toHaveBeenCalled();

        hidden = false;
        vi.advanceTimersByTime(1000);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("showing the tab during the grouping window still refreshes only once", () => {
        controller.notify();
        controller.evaluate();
        vi.advanceTimersByTime(1000);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("does nothing after dispose", () => {
        controller.notify();
        busy = true;
        controller.dispose();
        busy = false;
        vi.advanceTimersByTime(10_000);
        controller.notify();
        controller.apply();
        vi.advanceTimersByTime(10_000);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("keeps working after a refresh throws", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        refresh.mockImplementationOnce(() => { throw new Error("network"); });
        controller.notify();
        vi.advanceTimersByTime(1000);
        controller.notify();
        vi.advanceTimersByTime(1000);
        expect(refresh).toHaveBeenCalledTimes(2);
        errorSpy.mockRestore();
    });
});

describe("createLiveRefreshController with a spread", () => {
    let refresh: Mock<() => void>;
    let busy: boolean;
    const make = (random: () => number, spreadMs = 1000) =>
        createLiveRefreshController({
            refresh,
            isBusy: () => busy,
            isHidden: () => false,
            onPendingChange: () => {},
            spreadMs,
            random,
        });

    beforeEach(() => {
        vi.useFakeTimers();
        refresh = vi.fn<() => void>();
        busy = false;
    });
    afterEach(() => vi.useRealTimers());

    it("waits the grouping window plus its random share of the spread", () => {
        const c = make(() => 0.5);
        c.notify();
        vi.advanceTimersByTime(1499);
        expect(refresh).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(refresh).toHaveBeenCalledTimes(1);
        c.dispose();
    });

    it("never waits the full spread or more", () => {
        const c = make(() => 0.999999);
        c.notify();
        vi.advanceTimersByTime(1999);
        expect(refresh).toHaveBeenCalledTimes(1);
        c.dispose();
    });

    it("picks a new share for each group", () => {
        const shares = [0.1, 0.9];
        const c = make(() => shares.shift() ?? 0);
        c.notify();
        vi.advanceTimersByTime(1100);
        expect(refresh).toHaveBeenCalledTimes(1);
        c.notify();
        vi.advanceTimersByTime(1899);
        expect(refresh).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(refresh).toHaveBeenCalledTimes(2);
        c.dispose();
    });

    it("still turns many changes during the wait into one refresh", () => {
        const c = make(() => 0.9);
        for (let i = 0; i < 20; i++) {
            c.notify();
            vi.advanceTimersByTime(90);
        }
        vi.advanceTimersByTime(5000);
        expect(refresh).toHaveBeenCalledTimes(1);
        c.dispose();
    });

    it("a chip click during the wait applies at once", () => {
        const c = make(() => 0.9);
        c.notify();
        vi.advanceTimersByTime(300);
        c.apply();
        expect(refresh).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(5000);
        expect(refresh).toHaveBeenCalledTimes(1);
        c.dispose();
    });

    it("spreads 50 screens told at the same moment across the window instead of one instant", () => {
        let next = 0;
        const fired: number[] = [];
        const screens = Array.from({ length: 50 }, () =>
            createLiveRefreshController({
                refresh: () => fired.push(Date.now()),
                isBusy: () => false,
                isHidden: () => false,
                onPendingChange: () => {},
                spreadMs: 1000,
                random: () => (next++ % 50) / 50, // 0, 0.02, ... 0.98: one screen per 20 ms
            }),
        );
        const start = Date.now();
        screens.forEach(s => s.notify());
        vi.advanceTimersByTime(2000);
        const offsets = fired.map(t => t - start);
        expect(offsets).toHaveLength(50);
        expect(new Set(offsets).size).toBe(50);
        expect(Math.min(...offsets)).toBe(1000);
        expect(Math.max(...offsets)).toBe(1980);
        screens.forEach(s => s.dispose());
    });
});

describe("isViewerBusy", () => {
    const now = 1_000_000;

    it("is idle at the top, mouse away long enough, nothing focused", () => {
        expect(isViewerBusy({ ...createViewerState(), pointerLeftAt: now - POINTER_QUIET_MS }, now)).toBe(false);
        expect(isViewerBusy(createViewerState(), now)).toBe(false); // the mouse never entered
    });

    it("is busy when scrolled down, with the mouse or focus in the rows, or just after the mouse left", () => {
        expect(isViewerBusy({ ...createViewerState(), scrolledDown: true }, now)).toBe(true);
        expect(isViewerBusy({ ...createViewerState(), pointerInRows: true }, now)).toBe(true);
        expect(isViewerBusy({ ...createViewerState(), focusInRows: true }, now)).toBe(true);
        expect(isViewerBusy({ ...createViewerState(), pointerLeftAt: now - POINTER_QUIET_MS + 1 }, now)).toBe(true);
    });
});

describe("isOverlayOpen", () => {
    it("asks the document for any open dialog, menu or floating layer", () => {
        const seen: string[] = [];
        const found = { querySelector: (s: string) => { seen.push(s); return {} as Element; } };
        const none = { querySelector: () => null };

        expect(isOverlayOpen(found)).toBe(true);
        expect(isOverlayOpen(none)).toBe(false);
        expect(seen[0]).toContain('[role="dialog"][data-state="open"]');
        expect(seen[0]).toContain('[role="menu"][data-state="open"]');
        expect(seen[0]).toContain("[data-radix-popper-content-wrapper]");
    });
});
