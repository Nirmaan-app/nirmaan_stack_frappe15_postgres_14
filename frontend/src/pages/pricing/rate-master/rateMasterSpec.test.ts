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
