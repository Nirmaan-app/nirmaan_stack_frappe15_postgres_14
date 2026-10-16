import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { canEditDepartments } from "@/constants/departments";
import {
  MIN_DEPARTMENT_REASON_LENGTH,
  departmentMove,
  isDepartmentReasonValid,
  needsDepartmentReason,
  normalizeDepartment,
  sameDepartment,
} from "./assetDepartment";

const APP = resolve(__dirname, "../../../nirmaan_stack");

describe("normalizeDepartment / sameDepartment", () => {
  it("trims and collapses spaces; empty is null", () => {
    expect(normalizeDepartment("  Site   Projects ")).toBe("Site Projects");
    expect(normalizeDepartment("   ")).toBeNull();
    expect(normalizeDepartment(undefined)).toBeNull();
  });

  it("spots a near-duplicate typed name (capitals, stray spaces)", () => {
    expect(sameDepartment("projects ", "Projects")).toBe(true);
    expect(sameDepartment("Projects", "Accounts")).toBe(false);
  });
});

describe("departmentMove", () => {
  it("does not move within the same department", () => {
    expect(departmentMove("Projects", "Projects")).toBeNull();
  });

  it("compares the stored names exactly (a different spelling is a different record)", () => {
    expect(departmentMove("Projects", "projects")).toEqual({ from: "Projects", to: "projects" });
  });

  it("leaves the asset where it is when the person has no department", () => {
    expect(departmentMove("Projects", null)).toBeNull();
    expect(departmentMove("Projects", "")).toBeNull();
  });

  it("moves to the person's department", () => {
    expect(departmentMove("Projects", "Accounts")).toEqual({ from: "Projects", to: "Accounts" });
  });

  it("gives an asset with no department the person's", () => {
    expect(departmentMove(null, "Accounts")).toEqual({ from: null, to: "Accounts" });
  });
});

describe("department reason", () => {
  it("is needed only to leave a department", () => {
    expect(needsDepartmentReason({ from: "Projects", to: "Accounts" })).toBe(true);
    expect(needsDepartmentReason({ from: null, to: "Accounts" })).toBe(false);
    expect(needsDepartmentReason(null)).toBe(false);
  });

  it("must have enough characters, ignoring spaces at the ends", () => {
    expect(isDepartmentReasonValid("x".repeat(MIN_DEPARTMENT_REASON_LENGTH))).toBe(true);
    expect(isDepartmentReasonValid("   short   ")).toBe(false);
    expect(isDepartmentReasonValid(undefined)).toBe(false);
  });

  it("uses the same minimum as the server", () => {
    const source = readFileSync(resolve(APP, "services/asset_department.py"), "utf-8");
    expect(source).toContain(`MIN_REASON_LENGTH = ${MIN_DEPARTMENT_REASON_LENGTH}`);
  });
});

describe("canEditDepartments", () => {
  it("lets Admin, HR and the Administrator user set departments", () => {
    expect(canEditDepartments("Nirmaan Admin Profile", "a@x")).toBe(true);
    expect(canEditDepartments("Nirmaan HR Executive Profile", "a@x")).toBe(true);
    expect(canEditDepartments("Nirmaan HR Lead Profile", "a@x")).toBe(true);
    expect(canEditDepartments(null, "Administrator")).toBe(true);
  });

  it("refuses everyone else", () => {
    expect(canEditDepartments("Nirmaan Project Manager Profile", "a@x")).toBe(false);
    expect(canEditDepartments("Nirmaan PMO Executive Profile", "a@x")).toBe(false);
    expect(canEditDepartments(undefined, undefined)).toBe(false);
  });

  it("matches the server's DEPARTMENT_EDIT_PROFILES", () => {
    const source = readFileSync(resolve(APP, "services/role_profiles.py"), "utf-8");
    expect(source).toContain("DEPARTMENT_EDIT_PROFILES = (ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE)");
  });
});
