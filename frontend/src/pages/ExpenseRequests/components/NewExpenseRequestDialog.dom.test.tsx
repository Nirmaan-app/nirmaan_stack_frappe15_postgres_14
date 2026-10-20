// @vitest-environment jsdom
//
// The first amount typed right after picking a type lands in Amount (spec #1494).
//
// Seen in the browser: a pick re-renders the whole form, and while that render ran the digits typed
// next were dispatched to the type picker, which still held focus; Amount got focus only afterwards,
// from a timer, and stayed empty. So the pick must hand focus to Amount in the SAME event: the test
// asserts where focus is the moment the click on the option returns, before any timer has run.
//
// The server is stubbed at `frappe-react-sdk`, the one boundary every hook here calls through.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDialogStore } from "@/zustand/useDialogStore";
import type { ExpenseRequest, GetRequestCatalogResponse } from "@/types/NirmaanStack/ExpenseRequest";
import { NewExpenseRequestDialog } from "./NewExpenseRequestDialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ONLY = { has_format: false, payee_rule: "Not asked" };
const CATALOG = {
    categories: [{
        category: "Staff",
        reviewer_role: null,
        types: [
            { expense_type: "Travel Expenses (Bus)", project: false, non_project: true,
              project_allowed: false, project_required: false, ...ONLY },
            { expense_type: "Labour Charges", project: true, non_project: false,
              project_allowed: true, project_required: true, ...ONLY },
        ],
    }],
    records_without_review: false,
} as unknown as GetRequestCatalogResponse;

vi.mock("frappe-react-sdk", async (importOriginal) => ({
    ...(await importOriginal<typeof import("frappe-react-sdk")>()),
    useFrappeGetCall: (method: string) => ({
        data: method.endsWith("get_request_catalog") ? { message: CATALOG } : undefined,
        isLoading: false,
        error: undefined,
        mutate: vi.fn(),
    }),
    useFrappePostCall: () => ({ call: vi.fn(), loading: false }),
    useFrappeFileUpload: () => ({ upload: vi.fn() }),
    useFrappeGetDoc: () => ({ data: undefined, isLoading: false, error: undefined }),
    useFrappeGetDocList: () => ({ data: [], isLoading: false, error: undefined, mutate: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useDialogStore.setState({ newExpenseRequestDialog: true });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
});

const amountInput = () => document.querySelector<HTMLInputElement>('input[type="number"]')!;
const typePicker = () => document.querySelector<HTMLInputElement>('input[role="combobox"]')!;

describe("New Expense: picking a type", () => {
    it("hands focus to Amount within the pick itself, so the next key typed lands there", () => {
        act(() => {
            root.render(<MemoryRouter><NewExpenseRequestDialog /></MemoryRouter>);
        });

        // Open the picker the way a user does: press on it.
        const control = typePicker().closest('[class*="control"]') ?? typePicker().parentElement!;
        act(() => {
            control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        });
        const option = Array.from(document.querySelectorAll<HTMLElement>('[id*="-option-"]'))
            .find((el) => el.textContent?.includes("Travel Expenses (Bus)"));
        expect(option).toBeTruthy();

        act(() => {
            option!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
            option!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
            option!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
        });

        expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Travel Expenses (Bus)");
        expect(document.activeElement).toBe(amountInput());
    });
});

describe("Edit request: a saved request with no vendor", () => {
    it("shows the Vendor field empty, not \"Others (No Vendor)\"", () => {
        const editing = {
            name: "EXR-TEST-1", type: "Labour Charges", projects: "PROJ-TEST", projects_name: "Test Project",
            amount: 500, vendor: null, comment: null, source_data: null, status: "Pending Approval",
            owner: "pm@example.com", creation: "2026-10-20 10:00:00", modified: "2026-10-20 10:00:00",
        } as unknown as ExpenseRequest;
        useDialogStore.setState({ newExpenseRequestDialog: false });
        act(() => {
            root.render(<MemoryRouter><NewExpenseRequestDialog editing={editing} /></MemoryRouter>);
        });

        const dialog = document.querySelector('[role="alertdialog"]')!;
        expect(dialog.textContent).toContain("Test Project");
        expect(dialog.textContent).toContain("Search vendors");
        expect(dialog.textContent).not.toContain("Others (No Vendor)");
    });
});
