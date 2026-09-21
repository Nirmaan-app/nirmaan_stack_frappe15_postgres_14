// SLICE 1c -- the SPEC READER's frontend half: pure helpers + the wording, in one place, so the Data
// Viewer, the upload preview and their tests share one definition.
//
// Owner rulings (quoted in services/boq_rate_master/spec_reader.py): item name + item detail are the
// source of truth for an opted-in category's attributes; the derived attributes are shown READ-ONLY,
// greyed, labelled "read from spec"; a spec the reader could not understand is marked "won't price:
// spec not understood" with its reason; the manual add/edit form sends the TEXT only and the server
// runs the same reader -- there is no client-side reading and no back door.
//
// ⚠️ NOTHING HERE DECIDES AN ATTRIBUTE. The server owns the reader; this module only recognises the
// opt-in key, splits the definitions into text vs derived for rendering, and reads the two reserved
// flag keys the server stores on a not-understood item.

import type { AttributeDefinition, RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import type { UploadSpec } from "./rateMasterUpload";

/** The config key that opts a category in. Read as `=== true`, exactly as the server reads it. */
export const SPEC_CONFIG_KEY = "attributes_from_spec";
/** The two text attributes, in display order. */
export const SPEC_TEXT_ATTRS = ["item_name", "item_detail"] as const;
/** The two reserved flag keys the server stores on a not-understood item. Never columns, never editable. */
export const SPEC_STATUS_ATTR = "spec_status";
export const SPEC_NOTE_ATTR = "spec_note";
export const SPEC_NOT_UNDERSTOOD = "not_understood";

export const SPEC_COPY = {
  readFromSpec: "read from spec",
  wontPrice: "won't price: spec not understood",
  itemLabel: "Item",
  detailLabel: "Item detail",
  specColumn: "spec",
  /** The one rule a user needs on this screen, said once beside the table. */
  hint: "Item and Item detail are the source of truth: the greyed attributes are read from them and cannot be edited.",
  addHint: "Enter the item as the spec writes it. Its attributes are read on save.",
  /** The preview's per-row line. */
  previewRead: "Read from spec:",
  previewNone: "Read from spec: family only",
} as const;

/** Does this category take its attributes from the spec? `true` ONLY; a string does not opt in. */
export function isSpecDrivenConfig(config: Pick<RateCategoryConfig, "attributes_from_spec"> | null | undefined): boolean {
  return !!config && config.attributes_from_spec === true;
}

export function isSpecTextAttr(id: string): boolean {
  return (SPEC_TEXT_ATTRS as readonly string[]).includes(id);
}

/**
 * The definitions split for rendering: the TEXT columns (item_name, item_detail, in that fixed
 * order, whatever order the config lists them) and the DERIVED columns (everything else except
 * brand, in config order). PURE.
 */
export function splitSpecColumns(defs: AttributeDefinition[]): {
  text: AttributeDefinition[];
  derived: AttributeDefinition[];
} {
  const byId = new Map(defs.map((d) => [d.id, d] as const));
  const text: AttributeDefinition[] = [];
  for (const id of SPEC_TEXT_ATTRS) {
    const d = byId.get(id);
    if (d) text.push(d);
  }
  const derived = defs.filter((d) => d.id !== "brand" && !isSpecTextAttr(d.id));
  return { text, derived };
}

/** The reason the server stored on a not-understood item, or null when the item was understood. */
export function specNotUnderstoodReason(item: Pick<RateMasterItem, "attributes"> | null | undefined): string | null {
  const a = item?.attributes;
  if (!a || a[SPEC_STATUS_ATTR] !== SPEC_NOT_UNDERSTOOD) return null;
  const note = a[SPEC_NOTE_ATTR];
  return typeof note === "string" && note.trim() ? note : "(no reason recorded)";
}

/** The upload preview's one line per new / changed row: what was read, or why nothing could be. */
export function specLine(spec: UploadSpec): string {
  if (spec.status === "not_understood") {
    return `${SPEC_COPY.wontPrice} — ${spec.reason ?? "(no reason recorded)"}`;
  }
  const parts = Object.entries(spec.read ?? {}).map(([k, v]) => `${k} = ${String(v)}`);
  return parts.length ? `${SPEC_COPY.previewRead} ${parts.join(", ")}` : SPEC_COPY.previewNone;
}
