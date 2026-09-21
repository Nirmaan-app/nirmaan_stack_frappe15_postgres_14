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

import { formatDate } from "@/utils/FormatDate";
import type { AttributeDefinition, RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import type { UploadPlan, UploadSpec } from "./rateMasterUpload";

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
  /** SLICE 1d: the preview's line for a row the user accepted. */
  confirmedPreview: "Confirmed (best match):",
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
  if (spec.status === "confirmed") {
    const parts = Object.entries(spec.read ?? {}).map(([k, v]) => `${k} = ${String(v)}`);
    return `${SPEC_COPY.confirmedPreview} ${parts.join(", ")}`;
  }
  if (spec.status === "not_understood") {
    return `${SPEC_COPY.wontPrice} — ${spec.reason ?? "(no reason recorded)"}`;
  }
  const parts = Object.entries(spec.read ?? {}).map(([k, v]) => `${k} = ${String(v)}`);
  return parts.length ? `${SPEC_COPY.previewRead} ${parts.join(", ")}` : SPEC_COPY.previewNone;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 1d -- SUGGEST THE BEST MATCH, THE USER CONFIRMS (owner T-a / T-b).
// ══════════════════════════════════════════════════════════════════════════════════════════════
// The SERVER suggests (deterministic rules in spec_reader.suggest_spec) and the server stores; this
// half only asks the question, carries the answer back, and renders the third status. A suggestion a
// user confirms is stored with spec_status "confirmed" plus WHO and WHEN; an unconfirmed suggestion is
// never stored (a rejected or undecided row stays "won't price: spec not understood").

export const SPEC_CONFIRMED = "confirmed";
export const SPEC_CONFIRMED_BY_ATTR = "spec_confirmed_by";
export const SPEC_CONFIRMED_AT_ATTR = "spec_confirmed_at";

export type SpecDecision = "accept" | "reject";

/** The server's suggestion for a row / a form entry the exact read refused. */
export interface SpecSuggestion {
  attributes: Record<string, string | number>;
  label: string;
  notes: string[];
  /** What the apply re-verifies: the server refuses an accept whose re-derived suggestion differs. */
  fingerprint: string;
}

/**
 * What create_rate_master_item / update_rate_master_item return for an opted-in kind when the exact
 * read refused and a suggestion exists but no decision was sent: NOTHING was written, the form must ask.
 */
export interface SpecConfirmationReply {
  ok: boolean;
  needs_confirmation?: boolean;
  question?: string;
  suggestion?: SpecSuggestion | null;
  no_suggestion_reason?: string | null;
  item?: unknown;
}

export const SPEC_CONFIRM_COPY = {
  accept: "Accept",
  reject: "Reject",
  acceptAll: "Accept all shown",
  acceptAllHint: "Accepts every row above that has a best match. Rows without one stay flagged.",
  confirmedPrefix: "confirmed by",
  noMatch: "No reasonable match:",
  /** The question, exactly as the owner approved it. */
  question: (text: string, label: string) => `Couldn't read '${text}' exactly. Best match: ${label}. Accept?`,
  decided: (d: SpecDecision) => (d === "accept" ? "Will be stored as confirmed." : "Rejected: stays flagged."),
} as const;

/** "read" (no status), "confirmed", or "not_understood" -- the three states the screen renders. */
export function specVerdict(item: Pick<RateMasterItem, "attributes"> | null | undefined): "read" | "confirmed" | "not_understood" {
  const s = item?.attributes?.[SPEC_STATUS_ATTR];
  if (s === SPEC_CONFIRMED) return "confirmed";
  if (s === SPEC_NOT_UNDERSTOOD) return "not_understood";
  return "read";
}

/** Who confirmed and when, for a confirmed item; null otherwise. */
export function specConfirmedInfo(item: Pick<RateMasterItem, "attributes"> | null | undefined): { by: string; at: string } | null {
  if (specVerdict(item) !== "confirmed") return null;
  const a = item?.attributes ?? {};
  return { by: String(a[SPEC_CONFIRMED_BY_ATTR] ?? "(unknown)"), at: String(a[SPEC_CONFIRMED_AT_ATTR] ?? "") };
}

/** The amber tag's text: "confirmed by <user>, <dd-MMM-yyyy>". A blank / unparseable date is shown raw. */
export function confirmedTag(by: string, at: string): string {
  let when = at;
  try {
    if (at && !Number.isNaN(new Date(at).getTime())) when = formatDate(at);
  } catch {
    /* keep the raw value */
  }
  return `${SPEC_CONFIRM_COPY.confirmedPrefix} ${by}${when ? `, ${when}` : ""}`;
}

/** The question for one row / one form entry. */
export function specQuestion(itemName: string, itemDetail: string, suggestion: SpecSuggestion): string {
  const text = [itemName, itemDetail].filter((t) => t && t.trim()).join(" / ");
  return SPEC_CONFIRM_COPY.question(text, suggestion.label);
}

/** The preview rows that HAVE a suggestion (the ones "Accept all shown" accepts). PURE. */
export function rowsWithSuggestion(plan: Pick<UploadPlan, "changes"> | null | undefined): number[] {
  return (plan?.changes ?? []).filter((c) => !!c.spec?.suggestion).map((c) => c.row);
}

/** The fingerprints the apply must send for every ACCEPTED row. PURE. */
export function acceptedFingerprints(
  plan: Pick<UploadPlan, "changes"> | null | undefined,
  decisions: Record<number, SpecDecision>,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of plan?.changes ?? []) {
    if (decisions[c.row] === "accept" && c.spec?.suggestion) out[c.row] = c.spec.suggestion.fingerprint;
  }
  return out;
}

// ── the request payloads the page sends (owner ruling: byte-identical to before when nothing optional
// is present -- these builders are what the test pins) ────────────────────────────────────────────

export function applyCsvPayload(
  discipline: string,
  contentBase64: string,
  expectedDigest: string,
  decisions?: Record<number, SpecDecision>,
  fingerprints?: Record<number, string>,
): Record<string, string> {
  const out: Record<string, string> = { discipline, content_base64: contentBase64, expected_digest: expectedDigest };
  if (decisions && Object.keys(decisions).length) out.decisions = JSON.stringify(decisions);
  if (fingerprints && Object.keys(fingerprints).length) out.accepted_fingerprints = JSON.stringify(fingerprints);
  return out;
}

export interface CreateItemPayload {
  kind: string;
  brand?: string;
  unit?: string;
  attributes: Record<string, string | number>;
  rates: Record<string, number | null>;
  spec_decision?: SpecDecision;
  spec_fingerprint?: string;
}

export function createItemPayload(discipline: string, p: CreateItemPayload): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {
    discipline, kind: p.kind, brand: p.brand, unit: p.unit,
    attributes: JSON.stringify(p.attributes), rates: JSON.stringify(p.rates),
  };
  if (p.spec_decision) out.spec_decision = p.spec_decision;
  if (p.spec_fingerprint) out.spec_fingerprint = p.spec_fingerprint;
  return out;
}

export interface SaveItemPatch {
  rates_patch?: Record<string, number | null>;
  attributes_patch?: Record<string, string | number>;
  spec_decision?: SpecDecision;
  spec_fingerprint?: string;
}

export function saveItemPayload(name: string, patch: SaveItemPatch): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {
    name,
    rates_patch: patch.rates_patch ? JSON.stringify(patch.rates_patch) : undefined,
    attributes_patch: patch.attributes_patch ? JSON.stringify(patch.attributes_patch) : undefined,
  };
  if (patch.spec_decision) out.spec_decision = patch.spec_decision;
  if (patch.spec_fingerprint) out.spec_fingerprint = patch.spec_fingerprint;
  return out;
}
