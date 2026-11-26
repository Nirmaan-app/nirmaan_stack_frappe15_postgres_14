import { describe, expect, it } from "vitest";
import {
  AuditInvoiceRow,
  AuditOrderRow,
  AuditPaymentRow,
  auditAgainstFor,
  auditBreakdown,
  auditColumnSpecs,
  auditIdMatches,
  auditRangeChosenAtLoad,
  compactRupees,
  sharePercent,
  auditFacetOptions,
  auditRangeLabel,
  auditTabSources,
  invoicedPercent,
  isAuditTabDisabled,
  isOrderOutsideRange,
  resolveAuditTab,
  summariseAuditInvoices,
  summariseAuditOrders,
  summariseAuditPayments,
  toAuditApiDate,
} from "./auditView";

const labels = (view: "project" | "nonproject", tab: "orders" | "invoices" | "payments") =>
  auditColumnSpecs(view, tab).map((c) => c.label);

const order = (over: Partial<AuditOrderRow> = {}): AuditOrderRow => ({
  against: "PO", id: "PO/001", project: "P1", project_name: "Alpha", vendor: "V1", vendor_name: "Acme",
  date: "2026-04-10", excl_gst: 1000, gst: 180, incl_gst: 1180, total_invoiced: 590, ...over,
});

const invoice = (over: Partial<AuditInvoiceRow> = {}): AuditInvoiceRow => ({
  against: "PO", id: "PO/001", invoice_no: "INV-1", project: "P1", project_name: "Alpha", vendor: "V1",
  vendor_name: "Acme", expense_type: null, description: null, date: "2026-04-12", invoice_amount: 500, order_date: "2026-04-10", invoice_url: null, ...over,
});

const payment = (over: Partial<AuditPaymentRow> = {}): AuditPaymentRow => ({
  against: "WO", id: "WO/001", project: "P1", project_name: "Alpha", vendor: "V1", vendor_name: "Acme",
  expense_type: null, description: null, date: "2026-04-15", utr: "UTR1", amount_paid: 900, tds: 100, net_paid: 1000,
  is_gst_payment: false, order_date: "2026-03-01", ...over,
});

describe("column sets per view and tab (exact order and labels, no status column)", () => {
  it("Orders, project view", () => {
    expect(labels("project", "orders")).toEqual([
      "Type", "Against", "Project", "Vendor", "Created date", "Excl. GST", "GST", "Incl. GST", "Total Invoiced",
    ]);
  });

  it("Invoices, project view", () => {
    expect(labels("project", "invoices")).toEqual([
      "Type", "Invoice No.", "Against", "Project", "Vendor", "Invoice date", "Invoice Amount",
    ]);
  });

  it("Invoices, non-project view has no Project / Vendor (the expense type sits under the Type pill)", () => {
    expect(labels("nonproject", "invoices")).toEqual([
      "Type", "Invoice No.", "Against", "Invoice date", "Invoice Amount",
    ]);
  });

  it("Payments, project view", () => {
    expect(labels("project", "payments")).toEqual([
      "Type", "Against", "Project", "Vendor", "Payment date", "UTR / Ref", "Amount Paid", "TDS", "Net Paid",
    ]);
  });

  it("Payments, non-project view: UTR reads Payment ref", () => {
    expect(labels("nonproject", "payments")).toEqual([
      "Type", "Against", "Payment date", "Payment ref", "Amount Paid", "TDS", "Net Paid",
    ]);
  });

  it("Orders in non-project view has no table at all", () => {
    expect(auditColumnSpecs("nonproject", "orders")).toEqual([]);
  });

  it("no table anywhere has a status column, and column keys are unique per table", () => {
    for (const view of ["project", "nonproject"] as const) {
      for (const tab of ["orders", "invoices", "payments"] as const) {
        const specs = auditColumnSpecs(view, tab);
        expect(specs.some((c) => /status/i.test(c.label) || /status/i.test(c.key))).toBe(false);
        expect(new Set(specs.map((c) => c.key)).size).toBe(specs.length);
      }
    }
  });

  it("there is no type-switch column: Type is always first, so its facet replaces the toggle", () => {
    expect(auditColumnSpecs("project", "payments")[0].key).toBe("against");
    expect(auditColumnSpecs("nonproject", "invoices")[0].key).toBe("against");
  });
});

describe("which tab opens (URL `audit_tab`)", () => {
  it("non-project view never opens Orders: it falls back to Invoices", () => {
    expect(resolveAuditTab("nonproject", "orders")).toBe("invoices");
    expect(isAuditTabDisabled("nonproject", "orders")).toBe(true);
  });

  it("project view keeps Orders", () => {
    expect(resolveAuditTab("project", "orders")).toBe("orders");
    expect(isAuditTabDisabled("project", "orders")).toBe(false);
  });

  it("a missing, empty, garbage or wrongly cased param opens the view's first usable tab", () => {
    for (const raw of [null, undefined, "", "ORDERS", "Payments", "bogus", " invoices"]) {
      expect(resolveAuditTab("project", raw)).toBe("orders");
      expect(resolveAuditTab("nonproject", raw)).toBe("invoices");
    }
  });

  it("invoices and payments survive a view switch both ways", () => {
    for (const tab of ["invoices", "payments"] as const) {
      expect(resolveAuditTab("project", tab)).toBe(tab);
      expect(resolveAuditTab("nonproject", tab)).toBe(tab);
    }
  });

  it("card subtitles say what each tab covers", () => {
    expect(auditTabSources("project", "orders")).toBe("PO + WO");
    expect(auditTabSources("project", "payments")).toBe("PO + WO + Expense");
    expect(auditTabSources("nonproject", "invoices")).toBe("Non-Project Expense");
  });
});

describe("Order outside range", () => {
  it("an order created the day before the from-date is outside", () => {
    expect(isOrderOutsideRange("2026-03-31", "2026-04-01")).toBe(true);
  });

  it("an order created ON the from-date is inside (not strictly before)", () => {
    expect(isOrderOutsideRange("2026-04-01", "2026-04-01")).toBe(false);
  });

  it("never outside with no from-date (the ALL preset)", () => {
    expect(isOrderOutsideRange("2020-01-01", undefined)).toBe(false);
    expect(isOrderOutsideRange("2020-01-01", null)).toBe(false);
    expect(isOrderOutsideRange("2020-01-01", "")).toBe(false);
  });

  it("never outside with no order date (an expense)", () => {
    expect(isOrderOutsideRange(null, "2026-04-01")).toBe(false);
    expect(isOrderOutsideRange(undefined, "2026-04-01")).toBe(false);
    expect(isOrderOutsideRange("", "2026-04-01")).toBe(false);
  });

  it("a datetime order date compares by its date part, not as a longer string", () => {
    // "2026-04-01 09:00:00" > "2026-04-01" as strings; by date it is the same day.
    expect(isOrderOutsideRange("2026-04-01 09:00:00", "2026-04-01")).toBe(false);
    expect(isOrderOutsideRange("2026-03-31 23:59:59", "2026-04-01")).toBe(true);
  });

  it("a year boundary compares as dates", () => {
    expect(isOrderOutsideRange("2025-12-31", "2026-01-01")).toBe(true);
    expect(isOrderOutsideRange("2027-01-01", "2026-12-31")).toBe(false);
  });

  it("a malformed order date is never flagged", () => {
    expect(isOrderOutsideRange("2026-3-1", "2026-04-01")).toBe(false);
  });
});

describe("summary math from rows", () => {
  it("orders: sums and invoiced %", () => {
    const s = summariseAuditOrders([order(), order({ id: "WO/1", against: "WO", excl_gst: 2000, gst: 360, incl_gst: 2360, total_invoiced: 0 })]);
    expect(s).toEqual({ count: 2, exclGst: 3000, gst: 540, inclGst: 3540, totalInvoiced: 590, invoicedPct: 16.7 });
  });

  it("orders: no rows → zeros and no % (never NaN or Infinity)", () => {
    expect(summariseAuditOrders([])).toEqual({ count: 0, exclGst: 0, gst: 0, inclGst: 0, totalInvoiced: 0, invoicedPct: null });
  });

  it("orders: null money counts as 0", () => {
    const s = summariseAuditOrders([order({ excl_gst: null, gst: null, incl_gst: null, total_invoiced: null })]);
    expect(s.inclGst).toBe(0);
    expect(s.invoicedPct).toBeNull();
  });

  it("orders: over-invoiced shows over 100%", () => {
    expect(summariseAuditOrders([order({ incl_gst: 1000, total_invoiced: 1250 })]).invoicedPct).toBe(125);
  });

  it("invoicedPercent rounds to one decimal", () => {
    expect(invoicedPercent(1, 3)).toBe(33.3);
    expect(invoicedPercent(2, 3)).toBe(66.7);
    expect(invoicedPercent(5, 0)).toBeNull();
  });

  it("invoices: a credit note (negative amount) nets off", () => {
    const s = summariseAuditInvoices([invoice({ invoice_amount: 1000 }), invoice({ invoice_no: "CN-1", invoice_amount: -400 })]);
    expect(s).toEqual({ count: 2, invoiceAmount: 600 });
  });

  it("invoices: credit notes can take the total below zero", () => {
    expect(summariseAuditInvoices([invoice({ invoice_amount: -250 })]).invoiceAmount).toBe(-250);
  });

  it("invoices: null and NaN amounts count as 0 but the row still counts", () => {
    const s = summariseAuditInvoices([invoice({ invoice_amount: null }), invoice({ invoice_amount: Number.NaN }), invoice()]);
    expect(s).toEqual({ count: 3, invoiceAmount: 500 });
  });

  it("payments: Amount paid + TDS = Net paid, with null TDS (expenses) as 0", () => {
    const s = summariseAuditPayments([
      payment(),
      payment({ against: "Project Expense", id: "EXP-1", tds: null, amount_paid: 300, net_paid: 300, order_date: null }),
    ]);
    expect(s.amountPaid).toBe(1200);
    expect(s.tds).toBe(100);
    expect(s.netPaid).toBe(1300);
    expect(s.amountPaid + s.tds).toBe(s.netPaid);
    expect(s.noTds).toBe(false);
    expect(s.rowsWithoutTds).toBe(1);
  });

  it("payments: every row without TDS → noTds (the card shows —), and a 0 TDS is not 'no TDS'", () => {
    expect(summariseAuditPayments([payment({ tds: null, net_paid: 900 })]).noTds).toBe(true);
    const zero = summariseAuditPayments([payment({ tds: 0, net_paid: 900 })]);
    expect(zero.noTds).toBe(false);
    expect(zero.rowsWithoutTds).toBe(0);
  });

  it("payments: no rows is not 'no TDS'", () => {
    const s = summariseAuditPayments([]);
    expect(s).toEqual({ count: 0, amountPaid: 0, tds: 0, netPaid: 0, noTds: false, rowsWithoutTds: 0, gstPayments: 0 });
  });

  it("payments: counts WO GST payment rows; a truthy non-boolean is not one", () => {
    const s = summariseAuditPayments([
      payment({ is_gst_payment: true, tds: 0 }),
      payment(),
      { ...payment(), is_gst_payment: "1" as unknown as boolean },
    ]);
    expect(s.gstPayments).toBe(1);
  });

  it("payments: a negative (reversed) payment reduces the totals", () => {
    const s = summariseAuditPayments([payment(), payment({ amount_paid: -900, tds: -100, net_paid: -1000 })]);
    expect(s).toMatchObject({ amountPaid: 0, tds: 0, netPaid: 0, count: 2 });
  });
});

describe("dates and facets", () => {
  it("API dates are YYYY-MM-DD in local time; unset is undefined (unbounded)", () => {
    expect(toAuditApiDate(new Date(2026, 3, 1, 23, 59, 59))).toBe("2026-04-01");
    expect(toAuditApiDate(undefined)).toBeUndefined();
    expect(toAuditApiDate(null)).toBeUndefined();
  });

  it("range label covers both sides, one side and no range", () => {
    expect(auditRangeLabel("2026-04-01", "2026-04-30")).toBe("01-Apr-2026 – 30-Apr-2026");
    expect(auditRangeLabel("2026-04-01", "2026-04-01")).toBe("01-Apr-2026");
    expect(auditRangeLabel("2026-04-01", undefined)).toBe("From 01-Apr-2026");
    expect(auditRangeLabel(undefined, "2026-04-30")).toBe("Until 30-Apr-2026");
    expect(auditRangeLabel()).toBe("All dates");
  });

  it("facet options count values, skip blanks and sort", () => {
    const rows = [invoice({ against: "WO" }), invoice(), invoice(), invoice({ against: "Project Expense" })];
    expect(auditFacetOptions(rows, (r) => r.against)).toEqual([
      { label: "PO (2)", value: "PO" },
      { label: "Project Expense (1)", value: "Project Expense" },
      { label: "WO (1)", value: "WO" },
    ]);
    expect(auditFacetOptions(rows, (r) => r.expense_type)).toEqual([]);
  });
});

describe("compactRupees", () => {
  it("shortens to Cr and L and keeps small amounts whole", () => {
    expect(compactRupees(32304860)).toBe("₹3.23 Cr");
    expect(compactRupees(427800)).toBe("₹4.28 L");
    expect(compactRupees(45000.4)).toBe("₹45,000");
    expect(compactRupees(0)).toBe("₹0");
  });
  it("keeps the minus sign of a net-negative figure (credit notes)", () => {
    expect(compactRupees(-1500)).toBe("-₹1,500");
    expect(compactRupees(-250000)).toBe("-₹2.50 L");
  });
  it("treats null, undefined and NaN as 0", () => {
    expect(compactRupees(null)).toBe("₹0");
    expect(compactRupees(undefined)).toBe("₹0");
    expect(compactRupees(Number.NaN)).toBe("₹0");
  });
});

describe("sharePercent", () => {
  it("never divides by 0", () => {
    expect(sharePercent(10, 0)).toBe(0);
    expect(sharePercent(1, 3)).toBe(33.3);
  });
});

describe("auditBreakdown", () => {
  const rows = [
    { k: "PO", v: 100 }, { k: "WO", v: 300 }, { k: "PO", v: -20 }, { k: null, v: 5 }, { k: "WO", v: null },
  ];
  it("groups, counts and sums, largest first; blank keys are Other; null values count but add 0", () => {
    expect(auditBreakdown(rows, (r) => r.k, (r) => r.v)).toEqual([
      { key: "WO", count: 2, value: 300 },
      { key: "PO", count: 2, value: 80 },
      { key: "Other", count: 1, value: 5 },
    ]);
  });
  it("with an order, lists every key in that order, missing ones at 0", () => {
    expect(auditBreakdown(rows, (r) => r.k, (r) => r.v, ["PO", "WO", "Project Expense"])).toEqual([
      { key: "PO", count: 2, value: 80 },
      { key: "WO", count: 2, value: 300 },
      { key: "Project Expense", count: 0, value: 0 },
    ]);
  });
  it("is empty for no rows without an order", () => {
    expect(auditBreakdown([], () => "x", () => 1)).toEqual([]);
  });
});

describe("auditAgainstFor", () => {
  it("matches each view and tab", () => {
    expect(auditAgainstFor("project", "orders")).toEqual(["PO", "WO"]);
    expect(auditAgainstFor("project", "payments")).toEqual(["PO", "WO", "Project Expense"]);
    expect(auditAgainstFor("nonproject", "invoices")).toEqual(["Non-Project Expense"]);
    expect(auditAgainstFor("nonproject", "orders")).toEqual([]);
  });
});

describe("auditRangeChosenAtLoad (does a refresh keep step 1?)", () => {
  it("a preset or custom range in the URL counts as chosen", () => {
    expect(auditRangeChosenAtLoad("preset", null)).toBe(true);
    expect(auditRangeChosenAtLoad("custom", null)).toBe(true);
  });

  it("ALL picked on this page before the refresh counts (the URL keeps audit_range=1)", () => {
    expect(auditRangeChosenAtLoad("all", "1")).toBe(true);
  });

  it("the shared default ALL with no pick here does not: ALL must be picked on purpose", () => {
    expect(auditRangeChosenAtLoad("all", null)).toBe(false);
    expect(auditRangeChosenAtLoad("all", "")).toBe(false);
    expect(auditRangeChosenAtLoad("all", "0")).toBe(false);
  });
});

describe("auditIdMatches (search by an expense's record name; PR #1736 walk)", () => {
  it("finds an expense by its record name, in any case and by part of it", () => {
    expect(auditIdMatches("qs21qubbrb", "qs21qubbrb")).toBe(true);
    expect(auditIdMatches("qs21qubbrb", "QS21QUB")).toBe(true);
    expect(auditIdMatches("qs21qubbrb", "  qubbrb ")).toBe(true);
  });

  it("finds a PO / WO by its number", () => {
    expect(auditIdMatches("PO/163/00086/26-27", "00086/26")).toBe(true);
  });

  it("matches nothing for other text, an empty search or a row without a name", () => {
    expect(auditIdMatches("qs21qubbrb", "zz99")).toBe(false);
    expect(auditIdMatches("qs21qubbrb", "")).toBe(false);
    expect(auditIdMatches("qs21qubbrb", "   ")).toBe(false);
    expect(auditIdMatches("qs21qubbrb", undefined)).toBe(false);
    expect(auditIdMatches(null, "qs21")).toBe(false);
  });
});
