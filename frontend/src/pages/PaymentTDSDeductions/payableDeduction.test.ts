import { describe, expect, it } from "vitest";

import { canPayDeduction } from "./payableDeduction";

describe("canPayDeduction (Pay TDS takes tax only from Paid payments, story 39; walk W9)", () => {
  it("lets a Pending deduction of a Paid payment be ticked", () => {
    expect(canPayDeduction({ status: "Pending", project_payment: "PAY-1" }, "Paid")).toBe(true);
  });

  it("does not let one whose payment is not Paid yet, or whose status is still loading, be ticked", () => {
    expect(canPayDeduction({ status: "Pending", project_payment: "PAY-1" }, "Approved")).toBe(false);
    expect(canPayDeduction({ status: "Pending", project_payment: "PAY-1" }, undefined)).toBe(false);
  });

  it("keeps an Office Rent row payable from approval on (spec #1522): it names no payment", () => {
    expect(canPayDeduction({ status: "Pending", non_project_expense: "NPE-1" }, undefined)).toBe(true);
  });

  it("never lets a deduction already paid, or a blank status read as Pending, slip the rule", () => {
    expect(canPayDeduction({ status: "Paid", project_payment: "PAY-1" }, "Paid")).toBe(false);
    expect(canPayDeduction({ status: "", project_payment: "PAY-1" }, "Paid")).toBe(true);
  });
});
