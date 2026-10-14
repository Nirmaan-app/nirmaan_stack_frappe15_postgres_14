import { describe, expect, it } from "vitest";
import { buildPackageOptions, filterPOsByPackage, PRPackageRow } from "./utils";

const values = (options: { value: string }[]) => options.map((o) => o.value);

describe("buildPackageOptions (Critical PO 'Select Package' dropdown)", () => {
  const enabled = [
    { procurement_package: "Electrical Work" },
    { procurement_package: "HVAC System" },
    { procurement_package: "Electrical Work" },
  ];

  it("lists the enabled packages, sorted and once each, then Custom", () => {
    expect(values(buildPackageOptions(enabled, []))).toEqual(["Electrical Work", "HVAC System", "Custom"]);
  });

  it("adds a package a PR carries that the project never enabled", () => {
    // A tools-only PR carries "Tool & Equipments"; its PO must have an option to show under.
    const prRows: PRPackageRow[] = [
      { name: "PR-1", work_package: "Normal", tag_package: "Tool & Equipments" },
      { name: "PR-2", work_package: "Normal", tag_package: "Electrical Work" },
      { name: "PR-3", work_package: "Custom", tag_package: null },
    ];
    expect(values(buildPackageOptions(enabled, prRows))).toEqual([
      "Electrical Work",
      "HVAC System",
      "Tool & Equipments",
      "Custom",
    ]);
  });

  it("keeps Custom last and never twice, and works with no data yet", () => {
    expect(values(buildPackageOptions(undefined, undefined))).toEqual(["Custom"]);
    expect(values(buildPackageOptions([{ procurement_package: "Custom" }], []))).toEqual(["Custom"]);
  });

  it("every option it adds finds the PO in filterPOsByPackage", () => {
    const prRows: PRPackageRow[] = [{ name: "PR-1", work_package: "Normal", tag_package: "Tool & Equipments" }];
    const pos = [{ name: "PO/1", procurement_request: "PR-1" }];
    expect(filterPOsByPackage(pos, prRows, "Tool & Equipments")).toEqual(pos);
  });
});
