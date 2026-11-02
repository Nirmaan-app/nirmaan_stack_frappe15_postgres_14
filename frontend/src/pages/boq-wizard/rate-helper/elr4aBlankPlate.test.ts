// ELR-4a AC4 (owner R-PW-BLANK / R-KEEP, 2026-10-29; Q1 (A)): point wiring's "Blank plate" is hidden on the panel and
// the calculator by `panel: false`, and the note N1 says how the blank count is worked out, in the field's place;
// switches & sockets and pop-up boxes keep "Blank plate"; no priced figure moves.
import { describe, expect, it } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import type { RateCategoryConfig } from "@/pages/pricing/rate-master/rateMasterTypes";
import { blanksWorkedOutNote } from "./pricingSheetHelper";
import { isSuggestion, type HelperResult, type WorkingsAttribute } from "./rateHelperTypes";
import { HIDDEN, LIVE, N1, boqResult, calcResult, pwRow } from "./elr4aBlankPlate.harness";

const DATA_DIR = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const ASSET_V70 = "rate_master_electrical_all_v70.json";

const attrs = (r: HelperResult): WorkingsAttribute[] => (isSuggestion(r) ? r.workings.attributes : []);
const ids = (r: HelperResult) => attrs(r).map((a) => a.id);
const priced = (r: HelperResult) => isSuggestion(r) && Object.keys(r.values ?? {}).length > 0;

describe("ELR-4a: the note N1, written from the config", () => {
  it("POSITIVE: point wiring's blanks block (no display field) gives N1, on 'Blank plate qty'", () => {
    expect(blanksWorkedOutNote(LIVE.get("point_wiring")!)).toEqual({ attr: "blank_qty", text: N1 });
  });

  it("NEGATIVE: switches & sockets and pop-up boxes show their blanker on 'Blank plate' -> no note", () => {
    expect(blanksWorkedOutNote(LIVE.get("switches_sockets")!)).toBeNull();
    expect(blanksWorkedOutNote(LIVE.get("popup_boxes")!)).toBeNull();
    const shown = structuredClone(LIVE.get("point_wiring")!);
    for (const pl of Object.values(shown.pipelines ?? {})) for (const s of pl.steps ?? []) {
      const b = (s as { params?: { blanks?: Record<string, unknown> } }).params?.blanks;
      if (b) b.display_attr = "blank_item";
    }
    expect(blanksWorkedOutNote(shown)).toBeNull();
  });

  it("the words follow the config: the blanker's name and a term's weight", () => {
    const c = structuredClone(LIVE.get("point_wiring")!);
    for (const pl of Object.values(c.pipelines ?? {})) for (const s of pl.steps ?? []) {
      const p = (s as { params?: { blanks?: Record<string, unknown>; terms?: Array<Record<string, unknown>> } }).params;
      if (p?.blanks) { p.blanks.item_when_positive = "2M Blanker"; p.terms![0].weight = 3; }
    }
    const t = blanksWorkedOutNote(c)!.text;
    expect(t).toContain("(a socket takes 3, a switch 1)");
    expect(t).toContain("gets a '2M Blanker'");
  });
});

describe("ELR-4a AC4: point wiring's 'Blank plate' gone from both screens, the note in its place", () => {
  it("calculator: WAS 'Blank plate' starred between 'Socket qty' and 'Blank plate qty'; NOW gone, N1 on 'Blank plate qty'", () => {
    const was = calcResult(LIVE, "point_wiring");
    expect(ids(was)).toContain("blank_item");
    expect(attrs(was).find((a) => a.id === "blank_item")!.required).toBe(true);
    const now = calcResult(HIDDEN, "point_wiring");
    expect(ids(now)).not.toContain("blank_item");
    const at = ids(now).indexOf("blank_qty");
    expect(ids(now)[at - 1]).toBe("socket_qty");
    expect(attrs(now)[at].leadNote).toBe(N1);
    expect(attrs(now).filter((a) => a.leadNote).length).toBe(1);
    // "Blank plate qty" itself is unchanged: same label, not starred, editable
    const qty = attrs(now)[at];
    expect(qty.label).toBe("Blank plate qty");
    expect(qty.required).toBeUndefined();
    expect(qty.readOnly).toBeUndefined();
  });

  it("BoQ panel: the same field list and note as the calculator (calculator = panel)", () => {
    const panel = boqResult(HIDDEN, "point_wiring", pwRow("None"));
    expect(ids(panel)).toEqual(ids(calcResult(HIDDEN, "point_wiring")));
    expect(attrs(panel).find((a) => a.id === "blank_qty")!.leadNote).toBe(N1);
  });

  it("NO PRICE MOVES: a priced row prices the same figures with the field hidden", () => {
    const was = boqResult(LIVE, "point_wiring", pwRow("None"));
    const now = boqResult(HIDDEN, "point_wiring", pwRow("None"));
    expect(priced(was)).toBe(true);
    expect(isSuggestion(now) && now.values).toEqual(isSuggestion(was) && was.values);
  });

  it("Q1 (A), the declared change: WAS a row whose 'Blank plate' read came back blank refused on that field alone; NOW it prices, at the figures of the same row read 'None'", () => {
    const was = boqResult(LIVE, "point_wiring", pwRow(null));
    expect(priced(was)).toBe(false);
    expect(isSuggestion(was) && was.workings.derivation.join(" ")).toContain("Missing to price: Blank plate -- fill them to compute a rate.");
    const now = boqResult(HIDDEN, "point_wiring", pwRow(null));
    expect(priced(now)).toBe(true);
    expect(isSuggestion(now) && now.values).toEqual(isSuggestion(boqResult(LIVE, "point_wiring", pwRow("None"))) && (boqResult(LIVE, "point_wiring", pwRow("None")) as { values: unknown }).values);
  });
});

describe("ELR-4a AC4 (R-KEEP): switches & sockets and pop-up boxes keep 'Blank plate', with no note", () => {
  it("both screens", () => {
    for (const cat of ["switches_sockets", "popup_boxes"]) {
      for (const r of [calcResult(HIDDEN, cat), boqResult(HIDDEN, cat, {})]) {
        expect(ids(r), cat).toContain("blank_item");
        expect(attrs(r).find((a) => a.id === "blank_item")!.label, cat).toBe("Blank plate");
        expect(attrs(r).some((a) => a.leadNote), cat).toBe(false);
      }
    }
  });
});

describe("ELR-4a AC5: v70 = v69 + the declared wording + the one flag, nothing else", () => {
  const read = (f: string) => readJsonFixture<Record<string, unknown>>(pathToFileURL(path.join(DATA_DIR, f)));
  const diff = (x: unknown, y: unknown, p: string, out: string[]) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return out;
    if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
      const key = (v: unknown, i: string) => {
        const o = v as Record<string, unknown> | null;
        return String((o && typeof o === "object" && (o.item_uid ?? o.category_id ?? o.id)) ?? i);
      };
      const xs = x as Record<string, unknown>, ys = y as Record<string, unknown>;
      for (const k of new Set([...Object.keys(xs), ...Object.keys(ys)])) {
        diff(xs[k], ys[k], Array.isArray(x) ? `${p}[${key(xs[k] ?? ys[k], k)}]` : `${p}.${k}`, out);
      }
      return out;
    }
    out.push(p);
    return out;
  };

  it("the diff is exactly the declared paths: four notes, the config notes, golden pw5 (both copies), blank_item's panel flag", () => {
    expect(diff(read("rate_master_electrical_all_v69.json"), read(ASSET_V70), "", []).sort()).toEqual([
      ".category_configs[point_wiring].attribute_definitions[blank_item].panel",
      ".category_configs[point_wiring].attribute_definitions[circuit_wire1_runs].note",
      ".category_configs[point_wiring].attribute_definitions[circuit_wire2_runs].note",
      ".category_configs[point_wiring].attribute_definitions[wire1_runs].note",
      ".category_configs[point_wiring].attribute_definitions[wire2_runs].note",
      ".category_configs[point_wiring].goldens[pw5].note",
      ".category_configs[point_wiring].notes",
      ".goldens.point_wiring[pw5].note",
    ]);
  });

  it("the flag is the one the harness applies, and v70's configs give the same fields and note as the harness", () => {
    const v70 = new Map<string, RateCategoryConfig>(
      (read(ASSET_V70).category_configs as RateCategoryConfig[]).map((c) => [c.category_id, c]));
    const bi = (v70.get("point_wiring")!.attribute_definitions ?? []).find((d) => d.id === "blank_item") as unknown as Record<string, unknown>;
    expect(bi.panel).toBe(false);
    for (const cat of ["point_wiring", "switches_sockets", "popup_boxes"]) {
      expect(attrs(calcResult(v70, cat)).map((a) => [a.id, a.required ?? false, a.leadNote ?? null]), cat)
        .toEqual(attrs(calcResult(HIDDEN, cat)).map((a) => [a.id, a.required ?? false, a.leadNote ?? null]));
    }
  });

  it("the (b) clause and the (d) re-wording are in v70's texts, word for word", () => {
    const pw = (read(ASSET_V70).category_configs as Array<Record<string, any>>).find((c) => c.category_id === "point_wiring")!;
    const clause = "A multi-core wire keeps its cores; a 1-core wire of the same size is added to make three.";
    for (const id of ["wire1_runs", "wire2_runs", "circuit_wire1_runs", "circuit_wire2_runs"]) {
      expect(pw.attribute_definitions.find((d: { id: string }) => d.id === id).note.endsWith(` ${clause}`), id).toBe(true);
    }
    expect(pw.notes).not.toMatch(/15 m|5 m,|15\/5|15 \+ \(points-1\)\*5/);
    expect(pw.notes).toContain("Primary -> the Pricing Input 'Point wiring - circuit length of the first point'");
    expect(pw.goldens[4].note).toContain("over the default length, the Pricing Input 'Point wiring - circuit wiring stretch, DB to the first point',");
  });
});
