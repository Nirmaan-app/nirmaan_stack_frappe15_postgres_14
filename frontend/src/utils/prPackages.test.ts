import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXCLUDED_PACKAGES, derivePRPackages, itemPackage, uniqueTagPackages } from "./prPackages";

// The Python module is the authority (the server writes `pr_tag_list`); this mirror only shows
// packages. The PARITY block reads that file so the two cannot drift silently.
const PY_SOURCE = readFileSync(
  resolve(__dirname, "../../../nirmaan_stack/services/pr_packages.py"),
  "utf-8",
);

describe("parity with pr_packages.py", () => {
  it("reads the real Python module", () => {
    expect(PY_SOURCE).toContain("def derive_pr_packages");
  });

  it("EXCLUDED_PACKAGES matches the Python constant", () => {
    const m = PY_SOURCE.match(/^EXCLUDED_PACKAGES\s*=\s*frozenset\(\{([^}]*)\}\)/m);
    expect(m, "constant not found in pr_packages.py").toBeTruthy();
    const pyValues = Array.from(m![1].matchAll(/"([^"]+)"/g), (x) => x[1]).sort();
    expect(pyValues).toEqual([...EXCLUDED_PACKAGES].sort());
  });

  it("the item's own package wins, then its category's (both sides)", () => {
    expect(PY_SOURCE).toMatch(/if own and own in valid:\s*\n\s*return own/);
    expect(PY_SOURCE).toMatch(/mapped = \(category_packages\.get\(category or ""\) or ""\)\.strip\(\)/);
    expect(itemPackage({ procurement_package: "FA System", category: "Wires" }, { Wires: "Electrical Work" })).toBe("FA System");
    expect(itemPackage({ procurement_package: "", category: "Wires" }, { Wires: "Electrical Work" })).toBe("Electrical Work");
  });

  it("status never decides a package (both sides)", () => {
    const deriveBody = PY_SOURCE.slice(PY_SOURCE.indexOf("def derive_pr_packages"), PY_SOURCE.indexOf("def categories_needing_lookup"));
    expect(deriveBody).not.toMatch(/status/);
  });
});

describe("itemPackage", () => {
  const cats = { Wires: "Electrical Work", Charges: "Additional Charges" };

  it("never counts Additional Charges, not even through the category", () => {
    expect(itemPackage({ procurement_package: "Additional Charges", category: "Charges" }, cats)).toBeNull();
    expect(itemPackage({ procurement_package: "", category: "Charges" }, cats)).toBeNull();
  });

  it("reads work_package while a PR is being built", () => {
    expect(itemPackage({ work_package: "HVAC System" }, cats)).toBe("HVAC System");
  });

  it("falls back to the category for an unknown name when the valid set is known", () => {
    const valid = new Set(["Electrical Work", "HVAC System"]);
    expect(itemPackage({ procurement_package: "Electrial Work", category: "Wires" }, cats, valid)).toBe("Electrical Work");
    expect(itemPackage({ procurement_package: "Bogus", category: "Nope" }, cats, valid)).toBeNull();
  });

  it("gives null when nothing is usable", () => {
    expect(itemPackage({}, cats)).toBeNull();
  });
});

describe("derivePRPackages", () => {
  it("sorts and de-duplicates", () => {
    expect(
      derivePRPackages([{ work_package: "HVAC System" }, { work_package: "Electrical Work" }, { work_package: "HVAC System" }]),
    ).toEqual(["Electrical Work", "HVAC System"]);
  });

  it("handles no items", () => {
    expect(derivePRPackages(undefined)).toEqual([]);
    expect(derivePRPackages([])).toEqual([]);
  });
});

describe("uniqueTagPackages", () => {
  it("shows an old PR's repeated HVAC rows once", () => {
    expect(
      uniqueTagPackages([
        { tag_package: "HVAC System" },
        { tag_package: "HVAC System" },
        { tag_package: "Electrical Work" },
        { tag_package: "" },
        { tag_package: null },
      ]),
    ).toEqual(["Electrical Work", "HVAC System"]);
  });

  it("handles no rows", () => {
    expect(uniqueTagPackages(null)).toEqual([]);
  });
});
