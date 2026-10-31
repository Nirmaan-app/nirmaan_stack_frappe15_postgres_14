import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { getAssetPermissions } from "./permissions";

describe("canViewHistory", () => {
  it("lets Admin, HR Executive, HR Lead and the Administrator user see the asset history", () => {
    expect(getAssetPermissions("a@x", "Nirmaan Admin Profile").canViewHistory).toBe(true);
    expect(getAssetPermissions("a@x", "Nirmaan HR Executive Profile").canViewHistory).toBe(true);
    expect(getAssetPermissions("a@x", "Nirmaan HR Lead Profile").canViewHistory).toBe(true);
    expect(getAssetPermissions("Administrator", null).canViewHistory).toBe(true);
  });

  it("hides it from everyone else, PMO and Procurement included", () => {
    expect(getAssetPermissions("a@x", "Nirmaan PMO Executive Profile").canViewHistory).toBe(false);
    expect(getAssetPermissions("a@x", "Nirmaan Procurement Executive Profile").canViewHistory).toBe(false);
    expect(getAssetPermissions("a@x", "Nirmaan Project Manager Profile").canViewHistory).toBe(false);
  });

  it("matches the server's ASSET_HISTORY_PROFILES", () => {
    const source = readFileSync(resolve(__dirname, "../../../../../nirmaan_stack/services/role_profiles.py"), "utf-8");
    expect(source).toContain("ASSET_HISTORY_PROFILES = (ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE)");
  });
});

describe("declaration upload", () => {
  it("is offered to nobody, Admin included: everyone signs their own (owner, 2026-10-15)", () => {
    for (const [user, role] of [["a@x", "Nirmaan Admin Profile"], ["Administrator", null]] as const) {
      expect(getAssetPermissions(user, role)).not.toHaveProperty("canUploadDeclaration");
    }
  });
});

describe("canAssignAssetType", () => {
  const can = (role: string | null, type: "Project" | "IT" | null, user = "a@x") =>
    getAssetPermissions(user, role).canAssignAssetType(type);

  it("lets Admin, HR Executive, HR Lead, PMO and the Administrator user assign and unassign every asset", () => {
    for (const role of ["Nirmaan Admin Profile", "Nirmaan HR Executive Profile", "Nirmaan HR Lead Profile", "Nirmaan PMO Executive Profile"]) {
      expect([can(role, "Project"), can(role, "IT"), can(role, null)]).toEqual([true, true, true]);
    }
    expect(can(null, "IT", "Administrator")).toBe(true);
  });

  it("lets procurement do Project assets only -- not IT, not an unknown kind", () => {
    for (const role of [
      "Nirmaan Procurement Executive Profile",
      "Nirmaan Procurement Lead Profile",
      "Nirmaan Material Procurement Executive Profile",
      "Nirmaan Service Procurement Executive Profile",
    ]) {
      expect([can(role, "Project"), can(role, "IT"), can(role, null)]).toEqual([true, false, false]);
      expect(getAssetPermissions("a@x", role).canAssignAsset).toBe(true);
    }
  });

  it("refuses everyone else", () => {
    for (const role of ["Nirmaan Project Lead Profile", "Nirmaan Project Manager Profile", "Nirmaan Estimates Executive Profile"]) {
      expect([can(role, "Project"), can(role, "IT")]).toEqual([false, false]);
      expect(getAssetPermissions("a@x", role).canAssignAsset).toBe(false);
    }
  });

  it("matches the server's ASSET_ASSIGN_ALL_PROFILES / ASSET_ASSIGN_PROJECT_PROFILES", () => {
    const source = readFileSync(resolve(__dirname, "../../../../../nirmaan_stack/services/role_profiles.py"), "utf-8");
    expect(source).toContain("ASSET_ASSIGN_ALL_PROFILES = (ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE, PMO_EXECUTIVE_PROFILE)");
    expect(source).toContain("ASSET_ASSIGN_PROJECT_PROFILES = PROCUREMENT_PROFILES");
  });
});

describe("canMarkLostDamaged", () => {
  it("lets Admin, HR Executive, HR Lead and the Administrator user mark Lost/Damaged and Found/Repaired", () => {
    expect(getAssetPermissions("a@x", "Nirmaan Admin Profile").canMarkLostDamaged).toBe(true);
    expect(getAssetPermissions("a@x", "Nirmaan HR Executive Profile").canMarkLostDamaged).toBe(true);
    expect(getAssetPermissions("a@x", "Nirmaan HR Lead Profile").canMarkLostDamaged).toBe(true);
    expect(getAssetPermissions("Administrator", null).canMarkLostDamaged).toBe(true);
  });

  it("refuses PMO, procurement and everyone else, holders included (owner, 2026-10-31)", () => {
    for (const role of ["Nirmaan PMO Executive Profile", "Nirmaan Procurement Executive Profile",
                        "Nirmaan Procurement Lead Profile", "Nirmaan Project Manager Profile", null]) {
      expect(getAssetPermissions("a@x", role).canMarkLostDamaged).toBe(false);
    }
  });

  it("matches the server's ASSET_LOST_DAMAGED_PROFILES", () => {
    const source = readFileSync(resolve(__dirname, "../../../../../nirmaan_stack/services/role_profiles.py"), "utf-8");
    expect(source).toContain("ASSET_LOST_DAMAGED_PROFILES = (ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE)");
  });
});

describe("HR Lead", () => {
  it("has every asset permission HR Executive has (owner, 2026-10-15)", () => {
    const flags = (role: string) => {
      const p = getAssetPermissions("a@x", role);
      const { canAssignAssetType, ...rest } = p;
      return { ...rest, project: canAssignAssetType("Project"), it: canAssignAssetType("IT") };
    };
    expect(flags("Nirmaan HR Lead Profile")).toEqual(flags("Nirmaan HR Executive Profile"));
    expect(flags("Nirmaan HR Lead Profile").canViewAssets).toBe(true);
  });

  it("is in the server's ASSET_AUDIT_VIEW_PROFILES too", () => {
    const source = readFileSync(resolve(__dirname, "../../../../../nirmaan_stack/services/role_profiles.py"), "utf-8");
    expect(source).toContain("ASSET_AUDIT_VIEW_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE)");
  });
});
