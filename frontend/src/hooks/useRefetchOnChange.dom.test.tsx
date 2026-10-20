// @vitest-environment jsdom
//
// The defect: Project Payment & Expense remounted its whole tab after a New Expense submit, so the
// table lost its filters and page. A changed key must refetch the data, and only then.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRefetchOnChange } from "./useRefetchOnChange";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Table({ version, refetch }: { version: number; refetch: () => void }) {
    useRefetchOnChange(version, refetch);
    return <input data-testid="filter" />;
}

describe("useRefetchOnChange", () => {
    let container: HTMLDivElement;
    let root: Root;
    const render = (version: number, refetch: () => void) =>
        act(() => root.render(<Table version={version} refetch={refetch} />));

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("does not refetch on mount, nor on a re-render with the same key", () => {
        const refetch = vi.fn();
        render(0, refetch);
        render(0, vi.fn());
        expect(refetch).not.toHaveBeenCalled();
    });

    it("refetches once per change, with the latest refetch, keeping the table mounted", () => {
        const first = vi.fn();
        const latest = vi.fn();
        render(0, first);
        const filter = container.querySelector('[data-testid="filter"]');
        render(1, latest);
        expect(first).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="filter"]')).toBe(filter);
    });
});
