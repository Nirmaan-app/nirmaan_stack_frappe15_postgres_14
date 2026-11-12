// @vitest-environment jsdom
/**
 * The project page's Estimates tab: which sub-tab opens, who may edit (an editing profile on a project that is not
 * Completed / Handover), the read-only note, the empty and error states, and Open line jumping to Line Item View.
 * The panels are stood in for (each has its own tests); the URL parameters live in memory.
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PanelProps } from "./components/panelTypes";

const state = vi.hoisted(() => ({
  params: {} as Record<string, string | null>,
  user: { role: "Nirmaan Estimates Executive Profile", user_id: "made-up@example.com" } as { role: string; user_id: string },
  overview: { boqs: [] as unknown[] } as { boqs: unknown[] } | undefined,
  isLoading: false,
  error: undefined as unknown,
  mutate: vi.fn(),
  panel: null as PanelProps | null,
  dialog: null as { afterSave: () => void } | null,
  pageParam: vi.fn(),
}));
const stand = vi.hoisted(() => ({
  panel: (name: string) => (p: PanelProps) => { state.panel = p; return <div data-panel={name}>{name}</div>; },
}));

vi.mock("./hooks/useUrlParam", async () => {
  const { useReducer } = await import("react");
  const listeners = new Set<() => void>();
  return {
    useUrlParamState: (key: string) => {
      const [, rerender] = useReducer((n: number) => n + 1, 0);
      listeners.add(rerender);
      return [state.params[key] ?? null, (v: string | null) => { state.params[key] = v; listeners.forEach((l) => l()); }];
    },
  };
});
vi.mock("@/hooks/useUserData", () => ({ useUserData: () => state.user }));
vi.mock("@/utils/urlStateManager", () => ({ urlStateManager: { updateParam: state.pageParam, getParam: () => null } }));
vi.mock("./hooks/useEstimatesData", () => ({
  useEstimatesOverview: () => ({ overview: state.overview, isLoading: state.isLoading, error: state.error, mutate: state.mutate }),
}));
vi.mock("./components/BoqViewPanel", () => ({ BoqViewPanel: stand.panel("BOQ View") }));
vi.mock("./components/LineItemViewPanel", () => ({ LineItemViewPanel: stand.panel("Line Item View") }));
vi.mock("./components/EstimateItemsPanel", () => ({ EstimateItemsPanel: stand.panel("Estimate Items") }));
vi.mock("./components/MaterialEstimateDialog", () => ({
  MaterialEstimateDialog: ({ target }: { target: { afterSave: () => void } }) => { state.dialog = target; return <div data-dialog="open" />; },
}));

import EstimatesProjectTab from "./EstimatesProjectTab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOQ = { name: "BOQ-A", boq_name: "Made-up BOQ A", sheets: [{ name: "SH", sheet_name: "Made-up sheet", line_items: 1, estimated: 0, older: 0 }] };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  state.params = {};
  state.user = { role: "Nirmaan Estimates Executive Profile", user_id: "made-up@example.com" };
  state.overview = { boqs: [BOQ] };
  state.isLoading = false;
  state.error = undefined;
  state.panel = null;
  state.dialog = null;
  state.pageParam.mockReset();
});
afterEach(() => act(() => root.unmount()));

const render = (projectStatus: string | null = "WIP") =>
  act(() => root.render(<EstimatesProjectTab projectId="PROJ-1" projectStatus={projectStatus} />));
const panel = () => container.querySelector("[data-panel]")?.textContent ?? null;
const tabs = () => [...container.querySelectorAll('[role="tab"]')];

describe("EstimatesProjectTab", () => {
  it("shows the three sub-tabs and opens BOQ View for a missing or unknown estTab", () => {
    render();
    expect(tabs().map((t) => t.textContent)).toEqual(["BOQ View", "Line Item View", "Estimate Items"]);
    expect(panel()).toBe("BOQ View");
    state.params.estTab = "Estimate-Items";
    render();
    expect(panel()).toBe("BOQ View");
  });

  it("switches sub-tab through the URL", () => {
    render();
    act(() => (tabs()[2] as HTMLButtonElement).click());
    expect([state.params.estTab, panel()]).toEqual(["estimate-items", "Estimate Items"]);
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
  });

  it.each([
    ["Nirmaan Admin Profile", "x@example.com", "WIP", true],
    ["Nirmaan PMO Executive Profile", "x@example.com", "WIP", true],
    ["Nirmaan Estimates Executive Profile", "x@example.com", "WIP", true],
    ["", "Administrator", "WIP", true],
    ["Nirmaan Project Lead Profile", "x@example.com", "WIP", false],
    ["Nirmaan Procurement Executive Profile", "x@example.com", "WIP", false],
    ["Loading", "x@example.com", "WIP", false],
    ["Nirmaan Admin Profile", "x@example.com", "Completed", false],
    ["Nirmaan Admin Profile", "x@example.com", "Handover", false],
  ])("%s (%s) on a %s project may edit: %s", (role, user_id, status, canEdit) => {
    state.user = { role, user_id };
    render(status);
    expect(state.panel!.canEdit).toBe(canEdit);
  });

  it("tells an editor why a Completed project is read-only, and says nothing to a viewer", () => {
    render("Completed");
    expect(container.textContent).toContain("Material estimates are read-only on a Completed project.");
    state.user = { role: "Nirmaan Project Lead Profile", user_id: "x@example.com" };
    render("Completed");
    expect(container.textContent).not.toContain("read-only");
  });

  it("says when the project has no Selected BOQ, and opens the BoQ tab", () => {
    state.overview = { boqs: [] };
    render();
    expect(container.textContent).toContain("No Selected BOQ on this project.");
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Open the BoQ tab")!.click());
    expect(state.pageParam).toHaveBeenCalledWith("page", "boq");
  });

  it("shows loading and error states instead of a panel", () => {
    state.isLoading = true;
    render();
    expect([panel(), container.textContent?.includes("Loading the project's BOQs")]).toEqual([null, true]);
    state.isLoading = false;
    state.error = new Error("made-up");
    render();
    expect([panel(), container.textContent?.includes("could not be loaded")]).toEqual([null, true]);
  });

  it("picking a BOQ or sheet clears the deeper choices; Open line jumps to Line Item View on that row", () => {
    state.params = { estBoq: "BOQ-A", estSheet: "Made-up sheet", estRow: "10" };
    render();
    expect([state.panel!.boq?.name, state.panel!.sheetName, state.panel!.focusRow]).toEqual(["BOQ-A", "Made-up sheet", "10"]);
    act(() => state.panel!.onSheet("Other"));
    expect([state.params.estSheet, state.params.estRow]).toEqual(["Other", null]);
    act(() => state.panel!.onBoq(null));
    expect([state.params.estBoq, state.params.estSheet, state.params.estRow]).toEqual([null, null, null]);
    act(() => state.panel!.onOpenLine("Made-up sheet", 14));
    expect(state.params).toMatchObject({ estBoq: "BOQ-A", estSheet: "Made-up sheet", estRow: "14", estTab: "line-item-view" });
    expect(panel()).toBe("Line Item View");
  });

  it("opens the form, and after a save focuses the saved line", () => {
    render();
    const afterSave = vi.fn();
    act(() => state.panel!.onEdit({ boq: "BOQ-A", node: "L1", sheetName: "Made-up sheet", excelRow: 10, slNo: null,
      description: null, unit: null, qty: null, afterSave }));
    expect(container.querySelector("[data-dialog]")).not.toBeNull();
    act(() => state.dialog!.afterSave());
    expect(afterSave).toHaveBeenCalledTimes(1);
    expect(state.params.estRow).toBe("10");  // the saved line is expanded and scrolled to
    act(() => state.panel!.onCountsChanged());
    expect(state.mutate).toHaveBeenCalled();
  });
});
