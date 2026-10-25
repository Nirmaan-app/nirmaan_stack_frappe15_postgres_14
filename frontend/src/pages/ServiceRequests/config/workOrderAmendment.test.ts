import { describe, expect, it } from "vitest";
import { amendBlockedReason, workOrderBadge } from "./workOrderAmendment";

describe("workOrderBadge", () => {
  it("marks a Work Order under amendment", () => {
    expect(workOrderBadge({ status: "Amendment", is_finalized: 0 })).toBe("Under amendment");
  });

  it("tells a Finalized one from an Approved one", () => {
    expect(workOrderBadge({ status: "Approved", is_finalized: 1 })).toBe("Finalized");
    expect(workOrderBadge({ status: "Approved", is_finalized: 0 })).toBe("Approved");
  });
});

describe("amendBlockedReason", () => {
  it("names every payment that is neither Paid nor Rejected", () => {
    expect(
      amendBlockedReason([
        { name: "PAY-1", status: "Requested" },
        { name: "PAY-2", status: "Paid" },
        { name: "PAY-3", status: "CEO Pending" },
        { name: "PAY-4", status: "Rejected" },
        { name: "PAY-5", status: "Approved" },
        { name: "PAY-6", status: "Reconciliation Pending" },
      ])
    ).toBe(
      "Can't amend while a payment is neither Paid nor Rejected: PAY-1 (Requested), PAY-3 (CEO Pending), " +
        "PAY-5 (Approved), PAY-6 (Reconciliation Pending)."
    );
  });

  it("lets Amend start when every payment is settled, or there are none", () => {
    expect(amendBlockedReason([{ name: "PAY-2", status: "Paid" }, { name: "PAY-4", status: "Rejected" }])).toBeNull();
    expect(amendBlockedReason([])).toBeNull();
    expect(amendBlockedReason(undefined)).toBeNull();
  });
});
