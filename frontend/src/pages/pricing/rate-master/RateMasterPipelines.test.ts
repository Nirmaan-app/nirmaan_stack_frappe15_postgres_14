// Tests for the two PURE exports of the Pipelines tab's attribute-definition surface.
//
// Component RENDER is structurally untestable here (vitest runs `environment: "node"` by deliberate
// config -- no jsdom, no @testing-library), so what a disabled `<Select>` looks like is a browser-cert
// concern. What CAN be pinned, and is pinned here, is the two decisions behind it:
//
//   1. the picker's option set covers every type the vocabulary declares (so a `<Select>` is never
//      bound to a value it cannot offer -- the TRAPDOOR), and
//   2. which definitions refuse a type edit at all (so the four live `number_choice` definitions
//      cannot be changed into a broken state by any single interaction).
//
// Plus the values-source description that replaced the blank `values` column.

import { describe, expect, it } from "vitest";
import type { AttributeDefinition } from "./rateMasterTypes";
import {
  ATTRIBUTE_TYPE_OPTIONS,
  describeValuesSource,
  isTypeLockedByValuesSource,
} from "./RateMasterPipelines";

/** The FOUR live `number_choice` definitions, verbatim from the active point_wiring config
 *  (BoQ Rate Category Config, discipline Electrical, batch rmbulk-94711c0ac197). These are the
 *  definitions the trapdoor could have destroyed, so they are the fixtures. */
const LIVE_NUMBER_CHOICE: AttributeDefinition[] = [
  {
    id: "wire1_core",
    label: "Wire 1 - cores",
    type: "number_choice",
    values_from: { kind: "cable", attr: "core", where: { material: "COPPER", insulation: "UNARMOURED" } },
  },
  {
    id: "wire1_thickness_sqmm",
    label: "Wire 1 - thickness (sqmm)",
    type: "number_choice",
    values_from: { kind: "cable", attr: "thickness_sqmm", where: { material: "COPPER", insulation: "UNARMOURED" } },
  },
  {
    id: "wire2_core",
    label: "Wire 2 - cores",
    type: "number_choice",
    values_from: { kind: "cable", attr: "core", where: { material: "COPPER", insulation: "UNARMOURED" } },
  },
  {
    id: "wire2_thickness_sqmm",
    label: "Wire 2 - thickness (sqmm)",
    type: "number_choice",
    allow_none: true,
    disables_when_none: ["wire2_core", "wire2_runs"],
    values_from: { kind: "cable", attr: "thickness_sqmm", where: { material: "COPPER", insulation: "UNARMOURED" } },
  },
];

/** A live `choice` + values_from definition (point_wiring / switches_sockets plate slot). */
const LIVE_PLATE: AttributeDefinition = {
  id: "plate_item",
  label: "Frame/Face plate",
  type: "choice",
  values_from: { kind: "switch_socket_item", attr: "item", where: { family: "Grid and Face Plates" } },
  allow_none: true,
  disables_when_none: ["plate_qty"],
};

/** The one live values_from definition that carries NO `where` (db_switchgear shell) -- 1 of 26. */
const LIVE_SHELL: AttributeDefinition = {
  id: "db_shell_item",
  label: "DB (shell)",
  type: "choice",
  values_from: { kind: "db_shell", attr: "item" },
  allow_none: true,
  disables_when_none: ["db_shell_qty"],
};

/** A live static-`values` choice (switches_sockets colour) -- the shape the old column rendered. */
const LIVE_STATIC_CHOICE: AttributeDefinition = {
  id: "colour",
  label: "Colour",
  type: "choice",
  values: ["White", "Grey"],
};

/** A live plain number (point_wiring points). */
const LIVE_NUMBER: AttributeDefinition = { id: "points", label: "Points", type: "number" };

describe("ATTRIBUTE_TYPE_OPTIONS -- the picker can represent every declared type", () => {
  it("offers all three types in the declared vocabulary", () => {
    expect([...ATTRIBUTE_TYPE_OPTIONS].sort()).toEqual(["choice", "number", "number_choice"]);
  });

  // NEGATIVE: the drift that caused the trapdoor was an option set SHORTER than the type union.
  it("offers number_choice -- the member whose absence WAS the trapdoor", () => {
    expect(ATTRIBUTE_TYPE_OPTIONS).toContain("number_choice");
  });

  // NEGATIVE the other way: no invented token may reach the picker.
  it("offers nothing outside the vocabulary", () => {
    for (const t of ATTRIBUTE_TYPE_OPTIONS) {
      expect(["choice", "number", "number_choice"]).toContain(t);
    }
  });

  // THE TRAPDOOR CONDITION, stated directly: a control bound to `d.type` must be able to show it.
  it("can represent the type of every live definition shape (no value is unofferable)", () => {
    const all = [...LIVE_NUMBER_CHOICE, LIVE_PLATE, LIVE_SHELL, LIVE_STATIC_CHOICE, LIVE_NUMBER];
    for (const d of all) {
      expect(ATTRIBUTE_TYPE_OPTIONS).toContain(d.type);
    }
  });
});

describe("isTypeLockedByValuesSource -- the four number_choice definitions cannot be changed", () => {
  // THE PIN the slice exists for. Each of the four is UNCHANGEABLE by any single interaction.
  it.each(LIVE_NUMBER_CHOICE.map((d) => [d.id, d] as const))(
    "locks the type of the live number_choice definition %s",
    (_id, d) => {
      expect(isTypeLockedByValuesSource(d)).toBe(true);
    },
  );

  // The same hazard runs the other way on a catalog-backed `choice`: switching it to `number`
  // would null every catalog string just as silently, so it is locked too.
  it("locks a catalog-backed choice (plate_item, db_shell_item)", () => {
    expect(isTypeLockedByValuesSource(LIVE_PLATE)).toBe(true);
    expect(isTypeLockedByValuesSource(LIVE_SHELL)).toBe(true);
  });

  // NEGATIVE -- the lock must NOT spread. A definition this editor can express end to end keeps its
  // full reach; narrowing further would be a regression in the authorable space.
  it("does NOT lock a static-values choice or a plain number", () => {
    expect(isTypeLockedByValuesSource(LIVE_STATIC_CHOICE)).toBe(false);
    expect(isTypeLockedByValuesSource(LIVE_NUMBER)).toBe(false);
  });

  // NEGATIVE -- a newly added attribute (blankAttributeDefinition) carries no values_from, so the
  // author can still set its type. The fix must not make new attributes unauthorable.
  it("does NOT lock a freshly added attribute", () => {
    // Declared as a full definition (the shape blankAttributeDefinition returns), then passed --
    // the predicate's `Pick<..., "values_from">` parameter deliberately narrows what it may read.
    const fresh: AttributeDefinition = { id: "", label: "", type: "choice", values: [] };
    expect(isTypeLockedByValuesSource(fresh)).toBe(false);
  });

  // A static-values number_choice does not exist live, but if one were authored it must be
  // editable AND re-selectable -- i.e. no trapdoor in either direction.
  it("leaves a hypothetical static-values number_choice editable and representable", () => {
    const d: AttributeDefinition = { id: "core", label: "Core", type: "number_choice", values: [1, 2, 3] };
    expect(isTypeLockedByValuesSource(d)).toBe(false);
    expect(ATTRIBUTE_TYPE_OPTIONS).toContain(d.type);
  });
});

describe("describeValuesSource -- the values column tells the truth", () => {
  it("names the catalog source and its filter for a values_from definition", () => {
    const src = describeValuesSource(LIVE_PLATE);
    expect(src.fromCatalog).toBe(true);
    expect(src.text).toBe("catalog switch_socket_item.item");
    expect(src.filters).toEqual(["family=Grid and Face Plates"]);
  });

  it("carries BOTH filter pairs for the two-key point_wiring filter", () => {
    const src = describeValuesSource(LIVE_NUMBER_CHOICE[0]);
    expect(src.text).toBe("catalog cable.core");
    // Both pairs, in declaration order -- this filter is what keeps the core dropdown at the six
    // COPPER/UNARMOURED values instead of the fifteen-value union.
    expect(src.filters).toEqual(["material=COPPER", "insulation=UNARMOURED"]);
  });

  it("reports NO filters for the one live values_from definition that has no `where`", () => {
    const src = describeValuesSource(LIVE_SHELL);
    expect(src.fromCatalog).toBe(true);
    expect(src.text).toBe("catalog db_shell.item");
    expect(src.filters).toEqual([]);
  });

  // REGRESSION PIN: a static list must render exactly as the old column did.
  it("renders a static values list unchanged, and marks it NOT catalog-backed", () => {
    const src = describeValuesSource(LIVE_STATIC_CHOICE);
    expect(src.fromCatalog).toBe(false);
    expect(src.text).toBe("White, Grey");
    expect(src.filters).toEqual([]);
  });

  it("returns empty text for a definition with neither source (the em-dash cell)", () => {
    const src = describeValuesSource(LIVE_NUMBER);
    expect(src.text).toBe("");
    expect(src.fromCatalog).toBe(false);
  });

  it("surfaces None-ability and the dependants a None clears", () => {
    const src = describeValuesSource(LIVE_NUMBER_CHOICE[3]);
    expect(src.noneable).toBe(true);
    expect(src.disables).toEqual(["wire2_core", "wire2_runs"]);
  });

  it("reports a None-able definition with no dependants", () => {
    const src = describeValuesSource({
      id: "paired_mcb",
      label: "Paired MCB",
      type: "choice",
      values_from: { kind: "db_switchgear_item", attr: "item", where: { family: "Switchgear" } },
      allow_none: true,
    });
    expect(src.noneable).toBe(true);
    expect(src.disables).toEqual([]);
  });

  it("reports a definition that is NOT None-able", () => {
    expect(describeValuesSource(LIVE_NUMBER_CHOICE[0]).noneable).toBe(false);
    expect(describeValuesSource(LIVE_STATIC_CHOICE).noneable).toBe(false);
  });

  // NEGATIVE -- this DESCRIBES the spec, it does not EXECUTE it. The validator does not check
  // values_from's shape (rate_master.py only tests it for truthiness), so a malformed one can be
  // stored; the table must stay readable rather than printing "undefined.undefined" or throwing.
  it("stays readable on a malformed values_from instead of throwing", () => {
    const d = { id: "x", label: "X", type: "choice", values_from: {} } as unknown as AttributeDefinition;
    const src = describeValuesSource(d);
    expect(src.fromCatalog).toBe(true);
    expect(src.text).toBe("catalog ?.?");
    expect(src.filters).toEqual([]);
  });

  // NEGATIVE -- no catalog resolution happens here. A values_from naming a kind that does not exist
  // is described identically to one that does: describing the spec is the whole contract, and it is
  // what keeps this from becoming a FOURTH copy of the values_from resolution.
  it("describes an unresolvable source without attempting to resolve it", () => {
    const src = describeValuesSource({
      id: "y",
      label: "Y",
      type: "choice",
      values_from: { kind: "no_such_kind", attr: "no_such_attr", where: { nope: "1" } },
    });
    expect(src.text).toBe("catalog no_such_kind.no_such_attr");
    expect(src.filters).toEqual(["nope=1"]);
  });
});
