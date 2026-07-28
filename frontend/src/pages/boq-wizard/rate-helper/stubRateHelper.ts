/**
 * U1 dev stub helper (guardrail G1 -- DIES at U2, replaced by the real telemetry + earthing import).
 *
 * Purely synchronous, frontend-only, no network. Canned data deliberately covers every state the
 * chassis must render:
 *   - suggestions on SOME categories, BOTH supply and install kinds (earthing, hvac_ducting);
 *   - a supply-ONLY suggestion (wiring_cabling) so per-kind chip independence is visible;
 *   - a NoSuggestion reason on categories with no table ("no rate table for this category");
 *   - an editable-attributes set whose recompute can reach an honest "no match for these attributes"
 *     state (earthing: material=Copper + size=50x6 is not in the table) WITHOUT collapsing the card,
 *     so the user can edit back out of it.
 */
import type {
  HelperResult,
  RateHelper,
  RateHelperRowContext,
  WorkingsAttribute,
} from "./rateHelperTypes";

interface StubTable {
  attributes: WorkingsAttribute[];
  /** attr-values joined by "|" -> per-kind rate. A combo absent here is a live "no match". */
  rates: Record<string, Partial<Record<string, number>>>;
  /** which rate-kinds this table can price (drives the derivation text). */
  kinds: string[];
}

/** Canned rate tables keyed by resolved category id. Anything not here => "no rate table". */
export const STUB_TABLES: Record<string, StubTable> = {
  earthing: {
    attributes: [
      { id: "material", label: "Material", options: ["GI", "Copper"], value: "GI" },
      { id: "size", label: "Strip size", options: ["25x3", "50x6"], value: "25x3" },
    ],
    kinds: ["supply_rate", "install_rate"],
    rates: {
      "GI|25x3": { supply_rate: 120, install_rate: 45 },
      "GI|50x6": { supply_rate: 210, install_rate: 60 },
      "Copper|25x3": { supply_rate: 480, install_rate: 52 },
      // Copper|50x6 deliberately absent -> the reachable "no match" state.
    },
  },
  wiring_cabling: {
    attributes: [
      { id: "conductor", label: "Conductor", options: ["Cu", "Al"], value: "Cu" },
      { id: "cores", label: "Cores", options: ["2C", "4C"], value: "4C" },
    ],
    kinds: ["supply_rate"], // supply-only: the install chip must NOT appear on this row
    rates: {
      "Cu|2C": { supply_rate: 180 },
      "Cu|4C": { supply_rate: 320 },
      "Al|2C": { supply_rate: 95 },
      "Al|4C": { supply_rate: 160 },
    },
  },
  hvac_ducting: {
    attributes: [{ id: "gauge", label: "Gauge", options: ["24G", "22G"], value: "24G" }],
    kinds: ["supply_rate", "install_rate"],
    rates: {
      "24G": { supply_rate: 640, install_rate: 210 },
      "22G": { supply_rate: 720, install_rate: 240 },
    },
  },
};

/** Resolve the current attribute list (defaults, with any panel edits applied). */
function currentAttributes(
  table: StubTable,
  attrOverrides?: Record<string, string>,
): WorkingsAttribute[] {
  return table.attributes.map((a) => ({
    ...a,
    value: attrOverrides?.[a.id] ?? a.value,
  }));
}

function computeStub(
  ctx: RateHelperRowContext,
  attrOverrides?: Record<string, string>,
): HelperResult {
  const table = ctx.category ? STUB_TABLES[ctx.category] : undefined;
  if (!table) {
    return { kind: "none", reason: "no rate table for this category" };
  }

  const attrs = currentAttributes(table, attrOverrides);
  const comboKey = attrs.map((a) => a.value).join("|");
  const matched = table.rates[comboKey];
  const attrLine = attrs.map((a) => `${a.label} = ${a.value}`).join(", ");

  if (!matched) {
    // Reachable "no match" -- keep the attributes editable (Suggestion shape, empty values) so the
    // user can drive back to a matching combo. No value => no badge for any kind (correct).
    return {
      kind: "suggestion",
      values: {},
      basis: "no match for these attributes",
      workings: {
        attributes: attrs,
        matchedRows: [],
        derivation: [`No rate row matches ${attrLine} for '${ctx.category}'.`],
        finalValues: {},
      },
    };
  }

  const values: Partial<Record<string, number>> = {};
  const derivation: string[] = [];
  for (const kind of table.kinds) {
    const v = matched[kind];
    if (typeof v === "number") {
      values[kind] = v;
      derivation.push(`${kind}: table row [${comboKey}] = ${v}`);
    }
  }

  return {
    kind: "suggestion",
    values,
    basis: `Pricing sheet: '${ctx.category}' @ ${attrLine}`,
    workings: {
      attributes: attrs,
      matchedRows: [`Matched rate row [${comboKey}] for '${ctx.category}'.`],
      derivation,
      finalValues: { ...values },
    },
  };
}

export const stubRateHelper: RateHelper = {
  id: "stub_pricing_sheet",
  label: "Pricing sheet",
  compute: computeStub,
};
