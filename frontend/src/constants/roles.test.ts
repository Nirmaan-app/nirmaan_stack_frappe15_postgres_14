import { describe, expect, it } from "vitest";

import { isNirmaanAdmin } from "./roles";

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
