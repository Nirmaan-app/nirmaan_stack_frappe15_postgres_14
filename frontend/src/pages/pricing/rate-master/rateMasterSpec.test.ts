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
} from "./rateMasterSpec";
import type { AttributeDefinition } from "./rateMasterTypes";

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
