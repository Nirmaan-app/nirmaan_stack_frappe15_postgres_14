import { describe, expect, it } from "vitest";

import {
  countLabel,
  forwardedToCeoNote,
  selectionBreakdown,
  selectionNoun,
  summarizeSelection,
} from "./bulkSelectionSummary";

const payment = { source: "Vendor Payment" } as const;
const projectExpense = { source: "Project Expense" } as const;
const nonProjectExpense = { source: "Non-Project" } as const;

describe("summarizeSelection", () => {
  it("counts each ledger separately and folds the two expense ones", () => {
    const mix = summarizeSelection([
      payment,
      projectExpense,
      projectExpense,
      nonProjectExpense,
    ]);
    expect(mix).toEqual({
      total: 4,
      payments: 1,
      projectExpenses: 2,
      nonProjectExpenses: 1,
      expenses: 3,
    });
  });

  it("is all zeros on an empty selection", () => {
    expect(summarizeSelection([]).total).toBe(0);
    expect(summarizeSelection([]).expenses).toBe(0);
  });
});

describe("selectionNoun", () => {
  it("says payment only when every row is one", () => {
    expect(selectionNoun(summarizeSelection([payment, payment]))).toBe("payment");
  });

  it("says expense for either expense ledger, and for both together", () => {
    expect(selectionNoun(summarizeSelection([projectExpense]))).toBe("expense");
    expect(selectionNoun(summarizeSelection([nonProjectExpense]))).toBe("expense");
    expect(selectionNoun(summarizeSelection([projectExpense, nonProjectExpense]))).toBe(
      "expense"
    );
  });

  // The whole reason this module exists: the dialog used to say "8 payments" over a
  // list of eight expenses.
  it("falls back to the neutral word on a mixed selection, never the majority ledger", () => {
    const mix = summarizeSelection([payment, projectExpense, projectExpense]);
    expect(selectionNoun(mix)).toBe("request");
  });
});

describe("countLabel", () => {
  it("agrees the noun with the count", () => {
    expect(countLabel(summarizeSelection([payment]))).toBe("1 payment");
    expect(countLabel(summarizeSelection([payment, payment]))).toBe("2 payments");
    expect(countLabel(summarizeSelection([projectExpense]))).toBe("1 expense");
  });

  it("takes an explicit count for partial results, keeping the selection's noun", () => {
    const mix = summarizeSelection([projectExpense, projectExpense, projectExpense]);
    expect(countLabel(mix, 1)).toBe("1 expense");
    expect(countLabel(mix, 2)).toBe("2 expenses");
  });
});

describe("selectionBreakdown", () => {
  it("omits every part that is zero", () => {
    const allExpenses = summarizeSelection([nonProjectExpense, nonProjectExpense]);
    // No "0 PO/SR": an expense has no parent document, and printing a zero there
    // reads like a missing value rather than an inapplicable one.
    expect(selectionBreakdown(allExpenses, 0)).toBe("2 non-project expenses");
  });

  it("names all three when the batch is mixed", () => {
    const mix = summarizeSelection([payment, projectExpense, nonProjectExpense]);
    expect(selectionBreakdown(mix, 1)).toBe(
      "1 PO/SR · 1 project expense · 1 non-project expense"
    );
  });

  it("is empty when there is nothing to say", () => {
    expect(selectionBreakdown(summarizeSelection([]), 0)).toBe("");
  });
});

describe("forwardedToCeoNote", () => {
  const po = { source: "Vendor Payment", source_type: "PO Payment" } as const;
  const wo = { source: "Vendor Payment", source_type: "SR Payment" } as const;
  const pe = { source: "Project Expense", source_type: "Project Expense" } as const;

  it("says nothing when nothing is forwarded", () => {
    expect(forwardedToCeoNote([], "₹50,000", 0)).toBe("");
  });

  it("counts every ledger, not only work orders (owner, 2026-09-19)", () => {
    expect(forwardedToCeoNote([po, po, wo, pe], "₹50,000", 1)).toBe(
      "4 requests above ₹50,000 go to the CEO next: 2 PO payments, 1 work order payment, 1 project expense." +
        " TDS on 1 work order payment is taken at CEO approval."
    );
  });

  it("names a single kind directly and mentions TDS only when there is some", () => {
    expect(forwardedToCeoNote([po, po], "₹50,000", 0)).toBe("2 PO payments above ₹50,000 go to the CEO next.");
    expect(forwardedToCeoNote([pe], "₹50,000", 0)).toBe("1 project expense above ₹50,000 goes to the CEO next.");
  });
});
