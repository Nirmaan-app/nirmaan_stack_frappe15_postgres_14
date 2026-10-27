/**
 * boqSelection.test.ts -- the Won project's Selected / Other split and its confirm wording (ADR-0037).
 */

import { describe, it, expect } from "vitest";
import {
  leavesNoSelectedBoq,
  selectionActionLabel,
  selectionConfirmCopy,
  splitWonProjectBoqs,
} from "./boqSelection";

describe("splitWonProjectBoqs", () => {
  it("puts only Selected BoQs in the Selected table and keeps the order", () => {
    const rows = [
      { name: "A", status: "Draft" },
      { name: "B", status: "Selected" },
      { name: "C", status: "Approved" },
      { name: "D", status: "Selected" },
      { name: "E", status: "Superseded" },
      { name: "F", status: null },
    ];
    const { selected, other } = splitWonProjectBoqs(rows);
    expect(selected.map((r) => r.name)).toEqual(["B", "D"]);
    expect(other.map((r) => r.name)).toEqual(["A", "C", "E", "F"]);
  });

  it("returns two empty tables for no BoQs", () => {
    expect(splitWonProjectBoqs([])).toEqual({ selected: [], other: [] });
  });
});

describe("leavesNoSelectedBoq", () => {
  it("is true only when Move to Draft takes every Selected BoQ", () => {
    expect(leavesNoSelectedBoq("Draft", 2, 2)).toBe(true);
    expect(leavesNoSelectedBoq("Draft", 1, 2)).toBe(false);
    expect(leavesNoSelectedBoq("Selected", 3, 0)).toBe(false);
    expect(leavesNoSelectedBoq("Draft", 0, 0)).toBe(false);
  });
});

describe("selectionActionLabel", () => {
  it("names each table's one action", () => {
    expect(selectionActionLabel("Selected")).toBe("Mark as Selected");
    expect(selectionActionLabel("Draft")).toBe("Move to Draft");
  });
});

describe("selectionConfirmCopy", () => {
  it("counts the BoQs in the title", () => {
    expect(selectionConfirmCopy("Selected", 1, false).title).toBe("Move 1 BoQ to Selected?");
    expect(selectionConfirmCopy("Selected", 3, false).title).toBe("Move 3 BoQs to Selected?");
    expect(selectionConfirmCopy("Draft", 2, false).title).toBe("Move 2 BoQs to Draft?");
  });

  it("switches to the warning when the move empties the Selected table", () => {
    const copy = selectionConfirmCopy("Draft", 2, true);
    expect(copy.title).toBe("Move 2 BoQs to Draft and leave no Selected BoQ?");
    expect(copy.description).toContain("no Selected BoQ");
    expect(copy.description).toContain("Only an Admin");
  });
});
