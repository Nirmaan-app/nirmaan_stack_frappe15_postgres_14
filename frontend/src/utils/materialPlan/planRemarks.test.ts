import { describe, expect, it } from "vitest";

import { DELIVERY_STATUSES } from "./deliveryStatusFilter";
import { remarksMissing, remarksRequired, remarksToSave } from "./planRemarks";

describe("remarksRequired", () => {
  it("is required only for Partially Delivered", () => {
    expect(remarksRequired("Partially Delivered")).toBe(true);
    expect(remarksRequired("Delivered")).toBe(false);
    expect(remarksRequired("Not Delivered")).toBe(false);
  });

  it("is optional on a plan with no status yet (a new plan saves as Not Delivered)", () => {
    expect(remarksRequired("")).toBe(false);
    expect(remarksRequired(null)).toBe(false);
    expect(remarksRequired(undefined)).toBe(false);
  });

  it("needs the exact status, as the select stores it", () => {
    expect(remarksRequired("partially delivered")).toBe(false);
    expect(remarksRequired(" Partially Delivered ")).toBe(false);
  });
});

describe("remarksMissing", () => {
  it("blocks Partially Delivered with no remarks, blank or spaces only", () => {
    for (const remarks of ["", "   ", "\n\t ", null, undefined]) {
      expect(remarksMissing("Partially Delivered", remarks)).toBe(true);
    }
  });

  it("lets Partially Delivered through once there is a real note", () => {
    expect(remarksMissing("Partially Delivered", "30 of 50 bags delivered")).toBe(false);
    expect(remarksMissing("Partially Delivered", "  pending: 20 bags  ")).toBe(false);
  });

  it("never blocks the other statuses, with or without remarks", () => {
    for (const status of DELIVERY_STATUSES.filter((s) => s !== "Partially Delivered")) {
      expect(remarksMissing(status, "")).toBe(false);
      expect(remarksMissing(status, null)).toBe(false);
      expect(remarksMissing(status, "a note")).toBe(false);
    }
  });
});

describe("remarksToSave", () => {
  it("trims the note", () => {
    expect(remarksToSave("  Deliver to gate 2  ")).toBe("Deliver to gate 2");
    expect(remarksToSave("line one\nline two\n")).toBe("line one\nline two");
  });

  it("saves blank, spaces only or missing remarks as empty", () => {
    expect(remarksToSave("")).toBe("");
    expect(remarksToSave("   ")).toBe("");
    expect(remarksToSave(null)).toBe("");
    expect(remarksToSave(undefined)).toBe("");
  });

  it("keeps a note when the plan moves Partially Delivered -> Delivered (it used to be wiped)", () => {
    const note = "30 of 50 bags delivered";
    expect(remarksMissing("Partially Delivered", note)).toBe(false);
    // The status changes; the saved remarks do not depend on it.
    expect(remarksToSave(note)).toBe(note);
    expect(remarksMissing("Delivered", note)).toBe(false);
  });
});
