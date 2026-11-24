// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuditInvoiceRow, AuditOrderRow, AuditPaymentRow, AuditTableRow, AuditViewSummary } from "../../utils/auditView";
import { SummaryStrip } from "./AuditSummaryStrip";
import { TabBar } from "./AuditTabBar";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

let n = 0;
const order = (over: Partial<AuditOrderRow>): AuditTableRow => ({
  name: `o${n++}`, against: "PO", id: "PO/001", project: "P1", project_name: "Alpha", vendor: "V1", vendor_name: "Acme",
  date: "2026-04-10", excl_gst: 1000, gst: 180, incl_gst: 1180, total_invoiced: 590, ...over,
});
const invoice = (over: Partial<AuditInvoiceRow>): AuditTableRow => ({
  name: `i${n++}`, against: "PO", id: "PO/001", invoice_no: "INV-1", project: "P1", project_name: "Alpha", vendor: "V1",
  vendor_name: "Acme", expense_type: null, description: null, date: "2026-04-12", invoice_amount: 500, order_date: null,
  invoice_url: null, ...over,
});
const payment = (over: Partial<AuditPaymentRow>): AuditTableRow => ({
  name: `p${n++}`, against: "WO", id: "WO/001", project: "P1", project_name: "Alpha", vendor: "V1", vendor_name: "Acme",
  expense_type: null, description: null, date: "2026-04-15", utr: "UTR1", amount_paid: 900, tds: 100, net_paid: 1000,
  is_gst_payment: false, order_date: null, ...over,
});

/** The summary's cards, in screen order. */
const cards = () => Array.from(container.querySelectorAll('[role="group"] > div'));

describe("Audit View summary cards", () => {
  it("Orders: the type card comes first, named Orders, with each type's amount only (no counts, bars or %)", () => {
    const rows = [order({}), order({ id: "PO/002" }), order({ against: "WO", id: "WO/001", excl_gst: 500, gst: 90, incl_gst: 590, total_invoiced: 0 })];
    act(() => root.render(<SummaryStrip view="project" tab="orders" rows={rows} />));

    expect(cards()).toHaveLength(3);
    // Exactly the heading and two chips: a PO / WO count badge would add its number to this text.
    expect(cards()[0].textContent).toBe("OrdersPO ₹2,360WO ₹590");
    expect(cards()[1].textContent).toContain("Order value incl. GST");
    expect(cards()[2].textContent).toContain("Total invoiced");
    expect(container.textContent).not.toContain("%");
    expect(container.textContent).not.toMatch(/by type/i);
  });

  it("Invoices and Payments: the type card is first, takes the tab's name, and lists every type (₹0 too)", () => {
    act(() => root.render(<SummaryStrip view="project" tab="invoices" rows={[invoice({}), invoice({ against: "WO", invoice_amount: 200 })]} />));
    expect(cards()[0].textContent).toBe("InvoicesPO ₹500WO ₹200Project Expense ₹0");
    expect(container.textContent).not.toContain("%");

    act(() => root.render(<SummaryStrip view="project" tab="payments" rows={[payment({}), payment({ against: "PO", net_paid: 300, amount_paid: 300, tds: 0 })]} />));
    expect(cards()[0].textContent).toBe("PaymentsPO ₹300WO ₹1,000Project Expense ₹0");
    expect(cards()[1].textContent).toContain("Net paid");
    expect(container.textContent).not.toContain("%");
  });

  it("Non Projects Data: Top expense types comes first, without percentages", () => {
    const rows = [
      invoice({ against: "Non-Project Expense", expense_type: "Rent", invoice_amount: 800 }),
      invoice({ against: "Non-Project Expense", expense_type: "Travel", invoice_amount: 200 }),
    ];
    act(() => root.render(<SummaryStrip view="nonproject" tab="invoices" rows={rows} />));
    expect(cards()[0].textContent).toContain("Top expense types");
    expect(cards()[0].textContent).toContain("Rent ₹800");
    expect(container.textContent).not.toContain("%");
  });

  it("each part is its own card; the group around them is not a card", () => {
    act(() => root.render(<SummaryStrip view="project" tab="orders" rows={[order({})]} />));
    const group = container.querySelector('[role="group"]');
    expect(group?.className).not.toMatch(/\bborder\b/);
    expect(group?.className).not.toMatch(/\bbg-/);
    for (const card of cards()) expect(card.className).toMatch(/\brounded-lg border\b/);
  });
});

describe("Audit View tab bar", () => {
  const summary: AuditViewSummary = {
    orders: { count: 12, incl_gst: 0, total_invoiced: 0, by_against: {} },
    invoices: { count: 7, invoice_amount: 0, by_against: {} },
    payments: { count: 3, amount_paid: 0, tds: 0, net_paid: 0, by_against: {} },
  };

  it("shows each tab with its count, and no Show details toggle", () => {
    act(() =>
      root.render(<TabBar view="project" tab="invoices" locked={false} onSelect={() => undefined} summary={summary} isLoading={false} />),
    );
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).toEqual(["Orders1212", "Invoices77", "Payments33"]);
    expect(container.textContent).not.toMatch(/details/i);
    expect(container.querySelectorAll("button")).toHaveLength(3);
  });

  it("Non Projects Data has no Orders tab", () => {
    act(() =>
      root.render(<TabBar view="nonproject" tab={null} locked={false} onSelect={() => undefined} summary={{ ...summary, orders: null }} isLoading={false} />),
    );
    expect(Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual(["Invoices77", "Payments33"]);
  });
});
