// @vitest-environment jsdom
//
// A server table can listen to more than its own doctype (`alsoDoctypes`, passed from useServerDataTable's
// `liveRefreshDoctypes`): a payments table also refreshes when an expense changes. These tests pin that:
//   - a change to any listed doctype refreshes the table, through the same grouping (both at once = one refresh);
//   - a caller's new array each render does not leave and rejoin the rooms; changing the names does;
//   - unmounting leaves every room.
//
// jsdom + react-dom/client only (no @testing-library), per frontend/CODING_STANDARDS.md § Writing a test.
import { FrappeContext, type FrappeConfig } from "frappe-react-sdk";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { heldDoctypes } from "./realtime/listUpdateHub";
import { GROUP_MS, TABLE_SPREAD_MS } from "./realtime/liveRefreshController";
import { FakeSocket } from "./realtime/testing/fakeSocket";
import { useServerTableLiveRefresh, watchedDoctypes } from "./useServerTableLiveRefresh";

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const change = (doctype: string, name = "DOC-1") => ({ doctype, name, user: "someone@example.com" });

interface ProbeProps { doctype: string; alsoDoctypes?: readonly string[]; refresh: () => void }

function Probe({ doctype, alsoDoctypes, refresh }: ProbeProps) {
    useServerTableLiveRefresh({ doctype, alsoDoctypes, refresh, hasSelection: false });
    return null;
}

describe("useServerTableLiveRefresh with alsoDoctypes", () => {
    let socket: FakeSocket;
    let refresh: Mock<() => void>;
    let container: HTMLDivElement;
    let root: Root;

    const render = (props: Omit<ProbeProps, "refresh">) =>
        act(() => {
            root.render(
                <FrappeContext.Provider value={{ socket } as unknown as FrappeConfig}>
                    <Probe {...props} refresh={refresh} />
                </FrappeContext.Provider>,
            );
        });
    const receive = (doctype: string, name?: string) => act(() => { socket.receive("list_update", change(doctype, name)); });
    const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

    beforeEach(() => {
        vi.useFakeTimers();
        // The random spread's share pinned to 0, so these cases time the grouping window alone; the spread has its
        // own case at the end.
        vi.spyOn(Math, "random").mockReturnValue(0);
        socket = new FakeSocket();
        refresh = vi.fn<() => void>();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("joins the room of the table's doctype and of every extra one", () => {
        render({ doctype: "Project Payments", alsoDoctypes: ["Project Expenses", "Non Project Expenses"] });
        expect(heldDoctypes(socket).sort()).toEqual(["Non Project Expenses", "Project Expenses", "Project Payments"]);
    });

    it("refreshes for a change to an extra doctype", () => {
        render({ doctype: "Project Payments", alsoDoctypes: ["Project Expenses", "Non Project Expenses"] });
        for (const doctype of ["Project Expenses", "Non Project Expenses", "Project Payments"]) {
            refresh.mockClear();
            receive(doctype);
            wait(GROUP_MS);
            expect(refresh, doctype).toHaveBeenCalledTimes(1);
        }
    });

    it("gives one refresh when the table's doctype and an extra one change together", () => {
        render({ doctype: "Project Payments", alsoDoctypes: ["Project Expenses"] });
        receive("Project Payments");
        receive("Project Expenses");
        receive("Project Expenses", "EXP-2");
        wait(GROUP_MS);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("ignores doctypes it was not given", () => {
        render({ doctype: "Project Payments", alsoDoctypes: ["Project Expenses"] });
        receive("Non Project Expenses");
        receive("Vendors");
        wait(GROUP_MS * 3);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("keeps its rooms when the caller passes a new array with the same names", () => {
        render({ doctype: "Project Payments", alsoDoctypes: ["Project Expenses"] });
        render({ doctype: "Project Payments", alsoDoctypes: ["Project Expenses"] });
        render({ doctype: "Project Payments", alsoDoctypes: ["Project Expenses"] });
        expect(socket.count("doctype_subscribe", "Project Expenses")).toBe(1);
        expect(socket.count("doctype_unsubscribe", "Project Expenses")).toBe(0);
        expect(socket.count("doctype_unsubscribe", "Project Payments")).toBe(0);
    });

    it("leaves a room that is dropped from the list and joins one that is added", () => {
        render({ doctype: "Project Payments", alsoDoctypes: ["Project Expenses"] });
        render({ doctype: "Project Payments", alsoDoctypes: ["Non Project Expenses"] });
        expect(heldDoctypes(socket).sort()).toEqual(["Non Project Expenses", "Project Payments"]);
        receive("Project Expenses");
        wait(GROUP_MS * 3);
        expect(refresh).not.toHaveBeenCalled();
        receive("Non Project Expenses");
        wait(GROUP_MS);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("joins a room once when a doctype is listed twice", () => {
        render({ doctype: "Project Payments", alsoDoctypes: ["Project Payments", "Project Expenses", "Project Expenses", ""] });
        expect(socket.count("doctype_subscribe", "Project Payments")).toBe(1);
        expect(socket.count("doctype_subscribe", "Project Expenses")).toBe(1);
        expect(socket.sent.filter(([event]) => event === "doctype_subscribe")).toHaveLength(2);
    });

    it("leaves every room on unmount", () => {
        render({ doctype: "Project Payments", alsoDoctypes: ["Project Expenses", "Non Project Expenses"] });
        act(() => root.unmount());
        root = createRoot(container); // afterEach unmounts again
        expect(heldDoctypes(socket)).toEqual([]);
        receive("Project Expenses");
        wait(GROUP_MS * 3);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("still listens to the table's own doctype alone when no extras are given", () => {
        render({ doctype: "Project Payments" });
        expect(heldDoctypes(socket)).toEqual(["Project Payments"]);
        receive("Project Payments");
        wait(GROUP_MS);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("a table waits its own random share of TABLE_SPREAD_MS, so open screens do not all ask at once", () => {
        vi.spyOn(Math, "random").mockReturnValue(0.75);
        render({ doctype: "Project Payments" });
        receive("Project Payments");
        wait(GROUP_MS + TABLE_SPREAD_MS * 0.75 - 1);
        expect(refresh).not.toHaveBeenCalled();
        wait(1);
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});

describe("watchedDoctypes", () => {
    it("puts the table's doctype first and drops blanks and repeats", () => {
        expect(watchedDoctypes("A", ["B", "A", "", "B", "C"])).toEqual(["A", "B", "C"]);
        expect(watchedDoctypes("A")).toEqual(["A"]);
        expect(watchedDoctypes("", [])).toEqual([]);
    });
});
