/**
 * The shared screen hook for a background operation (ADR 0047): start one, follow its status record, collect its
 * file. The state machine is `utils/backgroundOps/operationFollower` (tested there); this file wires it to the
 * server, the socket and the tab's sessionStorage.
 *
 *   const op = useBackgroundOperation({ storageKey: "tds_export:<project>", onFinished, onFailed });
 *   await op.start("nirmaan_stack.api.tds.tds_report.start_tds_export", { settings_json, ... }, { previewOnly });
 *   op.followStarted(opId)  // follow one the server started (another operation's result names its id)
 *   op.view  // idle | starting | queued | running (progress) | finished | failed | lost
 *   op.context  // what `start` was given, so a screen knows what a resumed operation is for
 *
 * `storageKey` names the screen's slot in this tab's sessionStorage, so a reload picks the operation up again.
 * The status read and a JSON start go through the SDK's call API; only a file upload and the file download use
 * fetch, which the SDK cannot do.
 * The server endpoint `start` posts to takes the browser-made `op_id` alongside `args` (JSON, or `FormData` for a
 * start that uploads a file) and calls `services/background_ops.start`. `onFinished` runs once per finished operation, with the `context` given to
 * `start` (kept across a reload, so JSON only) and the operation id, which `collectResultFile` takes. `onFailed`
 * runs once when it ends failed or lost, with the server's words. The socket's `background_op:read_now` message only makes the hook
 * read the record sooner.
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { useLatestRef } from "@/hooks/useLatestRef";
import { FrappeContext, type FrappeConfig } from "@/lib/frappe";
import { parseJson } from "@/lib/parseJson";
import { isRecord, OperationFollower, type OpView } from "@/utils/backgroundOps/operationFollower";
import { serverRefusalText } from "@/utils/frappeErrorText";

/** The socket message the server sends while an operation changes (`services/background_ops.READ_NOW_EVENT`). */
export const READ_NOW_EVENT = "background_op:read_now";

const STATUS_METHOD = "nirmaan_stack.api.background_ops.get_status";
const COLLECT_METHOD = "nirmaan_stack.api.background_ops.collect_result";

export interface BackgroundOperation {
  view: OpView;
  /** The context given to `start` for the operation shown (kept across a reload); undefined when idle. */
  context: unknown;
  /** Start a new operation through the flow's own start endpoint, then follow it. */
  start: (method: string, args: StartArgs, context?: unknown) => Promise<void>;
  /** Follow an operation the server started (its id came in another operation's result); nothing is posted. */
  followStarted: (opId: string, context?: unknown) => void;
  /** Forget the operation this screen follows. */
  reset: () => void;
}

/** The SDK's call API (`FrappeConfig.call`): GET and JSON POST to whitelisted methods. */
type FrappeCall = FrappeConfig["call"];

/** The words of a failed fetch reply, for the screen to show. */
async function serverError(response: Response, fallback: string): Promise<string> {
  try {
    return serverRefusalText(parseJson(await response.text())) ?? fallback;
  } catch {
    return fallback; // Not a JSON reply: the fallback says enough.
  }
}

async function readStatus(call: FrappeCall, opId: string): Promise<unknown> {
  try {
    const body: unknown = await call.get(STATUS_METHOD, { op_id: opId });
    return isRecord(body) ? body.message : null;
  } catch (error) {
    throw new Error(serverRefusalText(error) ?? "The status read failed.");
  }
}

/** Start args: JSON, or form data for a start that uploads a file (the BoQ upload). Either way the operation id
 *  rides along as `op_id`. */
export type StartArgs = Record<string, unknown> | FormData;

async function postStart(call: FrappeCall, method: string, args: StartArgs, opId: string): Promise<void> {
  if (!(args instanceof FormData)) {
    try {
      await call.post(method, { ...args, op_id: opId });
    } catch (error) {
      throw new Error(serverRefusalText(error) ?? "The server could not start this.");
    }
    return;
  }
  // Raw fetch: the SDK's `call.post` sends a JSON body only, and this start uploads a file as multipart form data.
  const body = new FormData();
  args.forEach((value, key) => body.append(key, value));
  body.append("op_id", opId);
  const csrfToken = (window as unknown as { csrf_token?: string }).csrf_token ?? "";
  const response = await fetch(`/api/method/${method}`, {
    method: "POST",
    headers: { Accept: "application/json", "X-Frappe-CSRF-Token": csrfToken },
    body,
  });
  if (!response.ok) throw new Error(await serverError(response, "The server could not start this."));
}

/** The finished file of the caller's own operation. Refused by the server for anyone else. */
export async function collectResultFile(opId: string): Promise<Blob> {
  // Raw fetch: the SDK's call API parses a JSON reply, and this reply is the file's bytes.
  const response = await fetch(`/api/method/${COLLECT_METHOD}?op_id=${encodeURIComponent(opId)}`);
  if (!response.ok) throw new Error(await serverError(response, "The finished file could not be fetched."));
  return response.blob();
}

function tabSlot(storageKey: string) {
  const key = `background_op:${storageKey}`;
  return {
    get: () => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (value: string) => {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        // No storage (a private window): only the reload pick-up is lost.
      }
    },
    remove: () => {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // As above.
      }
    },
  };
}

export interface BackgroundOperationOptions {
  storageKey: string;
  onFinished: (result: unknown, context: unknown, opId: string) => void | Promise<void>;
  onFailed?: (ended: Extract<OpView, { phase: "failed" | "lost" }>) => void;
}

/** Follow one background operation at a time on this screen. */
export function useBackgroundOperation({ storageKey, onFinished, onFailed }: BackgroundOperationOptions): BackgroundOperation {
  const { socket, call } = useContext(FrappeContext) as FrappeConfig;
  const callRef = useLatestRef(call);
  const [{ view, context }, setFollowed] = useState<{ view: OpView; context: unknown }>({
    view: { phase: "idle" },
    context: undefined,
  });
  const followerRef = useRef<OperationFollower | null>(null);
  const socketRef = useLatestRef(socket);
  const onFinishedRef = useLatestRef(onFinished);
  const onFailedRef = useLatestRef(onFailed);

  useEffect(() => {
    // A new slot (the pricing page switching sheets keeps this hook mounted) shows only what that slot holds: idle
    // until `resume` finds an operation stored there, never the previous slot's view.
    setFollowed({ view: { phase: "idle" }, context: undefined });
    const follower = new OperationFollower({
      makeId: () => crypto.randomUUID(),
      readStatus: (opId) => readStatus(callRef.current, opId),
      socketUp: () => Boolean(socketRef.current?.connected),
      storage: tabSlot(storageKey),
      onView: (next, nextContext) => {
        // A start posted for the previous slot can still fail after the switch: its view is not this slot's.
        if (followerRef.current !== follower) return;
        setFollowed({ view: next, context: nextContext });
        if (next.phase === "failed" || next.phase === "lost") onFailedRef.current?.(next);
      },
      onFinished: (result, context, opId) => onFinishedRef.current(result, context, opId),
    });
    followerRef.current = follower;
    follower.resume();
    return () => {
      follower.dispose();
      if (followerRef.current === follower) followerRef.current = null;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!socket) return;
    const onReadNow = (message: unknown) => {
      if (isRecord(message) && typeof message.op_id === "string") followerRef.current?.readNow(message.op_id);
    };
    const onSocketChange = () => followerRef.current?.socketChanged();
    socket.on(READ_NOW_EVENT, onReadNow);
    socket.on("connect", onSocketChange);
    socket.on("disconnect", onSocketChange);
    return () => {
      socket.off(READ_NOW_EVENT, onReadNow);
      socket.off("connect", onSocketChange);
      socket.off("disconnect", onSocketChange);
    };
  }, [socket]);

  const start = useCallback(async (method: string, args: StartArgs, context?: unknown) => {
    await followerRef.current?.start((opId) => postStart(callRef.current, method, args, opId), context);
  }, []);

  const followStarted = useCallback((opId: string, context?: unknown) => {
    followerRef.current?.followStarted(opId, context);
  }, []);

  const reset = useCallback(() => followerRef.current?.reset(), []);

  return { view, context, start, followStarted, reset };
}
