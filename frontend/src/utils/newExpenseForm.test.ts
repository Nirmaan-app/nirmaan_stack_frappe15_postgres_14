import { describe, expect, it } from "vitest";

import { newExpenseFields } from "./newExpenseForm";

const PROJECT_ONLY = { project_allowed: true, project_required: true, has_format: false };
const NON_PROJECT = { project_allowed: false, project_required: false, has_format: false };
const BOTH = { project_allowed: true, project_required: false, has_format: false };
const WITH_FORM = { ...NON_PROJECT, has_format: true };

const fields = (over: Partial<Parameters<typeof newExpenseFields>[0]> = {}) =>
    newExpenseFields({ type: undefined, projectChosen: false, formatLoading: false, formatReady: false, ...over });

describe("newExpenseFields", () => {
    it("asks nothing past the type until a type is picked", () => {
        expect(fields()).toEqual({ project: "hidden", vendor: false, details: "none" });
    });

    it("requires the project on a project-only type", () => {
        expect(fields({ type: PROJECT_ONLY }).project).toBe("required");
    });

    it("hides the project on a non-project type", () => {
        expect(fields({ type: NON_PROJECT }).project).toBe("hidden");
    });

    it("offers the project as optional on a type that allows both", () => {
        expect(fields({ type: BOTH }).project).toBe("optional");
    });

    it("offers the vendor only once a project is chosen", () => {
        expect(fields({ type: PROJECT_ONLY }).vendor).toBe(false);
        expect(fields({ type: PROJECT_ONLY, projectChosen: true }).vendor).toBe(true);
        expect(fields({ type: BOTH, projectChosen: true }).vendor).toBe(true);
    });

    it("never offers the vendor on a non-project type", () => {
        expect(fields({ type: NON_PROJECT, projectChosen: true }).vendor).toBe(false);
    });

    it("asks a type with no form for a description", () => {
        expect(fields({ type: NON_PROJECT }).details).toBe("description");
    });

    it("asks the type's own questions once its form has loaded", () => {
        expect(fields({ type: WITH_FORM, formatLoading: true }).details).toBe("loading");
        expect(fields({ type: WITH_FORM, formatReady: true }).details).toBe("form");
    });

    it("falls back to a description when a type's form cannot be read", () => {
        expect(fields({ type: WITH_FORM }).details).toBe("description");
    });
});
