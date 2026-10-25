import { describe, expect, it } from "vitest";

import {
  compactMaintenanceChecks,
  compactRows,
  compactTextMap,
  dlpEnd,
  documentChip,
  levelLabel,
  binderContents,
  needsSaving,
  canonicalMaterial,
  duplicateItems,
  duplicateLocations,
  inventoryEntries,
  inventoryMatrix,
  inventoryMatrixOf,
  inventoryProblem,
  inventoryTotals,
  materialUse,
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
  status: "Not Started" as const,
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

describe("Inventory List: location entries <-> printed matrix", () => {
  const stored = {
    materials: ["Diffuser", "Grille", "Damper"],
    locations: [
      { name: "OPS - 02", qty: ["15", 0, "3"] },
      { name: "Lounge", qty: ["", "", "4"] },
    ],
  };

  it("reads the stored matrix as locations, a blank or 0 cell meaning not there", () => {
    expect(inventoryEntries(stored)).toEqual([
      {
        name: "OPS - 02",
        items: [
          { material: "Diffuser", qty: "15" },
          { material: "Damper", qty: "3" },
        ],
      },
      { name: "Lounge", items: [{ material: "Damper", qty: "4" }] },
    ]);
  });

  it("an unedited list keeps its cells, an empty one becoming 0", () => {
    expect(inventoryMatrixOf(stored)).toEqual({
      materials: stored.materials,
      locations: [
        { name: "OPS - 02", qty: ["15", 0, "3"] },
        { name: "Lounge", qty: ["0", "0", "4"] },
      ],
    });
  });

  it("keeps the stored column order, adds new materials after, 0 for what a location lacks", () => {
    const entries = [
      { name: "Lounge", items: [{ material: "Sensor", qty: "2" }, { material: "damper ", qty: "4" }] },
      { name: "OPS - 02", items: [{ material: "Diffuser", qty: "15" }] },
    ];
    expect(inventoryMatrix(entries, stored.materials)).toEqual({
      materials: ["Diffuser", "damper", "Sensor"],
      locations: [
        { name: "Lounge", qty: ["0", "4", "2"] },
        { name: "OPS - 02", qty: ["15", "0", "0"] },
      ],
    });
  });

  it("one column per material whatever the case or spacing; a repeat in one location adds nothing", () => {
    const entries = [
      { name: "A", items: [{ material: "Fan Coil  Unit", qty: "1" }, { material: "fan coil unit", qty: "9" }] },
      { name: "B", items: [{ material: " FAN COIL UNIT", qty: "2" }] },
    ];
    expect(inventoryMatrix(entries, [])).toEqual({
      materials: ["Fan Coil Unit"],
      locations: [
        { name: "A", qty: ["1"] },
        { name: "B", qty: ["2"] },
      ],
    });
    expect([...duplicateItems(entries[0].items)]).toEqual([1]);
  });

  it("a material entered with no count prints 0", () => {
    expect(
      inventoryMatrix([{ name: "A", items: [{ material: "Damper", qty: " " }] }], []),
    ).toEqual({ materials: ["Damper"], locations: [{ name: "A", qty: ["0"] }] });
  });

  it("drops a location with no name and no material, and a material nobody has", () => {
    const entries = [
      { name: "  ", items: [{ material: "", qty: "5" }] },
      { name: "Store", items: [] },
    ];
    expect(inventoryMatrix(entries, ["Diffuser"])).toEqual({
      materials: [],
      locations: [{ name: "Store", qty: [] }],
    });
  });

  it("round-trips: a 0 cell reads back as not there and is written back as 0", () => {
    const clean = {
      materials: ["Diffuser", "Damper"],
      locations: [
        { name: "A", qty: ["1", "0"] },
        { name: "B", qty: ["0", "2"] },
      ],
    };
    expect(
      inventoryMatrixOf({ ...clean, entries: inventoryEntries(clean) }),
    ).toEqual(clean);
  });

  it("snaps a typed material to the spelling already on the list, not to itself", () => {
    const entries = [
      { name: "A", items: [{ material: "Fan coil unit", qty: "1" }] },
      { name: "B", items: [{ material: "fan COIL unit ", qty: "" }] },
    ];
    expect(canonicalMaterial(entries, "fan COIL unit ", { entry: 1, item: 0 })).toBe("Fan coil unit");
    expect(canonicalMaterial(entries, " Thermostat ", { entry: 1, item: 0 })).toBe("Thermostat");
    expect(canonicalMaterial([entries[1]], "fan COIL unit ", { entry: 0, item: 0 })).toBe("fan COIL unit");
  });

  it("a location name entered twice is a repeat of the first, whatever the case or spacing", () => {
    const entries = [
      { name: "test location 2", items: [] },
      { name: "OPS - 02", items: [] },
      { name: " Test  Location 2", items: [] },
      { name: "", items: [] },
      { name: "", items: [] },
    ];
    expect([...duplicateLocations(entries)]).toEqual([[2, 0]]);
  });

  it("will not mark an edited list Done with a repeated location or material", () => {
    const loc = { name: "Lounge", items: [{ material: "Damper", qty: "1" }] };
    expect(inventoryProblem({ entries: [loc, { ...loc, name: "lounge" }] })).toBe(
      'Location 2 "lounge" is already location 1. Each location can be entered only once.',
    );
    expect(
      inventoryProblem({
        entries: [{ name: "Lounge", items: [...loc.items, { material: "damper ", qty: "2" }] }],
      }),
    ).toBe('Location 1 has "damper" twice. Remove one of them.');
    expect(inventoryProblem({ entries: [loc, { ...loc, name: "Store" }] })).toBe("");
    // An unedited list is the stored matrix, saved as it is.
    expect(
      inventoryProblem({ materials: ["Damper"], locations: [{ name: "A" }, { name: "A" }] }),
    ).toBe("");
  });

  it("counts the locations that use each material", () => {
    const entries = [
      { name: "A", items: [{ material: "Damper", qty: "1" }, { material: "damper", qty: "1" }] },
      { name: "B", items: [{ material: "DAMPER", qty: "2" }, { material: "Grille", qty: "1" }] },
    ];
    expect(materialUse(entries)).toEqual([
      { name: "Damper", locations: 2 },
      { name: "Grille", locations: 1 },
    ]);
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
  // Every row opens (Edit / View) since 2026-10-06; `needsSaving` is the separate question -- the Done gate.
  it("gates Done on a From Nirmaan document ONLY", () => {
    expect(needsSaving({ kind: "app", fill: false })).toBe(true);
    // a form prints from its own layout with nothing filled in (owner 2026-09-28)
    expect(needsSaving({ kind: "form", fill: true })).toBe(false);
    expect(needsSaving({ kind: "template", fill: true })).toBe(false);
    expect(needsSaving({ kind: "template", fill: false })).toBe(false);
  });
});

describe("binderContents", () => {
  // Mirrors `binder.build_plan`: switched-on rows in checklist order, Done ones in, the rest skipped.
  const withStatus = (key: string, status: HodRow["status"], disabled: 0 | 1 = 0): HodRow => ({
    ...row(key, disabled),
    status,
  });

  it("puts Done documents in and skips the rest, numbered as the checklist prints them", () => {
    const out = binderContents(
      [withStatus("c", "Done"), withStatus("a", "WIP"), withStatus("b", "Done", 1), withStatus("d", "Not Started")],
      docs,
    );
    // b is switched off, so the S.No close up: a=1, c=2, d=3
    expect(out.included.map((e) => [e.sno, e.row.document])).toEqual([[2, "c"]]);
    expect(out.skipped.map((e) => [e.sno, e.row.document])).toEqual([[1, "a"], [3, "d"]]);
    expect(out.off).toBe(1);
  });

  it("agrees with the checklist numbering", () => {
    const rows = [withStatus("a", "Done"), withStatus("b", "WIP", 1), withStatus("c", "Done")];
    const numbers = printedNumbers(rows, docs);
    for (const e of binderContents(rows, docs).included)
      expect(e.sno).toBe(numbers.get(e.row.document));
  });
});
