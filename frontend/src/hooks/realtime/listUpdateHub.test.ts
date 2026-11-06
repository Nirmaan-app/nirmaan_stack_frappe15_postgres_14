// The hub must survive what broke live updates (Speed Plan bug B1): the SDK clean-up `socket.off("list_update")`,
// another screen leaving a room the hub still needs, and a reconnect that empties every room.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { heldDoctypes, parseListUpdate, subscribeListUpdate, type ListUpdateSocket } from "./listUpdateHub";

type Listener = (...args: unknown[]) => void;
/** A catch-all listener: the event name, then its arguments. */
type AnyListener = (event: string, ...args: unknown[]) => void;

/** Behaves like a socket.io-client Socket for the parts the hub and the SDK touch. */
class FakeSocket implements ListUpdateSocket {
    /** Every packet sent to the server, in order: [event, ...args]. */
    sent: unknown[][] = [];
    private events = new Map<string, Listener[]>();
    private any: AnyListener[] = [];
    private anyOutgoing: AnyListener[] = [];
    private managerReconnect: Listener[] = [];

    io = {
        on: (_event: "reconnect", listener: () => void) => { this.managerReconnect.push(listener); },
        off: (_event: "reconnect", listener?: () => void) => {
            this.managerReconnect = listener ? this.managerReconnect.filter(l => l !== listener) : [];
        },
    };

    emit(event: string, ...args: unknown[]) {
        // socket.io-client runs outgoing listeners just before it writes the packet.
        this.anyOutgoing.slice().forEach(l => l(event, ...args));
        this.sent.push([event, ...args]);
        return this;
    }
    on(event: string, listener: Listener) {
        this.events.set(event, [...(this.events.get(event) ?? []), listener]);
        return this;
    }
    /** Like socket.io: with no listener, removes EVERY listener for the event (what the SDK clean-up does). */
    off(event: string, listener?: Listener) {
        this.events.set(event, listener ? (this.events.get(event) ?? []).filter(l => l !== listener) : []);
        return this;
    }
    onAny(listener: AnyListener) { this.any.push(listener); return this; }
    offAny(listener?: AnyListener) { this.any = listener ? this.any.filter(l => l !== listener) : []; return this; }
    onAnyOutgoing(listener: AnyListener) { this.anyOutgoing.push(listener); return this; }
    offAnyOutgoing(listener?: AnyListener) {
        this.anyOutgoing = listener ? this.anyOutgoing.filter(l => l !== listener) : [];
        return this;
    }

    /** The server sends an event to this socket: catch-all listeners first, then the event's own. */
    receive(event: string, ...args: unknown[]) {
        this.any.slice().forEach(l => l(event, ...args));
        (this.events.get(event) ?? []).slice().forEach(l => l(...args));
    }
    reconnect() { this.managerReconnect.slice().forEach(l => l(1)); }

    count(event: string, doctype: string) {
        return this.sent.filter(([e, d]) => e === event && d === doctype).length;
    }
    listenerCounts() {
        return { any: this.any.length, anyOutgoing: this.anyOutgoing.length, reconnect: this.managerReconnect.length };
    }
}

const update = (doctype: string, name = "DOC-1") => ({ doctype, name, user: "someone@example.com" });

describe("listUpdateHub", () => {
    let socket: FakeSocket;
    beforeEach(() => {
        socket = new FakeSocket();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("joins a room once for the first subscriber and leaves only after the last one goes", () => {
        const offA = subscribeListUpdate(socket, "Procurement Orders", { onUpdate: vi.fn() });
        const offB = subscribeListUpdate(socket, "Procurement Orders", { onUpdate: vi.fn() });
        expect(socket.count("doctype_subscribe", "Procurement Orders")).toBe(1);

        offA();
        expect(socket.count("doctype_unsubscribe", "Procurement Orders")).toBe(0);

        offB();
        expect(socket.count("doctype_unsubscribe", "Procurement Orders")).toBe(1);
        expect(heldDoctypes(socket)).toEqual([]);
    });

    it("delivers a list_update only to that doctype's subscribers", () => {
        const po = vi.fn();
        const pr = vi.fn();
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate: po });
        subscribeListUpdate(socket, "Procurement Requests", { onUpdate: pr });

        socket.receive("list_update", update("Procurement Orders", "PO-001"));

        expect(po).toHaveBeenCalledTimes(1);
        expect(po).toHaveBeenCalledWith({ doctype: "Procurement Orders", name: "PO-001", user: "someone@example.com" });
        expect(pr).not.toHaveBeenCalled();
    });

    it("ignores other events and malformed payloads", () => {
        const onUpdate = vi.fn();
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate });

        socket.receive("doc_update", update("Procurement Orders"));
        socket.receive("list_update");
        socket.receive("list_update", null);
        socket.receive("list_update", "Procurement Orders");
        socket.receive("list_update", { name: "PO-001" });
        socket.receive("list_update", { doctype: 42 });

        expect(onUpdate).not.toHaveBeenCalled();
    });

    it("keeps delivering after the SDK clean-up removes every list_update listener (bug B1)", () => {
        const onUpdate = vi.fn();
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate });
        const sdkListener = vi.fn();
        socket.on("list_update", sdkListener);

        socket.off("list_update"); // what useFrappeEventListener's clean-up does
        socket.receive("list_update", update("Procurement Orders"));

        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(sdkListener).not.toHaveBeenCalled();
    });

    it("joins again on the next tick when someone else leaves a room it holds", () => {
        vi.useFakeTimers();
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate: vi.fn() });

        socket.emit("doctype_unsubscribe", "Procurement Orders"); // an SDK listener closing
        expect(socket.count("doctype_subscribe", "Procurement Orders")).toBe(1);

        vi.runAllTimers();
        expect(socket.count("doctype_subscribe", "Procurement Orders")).toBe(2);
        // The rejoin comes after the leave, so the server ends with the socket in the room.
        const last = socket.sent.filter(([, d]) => d === "Procurement Orders").pop();
        expect(last?.[0]).toBe("doctype_subscribe");
    });

    it("does not rejoin a room it does not hold, or after its own last subscriber leaves", () => {
        vi.useFakeTimers();
        const off = subscribeListUpdate(socket, "Procurement Orders", { onUpdate: vi.fn() });

        socket.emit("doctype_unsubscribe", "Vendors");
        off();
        vi.runAllTimers();

        expect(socket.count("doctype_subscribe", "Vendors")).toBe(0);
        expect(socket.count("doctype_subscribe", "Procurement Orders")).toBe(1);
    });

    it("does not rejoin when its last subscriber leaves before the rejoin tick", () => {
        vi.useFakeTimers();
        const off = subscribeListUpdate(socket, "Procurement Orders", { onUpdate: vi.fn() });

        socket.emit("doctype_unsubscribe", "Procurement Orders");
        off();
        vi.runAllTimers();

        expect(socket.count("doctype_subscribe", "Procurement Orders")).toBe(1);
    });

    it("rejoins every held room after a reconnect and tells each subscriber once", () => {
        const onReconnectA = vi.fn();
        const onReconnectB = vi.fn();
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate: vi.fn(), onReconnect: onReconnectA });
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate: vi.fn() });
        subscribeListUpdate(socket, "Vendors", { onUpdate: vi.fn(), onReconnect: onReconnectB });

        socket.reconnect();

        expect(socket.count("doctype_subscribe", "Procurement Orders")).toBe(2);
        expect(socket.count("doctype_subscribe", "Vendors")).toBe(2);
        expect(onReconnectA).toHaveBeenCalledTimes(1);
        expect(onReconnectB).toHaveBeenCalledTimes(1);
    });

    it("removes its socket listeners once nothing is subscribed, and attaches again on the next subscribe", () => {
        const off = subscribeListUpdate(socket, "Procurement Orders", { onUpdate: vi.fn() });
        expect(socket.listenerCounts()).toEqual({ any: 1, anyOutgoing: 1, reconnect: 1 });

        off();
        expect(socket.listenerCounts()).toEqual({ any: 0, anyOutgoing: 0, reconnect: 0 });

        const onUpdate = vi.fn();
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate });
        expect(socket.listenerCounts()).toEqual({ any: 1, anyOutgoing: 1, reconnect: 1 });
        socket.receive("list_update", update("Procurement Orders"));
        expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    it("treats a second unsubscribe call as a no-op", () => {
        const offA = subscribeListUpdate(socket, "Procurement Orders", { onUpdate: vi.fn() });
        const onUpdateB = vi.fn();
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate: onUpdateB });

        offA();
        offA();
        socket.receive("list_update", update("Procurement Orders"));

        expect(socket.count("doctype_unsubscribe", "Procurement Orders")).toBe(0);
        expect(onUpdateB).toHaveBeenCalledTimes(1);
    });

    it("keeps two subscriptions with the same callbacks apart", () => {
        const onUpdate = vi.fn();
        const offA = subscribeListUpdate(socket, "Procurement Orders", { onUpdate });
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate });

        offA();
        socket.receive("list_update", update("Procurement Orders"));

        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(socket.count("doctype_unsubscribe", "Procurement Orders")).toBe(0);
    });

    it("still calls the other subscribers when one throws", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const good = vi.fn();
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate: () => { throw new Error("boom"); } });
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate: good });

        socket.receive("list_update", update("Procurement Orders"));

        expect(good).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        errorSpy.mockRestore();
    });

    it("lets a subscriber unsubscribe itself or another during delivery", () => {
        const second = vi.fn();
        let offSecond: () => void = () => {};
        const offFirst = subscribeListUpdate(socket, "Procurement Orders", {
            onUpdate: () => { offFirst(); offSecond(); },
        });
        offSecond = subscribeListUpdate(socket, "Procurement Orders", { onUpdate: second });

        socket.receive("list_update", update("Procurement Orders"));
        socket.receive("list_update", update("Procurement Orders"));

        // The delivery in progress still reaches everyone it started with; nothing after it.
        expect(second).toHaveBeenCalledTimes(1);
        expect(socket.count("doctype_unsubscribe", "Procurement Orders")).toBe(1);
    });

    it("keeps separate sockets apart", () => {
        const other = new FakeSocket();
        const onA = vi.fn();
        const onB = vi.fn();
        subscribeListUpdate(socket, "Procurement Orders", { onUpdate: onA });
        subscribeListUpdate(other, "Procurement Orders", { onUpdate: onB });

        socket.receive("list_update", update("Procurement Orders"));

        expect(onA).toHaveBeenCalledTimes(1);
        expect(onB).not.toHaveBeenCalled();
        expect(other.count("doctype_subscribe", "Procurement Orders")).toBe(1);
    });
});

describe("parseListUpdate", () => {
    it("reads Frappe's payload and fills missing name or user with an empty string", () => {
        expect(parseListUpdate({ doctype: "Vendors", name: "V-1", user: "a@b.c" })).toEqual({ doctype: "Vendors", name: "V-1", user: "a@b.c" });
        expect(parseListUpdate({ doctype: "Vendors" })).toEqual({ doctype: "Vendors", name: "", user: "" });
    });

    it("refuses payloads without a doctype", () => {
        expect(parseListUpdate(undefined)).toBeNull();
        expect(parseListUpdate({ doctype: "" })).toBeNull();
        expect(parseListUpdate(["Vendors"])).toBeNull();
    });
});
