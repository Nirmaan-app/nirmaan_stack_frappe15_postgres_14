/**
 * The app's one import point for `frappe-react-sdk` (ADR-0049). Import SDK hooks, `FrappeProvider`,
 * `FrappeContext`, `useSWRConfig` and the SDK types from `@/lib/frappe`; oxlint bans importing the SDK anywhere
 * else.
 *
 * Every SDK hook is declared `<T = any>`, so a call that passes no type returns `any` that no rule sees. Here each
 * generic hook is re-declared with `T` defaulting to `unknown`: a call without a type argument gives `unknown` data
 * (or `FrappeDoc<unknown>`, Frappe's standard fields only, for a document), and a call with one gives that type.
 * Pass the type, or narrow the `unknown`.
 *
 * Pure re-typing, with one exception: every other export is the SDK's own function or value (`frappe.test.ts`
 * checks each one is identical), so no hook behaves differently, and a test that mocks `frappe-react-sdk` still
 * reaches every caller through here. The parameter and return types are read from the SDK's own declarations, so an
 * SDK upgrade cannot drift them.
 *
 * The exception is the event listeners (#1670). The SDK's three listener hooks drop other components' listeners and
 * rooms, so this module does not export them; it exports `useSocketEventListener`, `useDocTypeEventListener` and
 * `useDocumentEventListener` in their place, at the end of this file. oxlint's SDK-import ban keeps new files off the
 * raw hooks, and residence check L1 (`scripts/residence_check.py`) keeps their names out of `src/` everywhere else.
 *
 * Not re-typed: SWR's own `useSWR`, `useSWRInfinite`, `preload` and `useSWRConfig().mutate` keep SWR's typing
 * (they infer `Data` from the fetcher you pass).
 */
import * as sdk from "frappe-react-sdk";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

// Listed by name, never `export *`: vitest's node runner loads the SDK's CommonJS build, from which `export *`
// re-exports nothing, so a unit test would get `undefined` where the app gets the SDK's value.
export {
  FrappeContext,
  FrappeProvider,
  getDocListQueryString,
  getRequestURL,
  preload,
  useFrappeAuth,
  useFrappeDeleteDoc,
  useSWR,
  useSWRConfig,
  useSWRInfinite,
  useSearch,
} from "frappe-react-sdk";
export type {
  AuthCredentials,
  AuthResponse,
  DocTypeListUpdateEventData,
  DocumentUpdateEventData,
  FileArgs,
  Filter,
  FrappeConfig,
  FrappeDoc,
  FrappeError,
  FrappeFileUploadResponse,
  GetDocListArgs,
  Key,
  OTPCredentials,
  SearchResult,
  SWRConfiguration,
  SWRResponse,
  TokenParams,
  UserPassCredentials,
  ViewerEventData,
} from "frappe-react-sdk";

type Sdk = typeof sdk;

/** `useFrappeGetDoc` with `T` defaulting to `unknown`. The third argument is the SWR key (`id ? undefined : null`). */
export const useFrappeGetDoc: <T = unknown>(
  ...args: Parameters<Sdk["useFrappeGetDoc"]>
) => ReturnType<typeof sdk.useFrappeGetDoc<T>> = sdk.useFrappeGetDoc;

/** `useFrappePrefetchDoc` with `T` defaulting to `unknown`. */
export const useFrappePrefetchDoc: <T = unknown>(
  ...args: Parameters<Sdk["useFrappePrefetchDoc"]>
) => ReturnType<typeof sdk.useFrappePrefetchDoc<T>> = sdk.useFrappePrefetchDoc;

/** `useFrappeGetDocList` with `T` defaulting to `unknown`. */
export const useFrappeGetDocList: <T = unknown, K = sdk.FrappeDoc<T>>(
  ...args: Parameters<typeof sdk.useFrappeGetDocList<T, K>>
) => ReturnType<typeof sdk.useFrappeGetDocList<T, K>> = sdk.useFrappeGetDocList;

/** `useFrappePrefetchDocList` with `T` defaulting to `unknown`. */
export const useFrappePrefetchDocList: <T = unknown, K = sdk.FrappeDoc<T>>(
  ...args: Parameters<typeof sdk.useFrappePrefetchDocList<T, K>>
) => ReturnType<typeof sdk.useFrappePrefetchDocList<T, K>> = sdk.useFrappePrefetchDocList;

/** `useFrappeCreateDoc` with `T` defaulting to `unknown`. */
export const useFrappeCreateDoc: <T = unknown>() => ReturnType<typeof sdk.useFrappeCreateDoc<T>> =
  sdk.useFrappeCreateDoc;

/** `useFrappeUpdateDoc` with `T` defaulting to `unknown`. */
export const useFrappeUpdateDoc: <T = unknown>() => ReturnType<typeof sdk.useFrappeUpdateDoc<T>> =
  sdk.useFrappeUpdateDoc;

/** `useFrappeGetDocCount` with `T` defaulting to `unknown`. */
export const useFrappeGetDocCount: <T = unknown>(
  ...args: Parameters<typeof sdk.useFrappeGetDocCount<T>>
) => ReturnType<typeof sdk.useFrappeGetDocCount<T>> = sdk.useFrappeGetDocCount;

/** `useFrappePrefetchDocCount` with `T` defaulting to `unknown`. */
export const useFrappePrefetchDocCount: <T = unknown>(
  ...args: Parameters<typeof sdk.useFrappePrefetchDocCount<T>>
) => ReturnType<typeof sdk.useFrappePrefetchDocCount<T>> = sdk.useFrappePrefetchDocCount;

/** `useFrappeGetCall` with `T` defaulting to `unknown`. */
export const useFrappeGetCall: <T = unknown>(
  ...args: Parameters<Sdk["useFrappeGetCall"]>
) => ReturnType<typeof sdk.useFrappeGetCall<T>> = sdk.useFrappeGetCall;

/** `useFrappePrefetchCall` with `T` defaulting to `unknown`. */
export const useFrappePrefetchCall: <T = unknown>(
  ...args: Parameters<Sdk["useFrappePrefetchCall"]>
) => ReturnType<typeof sdk.useFrappePrefetchCall<T>> = sdk.useFrappePrefetchCall;

/** `useFrappePostCall` with `T` defaulting to `unknown`. */
export const useFrappePostCall: <T = unknown>(
  ...args: Parameters<Sdk["useFrappePostCall"]>
) => ReturnType<typeof sdk.useFrappePostCall<T>> = sdk.useFrappePostCall;

/** `useFrappePutCall` with `T` defaulting to `unknown`. */
export const useFrappePutCall: <T = unknown>(
  ...args: Parameters<Sdk["useFrappePutCall"]>
) => ReturnType<typeof sdk.useFrappePutCall<T>> = sdk.useFrappePutCall;

/** `useFrappeDeleteCall` with `T` defaulting to `unknown`. */
export const useFrappeDeleteCall: <T = unknown>(
  ...args: Parameters<Sdk["useFrappeDeleteCall"]>
) => ReturnType<typeof sdk.useFrappeDeleteCall<T>> = sdk.useFrappeDeleteCall;

/** `useFrappeFileUpload` with `T` (the upload's `otherData`) defaulting to `unknown`. */
export const useFrappeFileUpload: <T = unknown>() => ReturnType<typeof sdk.useFrappeFileUpload<T>> =
  sdk.useFrappeFileUpload;

// Event listeners (#1670). The SDK's hooks, read from frappe-react-sdk 1.17.0, clean up with `socket.off(event)`,
// which removes every listener of that event in the tab, and do so on every new handler too; and its document and
// doctype hooks leave their room on any unmount, for every other listener of it. Every `list_update` and
// `doc_update` listener shares one event name, so one closing component stopped a whole page's live refresh. These
// three keep the SDK's arguments and return values and remove only what their own component added.

type Socket = NonNullable<sdk.FrappeConfig["socket"]>;

/** The tab's socket from `FrappeProvider`; undefined when the provider has none (or none is mounted). */
function useSocket(): Socket | undefined {
  return useContext(sdk.FrappeContext)?.socket;
}

/**
 * Calls `handler` with each `event` the server sends this tab. Unlike the SDK's `useFrappeEventListener`, it removes
 * only its own handler on unmount (`socket.off(event, fn)`, never `socket.off(event)`), and a new `handler` on a
 * render is picked up without touching the socket, so neither ever drops another component's listener.
 */
export function useSocketEventListener<T = unknown>(event: string, handler: (eventData: T) => void): void {
  const socket = useSocket();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (socket === undefined) console.warn("Socket is not enabled. Please enable socket in FrappeProvider.");
    if (!socket) return;
    const listener = (eventData: T) => latest.current(eventData);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}

// How many mounted listeners hold each room, per socket. The server keeps one membership per socket, so a room's
// leave message is sent only when its last listener unmounts. A reconnect starts the socket afresh on the server;
// each listener then sends its join again, as the SDK does, and the counts stay as they are.
const roomHolders = new WeakMap<Socket, Map<string, number>>();

/** Counts one more holder of `room`; sends `join` when it is the first. Returns the release, which sends `leave`
 * when it was the last. */
function holdRoom(socket: Socket, room: string, join: () => void, leave: () => void): () => void {
  let holders = roomHolders.get(socket);
  if (!holders) roomHolders.set(socket, (holders = new Map()));
  const count = holders.get(room) ?? 0;
  holders.set(room, count + 1);
  if (count === 0) join();
  return () => {
    const left = (holders.get(room) ?? 1) - 1;
    if (left > 0) {
      holders.set(room, left);
      return;
    }
    holders.delete(room);
    leave();
  };
}

/** The SDK's `useFrappeDocTypeEventListener`, made safe: `onListUpdate` gets every `list_update` this tab receives
 * (as the SDK's does, for any doctype), the doctype's room is left only when its last listener unmounts, and only
 * this listener's handler is removed. */
export function useDocTypeEventListener(
  doctype: string,
  onListUpdate: (eventData: sdk.DocTypeListUpdateEventData) => void,
): void {
  const socket = useSocket();
  useEffect(() => {
    if (!socket) return;
    const subscribe = () => socket.emit("doctype_subscribe", doctype);
    const release = holdRoom(socket, `doctype:${doctype}`, subscribe, () => socket.emit("doctype_unsubscribe", doctype));
    socket.io.on("reconnect", subscribe);
    return () => {
      release();
      socket.io.off("reconnect", subscribe);
    };
  }, [socket, doctype]);
  useSocketEventListener("list_update", onListUpdate);
}

/** The SDK's `useFrappeDocumentEventListener`, made safe, with the same arguments and return value: `onUpdate` gets
 * every `doc_update` this tab receives (as the SDK's does, for any document), and the document's room, and its
 * open state when `emitOpenCloseEventsOnMount` (default true), are left only when their last listener unmounts. */
export function useDocumentEventListener(
  doctype: string,
  docname: string,
  onUpdate: (eventData: sdk.DocumentUpdateEventData) => void,
  emitOpenCloseEventsOnMount = true,
): { viewers: string[]; emitDocOpen: () => void; emitDocClose: () => void } {
  const socket = useSocket();
  const [viewers, setViewers] = useState<string[]>([]);
  useEffect(() => {
    if (!socket) return;
    const room = `${doctype}/${docname}`;
    const subscribe = () => socket.emit("doc_subscribe", doctype, docname);
    const releaseRoom = holdRoom(socket, `doc:${room}`, subscribe, () => socket.emit("doc_unsubscribe", doctype, docname));
    const releaseOpen = emitOpenCloseEventsOnMount
      ? holdRoom(socket, `open:${room}`, () => socket.emit("doc_open", doctype, docname),
          () => socket.emit("doc_close", doctype, docname))
      : () => undefined;
    socket.io.on("reconnect", subscribe);
    return () => {
      releaseRoom();
      socket.io.off("reconnect", subscribe);
      releaseOpen();
    };
  }, [socket, doctype, docname, emitOpenCloseEventsOnMount]);
  useSocketEventListener("doc_update", onUpdate);
  useSocketEventListener<sdk.ViewerEventData>("doc_viewers", (eventData) => {
    if (eventData.doctype === doctype && eventData.docname === docname) setViewers(eventData.users);
  });
  // Sent as asked, uncounted, as the SDK's are: a caller that closes the document by hand means to.
  const emitDocOpen = useCallback(() => {
    socket?.emit("doc_open", doctype, docname);
  }, [socket, doctype, docname]);
  const emitDocClose = useCallback(() => {
    socket?.emit("doc_close", doctype, docname);
  }, [socket, doctype, docname]);
  return { viewers, emitDocOpen, emitDocClose };
}
