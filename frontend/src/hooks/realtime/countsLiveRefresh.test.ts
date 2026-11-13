// The sidebar counts and tab badges refresh when another user changes a counted record: grouped, only while the tab
// is visible, and once after a reconnect.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { COUNTS_GROUP_MS, SIDEBAR_COUNT_DOCTYPES, subscribeCountsLiveRefresh, type CountsLiveRefresh } from "./countsLiveRefresh";
import { heldDoctypes } from "./listUpdateHub";
import { FakeSocket } from "./testing/fakeSocket";

const change = (doctype: string, name = "DOC-1") => ({ doctype, name, user: "someone@example.com" });

describe("subscribeCountsLiveRefresh", () => {
    let socket: FakeSocket;
    let refresh: Mock<() => void>;
    let hidden: boolean;
    let live: CountsLiveRefresh;

    beforeEach(() => {
        vi.useFakeTimers();
        socket = new FakeSocket();
        refresh = vi.fn<() => void>();
        hidden = false;
        live = subscribeCountsLiveRefresh(socket, refresh, () => hidden);
    });
    afterEach(() => {
        live.dispose();
        vi.useRealTimers();
    });

    it("joins the room of every counted record type", () => {
        expect(heldDoctypes(socket).sort()).toEqual([...SIDEBAR_COUNT_DOCTYPES].sort());
    });

    it("refreshes for a change to each record type sidebar_counts counts", () => {
        // Written out, not read from SIDEBAR_COUNT_DOCTYPES, so dropping one from the list fails here.
        const counted = [
            "Procurement Orders", "Procurement Requests", "Sent Back Category", "Service Requests",
            "PO Revisions", "Project Payments", "Cheques",
        ];
        for (const doctype of counted) {
            refresh.mockClear();
            socket.receive("list_update", change(doctype));
            vi.advanceTimersByTime(COUNTS_GROUP_MS);
            expect(refresh, doctype).toHaveBeenCalledTimes(1);
        }
    });

    it("refreshes the counts once, after the grouping window, when a counted record changes", () => {
        socket.receive("list_update", change("Procurement Orders"));
        vi.advanceTimersByTime(COUNTS_GROUP_MS - 1);
        expect(refresh).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("turns a bulk change across record types into one refresh", () => {
        for (let i = 0; i < 20; i++) socket.receive("list_update", change("Project Payments", `PAY-${i}`));
        socket.receive("list_update", change("Procurement Orders"));
        socket.receive("list_update", change("Cheques"));
        vi.advanceTimersByTime(COUNTS_GROUP_MS);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("ignores record types the counts do not read", () => {
        socket.receive("list_update", change("Vendors"));
        socket.receive("list_update", change("Nirmaan Users"));
        vi.advanceTimersByTime(COUNTS_GROUP_MS * 3);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("waits while the tab is hidden and refreshes once when it is shown", () => {
        hidden = true;
        socket.receive("list_update", change("Service Requests"));
        vi.advanceTimersByTime(COUNTS_GROUP_MS * 5);
        socket.receive("list_update", change("PO Revisions"));
        vi.advanceTimersByTime(COUNTS_GROUP_MS * 5);
        expect(refresh).not.toHaveBeenCalled();

        hidden = false;
        live.evaluate();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("refreshes once after a reconnect, since changes made meanwhile were not delivered", () => {
        socket.reconnect();
        vi.advanceTimersByTime(COUNTS_GROUP_MS);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("stops listening and leaves the rooms on dispose", () => {
        live.dispose();
        live.dispose();
        socket.receive("list_update", change("Procurement Orders"));
        vi.advanceTimersByTime(COUNTS_GROUP_MS * 3);
        expect(refresh).not.toHaveBeenCalled();
        expect(heldDoctypes(socket)).toEqual([]);
        for (const doctype of SIDEBAR_COUNT_DOCTYPES) expect(socket.count("doctype_unsubscribe", doctype)).toBe(1);
    });
});
