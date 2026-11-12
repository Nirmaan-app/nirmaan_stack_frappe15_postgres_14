/**
 * The project page shows the Estimates tab wherever it shows the BoQ tab (plan "BOQ Estimates": everyone with BoQ
 * access views), right after it. `project.tsx` is too large to render here, so this reads its source, as
 * `constants/roles.test.ts` does for other pages: every allowed-tab list and every tab menu that has BoQ has Estimates
 * next, and the tab renders the Estimates panel with the project's status (estimates are read-only on Completed and
 * Handover projects).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "..", "projects", "project.tsx"), "utf8");
const count = (re: RegExp) => (source.match(re) ?? []).length;

describe("the Estimates tab on the project page", () => {
  it("has its own tab key", () => {
    expect(source).toMatch(/ESTIMATES: 'estimates',/);
  });

  it("follows BoQ in every allowed-tab list", () => {
    const boq = count(/^\s+PROJECT_PAGE_TABS\.BOQ,$/gm);
    expect(boq).toBeGreaterThan(0);
    expect(count(/^\s+PROJECT_PAGE_TABS\.BOQ,\n\s+PROJECT_PAGE_TABS\.ESTIMATES,$/gm)).toBe(boq);
    expect(count(/^\s+PROJECT_PAGE_TABS\.ESTIMATES,$/gm)).toBe(boq);
  });

  it("follows BoQ in every tab menu, labelled Estimates", () => {
    const boq = count(/key: PROJECT_PAGE_TABS\.BOQ,/g);
    expect(boq).toBeGreaterThan(0);
    const next = /key: PROJECT_PAGE_TABS\.BOQ,\s*\},\s*\{\s*(?:\/\/[^\n]*\s*)?label: "Estimates",\s*key: PROJECT_PAGE_TABS\.ESTIMATES,/g;
    expect(count(next)).toBe(boq);
    expect(count(/key: PROJECT_PAGE_TABS\.ESTIMATES,/g)).toBe(boq);
  });

  it("renders the Estimates panel with the project's status", () => {
    expect(source).toMatch(
      /case PROJECT_PAGE_TABS\.ESTIMATES:\s*return <Suspense fallback=\{<LoadingFallback \/>\}><EstimatesProjectTab projectId=\{projectId\} projectStatus=\{data\?\.status\} \/><\/Suspense>;/);
  });
});
