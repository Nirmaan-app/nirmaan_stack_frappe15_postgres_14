import { describe, expect, it } from "vitest";

import {
  compactMaintenanceChecks,
  compactRows,
  compactTextMap,
  dlpEnd,
  levelLabel,
  inventoryTotals,
  printedNumbers,
  maintenanceSheet,
  rowEditable,
  withMaintenanceResult,
  withMaintenanceSheet,
} from "./hodRules";
import type { HodDocumentMeta, HodRow } from "./types";

const docs: HodDocumentMeta[] = ["a", "b", "c", "d"].map((key, i) => ({
  key,
  no: i + 1,
  title: key.toUpperCase(),
  kind: "form",
  landscape: false,
  fill: false,
  library: null,
  source: null,
}));

const row = (document: string, disabled: 0 | 1 = 0): HodRow => ({
  name: `r-${document}`,
  hod_system: "Electrical",
  document,
  status: "Pending" as const,
  disabled,
  remarks: null,
  attachment: null,
  form_data: {},
  modified: "",
  creation: "",
});

describe("printedNumbers", () => {
  it("closes up the S.No around switched-off rows, in index order", () => {
    const nums = printedNumbers(
      [row("d"), row("b", 1), row("a"), row("c")],
      docs,
    );
    expect(Object.fromEntries(nums)).toEqual({ a: 1, c: 2, d: 3 });
  });
});

describe("rowEditable", () => {
  it("needs edit rights and the switch on", () => {
    expect(rowEditable(row("a"), true)).toBe(true);
    expect(rowEditable(row("a", 1), true)).toBe(false);
    expect(rowEditable(row("a"), false)).toBe(false);
  });
});

describe("compactRows", () => {
  it("drops rows with nothing typed", () => {
    expect(
      compactRows([{ material: "" }, { material: " MCB " }, { qty: "" }]),
    ).toEqual([{ material: " MCB " }]);
  });
});

describe("inventoryTotals", () => {
  it("sums numeric cells per column", () => {
    expect(
      inventoryTotals([{ qty: [4, 2, "6"] }, { qty: [2, "", null] }], 3),
    ).toEqual([6, 2, 6]);
  });
});

describe("dlpEnd (mirrors services/hod/dates.dlp_end)", () => {
  it("owner sample: 08-Jan-2025 -> 07-Jan-2026", () => {
    expect(dlpEnd("2025-01-08")).toBe("2026-01-07");
  });
  it("clamps month ends", () => {
    expect(dlpEnd("2024-02-29")).toBe("2025-02-27");
    expect(dlpEnd("2025-01-31", 1)).toBe("2025-02-27");
  });
  it("blank for a bad date", () => {
    expect(dlpEnd("")).toBe("");
  });
});

describe("maintenance checks (mirrors services/hod/maintenance)", () => {
  it("patches one item without touching the rest of the form", () => {
    let v: Record<string, unknown> = { included: ["VRF"], date: "2026-09-22" };
    v = withMaintenanceResult(v, "b1", "list_1", "Clean filters", { result: "OK" });
    v = withMaintenanceResult(v, "b1", "list_1", "Clean filters", { remarks: "done" });
    v = withMaintenanceSheet(v, "b1", "list_2", { comments: "Next visit in March" });
    expect(v.included).toEqual(["VRF"]);
    expect(maintenanceSheet(v, "b1", "list_1").results).toEqual({
      "Clean filters": { result: "OK", remarks: "done" },
    });
    expect(maintenanceSheet(v, "b1", "list_2").comments).toBe("Next visit in March");
    expect(maintenanceSheet(v, "b9", "list_1")).toEqual({});
  });
  it("compacting drops empty items, sheets and blocks", () => {
    expect(
      compactMaintenanceChecks({
        b1: {
          list_1: { results: { A: { result: "", remarks: " " }, B: { result: "Not OK" } }, comments: "" },
          list_2: { results: { C: {} }, comments: "  " },
        },
        b2: { list_1: { results: {} } },
        b3: "junk",
      }),
    ).toEqual({ b1: { list_1: { results: { B: { result: "Not OK", remarks: "" } }, comments: "" } } });
  });
});

describe("compactTextMap", () => {
  it("keeps only non-blank text, trimmed", () => {
    expect(compactTextMap({ Multimeter: " 2 nos ", Clamp: "  ", Drill: 5 })).toEqual({
      Multimeter: "2 nos",
      Drill: "5",
    });
    expect(compactTextMap(null)).toEqual({});
    expect(compactTextMap(["x"])).toEqual({});
  });
});

describe("levelLabel (mirrors services/hod/escalation.level_label)", () => {
  it("names a level by its position", () => {
    expect([0, 1, 2, 3, 4].map(levelLabel)).toEqual([
      "1st Level",
      "2nd Level",
      "3rd Level",
      "4th Level",
      "5th Level",
    ]);
    expect(levelLabel(10)).toBe("11th Level");
  });
});
