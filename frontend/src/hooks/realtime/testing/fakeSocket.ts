// A stand-in for a socket.io-client Socket, for the realtime unit tests (never imported by product code).
import type { ListUpdateSocket } from "../listUpdateHub";

type Listener = (...args: unknown[]) => void;
/** A catch-all listener: the event name, then its arguments. */
type AnyListener = (event: string, ...args: unknown[]) => void;

/** Behaves like a socket.io-client Socket for the parts the hub and the SDK touch. */
export class FakeSocket implements ListUpdateSocket {
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
