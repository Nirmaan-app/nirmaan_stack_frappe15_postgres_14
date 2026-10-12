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

describe("canUploadDeclaration", () => {
  it("shows the Pending Declaration Upload to Admin and the Administrator user", () => {
    expect(getAssetPermissions("a@x", "Nirmaan Admin Profile").canUploadDeclaration).toBe(true);
    expect(getAssetPermissions("Administrator", null).canUploadDeclaration).toBe(true);
  });

  it("hides it from everyone else, PMO and HR included", () => {
    expect(getAssetPermissions("a@x", "Nirmaan PMO Executive Profile").canUploadDeclaration).toBe(false);
    expect(getAssetPermissions("a@x", "Nirmaan HR Executive Profile").canUploadDeclaration).toBe(false);
    expect(getAssetPermissions("a@x", "Nirmaan Procurement Executive Profile").canUploadDeclaration).toBe(false);
  });
});
