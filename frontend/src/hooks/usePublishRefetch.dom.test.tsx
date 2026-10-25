// @vitest-environment jsdom
//
// The defect: Project Payment & Expense remounted its whole tab after a New Expense submit, so the
// table lost its filters and page. The submit handler must refetch the open table's rows, and only then.
import { useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePublishRefetch, type RefetchRef } from "./usePublishRefetch";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Table({ refetchRef, refetch }: { refetchRef: RefetchRef; refetch: () => void }) {
    usePublishRefetch(refetchRef, refetch);
    return <input data-testid="filter" />;
}

function Page({ refetch, showTable = true }: { refetch: () => void; showTable?: boolean }) {
    const refetchRef = useRef<(() => void) | null>(null);
    return (
        <>
            {showTable && <Table refetchRef={refetchRef} refetch={refetch} />}
            <button data-testid="submit" onClick={() => refetchRef.current?.()} />
        </>
    );
}

describe("usePublishRefetch", () => {
    let container: HTMLDivElement;
    let root: Root;
    const render = (el: JSX.Element) => act(() => root.render(el));
    const submit = () => act(() => {
        (container.querySelector('[data-testid="submit"]') as HTMLButtonElement).click();
    });

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("does not refetch on mount or on a re-render", () => {
        const refetch = vi.fn();
        render(<Page refetch={refetch} />);
        render(<Page refetch={refetch} />);
        expect(refetch).not.toHaveBeenCalled();
    });

    it("refetches once per submit, with the latest refetch, keeping the table mounted", () => {
        const first = vi.fn();
        const latest = vi.fn();
        render(<Page refetch={first} />);
        const filter = container.querySelector('[data-testid="filter"]');
        render(<Page refetch={latest} />);

        submit();

        expect(first).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="filter"]')).toBe(filter);
    });

    it("calls nothing once the table is gone", () => {
        const refetch = vi.fn();
        render(<Page refetch={refetch} />);
        render(<Page refetch={refetch} showTable={false} />);

        submit();

        expect(refetch).not.toHaveBeenCalled();
    });
});
