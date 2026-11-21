/**
 * VAV-2b2 R16 PARITY, the TS half (F1: one rule, pinned FE <-> BE): the PRODUCT's own VAV own-row tests (vavSeparateRow, composed as
 * vavSheetOf composes them) on the 815 real rows of `__fixtures__/vav2b2ClaimRows.json` give exactly the kinds the fixture records -- the
 * same kinds services/boq_rate_master/vav_claims.py gives (test_vav2b2_keys test_10). A change to either side's word tests fails one half.
 */
import path from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { vavSeparateRow } from "./pricingSheetHelper";
import { vav81 } from "./vav2b2.harness";

type FixRow = { ref: string; category: string; unit: string; text: string; headings: string[]; ts_kind: string | null; claim: string | null };
const ROWS = readJsonFixture<{ rows: FixRow[] }>(pathToFileURL(path.resolve(__dirname, "__fixtures__", "vav2b2ClaimRows.json"))).rows;

/** the raw config JSON, read as the server reads it (only the parts the own-row tests use) */
type Ex = { share?: string; label: string; words: string; needs_vav?: boolean; not_words?: string; near_words?: string; near_chars?: number;
  not_near_words?: string; not_near_chars?: number; item_first?: boolean; not_integrator_rows?: boolean; controls_vav_words?: string;
  presence_only?: boolean; target?: { attr?: string } };
type Oc = Record<string, unknown> & { extras: Ex[]; artefact_words?: string; serves?: { item_first?: boolean; extras?: string[]; also?: string[] } };
type Spec = { own_row_check: Oc; sheet_shares: { separate: { extras: Ex[]; artefact_words?: Record<string, string> } } };
const sep = vavSeparateRow as unknown as (oc: unknown, e: unknown, l: unknown) => boolean;

function kindOf(spec: Spec, r: FixRow): string | null {
  const oc = spec.own_row_check, sh = spec.sheet_shares;
  const l = { row: 0, text: r.text, unit: r.unit || undefined, headings: r.headings };
  const integ = oc.extras.find((x) => x.presence_only && x.target?.attr);
  const ocI = { ...oc, serves: { ...(oc.serves ?? { item_first: true }), item_first: true, extras: [...(oc.serves?.extras ?? []), ...(oc.serves?.also ?? [])] } };
  for (const id of ["ddc", "bacnet", "dp"]) {
    const exs = sh.separate.extras.filter((e) => e.share === id);
    const oc2 = { ...oc, artefact_words: sh.separate.artefact_words?.[id] ?? oc.artefact_words, serves: { item_first: true, extras: exs.filter((e) => e.item_first).map((e) => e.label) } };
    for (const e of exs) {
      const ex = { label: e.label, target: { family: id }, words: e.words, needs_vav: e.needs_vav, not_words: e.not_words, near_words: e.near_words,
        near_chars: e.near_chars, not_near_words: e.not_near_words, not_near_chars: e.not_near_chars };
      const ctl = e.controls_vav_words ? new RegExp(e.controls_vav_words, "i") : null;
      const integOnly = !!e.not_integrator_rows && !!integ && sep(ocI, integ, l) && !(ctl && ctl.test(r.text.split(" | ")[0]));
      if (sep(oc2, ex, l) && !integOnly) return id;
    }
  }
  if (integ && sep(ocI, integ, l)) return "integrator";
  for (const [lab, id] of [["Conical piece", "conical"], ["Transformation piece", "transformation"]]) {
    const e = oc.extras.find((x) => x.label === lab);
    if (e && sep(oc, e, l)) return id;
  }
  return null;
}

describe("VAV-2b2 R16 parity: the product's own-row tests on the 815 fixture rows = the server's recognition", () => {
  const spec = (vav81() as unknown as { list_spec: { pricing: Spec } }).list_spec.pricing;
  it("every row's kind equals the fixture's (84 hits; count asserted)", () => {
    const diffs = ROWS.map((r) => [r.ref, kindOf(spec, r), r.ts_kind]).filter(([, a, b]) => a !== b);
    expect(diffs).toEqual([]);
    expect(ROWS.length).toBe(815);
    expect(ROWS.filter((r) => r.ts_kind).length).toBe(84);
  });
  it("VACUITY: without the adaptor not-words (QR-K2) one more row hits -- BOQ-26-00020 r194", () => {
    const off = structuredClone(spec);
    for (const e of off.sheet_shares.separate.extras) if (e.share === "bacnet") e.not_words = String(e.not_words ?? "").split("|").filter((w) => !/adaptor/.test(w)).join("|");
    const extra = ROWS.filter((r) => !r.ts_kind && kindOf(off, r)).map((r) => r.ref);
    expect(extra).toEqual(["BOQ-26-00020|HVAC_-19TH FLOOR|194"]);
  });
});
