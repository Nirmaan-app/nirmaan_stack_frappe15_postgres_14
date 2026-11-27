/** ADR-0051 decision 5: the Software Developer gets its own badge colour, not the grey of an unknown role. */
import { describe, expect, it } from "vitest";
import { getRoleColors, getRoleLabel, ROLE_OPTIONS } from "./roleColors";

const DEVELOPER = "Nirmaan Software Developer Profile";

describe("the Software Developer badge", () => {
  it("has a colour of its own: not Admin's, not the unknown-role grey, not any other profile's", () => {
    const developer = getRoleColors(DEVELOPER);
    expect(developer.bg).toBe("bg-orange-50");
    expect(developer).not.toEqual(getRoleColors("Nirmaan Admin Profile"));
    expect(developer).not.toEqual(getRoleColors("Some Unknown Profile"));
  });

  it("reads Software Developer and is offered in the role options", () => {
    expect(getRoleLabel(DEVELOPER)).toBe("Software Developer");
    expect(ROLE_OPTIONS).toContainEqual({ label: "Software Developer", value: DEVELOPER });
  });
});
