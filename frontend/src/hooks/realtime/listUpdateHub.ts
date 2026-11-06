/**
 * One shared listener for Frappe's `list_update` event, per socket.
 *
 * Frappe sends `list_update` ({doctype, name, user}) on every insert, save and delete, but only to sockets in that
 * doctype's room (`frappe/realtime.py` publish_realtime). A socket joins with `doctype_subscribe` and leaves with
 * `doctype_unsubscribe`. Membership is yes/no, not counted.
 *
 * Why not the SDK's `useFrappeDocTypeEventListener` (frappe-react-sdk 1.17.0, Speed Plan bug B1):
 *  1. Its clean-up calls `socket.off("list_update")` with no function, which removes EVERY screen's
 *     `list_update` listener, not just its own.
 *  2. That clean-up runs whenever the callback changes, so a table re-created its listener on every search
 *     keystroke and removed everyone else's each time.
 *  3. When one screen closes it leaves the room, and that cuts off every other screen on the same doctype.
 *
 * This hub fixes all three:
 *  1. It listens through socket.io's catch-all (`onAny`), which `socket.off(event)` never touches.
 *  2. Subscribers are plain entries in a map, and adding or removing one never re-attaches the socket listener.
 *  3. Rooms are counted: join when the first subscriber of a doctype arrives, leave when the last one goes. If
 *     something outside the hub (an old SDK listener) leaves a room the hub still needs, the hub joins again.
 *
 * After the socket reconnects (the server forgets every room then), the hub joins every room again and calls each
 * subscriber's `onReconnect`, so a table can refresh once to catch changes missed while the connection was down.
 */

/** What Frappe sends with `list_update` (`frappe/model/document.py` notify_update). */
export interface ListUpdateMessage {
    doctype: string;
    name: string;
    user: string;
}

export interface ListUpdateSubscriber {
    /** A document of the doctype was inserted, saved or deleted. */
    onUpdate: (message: ListUpdateMessage) => void;
    /** The socket reconnected and the hub joined the room again; changes made meanwhile were not delivered. */
    onReconnect?: () => void;
}

type AnyListener = (event: string, ...args: unknown[]) => void;

/** The part of a socket.io-client `Socket` the hub uses. */
export interface ListUpdateSocket {
    emit(event: string, ...args: unknown[]): unknown;
    onAny(listener: AnyListener): unknown;
    offAny(listener?: AnyListener): unknown;
    onAnyOutgoing(listener: AnyListener): unknown;
    offAnyOutgoing(listener?: AnyListener): unknown;
    io: {
        on(event: "reconnect", listener: () => void): unknown;
        off(event: "reconnect", listener?: () => void): unknown;
    };
}

interface HubState {
    subscribers: Map<string, Set<ListUpdateSubscriber>>;
    onIncoming: AnyListener;
    onOutgoing: AnyListener;
    onReconnect: () => void;
}

const hubs = new WeakMap<ListUpdateSocket, HubState>();

/** Runs every callback even when one of them throws, and never lets a subscriber break the socket. */
function callEach(subscribers: Set<ListUpdateSubscriber>, call: (subscriber: ListUpdateSubscriber) => void) {
    // A copy: a callback may unsubscribe itself or another subscriber while we loop.
    for (const subscriber of Array.from(subscribers)) {
        try {
            call(subscriber);
        } catch (error) {
            console.error("[listUpdateHub] a list_update subscriber failed:", error);
        }
    }
}

/** The one place a `list_update` payload is read. `name` and `user` fall back to "" when missing. */
export function parseListUpdate(payload: unknown): ListUpdateMessage | null {
    if (!payload || typeof payload !== "object") return null;
    const { doctype, name, user } = payload as Record<string, unknown>;
    if (typeof doctype !== "string" || !doctype) return null;
    return {
        doctype,
        name: typeof name === "string" ? name : "",
        user: typeof user === "string" ? user : "",
    };
}

function attach(socket: ListUpdateSocket): HubState {
    const subscribers = new Map<string, Set<ListUpdateSubscriber>>();

    const onIncoming: AnyListener = (event, payload) => {
        if (event !== "list_update") return;
        const message = parseListUpdate(payload);
        if (!message) return;
        const forDoctype = subscribers.get(message.doctype);
        if (forDoctype) callEach(forDoctype, subscriber => subscriber.onUpdate(message));
    };

    // Someone else on this socket left a room we still hold. Outgoing listeners run just BEFORE the packet is
    // sent, so join again on the next tick, after the server has handled the leave.
    const onOutgoing: AnyListener = (event, room) => {
        if (event !== "doctype_unsubscribe" || typeof room !== "string" || !subscribers.has(room)) return;
        const doctype = room;
        setTimeout(() => {
            if (subscribers.has(doctype)) socket.emit("doctype_subscribe", doctype);
        }, 0);
    };

    const onReconnect = () => {
        for (const doctype of Array.from(subscribers.keys())) socket.emit("doctype_subscribe", doctype);
        for (const forDoctype of Array.from(subscribers.values())) {
            callEach(forDoctype, subscriber => subscriber.onReconnect?.());
        }
    };

    socket.onAny(onIncoming);
    socket.onAnyOutgoing(onOutgoing);
    socket.io.on("reconnect", onReconnect);
    const state = { subscribers, onIncoming, onOutgoing, onReconnect };
    hubs.set(socket, state);
    return state;
}

function detach(socket: ListUpdateSocket, state: HubState) {
    socket.offAny(state.onIncoming);
    socket.offAnyOutgoing(state.onOutgoing);
    socket.io.off("reconnect", state.onReconnect);
    hubs.delete(socket);
}

/**
 * Calls `subscriber.onUpdate` for every `list_update` of `doctype` on `socket` until the returned function is
 * called. Any number of subscribers may share a doctype. The returned function is safe to call more than once.
 */
export function subscribeListUpdate(
    socket: ListUpdateSocket,
    doctype: string,
    subscriber: ListUpdateSubscriber,
): () => void {
    const state = hubs.get(socket) ?? attach(socket);
    let forDoctype = state.subscribers.get(doctype);
    if (!forDoctype) {
        forDoctype = new Set();
        state.subscribers.set(doctype, forDoctype);
        socket.emit("doctype_subscribe", doctype);
    }
    // Each call gets its own entry, so the same callbacks subscribed twice are two subscribers.
    const entry: ListUpdateSubscriber = { ...subscriber };
    forDoctype.add(entry);

    let active = true;
    return () => {
        if (!active) return;
        active = false;
        const current = state.subscribers.get(doctype);
        if (!current) return;
        current.delete(entry);
        if (current.size > 0) return;
        // Forget the room BEFORE leaving it, so our own leave is not mistaken for someone else's.
        state.subscribers.delete(doctype);
        socket.emit("doctype_unsubscribe", doctype);
        if (state.subscribers.size === 0) detach(socket, state);
    };
}

/** For tests: the doctypes the hub holds a room for on `socket`. */
export function heldDoctypes(socket: ListUpdateSocket): string[] {
    return Array.from(hubs.get(socket)?.subscribers.keys() ?? []);
}
