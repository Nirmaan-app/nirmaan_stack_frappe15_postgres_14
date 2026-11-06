import { FrappeConfig, FrappeContext } from "frappe-react-sdk";
import { useContext, useEffect, useRef } from "react";

import { subscribeListUpdate, type ListUpdateMessage } from "./realtime/listUpdateHub";

export type { ListUpdateMessage };

/**
 * Runs `onUpdate` for every `list_update` of `doctype`: a document of it was inserted, saved or deleted.
 *
 * Built on the shared `listUpdateHub`, not the SDK's `useFrappeDocTypeEventListener`: the SDK's clean-up removes
 * every screen's `list_update` listener (Speed Plan bug B1). The hub counts the screens on each doctype, so any
 * number of these may share one doctype, and one closing never cuts another off. `onUpdate` may change on every
 * render; the subscription is made once per socket and doctype.
 */
export const useListUpdate = (doctype: string, onUpdate: (message: ListUpdateMessage) => void) => {
    const { socket } = useContext(FrappeContext) as FrappeConfig;
    const onUpdateRef = useRef(onUpdate);
    useEffect(() => {
        onUpdateRef.current = onUpdate;
    });

    useEffect(() => {
        if (!socket) return;
        return subscribeListUpdate(socket, doctype, { onUpdate: message => onUpdateRef.current(message) });
    }, [socket, doctype]);
};
