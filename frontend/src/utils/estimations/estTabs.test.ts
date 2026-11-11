import { describe, expect, it } from "vitest";

import { DEFAULT_EST_TAB, EST_TABS, toEstTab } from "./estTabs";

describe("Estimates sub-tabs", () => {
  it("lists BOQ View, Line Item View and Estimate Items in that order", () => {
    expect(EST_TABS.map((tab) => tab.label)).toEqual(["BOQ View", "Line Item View", "Estimate Items"]);
  });

  it("opens BOQ View by default", () => {
    expect(DEFAULT_EST_TAB).toBe("boq-view");
  });

  it("reads each known URL value as itself", () => {
    for (const tab of EST_TABS) {
      expect(toEstTab(tab.value)).toBe(tab.value);
    }
  });

  it("opens the first sub-tab for a missing, unknown or differently cased value", () => {
    for (const value of [null, undefined, "", "boq", "BOQ-VIEW", "line items"]) {
      expect(toEstTab(value)).toBe("boq-view");
    }
  });
});
