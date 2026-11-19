// @vitest-environment jsdom
//
// #1665: two BoQ uploads by one user, in two tabs, each follow their own operation through the shared hook. The
// server is faked at the hook's two edges: fetch, where the upload start posts the workbook as multipart form data
// with the browser-made operation id, and the SDK's call API, where each operation's status record answers for
// itself. One tab's upload fails; the
// other's keeps running and then finishes. The socket's "read now" message for one operation reaches both tabs
// (it is user-targeted) and must not end the other.
//
// jsdom has one sessionStorage, so the two tabs use two storage keys here; in a browser each tab has its own.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FrappeContext } from "@/lib/frappe";
import { sdkRejection } from "@/utils/__fixtures__/sdkRejection";
import { collectResultFile, READ_NOW_EVENT, useBackgroundOperation, type BackgroundOperation } from "./useBackgroundOperation";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UPLOAD_METHOD = "nirmaan_stack.api.boq.wizard.upload_file.upload_file";

type Listener = (message: unknown) => void;
function fakeSocket() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    connected: true,
    on: (event: string, fn: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(fn);
    },
    off: (event: string, fn: Listener) => listeners.get(event)?.delete(fn),
    emit: (event: string, message: unknown) => listeners.get(event)?.forEach((fn) => fn(message)),
  };
}

const STATUS_METHOD = "nirmaan_stack.api.background_ops.get_status";

/** The server: each operation's record, and the files each start received. */
function fakeServer() {
  const records = new Map<string, Record<string, unknown>>();
  const startedFiles = new Map<string, string>();
  const fetchFake = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith(`/api/method/${UPLOAD_METHOD}`)) {
      const body = init?.body;
      if (!(body instanceof FormData)) return new Response("{}", { status: 417 });
      const opId = body.get("op_id");
      const file = body.get("file");
      if (typeof opId !== "string" || !(file instanceof File)) return new Response("{}", { status: 417 });
      startedFiles.set(opId, file.name);
      records.set(opId, { op_id: opId, state: "queued", started_at: null, timeout: 600, now: 1000 });
      return new Response(JSON.stringify({ message: records.get(opId) }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const call = {
    get: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method !== STATUS_METHOD) throw { httpStatus: 404, message: "There was an error.", exception: "" };
      const opId = typeof params?.op_id === "string" ? params.op_id : "";
      return { message: records.get(opId) ?? null };
    }),
  };
  const set = (opId: string, patch: Record<string, unknown>) =>
    records.set(opId, { ...records.get(opId), ...patch });
  return { fetchFake, call, startedFiles, set };
}

function Tab({ storageKey, expose, onFinished }: {
  storageKey: string;
  expose: (op: BackgroundOperation) => void;
  onFinished: (result: unknown) => void;
}) {
  expose(useBackgroundOperation({ storageKey, onFinished }));
  return null;
}

const upload = (name: string) => {
  const form = new FormData();
  form.append("project_id", "PROJ-TEST-0001");
  form.append("file", new File(["workbook"], name), name);
  return form;
};

const settle = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});

describe("useBackgroundOperation: two BoQ uploads in two tabs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.sessionStorage.clear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("each tab shows its own upload's outcome: one fails, the other still runs and then finishes", async () => {
    const server = fakeServer();
    vi.stubGlobal("fetch", server.fetchFake);
    const socket = fakeSocket();
    const tabs: Record<"a" | "b", BackgroundOperation | null> = { a: null, b: null };
    const finished = { a: vi.fn(), b: vi.fn() };

    await act(async () => {
      root.render(
        <FrappeContext.Provider value={{ socket, call: server.call } as never}>
          <Tab storageKey="boq_upload:tab-a" expose={(op) => { tabs.a = op; }} onFinished={finished.a} />
          <Tab storageKey="boq_upload:tab-b" expose={(op) => { tabs.b = op; }} onFinished={finished.b} />
        </FrappeContext.Provider>,
      );
    });

    await act(async () => {
      await tabs.a?.start(UPLOAD_METHOD, upload("Tower_A.xlsx"));
      await tabs.b?.start(UPLOAD_METHOD, upload("Tower_B.xlsx"));
    });
    const opA = tabs.a?.view.phase === "queued" ? tabs.a.view.opId : "";
    const opB = tabs.b?.view.phase === "queued" ? tabs.b.view.opId : "";
    expect(opA).not.toBe("");
    expect(opB).not.toBe("");
    expect(opA).not.toBe(opB);
    expect(server.startedFiles.get(opA)).toBe("Tower_A.xlsx");
    expect(server.startedFiles.get(opB)).toBe("Tower_B.xlsx");

    server.set(opA, { state: "failed", error: "The operation failed. The error has been logged." });
    server.set(opB, { state: "running", started_at: 1000 });
    socket.emit(READ_NOW_EVENT, { op_id: opA });
    await settle();
    expect(tabs.a?.view).toEqual({
      phase: "failed", opId: opA, error: "The operation failed. The error has been logged.",
    });
    expect(tabs.b?.view.phase).toBe("queued");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(tabs.b?.view.phase).toBe("running");

    server.set(opB, { state: "finished", result: { status: "success", boq_name: "BOQ-26-00002" } });
    socket.emit(READ_NOW_EVENT, { op_id: opB });
    await settle();
    expect(tabs.b?.view.phase).toBe("finished");
    expect(finished.b).toHaveBeenCalledWith({ status: "success", boq_name: "BOQ-26-00002" }, undefined, opB);
    expect(finished.a).not.toHaveBeenCalled();
    expect(tabs.a?.view.phase).toBe("failed");
  });
});

describe("useBackgroundOperation: a slot change (the pricing page switching sheets)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.sessionStorage.clear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the new slot's own operation, idle when the new slot holds none, and the old one again on return", async () => {
    const server = fakeServer();
    vi.stubGlobal("fetch", server.fetchFake);
    const socket = fakeSocket();
    let op: BackgroundOperation | null = null;
    const render = (storageKey: string) => act(async () => {
      root.render(
        <FrappeContext.Provider value={{ socket, call: server.call } as never}>
          <Tab storageKey={storageKey} expose={(o) => { op = o; }} onFinished={vi.fn()} />
        </FrappeContext.Provider>,
      );
    });
    const view = () => (op as BackgroundOperation | null)?.view;

    await render("rate_suggest:BOQ-TEST-0001:Sheet A");
    await act(async () => {
      await (op as BackgroundOperation | null)?.start(UPLOAD_METHOD, upload("Sheet_A.xlsx"));
    });
    const opA = view()?.phase === "queued" ? (view() as { opId: string }).opId : "";
    expect(opA).not.toBe("");

    await render("rate_suggest:BOQ-TEST-0001:Sheet B");
    expect(view()).toEqual({ phase: "idle" });

    await render("rate_suggest:BOQ-TEST-0001:Sheet A");
    await settle();
    expect(view()).toEqual({ phase: "queued", opId: opA });
  });
});

describe("useBackgroundOperation: the server's words when it refuses a start or a file", () => {
  const JSON_METHOD = "nirmaan_stack.api.tds.tds_report.start_tds_export";
  const START_FALLBACK = "The server could not start this.";
  const refusal = (message: string) => JSON.stringify([JSON.stringify({ message, title: "Not permitted" })]);

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.sessionStorage.clear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function failedStart(args: Record<string, unknown> | FormData, postRejects: unknown) {
    const call = { get: vi.fn(async () => ({ message: null })), post: vi.fn(async () => { throw postRejects; }) };
    let op: BackgroundOperation | null = null;
    await act(async () => {
      root.render(
        <FrappeContext.Provider value={{ socket: fakeSocket(), call } as never}>
          <Tab storageKey="tds_export:PROJ-TEST-0001" expose={(o) => { op = o; }} onFinished={vi.fn()} />
        </FrappeContext.Provider>,
      );
    });
    await act(async () => {
      await (op as BackgroundOperation | null)?.start(args instanceof FormData ? UPLOAD_METHOD : JSON_METHOD, args);
    });
    const view = (op as BackgroundOperation | null)?.view;
    return view?.phase === "failed" ? view.error : `not failed: ${view?.phase}`;
  }

  it("a JSON start shows the server's refusal, its exception without the class, else the start fallback", async () => {
    expect(await failedStart({}, sdkRejection({ _server_messages: refusal("<b>Only</b> a Project Manager can export.") })))
      .toBe("Only a Project Manager can export.");
    expect(await failedStart({}, sdkRejection({ exception: "frappe.exceptions.ValidationError: The sheet is locked." })))
      .toBe("The sheet is locked.");
    expect(await failedStart({}, sdkRejection({}))).toBe(START_FALLBACK);
    expect(await failedStart({}, new TypeError("Cannot read properties of undefined (reading 'data')"))).toBe(START_FALLBACK);
  });

  it("an upload start reads the refusal from the reply's body, and falls back when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ _server_messages: refusal("The workbook has no sheets.") }), { status: 417 },
    )));
    expect(await failedStart(upload("Empty.xlsx"), null)).toBe("The workbook has no sheets.");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 })));
    expect(await failedStart(upload("Tower_A.xlsx"), null)).toBe(START_FALLBACK);
  });

  it("collecting the file rejects with the server's refusal, else its own fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ _server_messages: refusal("This file belongs to another user.") }), { status: 403 },
    )));
    await expect(collectResultFile("op-1")).rejects.toThrow("This file belongs to another user.");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(collectResultFile("op-1")).rejects.toThrow("The finished file could not be fetched.");
  });
});
