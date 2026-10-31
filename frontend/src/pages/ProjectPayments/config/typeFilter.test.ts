import { describe, expect, it } from "vitest";

import { orderTypeOptions, typeFilterLabel } from "./typeFilter";

describe("typeFilterLabel", () => {
  it("names the four types, the reimbursement option and the two fixed narrower options", () => {
    expect(typeFilterLabel("SR Payment")).toBe("WO Payment");
    expect(typeFilterLabel("Non-Project")).toBe("Non Project Expense");
    expect(typeFilterLabel("Reimbursement")).toBe("Non Project – Reimbursement");
    expect(typeFilterLabel("SR Payment:GST")).toBe("WO Payment – GST");
    expect(typeFilterLabel("PO Payment:Cheque")).toBe("PO Payment – Cheque");
  });

  it("names an expense type under its ledger", () => {
    expect(typeFilterLabel("Project Expense:Petty Cash")).toBe("Project Expense – Petty Cash");
    expect(typeFilterLabel("Non-Project:Petty Cash")).toBe("Non Project – Petty Cash");
  });
});

describe("orderTypeOptions — the top five, then the narrower options one by one", () => {
  it("puts the fixed top first and each expense-type set after it, keeping the server's order inside a set", () => {
    // As the server sends them: the types by count, then the narrower options by count.
    const arrived = [
      "PO Payment", "Project Expense", "SR Payment", "Non-Project", "Reimbursement",
      "Project Expense:Material Transportation", "Non-Project:Rent", "Project Expense:Petty Cash",
      "PO Payment:Cheque", "SR Payment:GST", "Non-Project:Petty Cash",
    ].map((value) => ({ value }));
    expect(orderTypeOptions(arrived).map((o) => o.value)).toEqual([
      "SR Payment", "PO Payment", "Project Expense", "Non-Project", "Reimbursement",
      "SR Payment:GST", "PO Payment:Cheque",
      "Project Expense:Material Transportation", "Project Expense:Petty Cash",
      "Non-Project:Rent", "Non-Project:Petty Cash",
    ]);
  });

  it("leaves out nothing it does not know, and puts it last", () => {
    expect(orderTypeOptions([{ value: "Vendor Payment" }, { value: "SR Payment" }]).map((o) => o.value))
      .toEqual(["SR Payment", "Vendor Payment"]);
  });
});
