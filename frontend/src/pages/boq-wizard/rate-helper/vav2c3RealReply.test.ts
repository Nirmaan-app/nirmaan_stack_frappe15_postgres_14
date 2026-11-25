/**
 * VAV-2c3 K3 - T4: the point-4 answer ("Needs installing" / "Why no installing", owner 2026-11-23 13:56 point 4; 2026-11-24 00:25 "supply only can
 * also be for attic ctock mentoipned explicitly") read from REAL replies CUT from the paid run's capture (__fixtures__/vav2c3RealReplies.json),
 * priced on scratch copies of the v84 file with the v85 edits (vav2c3b.harness): "No" + a reason -> Supply only with note G naming the
 * model's reason; "Yes" and a left-out answer -> the default (Supply + installation, no note G).
 */
import path from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import { parseJson } from "@/lib/parseJson";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import type { ItemListView } from "./pricingSheetHelper";
import { sheet81, type Row81 } from "./vav2b2.harness";
import { ITEMS84, cfg85 } from "./vav2c3b.harness";

type Reply = { id: number; items: Array<{ attributes: Record<string, { value: unknown }> }> };
const FX = readJsonFixture<{ rows: Array<{ boq: string; sheet: string; excel_row: number; description: string; capture_line: string; raw_reply: string }> }>(
  pathToFileURL(path.resolve(__dirname, "__fixtures__/vav2c3RealReplies.json")));
const reply = (row: number): Reply => parseJson(FX.rows.find((r) => r.excel_row === row)!.raw_reply) as Reply;
/** the reply's first item as the run stored it (each answer's value), optionally with answers changed / left out */
const asRow = (row: number, text: string, change: Record<string, string> = {}, drop: string[] = []): Row81 => {
  const at = Object.fromEntries(Object.entries(reply(row).items[0].attributes).map(([k, v]) => [k, v.value]));
  for (const d of drop) delete at[d];
  return { qty: 2, text, unit: "Nos", items: [{ ...at, ...change }] } as never;
};
const C85 = cfg85("hvac_vav_box");
const price = (rows: Record<number, Row81>, er: number): ItemListView => sheet81(rows, { cfg: C85, items: ITEMS84 })(er).itemList!;
const NOTE_G = (reason: string) => `Supply only: this item does not need installing (${reason}). Change the scope if installation is required.`;

describe("T4 - the point-4 answer from REAL replies of the paid run", () => {
  it("the fixture is the run's own: two rows, each with its capture line, cut verbatim", () => {
    expect(FX.rows.map((r) => `${r.boq}|${r.sheet}|${r.excel_row}`)).toEqual(["BOQ-26-00016|Dismantling-ELE|33", "BOQ-26-00003|PUNE HVAC BOQ|248"]);
    for (const r of FX.rows) expect(r.capture_line).toMatch(/^capture_run:\d+$/);
    expect(reply(33).items[0].attributes.needs_installing.value).toBe("No");
    expect(reply(248).items[0].attributes.needs_installing.value).toBe("Yes");
  });
  it("'No' + the model's reason (BOQ-26-00016 'Dismantling-ELE' r33) -> Supply only with note G naming that reason", () => {
    const why = String(reply(33).items[0].attributes.no_install_reason.value);
    expect(why).toBe("Removing & handing over / storing of existing VAV's");
    const v = price({ 33: asRow(33, FX.rows[0].description) }, 33);
    expect(v.scope?.value).toBe("Supply only");
    expect(v.scope?.note).toBe(NOTE_G(why));
  });
  it("NEGATIVE: the same reply with 'Yes' -> the default scope, no note G", () => {
    const v = price({ 33: asRow(33, FX.rows[0].description, { needs_installing: "Yes", no_install_reason: "None" }) }, 33);
    expect(v.scope?.value).not.toBe("Supply only");
    expect(v.scope?.note ?? "").not.toContain("does not need installing");
  });
  it("'Yes' (BOQ-26-00003 'PUNE HVAC BOQ' r248, a VAV box) -> Supply + installation, priced, no note G", () => {
    const v = price({ 248: asRow(248, "Up to 650 CFM") }, 248);
    expect(v.rowPriced).toBe(true);
    expect(v.scope?.value ?? "Supply + installation").toBe("Supply + installation");
    expect(v.scope?.note ?? "").not.toContain("does not need installing");
    expect(v.totals?.install_rate ?? 0).toBeGreaterThan(0);
  });
  it("a reply that LEFT OUT the point-4 answer -> the default, as 'Yes'", () => {
    const a = price({ 248: asRow(248, "Up to 650 CFM") }, 248), b = price({ 248: asRow(248, "Up to 650 CFM", {}, ["needs_installing", "no_install_reason"]) }, 248);
    expect(b.totals).toEqual(a.totals);
    expect(b.scope?.value ?? "Supply + installation").toBe("Supply + installation");
  });
});
