// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { BrowserRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { urlStateManager } from "@/utils/urlStateManager";

import { useUrlParam } from "./useUrlParam";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let container: HTMLDivElement;
let root: Root;
let navigateTo: (to: string) => void = () => {};

/** One planning tab: shows the date filter it reads from the URL. */
const Probe = () => <span>{useUrlParam("planningDuration") ?? "none"}</span>;

/** The planning tab switcher: only the picked tab is mounted, as in SevenDayPlanningTab. */
const Page = ({ tab }: { tab: "material" | "cashflow" }) => {
  navigateTo = useNavigate();
  return tab === "material" ? <Probe key="material" /> : <Probe key="cashflow" />;
};

const render = (tab: "material" | "cashflow") => act(() => root.render(<BrowserRouter><Page tab={tab} /></BrowserRouter>));

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  window.history.replaceState({}, "", "/");
});

describe("useUrlParam", () => {
  it("keeps All Time after a tab switch when the page was opened on a custom range", () => {
    // 1. The page is opened with a custom range in the URL (the router's copy holds it).
    window.history.pushState({}, "", "/projects/P1?planningDuration=custom&startDate=2026-12-01&endDate=2026-12-10");
    render("material");
    expect(container.textContent).toBe("custom");

    // 2. All Time is picked: a replaceState write the router never sees.
    act(() => urlStateManager.updateParam("planningDuration", "All"));
    expect(container.textContent).toBe("All");

    // 3. Another planning tab mounts: it must read All, not the router's stale "custom".
    render("cashflow");
    expect(container.textContent).toBe("All");
  });

  it("still follows a navigate() to a new value", () => {
    window.history.pushState({}, "", "/projects/P1?planningDuration=7");
    render("material");
    expect(container.textContent).toBe("7");

    act(() => navigateTo("/projects/P1?planningDuration=14"));
    expect(container.textContent).toBe("14");
  });

  it("follows a navigate() back to the same search after a replaceState write", () => {
    window.history.pushState({}, "", "/projects/P1?planningDuration=7");
    render("material");
    act(() => urlStateManager.updateParam("planningDuration", "All"));
    expect(container.textContent).toBe("All");

    act(() => navigateTo("/projects/P1?planningDuration=7"));
    expect(container.textContent).toBe("7");
  });
});
