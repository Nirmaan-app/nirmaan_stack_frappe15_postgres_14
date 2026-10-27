import { describe, expect, it } from "vitest";

import { deliveryStatus, filterPlansByDeliveryStatus } from "./deliveryStatusFilter";

const plans = [
  { name: "a", delivery_status: "Delivered" },
  { name: "b", delivery_status: "Partially Delivered" },
  { name: "c", delivery_status: "Not Delivered" },
  { name: "d", delivery_status: "" },
  { name: "e", delivery_status: null },
  { name: "f" },
];
const names = (out?: { name: string }[]) => (out ?? []).map((p) => p.name);

describe("deliveryStatus", () => {
  it("counts an empty status as Not Delivered", () => {
    expect(deliveryStatus("")).toBe("Not Delivered");
    expect(deliveryStatus(null)).toBe("Not Delivered");
    expect(deliveryStatus(undefined)).toBe("Not Delivered");
    expect(deliveryStatus("Delivered")).toBe("Delivered");
  });
});

describe("filterPlansByDeliveryStatus", () => {
  it("keeps everything (same array) when nothing is selected", () => {
    expect(filterPlansByDeliveryStatus(plans, new Set())).toBe(plans);
  });

  it("passes a missing list through", () => {
    expect(filterPlansByDeliveryStatus(undefined, new Set(["Delivered"]))).toBeUndefined();
  });

  it("keeps only the selected statuses, empty ones under Not Delivered", () => {
    expect(names(filterPlansByDeliveryStatus(plans, new Set(["Delivered"])))).toEqual(["a"]);
    expect(names(filterPlansByDeliveryStatus(plans, new Set(["Not Delivered"])))).toEqual(["c", "d", "e", "f"]);
    expect(names(filterPlansByDeliveryStatus(plans, new Set(["Partially Delivered", "Delivered"])))).toEqual(["a", "b"]);
  });

  it("keeps the list order and never mutates the input", () => {
    const before = JSON.stringify(plans);
    expect(names(filterPlansByDeliveryStatus(plans, new Set(["Not Delivered", "Delivered"])))).toEqual([
      "a",
      "c",
      "d",
      "e",
      "f",
    ]);
    expect(JSON.stringify(plans)).toBe(before);
  });
});
