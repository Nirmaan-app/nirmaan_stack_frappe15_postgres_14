import { describe, expect, it } from "vitest";

import { MIN_UNASSIGN_DETAILS, OTHER_UNASSIGN_REASON, UNASSIGN_REASONS, isUnassignReasonValid } from "./assetUnassign";

describe("isUnassignReasonValid", () => {
  it("accepts a reason from the list, with or without details", () => {
    expect(isUnassignReasonValid("Employee left / exit", "")).toBe(true);
    expect(isUnassignReasonValid("Lost or stolen", "left in a cab")).toBe(true);
  });

  it("refuses no reason, or one not on the list", () => {
    expect(isUnassignReasonValid("", "Returned on the last day")).toBe(false);
    expect(isUnassignReasonValid(null, null)).toBe(false);
    expect(isUnassignReasonValid("aaaaaaaaaa", null)).toBe(false);
  });

  it("needs enough details with Other", () => {
    expect(isUnassignReasonValid(OTHER_UNASSIGN_REASON, "")).toBe(false);
    expect(isUnassignReasonValid(OTHER_UNASSIGN_REASON, "  too short ")).toBe(false);
    expect(isUnassignReasonValid(OTHER_UNASSIGN_REASON, "Sent to the Pune office")).toBe(true);
  });

  it("matches the server's list and minimum", () => {
    expect(UNASSIGN_REASONS).toEqual([
      "Employee left / exit",
      "Returned – no longer needed",
      "Handing over to another person",
      "Project finished – returned to store",
      "Damaged – sent for repair",
      "Lost or stolen",
      "Other",
    ]);
    expect(MIN_UNASSIGN_DETAILS).toBe(10);
  });
});
