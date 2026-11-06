import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PROJECT_INVOICES_ACCESS,
  canActOnInflow,
  canAddInflow,
  canAddProjectInvoice,
  canDeleteInflow,
  canEditProjectInvoice,
  isNirmaanAdmin,
} from "./roles";

describe("isNirmaanAdmin (the server's role_profiles.is_nirmaan_admin)", () => {
  it.each<[string, string, boolean]>([
    ["Nirmaan Admin Profile", "Administrator", true],
    ["Nirmaan Admin Profile", "shanu@nirmaan.app", true],
    ["Nirmaan Accountant Profile", "someone@nirmaan.app", false],
    ["Loading", "shanu@nirmaan.app", false],
    ["Error", "shanu@nirmaan.app", false],
    ["", "", false],
  ])("role %j, user %j -> %s", (role, userId, expected) => {
    expect(isNirmaanAdmin(role, userId)).toBe(expected);
  });

  it("is false while the role is still Loading, even for the Administrator user id", () => {
    // An admin-only control must not flash in before the role resolves.
    expect(isNirmaanAdmin("Loading", "Administrator")).toBe(false);
  });
});

describe("client money: PMO sees it but is view-only (owner, 2026-10-27)", () => {
  const PMO = "Nirmaan PMO Executive Profile";
  const ADMIN = "Nirmaan Admin Profile";
  const OTHERS = [
    "Nirmaan Accountant Profile",
    "Nirmaan Accountant Lead Profile",
    "Nirmaan Project Lead Profile",
    "Nirmaan Project Manager Profile",
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Estimates Executive Profile",
    "Nirmaan Billing Executive Profile",
    "Nirmaan Sales Executive Profile",
    "Nirmaan Sales Lead Profile",
  ];

  it("gives PMO no add, edit, delete or Actions menu on client invoices and inflows", () => {
    expect(canAddProjectInvoice(PMO)).toBe(false);
    expect(canEditProjectInvoice(PMO)).toBe(false);
    expect(canActOnInflow(PMO)).toBe(false);
    expect(canDeleteInflow(PMO)).toBe(false);
  });

  it("leaves Admin with every action", () => {
    expect(canAddProjectInvoice(ADMIN)).toBe(true);
    expect(canEditProjectInvoice(ADMIN)).toBe(true);
    expect(canActOnInflow(ADMIN)).toBe(true);
    expect(canDeleteInflow(ADMIN)).toBe(true);
  });

  // Each rule is pinned to the inline check it replaced, so no other role gains or loses anything.
  it.each(OTHERS)("leaves %s exactly where it was", (role) => {
    const isSales = role === "Nirmaan Sales Executive Profile" || role === "Nirmaan Sales Lead Profile";
    expect(canAddProjectInvoice(role)).toBe(!isSales);
    expect(canEditProjectInvoice(role)).toBe(false);
    expect(canActOnInflow(role)).toBe(
      role === "Nirmaan Accountant Profile" || role === "Nirmaan Accountant Lead Profile"
    );
    expect(canDeleteInflow(role)).toBe(false);
  });

  it("does not open the Actions menu for an unresolved role", () => {
    for (const role of ["Loading", "", null, undefined]) {
      expect(canEditProjectInvoice(role)).toBe(false);
      expect(canActOnInflow(role)).toBe(false);
      expect(canDeleteInflow(role)).toBe(false);
    }
  });
});

describe("client money pages and reports: PMO opens them view-only (owner, 2026-10-28)", () => {
  const PMO = "Nirmaan PMO Executive Profile";
  const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

  it("lets PMO through the /project-invoices guard and keeps everyone it let in before", () => {
    expect(PROJECT_INVOICES_ACCESS).toContain(PMO);
    for (const role of [
      "Nirmaan Admin Profile",
      "Nirmaan Accountant Profile",
      "Nirmaan Accountant Lead Profile",
      "Nirmaan Sales Executive Profile",
      "Nirmaan Sales Lead Profile",
    ]) {
      expect(PROJECT_INVOICES_ACCESS).toContain(role);
    }
    expect(PROJECT_INVOICES_ACCESS).not.toContain("Nirmaan Project Manager Profile");
  });

  it("gives PMO no New Inflow button, and matches the Add Invoice rule for every role", () => {
    expect(canAddInflow(PMO)).toBe(false);
    expect(canAddInflow("Nirmaan Admin Profile")).toBe(true);
    for (const role of [
      "Nirmaan Admin Profile",
      PMO,
      "Nirmaan Accountant Profile",
      "Nirmaan Accountant Lead Profile",
      "Nirmaan Project Lead Profile",
      "Nirmaan Sales Executive Profile",
      "Nirmaan Sales Lead Profile",
    ]) {
      expect(canAddInflow(role)).toBe(canAddProjectInvoice(role));
    }
  });

  // These gates are inline role checks, so they are pinned at the source.
  it("lets PMO through the /in-flow-payments guard (source)", () => {
    const src = read("utils/auth/ProtectedRoute.tsx");
    const guard = src.slice(src.indexOf("export const InflowPaymentsRoute"), src.indexOf("export const NewProjectRoute"));
    expect(guard).toContain(`role === "${PMO}"`);
  });

  it("does not count PMO as Admin on the Project Invoices sheet (source)", () => {
    const src = read("pages/ProjectInvoices/AllProjectInvoices.tsx");
    expect(src).toContain('const isAdmin = role === "Nirmaan Admin Profile";');
  });

  it("gates both header Add buttons on the view-only rules (source)", () => {
    const src = read("components/helpers/renderRightActionButton.tsx");
    expect(src).toContain("if (!canAddInflow(role)) return null;");
    expect(src).toContain("if (!canAddProjectInvoice(role)) return null;");
  });

  it("no longer narrows PMO's Reports › Projects list (source)", () => {
    expect(read("pages/reports/ReportsContainer.tsx")).not.toContain(`role === "${PMO}"`);
    expect(read("pages/reports/store/useReportStore.ts")).not.toContain(`userRole === "${PMO}"`);
  });
});
