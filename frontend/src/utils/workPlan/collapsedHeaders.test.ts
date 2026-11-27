// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allCollapsed,
  loadCollapsedHeaders,
  saveCollapsedHeaders,
  toggleAllHeaders,
  toggleHeader,
} from "./collapsedHeaders";

const sorted = (s: Set<string>) => [...s].sort();

describe("allCollapsed", () => {
  it("is false when nothing is shown", () => {
    expect(allCollapsed(new Set(["A"]), [])).toBe(false);
  });
  it("is true only when every shown header is collapsed", () => {
    expect(allCollapsed(new Set(["A", "B"]), ["A", "B"])).toBe(true);
    expect(allCollapsed(new Set(["A"]), ["A", "B"])).toBe(false);
  });
});

describe("toggleAllHeaders", () => {
  it("collapses every shown header when some are open", () => {
    expect(sorted(toggleAllHeaders(new Set(["A"]), ["A", "B", "C"]))).toEqual(["A", "B", "C"]);
  });
  it("opens every shown header when all are collapsed", () => {
    expect(sorted(toggleAllHeaders(new Set(["A", "B"]), ["A", "B"]))).toEqual([]);
  });
  it("leaves headers that are not shown as they were", () => {
    expect(sorted(toggleAllHeaders(new Set(["Hidden"]), ["A"]))).toEqual(["A", "Hidden"]);
    expect(sorted(toggleAllHeaders(new Set(["Hidden", "A"]), ["A"]))).toEqual(["Hidden"]);
  });
  it("does not change the set it was given", () => {
    const before = new Set(["A"]);
    toggleAllHeaders(before, ["A", "B"]);
    expect(sorted(before)).toEqual(["A"]);
  });
});

describe("toggleHeader", () => {
  it("collapses an open header and opens a collapsed one", () => {
    expect(sorted(toggleHeader(new Set(), "A"))).toEqual(["A"]);
    expect(sorted(toggleHeader(new Set(["A", "B"]), "A"))).toEqual(["B"]);
  });
});

describe("load/saveCollapsedHeaders", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips per project", () => {
    saveCollapsedHeaders("P1", new Set(["HVAC Ducting", "Electrical"]));
    expect(sorted(loadCollapsedHeaders("P1"))).toEqual(["Electrical", "HVAC Ducting"]);
    expect(loadCollapsedHeaders("P2").size).toBe(0);
  });

  it("removes the saved entry when nothing is collapsed", () => {
    saveCollapsedHeaders("P1", new Set(["A"]));
    saveCollapsedHeaders("P1", new Set());
    expect(window.localStorage.length).toBe(0);
  });

  it("starts empty on unreadable or wrong-shaped saved text", () => {
    window.localStorage.setItem("nirmaan.workPlan.collapsedHeaders.P1", "{not json");
    expect(loadCollapsedHeaders("P1").size).toBe(0);
    window.localStorage.setItem("nirmaan.workPlan.collapsedHeaders.P1", JSON.stringify({ a: 1 }));
    expect(loadCollapsedHeaders("P1").size).toBe(0);
    window.localStorage.setItem("nirmaan.workPlan.collapsedHeaders.P1", JSON.stringify(["A", 3, null]));
    expect(sorted(loadCollapsedHeaders("P1"))).toEqual(["A"]);
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadCollapsedHeaders("P1").size).toBe(0);
    expect(() => saveCollapsedHeaders("P1", new Set(["A"]))).not.toThrow();
  });
});
