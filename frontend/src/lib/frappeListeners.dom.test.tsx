// @vitest-environment jsdom
//
// The app's safe listener hooks (#1670), exported from `@/lib/frappe`. The SDK's own hooks (frappe-react-sdk 1.17.0)
// remove every listener of an event when one component unmounts or changes its handler, and leave a document or
// doctype room for the whole tab when one listener unmounts. Each test mounts real components against a fake socket
// that keeps socket.io-client's rules: `off(event)` removes every handler of that event, `off(event, fn)` only `fn`.
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FrappeContext,
  useDocTypeEventListener,
  useDocumentEventListener,
  useSocketEventListener,
  type FrappeConfig,
} from "./frappe";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (data: unknown) => void;

/** A socket.io-client stand-in: what the server sends, and what the tab told the server. */
class FakeSocket {
  handlers = new Map<string, Handler[]>();
  ioHandlers = new Map<string, Handler[]>();
  /** Every message the tab sent the server, as `[event, ...args]`. */
  sent: unknown[][] = [];
  io = {
    on: (event: string, fn: Handler) => {
      this.ioHandlers.set(event, [...(this.ioHandlers.get(event) ?? []), fn]);
    },
    off: (event: string, fn?: Handler) => {
      this.ioHandlers.set(event, fn ? (this.ioHandlers.get(event) ?? []).filter((h) => h !== fn) : []);
    },
  };
  on(event: string, fn: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  off(event: string, fn?: Handler) {
    this.handlers.set(event, fn ? (this.handlers.get(event) ?? []).filter((h) => h !== fn) : []);
    return this;
  }
  emit(...args: unknown[]) {
    this.sent.push(args);
    return this;
  }
  /** The server sends `event` to this tab. */
  serverSends(event: string, data: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(data);
  }
  reconnects() {
    for (const h of this.ioHandlers.get("reconnect") ?? []) h(undefined);
  }
  sentNamed(event: string) {
    return this.sent.filter(([e]) => e === event);
  }
}

let socket: FakeSocket;
let container: HTMLDivElement;
let root: Root;

const render = (node: ReactNode) =>
  act(() => {
    root.render(
      <FrappeContext.Provider value={{ socket } as unknown as FrappeConfig}>{node}</FrappeContext.Provider>,
    );
  });

beforeEach(() => {
  socket = new FakeSocket();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useSocketEventListener", () => {
  function Listener({ event, onEvent }: { event: string; onEvent: Handler }) {
    useSocketEventListener(event, onEvent);
    return null;
  }

  it("removes only its own handler when it unmounts: the other listener of the event still fires", () => {
    const seenByA: unknown[] = [];
    const seenByB: unknown[] = [];
    const onA = (d: unknown) => seenByA.push(d);
    const onB = (d: unknown) => seenByB.push(d);
    render(
      <>
        <Listener key="a" event="cheques:changed" onEvent={onA} />
        <Listener key="b" event="cheques:changed" onEvent={onB} />
      </>,
    );
    socket.serverSends("cheques:changed", 1);

    render(<Listener key="b" event="cheques:changed" onEvent={onB} />);
    socket.serverSends("cheques:changed", 2);

    expect(seenByA).toEqual([1]);
    expect(seenByB).toEqual([1, 2]);
  });

  it("a new handler on each render never removes another component's listener of the event", () => {
    const seenByB: unknown[] = [];
    let rerenderA: () => void = () => undefined;
    function InlineHandler() {
      const [renders, setRenders] = useState(0);
      rerenderA = () => setRenders((n) => n + 1);
      useSocketEventListener("cheques:changed", () => void renders);
      return null;
    }
    render(
      <>
        <InlineHandler />
        <Listener event="cheques:changed" onEvent={(d) => seenByB.push(d)} />
      </>,
    );
    act(() => rerenderA());
    socket.serverSends("cheques:changed", 1);

    expect(seenByB).toEqual([1]);
  });

  it("calls the handler of the latest render", () => {
    const seen: string[] = [];
    render(<Listener event="po:new" onEvent={() => seen.push("first")} />);
    render(<Listener event="po:new" onEvent={() => seen.push("second")} />);
    socket.serverSends("po:new", {});

    expect(seen).toEqual(["second"]);
  });

  it("an event that arrives after a render commits, before its effects run, reaches that render's handler", () => {
    const seen: string[] = [];
    // A layout effect runs after the commit and before any passive effect: the earliest an event can arrive.
    function SendsOnCommit() {
      useLayoutEffect(() => {
        socket.serverSends("po:new", {});
      });
      return null;
    }
    render(<Listener event="po:new" onEvent={() => seen.push("first")} />);
    render(
      <>
        <Listener event="po:new" onEvent={() => seen.push("second")} />
        <SendsOnCommit />
      </>,
    );

    expect(seen).toEqual(["second"]);
  });
});

describe("useDocTypeEventListener", () => {
  function ListWatcher({ doctype, onUpdate }: { doctype: string; onUpdate: Handler }) {
    useDocTypeEventListener(doctype, onUpdate);
    return null;
  }

  it("keeps the doctype room while another listener of it is mounted, and leaves it with the last one", () => {
    const seenByB: unknown[] = [];
    render(
      <>
        <ListWatcher key="a" doctype="Procurement Orders" onUpdate={() => undefined} />
        <ListWatcher key="b" doctype="Procurement Orders" onUpdate={(d) => seenByB.push(d)} />
      </>,
    );
    expect(socket.sentNamed("doctype_subscribe")).toEqual([["doctype_subscribe", "Procurement Orders"]]);

    render(<ListWatcher key="b" doctype="Procurement Orders" onUpdate={(d) => seenByB.push(d)} />);
    socket.serverSends("list_update", { doctype: "Procurement Orders", name: "PO-TEST-1" });

    expect(socket.sentNamed("doctype_unsubscribe")).toEqual([]);
    expect(seenByB).toEqual([{ doctype: "Procurement Orders", name: "PO-TEST-1" }]);

    render(null);
    expect(socket.sentNamed("doctype_unsubscribe")).toEqual([["doctype_unsubscribe", "Procurement Orders"]]);
  });

  it("counts each doctype's room apart", () => {
    render(
      <>
        <ListWatcher key="a" doctype="Procurement Orders" onUpdate={() => undefined} />
        <ListWatcher key="b" doctype="Service Requests" onUpdate={() => undefined} />
      </>,
    );
    render(<ListWatcher key="b" doctype="Service Requests" onUpdate={() => undefined} />);

    expect(socket.sentNamed("doctype_unsubscribe")).toEqual([["doctype_unsubscribe", "Procurement Orders"]]);
  });

  it("joins the room again when the socket reconnects", () => {
    render(<ListWatcher doctype="Procurement Orders" onUpdate={() => undefined} />);
    socket.reconnects();

    expect(socket.sentNamed("doctype_subscribe")).toHaveLength(2);
  });
});

describe("useDocumentEventListener", () => {
  function DocWatcher({ docname, onUpdate, openClose }: { docname: string; onUpdate: Handler; openClose?: boolean }) {
    const { viewers } = useDocumentEventListener("Procurement Orders", docname, onUpdate, openClose);
    return <span>{viewers.join(",")}</span>;
  }

  it("keeps the document's room while another listener of it is mounted, and leaves it with the last one", () => {
    const seenByB: unknown[] = [];
    render(
      <>
        <DocWatcher key="a" docname="PO-TEST-1" onUpdate={() => undefined} />
        <DocWatcher key="b" docname="PO-TEST-1" onUpdate={(d) => seenByB.push(d)} />
      </>,
    );
    expect(socket.sentNamed("doc_subscribe")).toEqual([["doc_subscribe", "Procurement Orders", "PO-TEST-1"]]);
    expect(socket.sentNamed("doc_open")).toEqual([["doc_open", "Procurement Orders", "PO-TEST-1"]]);

    render(<DocWatcher key="b" docname="PO-TEST-1" onUpdate={(d) => seenByB.push(d)} />);
    socket.serverSends("doc_update", { doctype: "Procurement Orders", name: "PO-TEST-1" });

    expect(socket.sentNamed("doc_unsubscribe")).toEqual([]);
    expect(socket.sentNamed("doc_close")).toEqual([]);
    expect(seenByB).toEqual([{ doctype: "Procurement Orders", name: "PO-TEST-1" }]);

    render(null);
    expect(socket.sentNamed("doc_unsubscribe")).toEqual([["doc_unsubscribe", "Procurement Orders", "PO-TEST-1"]]);
    expect(socket.sentNamed("doc_close")).toEqual([["doc_close", "Procurement Orders", "PO-TEST-1"]]);
  });

  it("opens and closes the document only for listeners that ask to", () => {
    render(
      <>
        <DocWatcher key="a" docname="PO-TEST-1" onUpdate={() => undefined} openClose={false} />
        <DocWatcher key="b" docname="PO-TEST-1" onUpdate={() => undefined} />
      </>,
    );
    render(<DocWatcher key="a" docname="PO-TEST-1" onUpdate={() => undefined} openClose={false} />);

    expect(socket.sentNamed("doc_open")).toHaveLength(1);
    expect(socket.sentNamed("doc_close")).toHaveLength(1);
    expect(socket.sentNamed("doc_unsubscribe")).toEqual([]);
  });

  it("shows the viewers the server lists for its own document only", () => {
    render(<DocWatcher docname="PO-TEST-1" onUpdate={() => undefined} />);
    act(() => {
      socket.serverSends("doc_viewers", { doctype: "Procurement Orders", docname: "PO-TEST-2", users: ["x@example.test"] });
      socket.serverSends("doc_viewers", { doctype: "Procurement Orders", docname: "PO-TEST-1", users: ["a@example.test", "b@example.test"] });
    });

    expect(container.textContent).toBe("a@example.test,b@example.test");
  });
});
