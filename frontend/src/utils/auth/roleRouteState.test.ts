import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_LOADING_TEXT, roleRouteState } from "./ProtectedRoute";

const ALLOWED = ["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"];

describe("RoleRoute: a loading state, never 'Access Denied' while the role loads (S6 F4 / U3)", () => {
  it("while the user's record is read (role 'Loading') -> loading", () => {
    expect(roleRouteState("Loading", "someone@x.com", ALLOWED)).toBe("loading");
    expect(ROLE_LOADING_TEXT).toBe("Checking access…");
  });

  it("an allowed role, or Administrator -> allow", () => {
    expect(roleRouteState("Nirmaan Admin Profile", "someone@x.com", ALLOWED)).toBe("allow");
    expect(roleRouteState("Loading", "Administrator", ALLOWED)).toBe("allow");
  });

  it("negative: a known role that is not allowed, an error or no role -> deny ('Access Denied' stays)", () => {
    expect(roleRouteState("Nirmaan Procurement Executive Profile", "someone@x.com", ALLOWED)).toBe("deny");
    expect(roleRouteState("Error", "someone@x.com", ALLOWED)).toBe("deny");
    expect(roleRouteState("", "someone@x.com", ALLOWED)).toBe("deny");
  });

  it("RoleRoute uses it and keeps its Access Denied page (source)", () => {
    const src = readFileSync(join(__dirname, "ProtectedRoute.tsx"), "utf8");
    expect(src).toContain("roleRouteState(role, user_id, allowed)");
    expect(src).toContain('if (state === "loading") {');
    expect(src).toContain("Access Denied");
  });
});
