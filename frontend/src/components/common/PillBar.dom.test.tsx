// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PillBar } from "./PillBar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PILLS = [
    { key: "apples", label: "Apples" },
    { key: "pears", label: "Pears" },
] as const;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe("PillBar", () => {
    it("shows each pill in order, the chosen one pressed, and reports the pill clicked", () => {
        const chosen: string[] = [];
        act(() => root.render(<PillBar pills={PILLS} value="pears" onChange={(key) => chosen.push(key)} />));
        const buttons = [...container.querySelectorAll("button")];

        expect(buttons.map((b) => b.textContent)).toEqual(["Apples", "Pears"]);
        expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);

        act(() => buttons[0].click());
        expect(chosen).toEqual(["apples"]);
    });
});
