import { FrappeConfig, FrappeContext } from "frappe-react-sdk";
import { useContext, useEffect, useRef } from "react";

/** What Frappe sends with `list_update` (`frappe/model/document.py` notify_update): on insert, save and delete. */
export interface ListUpdateMessage {
    doctype: string;
    name: string;
    user: string;
}

/**
 * Runs `onUpdate` for every `list_update` of `doctype`: a document of it was inserted, saved or deleted.
 *
 * Why not the SDK's `useFrappeDocTypeEventListener`: its clean-up calls `socket.off("list_update")` with no
 * function, which removes EVERY screen's `list_update` listener (Speed Plan bug B1), so a listener set up there
 * dies whenever any other screen's listener cleans up. This one listens through socket.io's catch-all
 * (`onAny` / `offAny`), which `socket.off(event)` never touches, and removes only itself. `onUpdate` may change
 * on every render; the socket listener is set up once per doctype.
 *
 * It joins and leaves the doctype's room like the SDK does, so give each doctype ONE listener of this kind:
 * a second one leaving the room would cut the first off. When anything else on this socket leaves the room (the
 * SDK listener in `useServerDataTable`, as a page of that doctype closes), it joins again straight after.
 */
export const useListUpdate = (doctype: string, onUpdate: (message: ListUpdateMessage) => void) => {
    const { socket } = useContext(FrappeContext) as FrappeConfig;
    const onUpdateRef = useRef(onUpdate);
    useEffect(() => {
        onUpdateRef.current = onUpdate;
    });

    useEffect(() => {
        if (!socket) return;
        const subscribe = () => socket.emit("doctype_subscribe", doctype);
        const listener = (event: string, message?: ListUpdateMessage) => {
            if (event === "list_update" && message?.doctype === doctype) onUpdateRef.current(message);
        };
        // Outgoing listeners run before the packet is sent, so join again on the next tick, after the leave.
        const rejoin = (event: string, room?: string) => {
            if (event === "doctype_unsubscribe" && room === doctype) setTimeout(subscribe, 0);
        };
        subscribe();
        socket.io.on("reconnect", subscribe);
        socket.onAny(listener);
        socket.onAnyOutgoing(rejoin);
        return () => {
            socket.offAnyOutgoing(rejoin);
            socket.offAny(listener);
            socket.io.off("reconnect", subscribe);
            socket.emit("doctype_unsubscribe", doctype);
        };
    }, [socket, doctype]);
};
