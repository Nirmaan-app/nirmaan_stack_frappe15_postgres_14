/**
 * The shared screen hook for a background operation (ADR 0047): start one, follow its status record, collect its
 * file. The state machine is `utils/backgroundOps/operationFollower` (tested there); this file wires it to the
 * server, the socket and the tab's sessionStorage.
 *
 *   const op = useBackgroundOperation({ storageKey: "tds_export:<project>", onFinished, onFailed });
 *   await op.start("nirmaan_stack.api.tds.tds_report.start_tds_export", { settings_json, ... }, { previewOnly });
 *   op.view  // idle | starting | queued | running (progress) | finished | failed | lost
 *
 * `storageKey` names the screen's slot in this tab's sessionStorage, so a reload picks the operation up again.
 * The server endpoint `start` posts to takes the browser-made `op_id` alongside `args` and calls
 * `services/background_ops.start`. `onFinished` runs once per finished operation, with the `context` given to
 * `start` (kept across a reload, so JSON only) and the operation id, which `collectResultFile` takes. `onFailed`
 * runs once when it ends failed or lost, with the server's words. The socket's `background_op:read_now` message only makes the hook
 * read the record sooner.
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { FrappeContext, type FrappeConfig } from "@/lib/frappe";
import { parseJson } from "@/lib/parseJson";
import { OperationFollower, type OpView } from "@/utils/backgroundOps/operationFollower";

/** The socket message the server sends while an operation changes (`services/background_ops.READ_NOW_EVENT`). */
export const READ_NOW_EVENT = "background_op:read_now";

const STATUS_METHOD = "nirmaan_stack.api.background_ops.get_status";
const COLLECT_METHOD = "nirmaan_stack.api.background_ops.collect_result";

export interface BackgroundOperation {
  view: OpView;
  /** Start a new operation through the flow's own start endpoint, then follow it. */
  start: (method: string, args: Record<string, unknown>, context?: unknown) => Promise<void>;
  /** Forget the operation this screen follows. */
  reset: () => void;
}

const csrfToken = () => (window as unknown as { csrf_token?: string }).csrf_token ?? "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The words of a Frappe error reply (`_server_messages`, else `exception`), for the screen to show. */
async function serverError(response: Response, fallback: string): Promise<string> {
  try {
    const body = parseJson(await response.text());
    if (!isRecord(body)) return fallback;
    if (typeof body._server_messages === "string") {
      const messages = parseJson(body._server_messages);
      const first = Array.isArray(messages) && typeof messages[0] === "string" ? parseJson(messages[0]) : null;
      if (isRecord(first) && typeof first.message === "string") return first.message;
    }
    if (typeof body.exception === "string") return body.exception.replace(/^[\w.]+:\s*/, "");
  } catch {
    // Not a JSON reply: the fallback says enough.
  }
  return fallback;
}

async function readStatus(opId: string): Promise<unknown> {
  const response = await fetch(`/api/method/${STATUS_METHOD}?op_id=${encodeURIComponent(opId)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(await serverError(response, `Status read failed (${response.status})`));
  const body = parseJson(await response.text());
  return isRecord(body) ? body.message : null;
}

async function postStart(method: string, args: Record<string, unknown>, opId: string): Promise<void> {
  const response = await fetch(`/api/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Frappe-CSRF-Token": csrfToken() },
    body: JSON.stringify({ ...args, op_id: opId }),
  });
  if (!response.ok) throw new Error(await serverError(response, "The server could not start this."));
}

/** The finished file of the caller's own operation. Refused by the server for anyone else. */
export async function collectResultFile(opId: string): Promise<Blob> {
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
  const { socket } = useContext(FrappeContext) as FrappeConfig;
  const [view, setView] = useState<OpView>({ phase: "idle" });
  const followerRef = useRef<OperationFollower | null>(null);
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;

  useEffect(() => {
    const follower = new OperationFollower({
      makeId: () => crypto.randomUUID(),
      readStatus,
      socketUp: () => Boolean(socketRef.current?.connected),
      storage: tabSlot(storageKey),
      onView: (next) => {
        setView(next);
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

  const start = useCallback(async (method: string, args: Record<string, unknown>, context?: unknown) => {
    await followerRef.current?.start((opId) => postStart(method, args, opId), context);
  }, []);

  const reset = useCallback(() => followerRef.current?.reset(), []);

  return { view, start, reset };
}
