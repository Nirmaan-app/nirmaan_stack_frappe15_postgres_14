// @vitest-environment jsdom
//
// The Customers list never asks the server for its cached page (#1729). The data-table endpoint keeps a page it
// served for 5 minutes when asked to (`to_cache`), and a live refresh or a page-back then gets that old page, so a
// customer renamed elsewhere kept its old name on an open list. The page is rendered whole, with only the network
// faked, and the test reads what the list sends.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import CustomersPage from "./customers";

class StubResizeObserver {
    observe() { /* no layout in jsdom */ }
    unobserve() { /* no layout in jsdom */ }
    disconnect() { /* no layout in jsdom */ }
}
if (!Reflect.has(globalThis, "ResizeObserver")) Reflect.set(globalThis, "ResizeObserver", StubResizeObserver);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const LIST_ENDPOINT = "nirmaan_stack.api.data-table.get_list_with_count_enhanced";
const listRequests: Array<Record<string, unknown>> = [];

vi.mock("frappe-react-sdk", async (importOriginal) => {
    const idle = { data: undefined, isLoading: false, error: undefined, mutate: () => Promise.resolve() };
    return {
        // The real SDK under the mocks: `@/lib/frappe` reads every SDK hook when it loads. vitest loads the SDK's
        // CommonJS build, whose exports sit under `default`.
        ...(await importOriginal<{ default: object }>()).default,
        useFrappeGetCall: () => idle,
        useFrappeGetDocList: () => ({ ...idle, data: [] }),
        useFrappeGetDoc: () => idle,
        useFrappePostCall: (method: string) => ({
            call: (payload: Record<string, unknown>) => {
                if (method === LIST_ENDPOINT) listRequests.push(payload);
                return Promise.resolve({ message: { data: [], total_count: 0 } });
            },
            loading: false,
            reset: () => undefined,
        }),
        useSWRConfig: () => ({ mutate: () => Promise.resolve() }),
    };
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    listRequests.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

it("the Customers list asks the server for a fresh page, never its cached one", async () => {
    act(() => root.render(<MemoryRouter><CustomersPage /></MemoryRouter>));
    // Short act steps, so each render (and the fetch it starts) happens as it would in the browser.
    for (let i = 0; i < 50 && listRequests.length === 0; i++) await act(() => sleep(10));

    expect(listRequests.length).toBeGreaterThan(0);
    for (const request of listRequests) expect(request.to_cache).toBeFalsy();
});
