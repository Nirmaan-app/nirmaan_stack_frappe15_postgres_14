// ELR-1 AC3 (owner R-UNIT: the 12c-U note carried to the attribute path; Q1 ruling 2026-10-27 "a"): a PRICED BoQ row
// that stated no unit, or a rate-only one, says which unit its figure is a rate in -- the matched catalogue row's unit,
// or "one <category> item" for an assembly. The 12c-U lead and verb are reused; the item-list path is untouched.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import type { PipelineResult, RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { attributeUnitNote } from "./pricingSheetHelper";

const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const asset = readJsonFixture<never>(pathToFileURL(path.join(DATA, "rate_master_electrical_all_v67.json"))) as
  { items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const items = asset.items;
const cfgOf = (id: string) => asset.category_configs.find((c) => c.category_id === id)!;
const primaryOf = (id: string) => Object.keys(cfgOf(id).pipelines ?? {}).find((p) => !/bcs/i.test(p))!;
/** A primary result that matched `kind`'s first catalogue row (the `match_master_row` outcome), or none. */
const matched = (kind?: string): PipelineResult | undefined =>
  kind ? ({ status: "ok", matchedItem: items.find((i) => i.kind === kind) } as unknown as PipelineResult) : ({ status: "ok" } as PipelineResult);
const note = (cid: string, unit: string | undefined, kind?: string, pid = primaryOf(cid)) =>
  attributeUnitNote(cfgOf(cid), items, unit, pid, matched(kind));

describe("ELR-1 AC3: the unit note on the attribute path", () => {
  it("ONE MATCHED CATALOGUE ROW: the 12c-U sentence with that row's unit", () => {
    expect(note("conduit_piping", "", "conduit")).toBe("No unit on the BoQ row -> priced per Mtr, the catalogue's unit for this item");
    expect(note("cabletray_raceway", "", "cable_tray")).toBe("No unit on the BoQ row -> priced per Rmt, the catalogue's unit for this item");
    expect(note("junction_box_raceway", "", "junction_box")).toBe("No unit on the BoQ row -> priced per Nos, the catalogue's unit for this item");
    expect(note("wiring_cabling", "", "cable", "cable_boq")).toBe("No unit on the BoQ row -> priced per Mtr, the catalogue's unit for this item");
    expect(note("wiring_cabling", "R/O", "termination", "termination_boq")).toBe("BoQ says R/O (rate only) -> priced per Set, the catalogue's unit for this item");
  });

  it("ONE OWN-KIND COMPONENT (an industrial socket with its paired MCB): that component's catalogue unit", () => {
    expect(note("industrial_sockets", "")).toBe("No unit on the BoQ row -> priced per Nos, the catalogue's unit for this item");
  });

  it("AN ASSEMBLY: the same lead, 'priced as one <category> item' (owner Q1 'a')", () => {
    expect(note("point_wiring", "R/O")).toBe("BoQ says R/O (rate only) -> priced as one Point Wiring item");
    expect(note("db_switchgear", "QRO")).toBe("BoQ says QRO (rate only) -> priced as one DB and Switchgear item");
    expect(note("switches_sockets", "")).toBe("No unit on the BoQ row -> priced as one Switches and Sockets item");
    // a pop-up box matches its box row AND sums its module components: still an assembly, never "per Module"
    expect(note("popup_boxes", "", "popup_box_module")).toBe("No unit on the BoQ row -> priced as one Pop up Boxes item");
  });

  it("the rate-only spellings are one key (R/O, RO, R.O., Rate Only, QRO, a marker before a unit)", () => {
    for (const u of ["R/O", "RO", "R.O.", "Rate Only", "QRO", "QRO - Mtr"]) {
      expect(note("conduit_piping", u, "conduit"), u).toBe(`BoQ says ${u} (rate only) -> priced per Mtr, the catalogue's unit for this item`);
    }
  });

  it("NEGATIVE: a real unit says nothing; the calculator (no row unit) says nothing", () => {
    for (const u of ["Mtr", "Nos", "Rmt", "Set", "Point"]) expect(note("conduit_piping", u, "conduit"), u).toBeUndefined();
    expect(note("conduit_piping", undefined, "conduit")).toBeUndefined();
  });

  it("the attribute path never refuses on a unit and never moves a figure: the note is display only (source pin)", () => {
    const src = fs.readFileSync(path.join(__dirname, "pricingSheetHelper.ts"), "utf-8");
    // only on a PRICED row, only into `workings.unitNote`
    expect(src.match(/attributeUnitNote\(/g)?.length).toBe(3);   // the definition + the two call sites
    expect(src).toContain("const unitNote = Object.keys(values).length\n      ? attributeUnitNote(category, items,");
    expect(src).toContain("const unitNote = Object.keys(values).length\n    ? attributeUnitNote(config, items,");
  });
});
