/**
 * boqAccess.test.ts -- the BoQ surfaces' role predicates.
 *
 * The predicate is pure (ADR-0010 F4) precisely so it can be pinned here: the column it gates is
 * a React render, and this repo has NO DOM test environment (frontend/CLAUDE.md), so the
 * component itself is structurally untestable. Pinning the rule is the part that can be.
 */

import { describe, it, expect } from "vitest";
import { UPLOAD_BOQ_ACCESS } from "@/constants/roles";
import { ROLE_OPTIONS } from "@/utils/roleColors";
import { canOpenBoqHub, canOpenBoqWizard, canSeeBoqCommercials } from "./boqAccess";

describe("canOpenBoqWizard", () => {
  it("admits the Admin profile", () => {
    expect(canOpenBoqWizard("Nirmaan Admin Profile", "someone@nirmaan.app")).toBe(true);
  });

  it("admits the Estimates Executive profile", () => {
    expect(canOpenBoqWizard("Nirmaan Estimates Executive Profile", "someone@nirmaan.app")).toBe(
      true,
    );
  });

  it("admits the PMO Executive profile", () => {
    expect(canOpenBoqWizard("Nirmaan PMO Executive Profile", "someone@nirmaan.app")).toBe(true);
  });

  it("admits the Billing Executive profile", () => {
    expect(canOpenBoqWizard("Nirmaan Billing Executive Profile", "someone@nirmaan.app")).toBe(
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

  it("admits a PMO Executive -- a DELIBERATE widening of a set that used to refuse them", () => {
    // INVERTED PIN, not a deleted one. This case asserted `false` and was called out as the
    // likeliest role to be added BY MISTAKE, because PMO mirrors Admin on so many other
    // surfaces. It is now an owner decision, so the pin states the new truth -- and it still
    // fails for the neighbours that were NOT part of the widening, which is the half of the
    // original guard that is still doing work.
    expect(canOpenBoqWizard("Nirmaan PMO Executive Profile", "pmo@nirmaan.app")).toBe(true);
    expect(canOpenBoqWizard("Nirmaan Project Lead Profile", "pl@nirmaan.app")).toBe(false);
    expect(canOpenBoqWizard("Nirmaan Project Manager Profile", "pm@nirmaan.app")).toBe(false);
  });

  it("is never wider than the route guard that admits its pencil's destination", () => {
    // The predicate draws the pencil into /upload-boq/*; UPLOAD_BOQ_ACCESS decides who the
    // router lets in. A profile in the first and not the second gets an affordance whose very
    // next click is Access Denied, so the containment is pinned rather than merely commented.
    // Enumerating ROLE_OPTIONS (the canonical role_profile list) is what makes this mechanical:
    // a future widening of the predicate alone turns this red without anyone remembering to
    // extend a hand-written list.
    for (const { value: role } of ROLE_OPTIONS) {
      if (canOpenBoqWizard(role, "someone@nirmaan.app")) {
        expect(UPLOAD_BOQ_ACCESS).toContain(role);
      }
    }
  });
});

describe("canOpenBoqHub", () => {
  it("admits the roles that hold route access but get NO pencil", () => {
    // The whole reason this predicate is separate. These two are in UPLOAD_BOQ_ACCESS and NOT in
    // the wizard set, and they are exactly the population the pre-Won row click exists to serve.
    for (const role of [
      "Nirmaan Project Lead Profile",
      "Nirmaan Procurement Executive Profile",
    ]) {
      expect(canOpenBoqHub(role, "someone@nirmaan.app")).toBe(true);
      expect(canOpenBoqWizard(role, "someone@nirmaan.app")).toBe(false);
    }
  });

  it("admits the whole wizard set too", () => {
    for (const role of [
      "Nirmaan Admin Profile",
      "Nirmaan PMO Executive Profile",
      "Nirmaan Estimates Executive Profile",
      "Nirmaan Billing Executive Profile",
    ]) {
      expect(canOpenBoqHub(role, "someone@nirmaan.app")).toBe(true);
    }
  });

  it("admits the Administrator USER whatever their profile reads", () => {
    expect(canOpenBoqHub("", "Administrator")).toBe(true);
    expect(canOpenBoqHub("Nirmaan Accountant Profile", "Administrator")).toBe(true);
  });

  it("refuses profiles the router would bounce", () => {
    // These CAN open a pre-Won project page, so they CAN reach the BoQ list on a stub. Sending
    // them to the hub would land them on Access Denied -- an affordance whose very next screen
    // refuses it, which is the thing this predicate exists to prevent.
    for (const role of [
      "Nirmaan Accountant Profile",
      "Nirmaan Sales Executive Profile",
      "Nirmaan Design Lead Profile",
      "Nirmaan Project Manager Profile",
    ]) {
      expect(canOpenBoqHub(role, "someone@nirmaan.app")).toBe(false);
    }
  });

  it("refuses while the role is still resolving, and on a failed read", () => {
    expect(canOpenBoqHub("Loading", "someone@nirmaan.app")).toBe(false);
    expect(canOpenBoqHub("Error", "someone@nirmaan.app")).toBe(false);
    expect(canOpenBoqHub(undefined, undefined)).toBe(false);
    expect(canOpenBoqHub("", "")).toBe(false);
  });

  it("agrees with the route guard on EVERY role, by construction", () => {
    // It reads UPLOAD_BOQ_ACCESS rather than re-spelling the membership, so this cannot drift.
    // Pinned anyway: the pin is what makes a future rewrite into a local Set fail loudly instead
    // of quietly reintroducing the drift the derivation was chosen to make impossible.
    for (const { value: role } of ROLE_OPTIONS) {
      expect(canOpenBoqHub(role, "someone@nirmaan.app")).toBe(UPLOAD_BOQ_ACCESS.includes(role));
    }
  });

  it("contains the pencil set -- the hub is where the pencil POINTS", () => {
    // The pencil navigates to the hub, so a profile that gets one and cannot be admitted to the
    // hub has an affordance that refuses itself. Enumerating ROLE_OPTIONS keeps this mechanical.
    for (const { value: role } of ROLE_OPTIONS) {
      if (canOpenBoqWizard(role, "someone@nirmaan.app")) {
        expect(canOpenBoqHub(role, "someone@nirmaan.app")).toBe(true);
      }
    }
  });
});

describe("canSeeBoqCommercials", () => {
  it("admits the wizard set plus billing", () => {
    for (const role of [
      "Nirmaan Admin Profile",
      "Nirmaan PMO Executive Profile",
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
    for (const role of [
      "Nirmaan Admin Profile",
      "Nirmaan PMO Executive Profile",
      "Nirmaan Estimates Executive Profile",
    ]) {
      expect(canOpenBoqWizard(role, "x@y.z")).toBe(true);
      expect(canSeeBoqCommercials(role, "x@y.z")).toBe(true);
    }
    // ⚠️ NO LONGER A *PROPER* SUPERSET, and the pin says so rather than being dropped. This
    // asserted that billing "sees the figures but gets no pencil" -- the owner reversed it, so
    // billing now authors too and the two populations coincide. The containment above is the
    // half that must never break; the properness was only ever a fact about the roster.
    expect(canSeeBoqCommercials("Nirmaan Billing Executive Profile", "x@y.z")).toBe(true);
    expect(canOpenBoqWizard("Nirmaan Billing Executive Profile", "x@y.z")).toBe(true);
  });
});
