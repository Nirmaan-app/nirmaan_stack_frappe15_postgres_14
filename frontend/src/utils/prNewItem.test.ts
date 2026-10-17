import { describe, expect, it } from "vitest";

import { newItemRequestReason } from "./prNewItem";

const ADMIN = "Nirmaan Admin Profile";
const PMO = "Nirmaan PMO Executive Profile";
const PROCUREMENT = "Nirmaan Procurement Executive Profile";
const PROJECT_MANAGER = "Nirmaan Project Manager Profile";

describe("newItemRequestReason", () => {
  it("lets Admin create in every category", () => {
    for (const flag of ["true", "false", undefined, null, ""]) {
      expect(newItemRequestReason(ADMIN, flag)).toBeNull();
    }
  });

  it("makes PMO request in every category, open ones included", () => {
    for (const flag of ["true", "false", undefined, null, ""]) {
      expect(newItemRequestReason(PMO, flag)).toBe("role");
    }
  });

  it("makes other roles request only where the category is closed", () => {
    for (const role of [PROCUREMENT, PROJECT_MANAGER]) {
      expect(newItemRequestReason(role, "false")).toBe("category");
      expect(newItemRequestReason(role, "true")).toBeNull();
      expect(newItemRequestReason(role, undefined)).toBeNull();
    }
  });

  it("treats a missing role like any other non-Admin role", () => {
    expect(newItemRequestReason(undefined, "false")).toBe("category");
    expect(newItemRequestReason(null, "true")).toBeNull();
  });

  it("does not match a role by part of its name", () => {
    expect(newItemRequestReason("Nirmaan PMO Executive", "true")).toBeNull();
    expect(newItemRequestReason("Nirmaan Admin", "false")).toBe("category");
  });
});
