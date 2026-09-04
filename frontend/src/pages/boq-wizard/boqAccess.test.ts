/**
 * boqAccess.test.ts -- the BoQ surfaces' role predicates.
 *
 * The predicate is pure (ADR-0010 F4) precisely so it can be pinned here: the column it gates is
 * a React render, and this repo has NO DOM test environment (frontend/CLAUDE.md), so the
 * component itself is structurally untestable. Pinning the rule is the part that can be.
 */

import { describe, it, expect } from "vitest";
import { canOpenBoqWizard, canSeeBoqCommercials } from "./boqAccess";

describe("canOpenBoqWizard", () => {
  it("admits the Admin profile", () => {
    expect(canOpenBoqWizard("Nirmaan Admin Profile", "someone@nirmaan.app")).toBe(true);
  });

  it("admits the Estimates Executive profile", () => {
    expect(canOpenBoqWizard("Nirmaan Estimates Executive Profile", "someone@nirmaan.app")).toBe(
      true,
    );
  });

  it("admits the Administrator USER whatever their profile reads", () => {
    // useUserData resolves this user to the Admin profile today; the userId check means the
    // predicate stays right if that ever changes.
    expect(canOpenBoqWizard("", "Administrator")).toBe(true);
    expect(canOpenBoqWizard("Nirmaan Project Manager Profile", "Administrator")).toBe(true);
  });

  it("refuses every other profile", () => {
    for (const role of [
      "Nirmaan Project Lead Profile",
      "Nirmaan Project Manager Profile",
      "Nirmaan PMO Executive Profile",
      "Nirmaan Procurement Executive Profile",
      "Nirmaan Accountant Profile",
      "Nirmaan Design Lead Profile",
    ]) {
      expect(canOpenBoqWizard(role, "someone@nirmaan.app")).toBe(false);
    }
  });

  it("refuses while the role is still resolving, and on a failed read", () => {
    // useUserData reports these two as the role itself. Withholding until the role is KNOWN is
    // deliberate: appearing late is a smaller lie than appearing and then being taken away.
    expect(canOpenBoqWizard("Loading", "someone@nirmaan.app")).toBe(false);
    expect(canOpenBoqWizard("Error", "someone@nirmaan.app")).toBe(false);
  });

  it("refuses an absent role or user", () => {
    expect(canOpenBoqWizard(undefined, undefined)).toBe(false);
    expect(canOpenBoqWizard("", "")).toBe(false);
  });

  it("does not admit a PMO Executive, who mirrors Admin on many other surfaces", () => {
    // Called out because the mirroring makes it the likeliest role to be added by mistake.
    expect(canOpenBoqWizard("Nirmaan PMO Executive Profile", "pmo@nirmaan.app")).toBe(false);
  });
});

describe("canSeeBoqCommercials", () => {
  it("admits the wizard set plus billing", () => {
    for (const role of [
      "Nirmaan Admin Profile",
      "Nirmaan Estimates Executive Profile",
      "Nirmaan Billing Executive Profile",
    ]) {
      expect(canSeeBoqCommercials(role, "someone@nirmaan.app")).toBe(true);
    }
    expect(canSeeBoqCommercials("", "Administrator")).toBe(true);
  });

  it("refuses every other profile", () => {
    for (const role of [
      "Nirmaan Project Lead Profile",
      "Nirmaan Project Manager Profile",
      "Nirmaan PMO Executive Profile",
      "Nirmaan Procurement Executive Profile",
      "Nirmaan Accountant Profile",
      "Nirmaan Design Lead Profile",
    ]) {
      expect(canSeeBoqCommercials(role, "someone@nirmaan.app")).toBe(false);
    }
  });

  it("refuses while the role is still resolving, and on a failed read", () => {
    expect(canSeeBoqCommercials("Loading", "someone@nirmaan.app")).toBe(false);
    expect(canSeeBoqCommercials("Error", "someone@nirmaan.app")).toBe(false);
    expect(canSeeBoqCommercials(undefined, undefined)).toBe(false);
  });

  it("is a strict SUPERSET of the wizard set", () => {
    // The relationship is the point: billing reads a priced sheet, it does not author one.
    // Anyone who may open the wizard must also be able to see what they are pricing.
    for (const role of ["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"]) {
      expect(canOpenBoqWizard(role, "x@y.z")).toBe(true);
      expect(canSeeBoqCommercials(role, "x@y.z")).toBe(true);
    }
    // ...and the superset is PROPER: billing sees the figures, but gets no pencil.
    expect(canSeeBoqCommercials("Nirmaan Billing Executive Profile", "x@y.z")).toBe(true);
    expect(canOpenBoqWizard("Nirmaan Billing Executive Profile", "x@y.z")).toBe(false);
  });
});
