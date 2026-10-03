// SLICE 1c -- the SPEC READER's frontend helpers. PURE, so they are pinned without a DOM or a server.
//
// The server owns the reader; these helpers only recognise the opt-in key, split the definitions for
// rendering, read the two reserved flag keys, and word the preview line. Each pin below protects one
// of those against the failure that would otherwise be silent: a string "true" opting a category in,
// a derived column rendered editable, a flagged item shown as ordinary, a preview that says nothing.

import { describe, it, expect } from "vitest";
import {
  SPEC_COPY,
  SPEC_NOTE_ATTR,
  SPEC_NOT_UNDERSTOOD,
  SPEC_STATUS_ATTR,
  SPEC_TEXT_ATTRS,
  isSpecDrivenConfig,
  isSpecTextAttr,
  specLine,
  specNotUnderstoodReason,
  splitSpecColumns,
  SPEC_CONFIRMED,
  SPEC_CONFIRMED_AT_ATTR,
  SPEC_CONFIRMED_BY_ATTR,
  SPEC_CONFIRM_COPY,
  acceptedFingerprints,
  applyCsvPayload,
  confirmedTag,
  createItemPayload,
  rowsWithSuggestion,
  saveItemPayload,
  specConfirmedInfo,
  specQuestion,
  specVerdict,
  asPercent,
  pricingInputCell,
  isPricingInputConfig,
  pricingInputUsedBy,
  pricingInputUsedByText,
  PRICING_INPUT_VALUE_COLUMNS,
  PRICING_INPUT_PERCENT_COLUMNS,
  PRICING_INPUT_COLUMN_LABELS,
  deriveRateColumnLabels,
  rateColumnLabel,
  RATE_LABEL_DISCIPLINES,
  RATE_LABEL_OWNER_SET,
  RATE_LABEL_UNSETTLED_NOTE,
  columnNote,
} from "./rateMasterSpec";
import type { AttributeDefinition } from "./rateMasterTypes";
import { UPLOAD_COPY, type UploadChange, type UploadPlan } from "./rateMasterUpload";

const defs: AttributeDefinition[] = [
  { id: "item_name", label: "Item", type: "choice", selector: false, panel: false },
  { id: "item_detail", label: "Item detail", type: "choice", selector: false, panel: false },
  { id: "family", label: "Family", type: "choice", values: ["VCD"] },
  { id: "brand", label: "Brand", type: "choice", values: ["x"] },
  { id: "dia_mm", label: "Diameter (mm)", type: "number" },
];

describe("isSpecDrivenConfig -- the opt-in is `true` and nothing else", () => {
  it("POSITIVE: true opts in", () => {
    expect(isSpecDrivenConfig({ attributes_from_spec: true })).toBe(true);
  });
  it("NEGATIVE: absent, false, a string and a null config do NOT opt in (Electrical is absent)", () => {
    expect(isSpecDrivenConfig({})).toBe(false);
    expect(isSpecDrivenConfig({ attributes_from_spec: false })).toBe(false);
    expect(isSpecDrivenConfig({ attributes_from_spec: "true" as unknown as boolean })).toBe(false);
    expect(isSpecDrivenConfig(null)).toBe(false);
    expect(isSpecDrivenConfig(undefined)).toBe(false);
  });
});

describe("splitSpecColumns -- text first, derived without brand, in config order", () => {
  it("puts item_name then item_detail first whatever the config order, and keeps brand out of derived", () => {
    const shuffled = [defs[2], defs[1], defs[3], defs[0], defs[4]];
    const { text, derived } = splitSpecColumns(shuffled);
    expect(text.map((d) => d.id)).toEqual(["item_name", "item_detail"]);
    expect(derived.map((d) => d.id)).toEqual(["family", "dia_mm"]);
  });
  it("NEGATIVE: a config without the text defs has no text columns and every non-brand def is derived", () => {
    const { text, derived } = splitSpecColumns([defs[2], defs[3], defs[4]]);
    expect(text).toEqual([]);
    expect(derived.map((d) => d.id)).toEqual(["family", "dia_mm"]);
  });
  it("isSpecTextAttr names exactly the two text keys", () => {
    expect(SPEC_TEXT_ATTRS).toEqual(["item_name", "item_detail"]);
    expect(isSpecTextAttr("item_name")).toBe(true);
    expect(isSpecTextAttr("family")).toBe(false);
    expect(isSpecTextAttr(SPEC_STATUS_ATTR)).toBe(false);
  });
});

describe("specNotUnderstoodReason -- the flag the server stores", () => {
  it("POSITIVE: a flagged item yields its reason", () => {
    const item = { attributes: { item_name: "Frobnicator", [SPEC_STATUS_ATTR]: SPEC_NOT_UNDERSTOOD, [SPEC_NOTE_ATTR]: "no known ADP family matches item 'Frobnicator'." } };
    expect(specNotUnderstoodReason(item)).toBe("no known ADP family matches item 'Frobnicator'.");
  });
  it("a flagged item with a blank note still reads as flagged, never as ordinary", () => {
    expect(specNotUnderstoodReason({ attributes: { [SPEC_STATUS_ATTR]: SPEC_NOT_UNDERSTOOD, [SPEC_NOTE_ATTR]: " " } })).toBe("(no reason recorded)");
  });
  it("NEGATIVE: an understood item, an item without the key, and a missing item yield null", () => {
    expect(specNotUnderstoodReason({ attributes: { item_name: "x", family: "VCD" } })).toBeNull();
    expect(specNotUnderstoodReason({ attributes: { [SPEC_STATUS_ATTR]: "ok" } })).toBeNull();
    expect(specNotUnderstoodReason(null)).toBeNull();
  });
});

describe("specLine -- the preview's one line per new or changed row", () => {
  it("lists what was read, in the server's order", () => {
    expect(specLine({ status: "ok", reason: null, read: { family: "square diffuser", damper: "with", neck_mm: 375 } }))
      .toBe("Read from spec: family = square diffuser, damper = with, neck_mm = 375");
  });
  it("says so when a family carries no other attribute", () => {
    expect(specLine({ status: "ok", reason: null, read: {} })).toBe(SPEC_COPY.previewNone);
  });
  it("NEGATIVE: a not-understood spec names the verdict AND the reason, never a guess", () => {
    const line = specLine({ status: "not_understood", reason: "no diameter found in 'huge' -- write it as '<n> mm dia'.", read: {} });
    expect(line.startsWith(SPEC_COPY.wontPrice)).toBe(true);
    expect(line).toContain("no diameter found in 'huge'");
    expect(line).not.toContain("=");
  });
});

describe("SPEC_COPY -- the owner's words", () => {
  it("labels derived attributes 'read from spec' and flagged items 'won't price: spec not understood'", () => {
    expect(SPEC_COPY.readFromSpec).toBe("read from spec");
    expect(SPEC_COPY.wontPrice).toBe("won't price: spec not understood");
  });
});


const change = (row: number, spec?: UploadChange["spec"]): UploadChange =>
  ({ row, kind: "add", item_uid: null, name: null, label: `r${row}`, major: true, fields: [], spec }) as UploadChange;
const sugg = (fp: string) => ({ attributes: { family: "linear grille", damper: "without" }, label: "family = linear grille, damper = without", notes: [], fingerprint: fp });

describe("specVerdict / specConfirmedInfo / confirmedTag -- the third status", () => {
  it("reads confirmed with who and when; not_understood and plain read stay distinct", () => {
    const confirmed = { attributes: { item_name: "Grille", [SPEC_STATUS_ATTR]: SPEC_CONFIRMED, [SPEC_CONFIRMED_BY_ATTR]: "admins@nirmaan.app", [SPEC_CONFIRMED_AT_ATTR]: "2026-09-21T20:15:00" } };
    expect(specVerdict(confirmed)).toBe("confirmed");
    expect(specConfirmedInfo(confirmed)).toEqual({ by: "admins@nirmaan.app", at: "2026-09-21T20:15:00" });
    expect(specVerdict({ attributes: { [SPEC_STATUS_ATTR]: SPEC_NOT_UNDERSTOOD } })).toBe("not_understood");
    expect(specVerdict({ attributes: { family: "VCD" } })).toBe("read");
    expect(specConfirmedInfo({ attributes: { [SPEC_STATUS_ATTR]: SPEC_NOT_UNDERSTOOD } })).toBeNull();
    expect(specConfirmedInfo(null)).toBeNull();
  });
  it("NEGATIVE: a confirmed item is never reported as not understood, and vice versa", () => {
    const confirmed = { attributes: { [SPEC_STATUS_ATTR]: SPEC_CONFIRMED, [SPEC_CONFIRMED_BY_ATTR]: "x", [SPEC_CONFIRMED_AT_ATTR]: "2026-09-21" } };
    expect(specNotUnderstoodReason(confirmed)).toBeNull();
    expect(specVerdict({ attributes: { [SPEC_STATUS_ATTR]: "something-else" } })).toBe("read");
  });
  it("words the amber tag as 'confirmed by <user>, <dd-MMM-yyyy>' and keeps a blank date out", () => {
    expect(confirmedTag("admins@nirmaan.app", "2026-09-21T20:15:00")).toBe("confirmed by admins@nirmaan.app, 21-Sep-2026");
    expect(confirmedTag("admins@nirmaan.app", "")).toBe("confirmed by admins@nirmaan.app");
    expect(SPEC_CONFIRM_COPY.confirmedPrefix).toBe("confirmed by");
  });
});

describe("specQuestion -- the owner's exact wording", () => {
  it("asks 'Couldn't read ... exactly. Best match: .... Accept?'", () => {
    expect(specQuestion("Grille", "Linear grille without damper", sugg("f")))
      .toBe("Couldn't read 'Grille / Linear grille without damper' exactly. Best match: family = linear grille, damper = without. Accept?");
    expect(specQuestion("Grille", "", sugg("f"))).toBe("Couldn't read 'Grille' exactly. Best match: family = linear grille, damper = without. Accept?");
  });
});

describe("rowsWithSuggestion / acceptedFingerprints -- Accept all shown, and what the apply sends", () => {
  const plan = { changes: [
    change(1, { status: "not_understood", reason: "r", read: {}, suggestion: sugg("fp1"), decision: null }),
    change(2, { status: "not_understood", reason: "r", read: {}, suggestion: null, no_suggestion_reason: "no family", decision: null }),
    change(3, { status: "ok", reason: null, read: { family: "VCD" } }),
    change(4, { status: "not_understood", reason: "r", read: {}, suggestion: sugg("fp4"), decision: null }),
  ] } as unknown as UploadPlan;
  it("names exactly the rows that HAVE a suggestion", () => {
    expect(rowsWithSuggestion(plan)).toEqual([1, 4]);
    expect(rowsWithSuggestion(null)).toEqual([]);
  });
  it("sends a fingerprint for an ACCEPTED row with a suggestion only -- never for a reject or a row without one", () => {
    expect(acceptedFingerprints(plan, { 1: "accept", 2: "accept", 3: "accept", 4: "reject" })).toEqual({ 1: "fp1" });
    expect(acceptedFingerprints(plan, {})).toEqual({});
  });
});

describe("the request payloads -- byte-identical to before when nothing optional is present (owner condition)", () => {
  it("applyCsvPayload: absent decisions -> exactly {discipline, content_base64, expected_digest}", () => {
    const p = applyCsvPayload("Electrical", "QUJD", "digest1");
    expect(JSON.stringify(p)).toBe(JSON.stringify({ discipline: "Electrical", content_base64: "QUJD", expected_digest: "digest1" }));
    expect(Object.keys(p)).toEqual(["discipline", "content_base64", "expected_digest"]);
    // empty maps count as absent, so an HVAC apply with no answers is byte-identical too
    expect(JSON.stringify(applyCsvPayload("HVAC", "QUJD", "d", {}, {}))).toBe(JSON.stringify(applyCsvPayload("HVAC", "QUJD", "d")));
  });
  it("applyCsvPayload: present decisions add exactly two JSON-string fields", () => {
    const p = applyCsvPayload("HVAC", "QUJD", "d", { 1: "accept", 2: "reject" }, { 1: "fp1" });
    expect(p.decisions).toBe(JSON.stringify({ 1: "accept", 2: "reject" }));
    expect(p.accepted_fingerprints).toBe(JSON.stringify({ 1: "fp1" }));
    expect(Object.keys(p)).toEqual(["discipline", "content_base64", "expected_digest", "decisions", "accepted_fingerprints"]);
  });
  it("createItemPayload: absent decision -> exactly the pre-slice six fields, same order, same stringification", () => {
    const p = createItemPayload("Electrical", { kind: "cable", brand: "Polycab", unit: "Mtr", attributes: { material: "COPPER" }, rates: { list_price_per_mtr: 10 } });
    expect(JSON.stringify(p)).toBe(JSON.stringify({
      discipline: "Electrical", kind: "cable", brand: "Polycab", unit: "Mtr",
      attributes: JSON.stringify({ material: "COPPER" }), rates: JSON.stringify({ list_price_per_mtr: 10 }),
    }));
    const q = createItemPayload("HVAC", { kind: "hvac_adp_item", unit: "Nos", attributes: { item_name: "Grille" }, rates: {}, spec_decision: "accept", spec_fingerprint: "fp" });
    expect(q.spec_decision).toBe("accept"); expect(q.spec_fingerprint).toBe("fp");
    expect(Object.keys(q).slice(-2)).toEqual(["spec_decision", "spec_fingerprint"]);
  });
  it("saveItemPayload: absent decision -> exactly {name, rates_patch, attributes_patch} with undefined where unset", () => {
    const p = saveItemPayload("RMI-1", { rates_patch: { x: 1 } });
    expect(JSON.stringify(p)).toBe(JSON.stringify({ name: "RMI-1", rates_patch: JSON.stringify({ x: 1 }), attributes_patch: undefined }));
    expect(Object.keys(p)).toEqual(["name", "rates_patch", "attributes_patch"]);
    const q = saveItemPayload("RMI-1", { attributes_patch: { item_detail: "x" }, spec_decision: "reject" });
    expect(q.spec_decision).toBe("reject"); expect("spec_fingerprint" in q).toBe(false);
  });
});

describe("the shown-in-full hint names the spec rows (the server promotes them to major)", () => {
  it("says a row the reader must ask about or flags is shown in full", () => {
    expect(UPLOAD_COPY.expandedHint).toContain("ask about or flags");
    expect(UPLOAD_COPY.expandedHint).toContain("10%");
  });
});

describe("SLICE 1f -- the duplicate answers on the three payloads: byte-identical when absent, exact keys when present", () => {
  it("applyCsvPayload: absent / empty twin maps -> the pre-1f payload to the byte", () => {
    const base = applyCsvPayload("HVAC", "QUJD", "d");
    expect(JSON.stringify(applyCsvPayload("HVAC", "QUJD", "d", undefined, undefined, {}, {}))).toBe(JSON.stringify(base));
    expect(Object.keys(base)).toEqual(["discipline", "content_base64", "expected_digest"]);
    // present -> exactly two more JSON-string fields, after the 1d pair
    const p = applyCsvPayload("HVAC", "QUJD", "d", { 1: "accept" }, { 1: "fp" }, { 2: "confirm", 3: "decline" }, { 2: "tfp" });
    expect(p.twin_decisions).toBe(JSON.stringify({ 2: "confirm", 3: "decline" }));
    expect(p.twin_fingerprints).toBe(JSON.stringify({ 2: "tfp" }));
    expect(Object.keys(p)).toEqual(["discipline", "content_base64", "expected_digest", "decisions", "accepted_fingerprints", "twin_decisions", "twin_fingerprints"]);
    // twin answers WITHOUT spec answers: the 1d keys are absent, the 1f keys present
    const q = applyCsvPayload("Electrical", "QUJD", "d", undefined, undefined, { 4: "confirm" }, { 4: "tfp4" });
    expect(Object.keys(q)).toEqual(["discipline", "content_base64", "expected_digest", "twin_decisions", "twin_fingerprints"]);
  });
  it("createItemPayload / saveItemPayload: the twin pair is added only when present", () => {
    const base = createItemPayload("Electrical", { kind: "cable", brand: "Polycab", unit: "Mtr", attributes: { material: "COPPER" }, rates: { list_price_per_mtr: 10 } });
    expect(Object.keys(base)).toEqual(["discipline", "kind", "brand", "unit", "attributes", "rates"]);
    const c = createItemPayload("Electrical", { kind: "cable", brand: "Polycab", unit: "Mtr", attributes: {}, rates: {}, twin_decision: "confirm", twin_fingerprint: "tfp" });
    expect(Object.keys(c).slice(-2)).toEqual(["twin_decision", "twin_fingerprint"]);
    expect(c.twin_decision).toBe("confirm"); expect(c.twin_fingerprint).toBe("tfp");
    const s0 = saveItemPayload("RMI-1", { rates_patch: { x: 1 } });
    expect(Object.keys(s0)).toEqual(["name", "rates_patch", "attributes_patch"]);
    const s1 = saveItemPayload("RMI-1", { attributes_patch: { core: 2 }, twin_decision: "confirm", twin_fingerprint: "tfp" });
    expect(Object.keys(s1)).toEqual(["name", "rates_patch", "attributes_patch", "twin_decision", "twin_fingerprint"]);
    // a spec answer AND a twin answer travel together (the form may have answered both questions in turn)
    const both = saveItemPayload("RMI-1", { attributes_patch: { item_detail: "x" }, spec_decision: "accept", spec_fingerprint: "sfp", twin_decision: "confirm", twin_fingerprint: "tfp" });
    expect(Object.keys(both)).toEqual(["name", "rates_patch", "attributes_patch", "spec_decision", "spec_fingerprint", "twin_decision", "twin_fingerprint"]);
  });
});

// =====================================================================================
// SLICE 12b(A) -- PRICING INPUTS: the pure half of the screen.
// =====================================================================================
describe("SLICE 12b(A) -- Pricing Inputs on the screen", () => {
  it("ACCEPTANCE 6 POSITIVE: a factor displays as a percentage, never a decimal", () => {
    expect(asPercent(0.75)).toBe("75%");
    expect(asPercent(0.45)).toBe("45%");
    expect(asPercent(0.05)).toBe("5%");
    expect(asPercent(0.3625)).toBe("36.25%");
    expect(asPercent(1)).toBe("100%");
    expect(asPercent(0)).toBe("0%");
  });

  it("ACCEPTANCE 6 NEGATIVE: an amount is rupees, NOT a percentage", () => {
    expect(pricingInputCell("amount", 106)).toBe("106");
    expect(pricingInputCell("discount", 0.75)).toBe("75%");
    // the whole point: the same 106 read as a percentage would be 10600%
    expect(pricingInputCell("amount", 106)).not.toBe("10600%");
  });

  it("a blank stays blank -- an absent input is not 0%", () => {
    expect(pricingInputCell("discount", null)).toBe("");
    expect(pricingInputCell("discount", undefined)).toBe("");
    expect(asPercent("")).toBe("");
  });

  it("ACCEPTANCE 14: the category is recognised by its KIND SUFFIX, never by a discipline name", () => {
    expect(isPricingInputConfig({ item_kinds: ["electrical_pricing_input"] } as any)).toBe(true);
    // a future discipline flows through with no code change
    expect(isPricingInputConfig({ item_kinds: ["hvac_pricing_input"] } as any)).toBe(true);
    expect(isPricingInputConfig({ item_kinds: ["cable"] } as any)).toBe(false);
    expect(isPricingInputConfig({ item_kinds: [] } as any)).toBe(false);
    expect(isPricingInputConfig(null)).toBe(false);
    // a MIXED kind list is not a pricing-input category
    expect(isPricingInputConfig({ item_kinds: ["cable", "electrical_pricing_input"] } as any)).toBe(false);
  });

  it("ACCEPTANCE 13: the used-by count is DERIVED from the rules, with its categories named", () => {
    const configs = [
      { category_id: "conduit_piping", pipelines: { a: { steps: [
        { step: "rate_ref", ref: { kind: "electrical_pricing_input", item: "conduit" } },
        { step: "rate_ref", ref: { kind: "electrical_pricing_input", item: "conduit_share" } },
      ] } } },
      { category_id: "point_wiring", pipelines: { b: { steps: [
        { step: "rate_ref", ref: { kind: "electrical_pricing_input", item: "conduit" } },
      ] } } },
    ] as any;
    const u = pricingInputUsedBy(configs);
    expect(u["conduit"]).toEqual({ sites: 2, categories: ["conduit_piping", "point_wiring"] });
    // ⚠️ INVERTED, NOT DELETED (owner 2026-10-03: "the used by should mention all categories where
    // it is used instead of the current format"). The categories now LEAD, under the display names
    // the pricer sees on screen, and the site count follows as the secondary fact it is. The old
    // shape -- count first, raw ids -- is asserted ABSENT so it cannot come back unnoticed.
    const label = (c: string) => ({ conduit_piping: "Electrical Conduit", point_wiring: "Point Wiring" } as Record<string, string>)[c] ?? c;
    expect(pricingInputUsedByText(u["conduit"], label)).toBe("Electrical Conduit, Point Wiring (2 uses)");
    expect(pricingInputUsedByText(u["conduit_share"], label)).toBe("Electrical Conduit (1 use)");
    expect(pricingInputUsedByText(u["conduit"], label)).not.toContain("2 sites in");
    // with NO label resolver the ids stand in, so a caller holding no configs still renders something
    expect(pricingInputUsedByText(u["conduit"])).toBe("conduit_piping, point_wiring (2 uses)");
  });

  it("NEGATIVE: an input no rule reads reads as 'not used' -- so a delete can be allowed", () => {
    expect(pricingInputUsedByText(undefined)).toBe("not used");
    expect(pricingInputUsedByText({ sites: 0, categories: [] })).toBe("not used");
  });

  it("NEGATIVE: a non-rate_ref step is never counted as a use", () => {
    const configs = [{ category_id: "x", pipelines: { p: { steps: [
      { step: "scale", ref: { item: "conduit" } },
      { step: "component_ref", ref: { kind: "conduit", item: "conduit" } },
    ] } } }] as any;
    expect(pricingInputUsedBy(configs)).toEqual({});
  });

  // ⚠️ INVERTED BY SLICE 12c (owner ruling, 2026-09-30), NOT deleted. It asserted "amount is the only
  // non-percentage" and banned the word "factor" from EVERY label. Both claims were true of 12b(A)'s
  // eight columns and the owner has since ruled two more into existence, so this now asserts the NEW
  // truth and keeps the OLD claims exactly where they still hold.
  //
  // ⚠️ THE `factor` COLUMN AND 12b(A)'s "THERE ARE NO FACTORS" RULE. That rule was about FOLDS -- a
  // pre-multiplied (1-discount)x(1+markup) called a "factor", which nobody who owned either half could
  // edit. `factor` here is a KIND-OF-NUMBER column, exactly as `amount` and `rate` are: the MEANING
  // lives in the item (cladding overlap; GI framework sheet factor), which is what the rule asked for.
  // The ban therefore still applies in full to the seven percentage columns, where a "factor" label
  // WOULD hide which business number it is.
  const PRE_12C = ["discount", "supply_markup", "installation_markup", "bcs_markup",
                   "wastage", "ratio", "share", "amount"];
  it("ACCEPTANCE 4 / 9: the column set is fixed; amount, rate and factor are the non-percentages", () => {
    expect(PRICING_INPUT_VALUE_COLUMNS).toEqual([...PRE_12C, "rate", "factor"]);
    // the pre-12c eight still LEAD, in their original order -- nothing moved
    expect(PRICING_INPUT_VALUE_COLUMNS.slice(0, 8)).toEqual(PRE_12C);
    expect(PRICING_INPUT_PERCENT_COLUMNS).not.toContain("amount");
    expect(PRICING_INPUT_PERCENT_COLUMNS).not.toContain("rate");
    expect(PRICING_INPUT_PERCENT_COLUMNS).not.toContain("factor");
    expect(PRICING_INPUT_PERCENT_COLUMNS).toHaveLength(7);
    // ACCEPTANCE 7/8: every column names a kind of number, and every markup names its leg
    for (const c of PRICING_INPUT_VALUE_COLUMNS) {
      expect(PRICING_INPUT_COLUMN_LABELS[c]).toBeTruthy();
    }
    // the 12b(A) ban, still in force on every column it was written for
    for (const c of PRE_12C) {
      expect(PRICING_INPUT_COLUMN_LABELS[c]).not.toMatch(/factor/i);
    }
    expect(PRICING_INPUT_COLUMN_LABELS.rate).toBe("Rate");
    expect(PRICING_INPUT_COLUMN_LABELS.factor).toBe("Factor");
    expect(PRICING_INPUT_COLUMN_LABELS.supply_markup).toBe("Supply markup");
    expect(PRICING_INPUT_COLUMN_LABELS.installation_markup).toBe("Installation markup");
    expect(PRICING_INPUT_COLUMN_LABELS.bcs_markup).toBe("BCS markup");
  });
});

// =====================================================================================================
// SLICE 12b(B) -- THE DERIVED RATE-COLUMN LABEL.
//
// ⚠️ THE FIXTURE BELOW IS SHARED WITH `test_rate_master.RATE_LABEL_FIXTURE` AND THE TWO MUST AGREE
// EXACTLY. The screen cannot call a Python exporter for one header cell, so the deriver exists twice;
// this pin is the mechanism that stops the copies drifting. Change one side without the other and a
// suite goes red -- that is the point. (Same contract as `FORMULA_FIXTURE` / `columnNote`.)
// =====================================================================================================
const RATE_LABEL_FIXTURE: any = {
  // a LIST price: a discount reaches the column (the cable_tray / junction_box shape at v65)
  tray: {
    category_id: "tray", item_kinds: ["tray_item"], attribute_definitions: [], pipelines: {
      tray_boq: {
        output: ["supply"], steps: [
          { step: "match_master_row", params: { kind: "tray_item" } },
          { step: "component", name: "base", target: "list_col", params: { discount_from_ctx: "pi_d" }, formula: "base*(1-discount)" },
          { step: "sum_components", result: "supply" },
          { step: "scale", target: "supply", result: "supply", params: { markup_from_ctx: "pi_m" }, formula: "base*(1+markup)" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "d" }, target: "discount", result: "pi_d" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "m" }, target: "supply_markup", result: "pi_m" },
        ],
      },
    },
  },
  // a BCS price: a markup but NO discount (the lms_item.rate shape -- the LMS inversion)
  lms: {
    category_id: "lms", item_kinds: ["lms_item"], attribute_definitions: [], pipelines: {
      lms_boq: {
        output: ["supply"], steps: [
          { step: "match_master_row", params: { kind: "lms_item" } },
          { step: "scale", target: "rate", result: "supply", params: { markup_from_ctx: "pi_m2" }, formula: "base*(1+markup)" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "m2" }, target: "supply_markup", result: "pi_m2" },
        ],
      },
      // ⚠️ a BCS-ONLY pipeline must NOT settle a label: it says how the COST is derived FROM the
      // column, never what the column IS (owner ruling 2).
      lms_bcs: {
        output: ["bcs_supply"], steps: [
          { step: "match_master_row", params: { kind: "lms_item" } },
          { step: "scale", target: "rate", result: "bcs_supply", params: { bcs_ratio_from_ctx: "pi_r" }, formula: "base*bcs_ratio" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "r" }, target: "ratio", result: "pi_r" },
        ],
      },
    },
  },
  // a BoQ price: NOTHING is applied on the client-facing path (the misc_item shape)
  misc: {
    category_id: "misc", item_kinds: ["misc_item"], attribute_definitions: [], pipelines: {
      misc_boq: {
        output: ["supply", "install"], steps: [
          { step: "match_master_row", params: { kind: "misc_item" } },
          { step: "scale", target: "boq_supply", result: "supply", params: {}, formula: "base" },
          { step: "scale", target: "boq_install", result: "install", params: {}, formula: "base" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "r2" }, target: "ratio", result: "pi_r2" },
        ],
      },
      misc_bcs: {
        output: ["bcs_supply"], steps: [
          { step: "match_master_row", params: { kind: "misc_item" } },
          { step: "scale", target: "boq_supply", result: "bcs_supply", params: { bcs_ratio_from_ctx: "pi_r2" }, formula: "base*bcs_ratio" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "r2" }, target: "ratio", result: "pi_r2" },
        ],
      },
    },
  },
};

describe("SLICE 12b(B) -- the derived rate-column label", () => {
  const L = deriveRateColumnLabels(RATE_LABEL_FIXTURE, "Electrical");

  it("a DISCOUNT reaching the column makes it a List price", () => {
    expect(rateColumnLabel(L, "tray_item", "list_col")).toBe("List price");
  });

  it("a markup with NO discount makes it a BCS price -- the LMS inversion, surfaced", () => {
    expect(rateColumnLabel(L, "lms_item", "rate")).toBe("BCS price");
  });

  it("NOTHING applied on the client-facing path makes it a BoQ price -- the rate IS the quote", () => {
    expect(rateColumnLabel(L, "misc_item", "boq_supply")).toBe("BoQ price");
  });

  it("the (install) suffix comes from the LEG the column feeds", () => {
    expect(rateColumnLabel(L, "misc_item", "boq_install")).toBe("BoQ price (install)");
  });

  it("NEGATIVE, owner ruling 2: a BCS-only pipeline never settles a label", () => {
    // lms_bcs applies a RATIO to `rate`. Were that counted, `misc_item.boq_supply` -- whose ONLY
    // operand is a bcs ratio -- would stop reading BoQ price. Here the BCS pipeline is the ONLY one.
    const only = {
      lms: { ...RATE_LABEL_FIXTURE.lms, pipelines: { lms_bcs: RATE_LABEL_FIXTURE.lms.pipelines.lms_bcs } },
    };
    expect(rateColumnLabel(deriveRateColumnLabels(only as any, "Electrical"), "lms_item", "rate")).toBeNull();
  });

  it("NEGATIVE: a column NO rule reads gets no derived label", () => {
    expect(L["tray_item\u0000never_read"]).toBeUndefined();
    expect(rateColumnLabel(L, "tray_item", "never_read")).toBeNull();
  });

  it("the label is NEVER taken from the column's NAME", () => {
    // `list_col` reads List price because a DISCOUNT reaches it -- strip the discount and the SAME name
    // reads BCS price. This is exactly the junction_box.list_price case that forced v65.
    const noDiscount = structuredClone(RATE_LABEL_FIXTURE);
    const base = noDiscount.tray.pipelines.tray_boq.steps[1];
    base.params = {};
    base.formula = "base";
    expect(rateColumnLabel(deriveRateColumnLabels(noDiscount, "Electrical"), "tray_item", "list_col"))
      .toBe("BCS price");
  });

  it("ACCEPTANCE 3: the label is DERIVED -- change a rule and the label follows", () => {
    const flipped = structuredClone(RATE_LABEL_FIXTURE);
    flipped.misc.pipelines.misc_boq.steps[1] = {
      step: "scale", target: "boq_supply", result: "supply",
      params: { discount_from_ctx: "pi_dd" }, formula: "base*(1-discount)",
    };
    flipped.misc.pipelines.misc_boq.steps.push(
      { step: "rate_ref", ref: { kind: "x_pricing_input", item: "dd" }, target: "discount", result: "pi_dd" });
    expect(rateColumnLabel(deriveRateColumnLabels(flipped, "Electrical"), "misc_item", "boq_supply"))
      .toBe("List price");
  });

  /**
   * INVERTED, NOT DELETED (owner ruling, 2026-09-29). This asserted the owner-set entry for
   * `cable_tray.with_cover_list`. **That COLUMN was removed at v66** -- all 450 rows derived exactly
   * as `without_cover_list + cover_only_list`, the rule the supply formula already applies -- so the
   * label went with it and the map is EMPTY. The ORDER rule it also proves is unchanged and still
   * matters, and its shadow case is synthetic, so it survives the removal.
   */
  it("OWNER-SET entries are consulted ONLY where the derivation is silent", () => {
    expect(Object.keys(RATE_LABEL_OWNER_SET)).toEqual([]);
    const shadowed = deriveRateColumnLabels({
      t: {
        category_id: "t", item_kinds: ["cable_tray"], attribute_definitions: [], pipelines: {
          p: {
            output: ["supply"], steps: [
              { step: "match_master_row", params: { kind: "cable_tray" } },
              { step: "scale", target: "with_cover_list", result: "supply", params: { markup_from_ctx: "pi_q" }, formula: "base*(1+markup)" },
              { step: "rate_ref", ref: { kind: "x_pricing_input", item: "q" }, target: "supply_markup", result: "pi_q" },
            ],
          },
        },
      },
    } as any, "Electrical");
    // the DERIVED answer wins; the owner-set List price does NOT shadow it
    expect(rateColumnLabel(shadowed, "cable_tray", "with_cover_list")).toBe("BCS price");
  });

  it("NEGATIVE, owner ruling 2026-09-28: the label is ELECTRICAL BY RULE, not by accident", () => {
    // The SAME configs that derive labels as Electrical derive NOTHING as HVAC. This is the pin the
    // owner asked for: 12c gives HVAC its own pricing rules, the mechanism gate would then open, and an
    // ungated deriver would start labelling HVAC columns nobody asked for.
    expect(Object.keys(deriveRateColumnLabels(RATE_LABEL_FIXTURE, "Electrical")).length).toBeGreaterThan(0);
    expect(deriveRateColumnLabels(RATE_LABEL_FIXTURE, "HVAC")).toEqual({});
    expect(deriveRateColumnLabels(RATE_LABEL_FIXTURE, "")).toEqual({});
    expect(RATE_LABEL_DISCIPLINES).toEqual(["Electrical"]);
  });

  it("ACCEPTANCE 2: an unsettled column's formula row says the rules do not determine it", () => {
    const note = columnNote(RATE_LABEL_FIXTURE.tray, "never_read", 0, true);
    expect(note.split("\n")[0]).toBe(RATE_LABEL_UNSETTLED_NOTE);
    // ABSENT => byte-identical to before 12b(B)
    expect(columnNote(RATE_LABEL_FIXTURE.tray, "never_read", 0)).not.toContain(RATE_LABEL_UNSETTLED_NOTE);
  });
});
