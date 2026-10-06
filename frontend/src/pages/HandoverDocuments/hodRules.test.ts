import { describe, expect, it } from "vitest";

import {
  compactMaintenanceChecks,
  compactRows,
  compactTextMap,
  dlpEnd,
  documentChip,
  levelLabel,
  isSaved,
  needsSaving,
  uploadedFile,
  inventoryTotals,
  printedNumbers,
  maintenanceDate,
  maintenanceSheet,
  visibleRows,
  rowEditable,
  withMaintenanceDate,
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
  status: "NO" as const,
  disabled,
  remarks: null,
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
  it("each period keeps its own date, and the pre-split one is the fallback", () => {
    // a row saved before the split shows its single date on BOTH periods
    const old = { date: "2026-01-09" };
    expect(maintenanceDate(old, "list_1")).toBe("2026-01-09");
    expect(maintenanceDate(old, "list_2")).toBe("2026-01-09");

    // the first edit freezes BOTH, so dropping `date` on save cannot lose the untouched one
    const v = withMaintenanceDate(old, "list_1", "2026-03-14");
    expect(v.dates).toEqual({ list_1: "2026-03-14", list_2: "2026-01-09" });
    expect(maintenanceDate(v, "list_1")).toBe("2026-03-14");

    // an explicitly cleared period reads blank once `date` is gone
    const cleared = withMaintenanceDate({ dates: { list_1: "2026-03-14" } }, "list_1", "");
    expect(maintenanceDate(cleared, "list_1")).toBe("");
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

describe("visibleRows (the grid forms' blank starter block)", () => {
  it("pads only when NOTHING is stored, so a delete can actually take", () => {
    // nothing stored yet -> a blank starter block to type into
    expect(visibleRows([], 5, false)).toHaveLength(5);
    // anything stored -> exactly that, even below minRows. Topping it back up to minRows is what made
    // the per-row delete button dead: the row went and the pad put an empty one straight back.
    expect(visibleRows([{ a: "1" }, {}], 5, false)).toEqual([{ a: "1" }, {}]);
    expect(visibleRows([{}], 5, false)).toEqual([{}]);
    // deleting the last row leaves the starter block, never a stuck empty grid
    expect(visibleRows([], 5, false)).toHaveLength(5);
    // read-only never invents rows
    expect(visibleRows([], 5, true)).toEqual([]);
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

describe("documentChip", () => {
  it("calls anything the project fills a Form, wherever its text comes from", () => {
    // Recommended Tools / Maintenance Checklist: library text, but the project fills it
    expect(documentChip({ kind: "template", fill: true }).label).toBe("Form");
    expect(documentChip({ kind: "form", fill: true }).label).toBe("Form");
    expect(documentChip({ kind: "template", fill: false }).label).toBe("Library");
    expect(documentChip({ kind: "app", fill: false }).label).toBe("From Nirmaan");
  });
});

describe("needsSaving", () => {
  // `hasEditor` (which rows get Edit / View) is gone: since 2026-10-06 every document takes an upload,
  // so every row opens. `needsSaving` was always the separate question -- the YES gate.
  it("gates YES on a From Nirmaan document ONLY", () => {
    expect(needsSaving({ kind: "app", fill: false })).toBe(true);
    // a form prints from its own layout with nothing filled in (owner 2026-09-28)
    expect(needsSaving({ kind: "form", fill: true })).toBe(false);
    expect(needsSaving({ kind: "template", fill: true })).toBe(false);
    expect(needsSaving({ kind: "template", fill: false })).toBe(false);
  });

});

describe("uploadedFile", () => {
  // Mirrors `services/hod/checklist.uploaded_file`: the ONE reader of `form_data.upload`.
  const file = { url: "/private/files/om.pdf", file_name: "om.pdf" };

  it("reads the upload", () => {
    expect(uploadedFile({ form_data: { upload: file } })).toEqual(file);
    expect(uploadedFile({ form_data: { upload: { url: " /f/x.pdf " } } })).toEqual({
      url: "/f/x.pdf",
      file_name: "Uploaded file",
    });
  });

  it("is null when nothing usable is uploaded -- the generated document stays", () => {
    expect(uploadedFile({ form_data: {} })).toBeNull();
    expect(uploadedFile({ form_data: { included: ["all"] } })).toBeNull();
    expect(uploadedFile({ form_data: { upload: { url: "  " } } })).toBeNull();
    expect(uploadedFile({ form_data: { upload: "/f/x.pdf" } })).toBeNull();
  });

  it("makes a From Nirmaan document answerable YES -- the file is its content", () => {
    expect(isSaved({ form_data: {} })).toBe(false);
    expect(isSaved({ form_data: { upload: file } })).toBe(true);
  });
});
