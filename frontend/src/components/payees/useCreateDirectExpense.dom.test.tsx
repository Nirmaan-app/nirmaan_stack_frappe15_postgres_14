// @vitest-environment jsdom
//
// The defect: the Add Expense dialogs' busy flag left out the payee add, so Escape or Cancel could
// close the dialog while a new Payee was being added. The close reset the choice, the add then landed
// its pick, and that stale pick survived the reopen. The dialogs block closing on this hook's
// `loading`, so it must stay true for the whole save, from the payee add to the server's reply.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADD_REQUEST_PAYEE_API } from "./usePayeeChoice";
import { CREATE_DIRECT_EXPENSE_API, useCreateDirectExpense } from "./useCreateDirectExpense";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred = { resolve: (value: unknown) => void; reject: (error: unknown) => void };
const h = vi.hoisted(() => ({ pending: {} as Record<string, Deferred> }));

// Every post call waits until the test settles it, by endpoint.
vi.mock("frappe-react-sdk", () => ({
    useFrappePostCall: (api: string) => ({
        call: () => new Promise((resolve, reject) => { h.pending[api] = { resolve, reject }; }),
        loading: false,
    }),
}));

const PAYEE = { name: "PYE-0412", account_name: "Ramesh Kumar Yadav", account_number: "36147100982211", ifsc: "SBIN0003435" };

let hook!: ReturnType<typeof useCreateDirectExpense<"Non Project Expenses">>;
function Dialog() {
    hook = useCreateDirectExpense("Non Project Expenses");
    return null;
}

/** Let pending promise callbacks run and React re-render. */
const flush = () => act(async () => { await Promise.resolve(); });

describe("useCreateDirectExpense loading", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        h.pending = {};
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<Dialog />));
        // New payee details typed in, so the save adds a Payee first.
        act(() => {
            hook.payeeChoice.setMode("new");
            hook.payeeChoice.bankForm.setField("account_name", PAYEE.account_name);
        });
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("is true from the payee add through the server's reply", async () => {
        let upload!: () => void;
        const buildExpense = () => new Promise<{ type: string }>((resolve) => { upload = () => resolve({ type: "Travel" }); });
        let saved: Promise<unknown>;
        act(() => { saved = hook.create(true, buildExpense); });

        expect(h.pending[ADD_REQUEST_PAYEE_API]).toBeDefined();
        expect(hook.loading).toBe(true); // the payee add is in flight

        await act(async () => { h.pending[ADD_REQUEST_PAYEE_API].resolve({ message: { payee: PAYEE } }); });
        expect(hook.payeeChoice.picked).toEqual({ kind: "payee", payee: PAYEE });
        expect(hook.loading).toBe(true); // the uploads are in flight

        await act(async () => { upload(); });
        expect(h.pending[CREATE_DIRECT_EXPENSE_API]).toBeDefined();
        expect(hook.loading).toBe(true); // the save is in flight

        await act(async () => { h.pending[CREATE_DIRECT_EXPENSE_API].resolve({ message: { name: "NPE-1", status: "Approved" } }); });
        await expect(saved!).resolves.toEqual({ name: "NPE-1", status: "Approved" });
        expect(hook.loading).toBe(false);
    });

    it("ends when the payee add fails", async () => {
        let failed: Promise<unknown>;
        act(() => { failed = hook.create(true, async () => ({ type: "Travel" })).catch((e: unknown) => e); });
        expect(hook.loading).toBe(true);

        await act(async () => { h.pending[ADD_REQUEST_PAYEE_API].reject(new Error("Server error")); });
        expect(await failed!).toEqual(new Error("Server error"));
        await flush();
        expect(hook.loading).toBe(false);
        expect(h.pending[CREATE_DIRECT_EXPENSE_API]).toBeUndefined();
    });
});
