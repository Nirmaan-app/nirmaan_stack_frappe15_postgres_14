// @vitest-environment jsdom
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BillCheckResultCell, FileLinkCell, MoneyCell } from "./ExpenseBillCells";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

const show = (el: ReactElement) => {
    act(() => root.render(el));
    return container;
};

describe("the expense bill tables' shared cells", () => {
    it("show money in whole rupees on the right, and a dash for none", () => {
        const cell = show(<MoneyCell value={1180.4} />).firstElementChild!;
        expect(cell.textContent).toBe("₹1,180");
        expect(cell.className).toContain("text-right");
        expect(show(<MoneyCell value={null} />).textContent).toBe("--");
    });

    it("open a file, and offer nothing to open without one", () => {
        expect(show(<FileLinkCell file="/private/files/bill.pdf" />).querySelector("a")?.getAttribute("href")).toContain("/private/files/bill.pdf");
        expect(show(<FileLinkCell file="/private/files/p.pdf" label="Open" />).textContent).toBe("Open");
        const none = show(<FileLinkCell file={null} />);
        expect(none.querySelector("a")).toBeNull();
        expect(none.textContent).toBe("--");
    });

    it("show a Bill check's result over its reason", () => {
        expect(show(<BillCheckResultCell row={{ bill_check: "Mismatched", bill_check_reason: "Totals differ." }} />).textContent)
            .toBe("MismatchedTotals differ.");
        expect(show(<BillCheckResultCell row={{ bill_check: "Matched", bill_check_reason: null }} />).textContent).toBe("Matched");
    });
});
