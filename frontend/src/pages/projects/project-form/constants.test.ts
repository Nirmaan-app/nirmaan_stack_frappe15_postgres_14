import { describe, expect, it } from "vitest";
import { getSections, resumeStepIndex } from "./constants";

describe("getSections", () => {
    it("shows the BOQ step in every wizard run (ADR-0038)", () => {
        expect(getSections()).toEqual([
            "projectDetails",
            "projectAddressDetails",
            "projectTimeline",
            "projectAssignees",
            "boqSelection",
            "packageSelection",
            "reviewDetails",
        ]);
    });
});

describe("resumeStepIndex", () => {
    const sections = getSections();

    it("resumes an old six-step draft on its section, not its saved number", () => {
        // The old Create wizard had no BOQ step: Packages was step 4, Review step 5.
        expect(resumeStepIndex(sections, "packageSelection", 4)).toBe(5);
        expect(resumeStepIndex(sections, "reviewDetails", 5)).toBe(6);
    });

    it("keeps steps before the BOQ step where they were", () => {
        expect(resumeStepIndex(sections, "projectAssignees", 3)).toBe(3);
    });

    it("falls back to the saved number, kept in range, for an unknown section", () => {
        expect(resumeStepIndex(sections, "somethingOld", 2)).toBe(2);
        expect(resumeStepIndex(sections, undefined, 99)).toBe(6);
        expect(resumeStepIndex(sections, undefined, undefined)).toBe(0);
    });
});
