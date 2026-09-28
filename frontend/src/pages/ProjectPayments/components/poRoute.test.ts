import { describe, expect, it } from "vitest";

import { orderDetailPath, poLinkFor } from "./poRoute";

const PO = "PO/123/00045/25-26";

describe("poLinkFor", () => {
  it("opens each list status on its own tab", () => {
    expect(poLinkFor(PO, "PO Approved", "P1")).toBe("/purchase-orders/PO&=123&=00045&=25-26?tab=Approved+PO");
    expect(poLinkFor(PO, "Partially Dispatched", "P1")).toContain("?tab=Partially+Dispatched+PO");
    expect(poLinkFor(PO, "Dispatched", "P1")).toContain("?tab=Dispatched+PO");
    expect(poLinkFor(PO, "Partially Delivered", "P1")).toContain("?tab=Partially+Delivered+PO");
    expect(poLinkFor(PO, "Delivered", "P1")).toContain("?tab=Delivered+PO");
  });

  it("falls back to the project summary for a status with no tab, or before the PO loads", () => {
    expect(poLinkFor(PO, "Merged", "P1")).toBe("/projects/P1/po/PO&=123&=00045&=25-26");
    expect(poLinkFor(PO, undefined, "P1")).toBe("/projects/P1/po/PO&=123&=00045&=25-26");
  });

  it("never emits a tab-less PO route", () => {
    expect(poLinkFor(PO, "Cancelled", null)).toContain("?tab=");
  });
});

describe("orderDetailPath", () => {
  const ID = "PO&=123&=00045&=25-26";

  it("keeps a PO opened from Reports under Reports", () => {
    expect(orderDetailPath(PO, "/reports")).toBe(`/reports/po/${ID}`);
  });

  it("keeps a PO opened inside a project under that project", () => {
    expect(orderDetailPath(PO, "/projects/P1", "P1")).toBe(`/projects/P1/po/${ID}`);
  });

  it("leaves every other screen on the payments route", () => {
    expect(orderDetailPath(PO, "/invoice-reconciliation")).toBe(`/project-payments/${ID}`);
    expect(orderDetailPath(PO, "/project-payments")).toBe(`/project-payments/${ID}`);
    // A path that merely starts with the letters "reports" is not the Reports page.
    expect(orderDetailPath(PO, "/reports-archive")).toBe(`/project-payments/${ID}`);
  });

  it("opens a WO on its approved view in Reports and projects, payments elsewhere", () => {
    expect(orderDetailPath("SR-00190-001071", "/reports")).toBe("/service-requests/SR-00190-001071?tab=approved-sr");
    expect(orderDetailPath("SR-00190-001071", "/projects/P1", "P1")).toBe("/service-requests/SR-00190-001071?tab=approved-sr");
    expect(orderDetailPath("SR-00190-001071", "/somewhere")).toBe("/project-payments/SR-00190-001071");
  });
});
