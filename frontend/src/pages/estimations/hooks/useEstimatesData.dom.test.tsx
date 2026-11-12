// @vitest-environment jsdom
/**
 * The Estimates reads and the refresh after a write. Each read is keyed so a missing BOQ or sheet fetches nothing; the
 * sheet name goes to the server verbatim (spaces kept); and a refresh after a save refetches every cached read of THAT
 * BOQ -- each sheet's and the all-sheets one Estimate Items uses -- and no other BOQ's (BOQ-1 is not BOQ-10).
 * `frappe-react-sdk` is stubbed: the hooks' own logic is what runs.
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  getCall: vi.fn(),
  mutate: vi.fn(),
  docList: vi.fn(),
}));
vi.mock("frappe-react-sdk", () => ({
  useFrappeGetCall: (...args: unknown[]) => sdk.getCall(...args),
  useFrappePostCall: () => ({ call: vi.fn(), loading: false }),
  useFrappeGetDocList: (...args: unknown[]) => sdk.docList(...args),
  useSWRConfig: () => ({ mutate: sdk.mutate }),
}));

import { useEstimates, useEstimatesOverview, useItemsCatalog, useRefreshEstimates, useSheetRows } from "./useEstimatesData";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  sdk.getCall.mockReset().mockReturnValue({ data: undefined, error: undefined, isLoading: false, mutate: vi.fn() });
  sdk.docList.mockReset().mockReturnValue({ data: undefined, isLoading: false });
  sdk.mutate.mockReset();
});
afterEach(() => act(() => root.unmount()));

function run<T>(hook: () => T): T {
  let out: T | undefined;
  function Probe() { out = hook(); return null; }
  act(() => root.render(<Probe />));
  return out as T;
}
const lastCall = () => sdk.getCall.mock.calls[sdk.getCall.mock.calls.length - 1];

describe("the reads", () => {
  it("overview: fetched for a project, nothing without one", () => {
    run(() => useEstimatesOverview("PROJ-1"));
    expect(lastCall()).toEqual(["nirmaan_stack.api.estimations.boq_view.get_estimates_overview", { project: "PROJ-1" }, undefined]);
    run(() => useEstimatesOverview(""));
    expect(lastCall()[2]).toBeNull();
  });

  it("sheet rows: through the BOQ viewer's own read, only once a BOQ and a sheet are chosen", () => {
    run(() => useSheetRows("BOQ-1", " Made-up sheet "));
    expect(lastCall()).toEqual(["nirmaan_stack.api.boq.wizard.pricing.get_priced_rows",
      { boq_name: "BOQ-1", sheet_name: " Made-up sheet " }, undefined]);
    run(() => useSheetRows(null, "Made-up sheet"));
    expect(lastCall()[2]).toBeNull();
    run(() => useSheetRows("BOQ-1", null));
    expect(lastCall()[2]).toBeNull();
    // An empty sheet name is a name ("" is not "none chosen").
    run(() => useSheetRows("BOQ-1", ""));
    expect(lastCall()[2]).toBeUndefined();
  });

  it("estimates: one key per BOQ and sheet, the sheet name sent verbatim, all sheets when none is given", () => {
    run(() => useEstimates("BOQ-1", " Made-up sheet "));
    expect(lastCall()).toEqual(["nirmaan_stack.api.estimations.boq_view.get_estimates",
      { boq: "BOQ-1", sheet_name: " Made-up sheet " }, "estimates:BOQ-1: Made-up sheet "]);
    run(() => useEstimates("BOQ-1"));
    expect(lastCall().slice(1)).toEqual([{ boq: "BOQ-1" }, "estimates:BOQ-1:*"]);
    run(() => useEstimates(null, "Made-up sheet"));
    expect(lastCall().slice(1)).toEqual([{}, null]);
  });

  it("estimates: an empty reply until the server answers", () => {
    const got = run(() => useEstimates("BOQ-1", "S"));
    expect(got.estimates).toEqual({ current: [], older: [] });
  });
});

describe("the refresh after a write", () => {
  it("refetches every cached read of that BOQ and nothing else", () => {
    const refresh = run(() => useRefreshEstimates());
    refresh("BOQ-1");
    expect(sdk.mutate).toHaveBeenCalledTimes(1);
    const matches = sdk.mutate.mock.calls[0][0] as (key: unknown) => boolean;
    const keys = ["estimates:BOQ-1:*", "estimates:BOQ-1:Made-up sheet", "estimates:BOQ-1: spaced ",
      "estimates:BOQ-10:*", "estimates:BOQ-2:Made-up sheet", "BOQ-1", ["estimates:BOQ-1:*"], null];
    expect(keys.filter(matches)).toEqual(["estimates:BOQ-1:*", "estimates:BOQ-1:Made-up sheet", "estimates:BOQ-1: spaced "]);
  });
});

describe("the Items catalog", () => {
  it("loads nothing until the form opens, then groups each category's makes once, sorted", () => {
    run(() => useItemsCatalog(false));
    expect(sdk.docList.mock.calls.map((c) => c[2])).toEqual([null, null, null]);

    sdk.docList.mockImplementation((doctype: string) => ({
      isLoading: false,
      data: doctype === "Category Makelist" ? [
        { category: "Made-up Boards", make: "Made-up make B" },
        { category: "Made-up Boards", make: "Made-up make A" },
        { category: "Made-up Boards", make: "Made-up make B" },
        { category: "Made-up Fixings", make: "" },
      ] : [],
    }));
    const catalog = run(() => useItemsCatalog(true));
    expect(sdk.docList.mock.calls.slice(-3).map((c) => c[2])).toEqual(
      ["estimates-items-catalog", "estimates-categories", "estimates-category-makes"]);
    expect(catalog.makesByCategory).toEqual({ "Made-up Boards": ["Made-up make A", "Made-up make B"] });
  });
});
