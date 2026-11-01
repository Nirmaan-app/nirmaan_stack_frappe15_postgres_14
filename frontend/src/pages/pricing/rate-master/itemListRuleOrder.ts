/**
 * SLICE 12c, ACCEPTANCE 5 / U10 -- WHAT AN ITEM-LIST CATEGORY'S RULES ARE, IN THE ORDER THEY RUN.
 * SLICE 12d-4c (owner C5, finding F6): EVERY rule the config declares is listed, not only the mechanisms.
 *
 * The Derivation tab renders `config.pipelines`, and an ITEM-LIST category's pipelines live inside
 * `list_spec` -- so for such a category the tab showed the configurator, "No rules configured for this
 * category", and blank space, while the category in fact carried a complete rule set. 12c added the
 * resolution ORDER (unit class, kind, needs, defaults, ladders, composition, conversions) but named the
 * mechanisms only; 12d-4c makes each line say what the config actually rules -- the default VALUES, the
 * materials that refuse by name, the cladding words, the sheet families that refuse glass cloth, the
 * foil-on-a-pipe mapping, the density line, the derived cells -- in the order `priceOneItem` applies them.
 *
 * ⚠️ PRICING A ROW IS NOT "RUN A PIPELINE" HERE. `priceItemList` resolves the unit class, the family,
 * the block, the facts it needs, the defaults, the ladders and the conversions FIRST, and only then runs
 * the pipeline that combination selects. A reader looking at pipeline steps alone cannot see any of
 * that, which is why this describes the whole order rather than just the steps.
 *
 * ⚠️ DERIVED FROM THE CONFIG, NEVER A SECOND LIST. Every line is a TEMPLATE keyed on the PRESENCE of a
 * config key and filled with that key's own values (the owner's standing rule for the tab: "lists every
 * rule in the order it runs, in plain English"). A mechanism the category does not declare is OMITTED;
 * no category, attribute id or internal code ("R4", "D3") is written here -- attributes are named by their
 * definition LABEL, numbers by their reader NAME, and a config sentence's trailing "(R4)" / "(owner ...)"
 * tag is stripped before it reaches the screen.
 *
 * PURE and unit-tested, so the tab stays thin over it (ADR-0010 F4). It reads the CONFIG and names the
 * category's own vocabulary -- no category is named here, and a config with no `list_spec` yields [],
 * which is what keeps every Electrical tab byte-identical.
 */

/** One line of the order: a short title and, where the config has something concrete to say, a detail.
 *  ADP-4a (owner A1 / D1): on a category under the plain item wording, `reason` is WHY -- an owner ruling quoted
 *  with its date, or "reason not recorded" -- and the detail ends with it, so the tab shows it. */
export interface RuleOrderLine {
  n: number;
  title: string;
  detail?: string;
  reason?: string;
}

/**
 * ADP-4a (owner AC1 b, 2026-10-21: "lines 12 / 32 / 34 list every need (no 'and N more')"): every list is written
 * IN FULL on every category -- a truncated list hid the very fact a reader looked for. `max` is kept so no call site
 * moves; it no longer cuts.
 */
const list = (xs: readonly string[], _max = 6): string => xs.join(", ");

const quoteList = (xs: readonly string[], max = 6): string => list(xs.map((x) => `'${x}'`), max);

/** ADP-4a (owner D4 / AC2): "10^6" in plain words wherever a rule is quoted on a category under the plain wording. */
// ADP-4b (owner AC6): and the box's surface formula in the one wording the working uses (`plainBoxSurface`)
const plainNumbers = (s: string): string => plainBoxSurface(s.replace(/\/ 10\^6 sq\.m/g, "/ 1,000,000 (sq.mm to sq.m)").replace(/10\^6/g, "1,000,000"));

/**
 * ADP-4a (owner D1, 2026-10-21 14:41: "many do have a reason in your rulings ... 'Reason not recorded' goes only where
 * none exists") -- WHY each Derivation line holds, keyed by the catalogue's own ITEM KIND (the rulings are the owner's
 * for that catalogue) and by the line's key. Every reason is one sentence drawn from a ruling the owner gave, with its
 * date; a line with no ruling here says "reason not recorded". NEVER written from what the code does.
 * A line carrying several facts names each fact's reason, and "reason not recorded" for a fact with none.
 */
const NOT_RECORDED = "reason not recorded";
const R = {
  a: "per number, the per-metre slot diffuser SKU (matched by its slots and damper) is priced through the length of the piece, so the length is captured (owner, 2026-10-19)",
  bSqm: "per sq.m the slots do not matter and the damper does, and only the with-damper SKU is stocked, so without refuses (owner, 2026-10-19)",
  bSlots: "a 1- or 4-slot diffuser refuses (owner, 2026-10-19)",
  bLength: "a piece length not stated uses a default of 1 m, disclosed (owner, 2026-10-19)",
  // ADP-4b (owner AC6): the formula in the one wording the line and the working use, (L x W + W x H + L x H)
  c: "a low-pressure plenum or mixing box is 2 x (L x W + W x H + L x H) / 1,000,000 x the per-sq.m rate + 150, the 150 on supply only and before the markup (owner, 2026-10-19)",
  cAdder: "the 150 is added on supply only, before the markup (owner, 2026-10-19)",
  dArea: "with an area read, the per-sq.m SKU's rate is used as it stands (owner, 2026-10-19)",
  dRefuse: "with neither an area nor a length, width and height, the row refuses (owner, 2026-10-19)",
  dBand: "an area band is priced at its maximum (owner, 2026-10-20)",
  e: "supply air means with damper unless the row says without; return, exhaust and fresh air mean without unless a damper is named (owner, 2026-10-19)",
  eBoth: "a row naming both air streams, or none that can be told, keeps the model's own damper value (owner, 2026-10-19)",
  f: "a typed neck size the catalogue does not stock takes the next stocked size up, and above 450 it refuses (owner, 2026-10-19)",
  g: "a missing torque, panel ratio, plenum thickness or damper type means blank and not priced (owner, standing ADP ruling)",
  h: "area and width x height are either-or: only one of them needs to be filled in to price (owner, 2026-10-19)",
  i: "a row in a unit its kind is not stocked in refuses, naming its unit and the stocked units (owner, 2026-10-20)",
  jThree: "a three-part size keeps its first two parts as the face (owner, 2026-10-20)",
  jGrille: "a per-metre grille's '150mm width' is its height (owner, 2026-10-20)",
  k: "a two-part size on a Width + Height item is the face, whatever its parts are called (owner, 2026-10-21)",
  l: "a piece length is the longest side of 'a x b (x c)', and a lone number of 300 mm or more is the length, below it a slot width (owner, 2026-10-19)",
  m: "a derived catalogue cell is a live link to its base row: editing the base row moves it (owner ruling on row links)",
  // ADP-4b (owner AC6, 2026-10-21): two lines that said "reason not recorded" have a ruling
  n: "when priced in numbers, the SKU is matched on its slots and damper (owner, 2026-10-19)",
  oBox: "either the area is read, or the length, width and height, and the formula is applied; with neither the row refuses (owner, 2026-10-19)",
  // ADP-5a (owner 2026-10-22; AC8): the reasons of the four rules this slice builds, each quoted from its ruling
  pBoxDepth: "\"1200x150-300 depth\" / \"600x600-300 depth\" is read as three box sides (owner, 2026-10-22 10:49, item 6)",
  qCurved: "\"curved grills are supply only..so they should price with damper only\" -- always with damper unless the row says 'without' (owner, 2026-10-20 12:51)",
  rWords: "the both-streams rule also reads 'cum' and 'SA / RA' (owner, 2026-10-22 10:49, item 3); the heading directly above the row counts with its notes (owner, 2026-10-22)",
  sMerge: "\"the model correctly returned spigot and butterfly damper...so these cases should be matched with spigot with butterfly damper\"; \"Spigot Smaper is spigot with butterfly damper\"; \"only the dia of the spigot matters\" (owner, 2026-10-22 10:45 / 10:48 / 10:49)",
} as const;
/** ELR-1: wiring_cabling's reasons, each from the ruling that covers the line (the v47 conduit rulings are quoted
 *  verbatim in the plan doc's "CONDUIT IN THE CABLE RATE" entry; the runs rulings in EA-4 ext-b and BOX-RUNS). */
const W = {
  bothBlocks: "\"we side step all this judgement and just show both the wirirng and cable rates and the terminations rates for all rows\" (owner, 2026-08-22)",
  match: "attribute values are canonical upper case and matching is exact (owner, 2026-07-28)",
  included: "\"system cannot judge if itsa included or not -- default to not include it\" (owner, 2026-08-23)",
  type: "\"dont use dfault for material type\" (owner, 2026-08-23)",
  size: "\"if material is mentioned and size cannot be determined and price needs tro be oincluded use default size of 25 mm\" (owner, 2026-08-23)",
  runs: "the run count multiplies the cable's price; runs and cores are never multiplied together (owner, 2026-08-05)",
  installStep: "the install is stepped one unit per three runs, correcting the excessive install rate (owner ruling, 2026-08-10)",
  conduit: "\"conduit pricing works the same way as it is working for conduit category\"; one conduit per row regardless of parallel runs (owner, 2026-08-23)",
  conduitInstall: "\"conduit pricing works the same way as it is working for conduit category\" (owner, 2026-08-23)",
  totals: "supply = the cable supply rounded to tens + the conduit supply unrounded, the total rounded up to units; install = the two rounded legs, not rounded again (owner, 2026-08-23)",
  terminationInstall: "\"for termination install dont multiply by R as it is already beign dervide from supply which has the multiplication done\" (owner, 2026-08-05)",
} as const;
/** ELR-4a: point wiring's, switches & sockets' and pop-up boxes' reasons, word for word as the owner approved them at
 *  the P6 stop (2026-10-29), with his three edits (the circuit-length reason without figures, the plate line's
 *  "reason not recorded", the bare-box reason). */
const E = {
  wires: "the wire-reading rule is your own rule text, given to the AI word for word (owner, c. 2026-08-08; rewritten 2026-09-03)",
  floor: "\"the number of conductors must ne coerced to 3 if the extraction reads less than 3 conductors, 3 core 1 run is also 3 conductors\"; \"if the wire given is 2 core then we have to add another wire 2 of 1 core and same thickness even if it results in higher install price\" (owner, 2026-09-03)",
  points: "\"Where the line names no count at all, record 1.\" (owner, c. 2026-08-08)",
  switch: "\"No 6A switch exists in the catalog. When a line states a 6A switch, select the 10A switch with the same other parameters\" (owner, c. 2026-08-06; the way-count and 16A rules likewise, no further reason recorded)",
  quantities: "\"if the item is filled but qty is blank then it should be populated default 1. when item is none or blank it, the default qty rule sshould not be applied ... this should be included\" (owner, 2026-09-07); clearing None = work it out (owner, 2026-10-27, \"2 v1\")",
  length: "\"if the line item mentions only Primary/ first or any synonym then length will be ['Point wiring - circuit length of the first point']. if it mentions only secondary/looping/ second/ third etc points then length will be ['Point wiring - circuit length per further point'] ... in case of confusion default to the formula\" (owner, 2026-09-01); n times: \"ok. still buid the mechanism\" (owner, 2026-09-05)",
  conduitIncluded: "\"slash alternation (existing conduit / raceway) | INCLUDE PVC -- genuinely ambiguous; silent on conduit | INCLUDE PVC\"; \"a NORMAL conduit named elsewhere | INCLUDE PVC -- ambiguous\"; \"conduit price EXPLICITLY EXCLUDED | DROP -- the document says so; outranks all inference\" (owner, 2026-09-01)",
  conduitType: "\"silent on conduit | INCLUDE PVC\" (owner, 2026-09-01; why PVC is not recorded)",
  circuitWiring: "\"we need to include only for positive cases ... the ciricuit wiring cost wil be added only to thr eprimary point rows or mixed rows and not secondary point rows\" (owner, 2026-09-02)",
  install: "\"we are pricing the 2 wires separately\" (owner, 2026-09-03; the wire install, ruling (a) 2026-08-10); the rest: reason not recorded",
  bareBox: "\"extraction should provide the higher count\" (owner, 2026-09-08); ranges: accepted as built, the higher-count rule not applied today (owner, 2026-09-08); the mm-only rows at 3M: \"this is ok\" (owner, 2026-09-07)",
  moduleWidths: "\"The owner's rule is 2 x (sockets) + 1 x (switches)\" (owner, c. 2026-08-06; per-item widths 2026-08-21)",
  includesModules: "\"if the user edits it to no, they should get the bare box price. if they set it to yes they should get price of box oplus components as [per the selction\" (owner, 2026-09-10)",
  // ELR-4b (owner P6 Q1, 2026-10-29 "Q1 yes"): the raw id "(owner R1)" dropped from the quote, the rest word for word
  boxAdded: "\"the switch-socket module set now lives INSIDE this category and its price is ADDED to the box price\" (owner, 2026-08-21)",
} as const;
/** ELR-4b: wiring's three new reasons (the P6 corrections WC-b / WC-c / WC-d), word for word as approved (2026-10-29). */
const W2 = {
  insulation: "\"a FLEXIBLE cable is unarmoured, and when NEITHER armoured nor unarmoured is stated (row or ancestors) the insulation DEFAULTS to UNARMOURED (not null)\" (owner, 2026-07-28)",
  runsCores: "\"If a run count is not stated anywhere in the context supplied for the row, record 1. If a core count is not stated, record 1.\" (owner, 2026-08-05)",
  gi: "\"GI and MS are PRICE-INTERCHANGEABLE FOR CONDUITS ONLY\" (owner, 2026-07-29)",
} as const;
/** ELR-4b (owner R-APPROVE; the P6 answer 2026-10-29 "all approved ... DB4 keep verbatim; MI2 repeat MI1's quote in
 *  full"): the other eight Electrical categories' reasons, word for word as approved, typos in the quotes included. */
const B = {
  partial: "\"PARTIAL PRICING = price every slot the catalog can satisfy ... a WHOLE-row no-match returns all slots null (fully manual)\" (owner, 2026-07-31)",
  board: "\"If the exact way-count is not in the catalog, select the NEXT HIGHER way-count, never a lower one.\" (owner, c. 2026-08-02)",
  breakers: "\"CURVE = BoQ-stated else UPS-context->D else C (undetermined->C)\"; \"AMP = exact else NEXT-HIGHER catalog rating (never lower), a range takes the HIGHEST first\" (owner, 2026-07-31)",
  pole: "\"for any ploe + Neutral, should be matched withnext higher pole: SPN with DP, TPN with 4p ... we need to first match with SPN in catalog, if that is not there then we match with DP\" (owner, 2026-09-05)",
  rccb: "\"Among the items that match, select the one with the HIGHEST mA rating.\" (owner, 2026-08-05); \"An ELCB is a combined device and is priced as TWO components: an MCB plus an RCCB.\" (owner, c. 2026-08-02)",
  phase: "\"Multiply the stated per-phase quantity by the number of phases the DB carries: three for a TPN or VTPN DB, one for an SPN DB.\" (owner, 2026-08-05)",
  mcbPole: "\"TPN, TP+N, TP+NL, TP+2N, TP+2NL, 4P and Four Pole all mean FOUR POLE\" (owner, 2026-08-22); a single pole plus neutral means two pole (owner, 2026-09-05); the pin-count fallback: reason not recorded",
  mcbRating: "\"this is the correct outcome\" (owner, 2026-09-06; refusing rather than pricing the socket alone); the unread amperage: reason not recorded",
  earthItem: "\"handle by hand for now. earthing would need its own detailed fix later. currently it is not correct\" (owner, 2026-10-29); the match: reason not recorded",
  busbar: "\"the D26 adder means ADD A BUS BAR\"; \"no positive bus-bar mention -> Without\" (owner, 2026-07-29 / 2026-07-30)",
  conduitSize: "\"we need to fix by implementing a match with next higher ladder in the catalog and giving the correct note as we did for cabletray width\" / \"my lean is towards seprating the arithmentic to the code side\" (owner, 2026-09-10)",
  trayMaterial: "\"These substitutions reflect what is actually supplied; the stated material in the document does not price.\" (owner, c. 2026-08-02)",
  trayDefaults: "\"silence -> Solid / cover No / cutting No / refilling No; installation Ceiling for cable tray, Floor when the text says RACEWAY\" (owner, 2026-07-30)",
  jbFace: "\"The depth ... does not affect the price and must be ignored. ... leave the value blank - never assume one.\" (owner, 2026-08-15)",
  lmsItem: "\"ONE catalogue item per BoQ row\" (owner, 2026-09-04)",
  lmsSupply: "\"ok the rate is BCS and it should be marked up by ['Lighting management system supply markup'] for BoQ\" (owner, 2026-09-04)",
  misc: "\"the Misc block is SELF-CONTAINED -- its hardcoded rates ARE the BoQ rates\" (owner, 2026-07-29)",
} as const;
const each = (parts: Array<[string, string]>): string => parts.map(([what, why]) => `${what} -- ${why}`).join("; ");
export const DERIVATION_RULINGS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  hvac_adp_item: {
    unit_refusal: R.i,
    slot_number: R.a,
    plenum_area: R.dArea,
    plenum_box: R.c,
    plenum_missing: R.dRefuse,
    slot_stock: R.bSlots,
    needs: R.g,
    piece_length: R.l,
    area_band: R.dBand,
    conv_band: R.dBand,
    slot_missing: R.n,
    sizes: each([["the face", `${R.jThree}; ${R.k}`], ["the box sides", `${R.oBox}; ${R.pBoxDepth}`]]),   // ADP-5a: BEFORE the box sides R.oBox alone
    defaults: each([["damper", R.e], ["piece length", R.bLength], ["insulated, UL listed, variant", NOT_RECORDED]]),
    // ADP-5a (AC2): the same line on a config whose default carries a per-family line (v51: the curved grille's "with")
    defaults_by_family: each([["damper", `${R.e}; ${R.qCurved}`], ["piece length", R.bLength], ["insulated, UL listed, variant", NOT_RECORDED]]),
    air_both: each([["both streams", R.eBoth], ["'cum', 'SA / RA' and the heading's notes", R.rWords]]),   // ADP-5a: BEFORE R.eBoth alone
    family_merge: R.sMerge,
    slot_sqm: R.bSqm,
    ladders: each([["neck size", R.f], ["diameter, torque, panel ratio, plenum thickness", NOT_RECORDED]]),
    steps: each([["Mixing box supply adder", R.cAdder], ["Cross-talk assumed depth, Flexible duct length per piece", NOT_RECORDED]]),
    derived: R.m,
    either_or: R.h,
    third_part: R.jThree,
    height_only: R.jGrille,
  },
  // ELR-1 (owner R-DERIV 2026-09-27; ADP-4b D1 2026-10-21 14:41): wiring_cabling's rules list, keyed by the CATEGORY --
  // an attribute-path category has no item kind of its own to key by (wiring's are cable and termination). A
  // category with an entry here gets its rules list on the Derivation tab (`attributeRuleOrder`); ELR-4 adds the
  // other eleven by entries and lines, nothing else.
  wiring_cabling: {
    both_blocks: W.bothBlocks,
    match: W.match,
    insulation: W2.insulation,
    runs_cores: W2.runsCores,
    conduit_included: W.included,
    conduit_type: `${W.type}; ${W2.gi}`,
    conduit_size: W.size,
    cable_supply: NOT_RECORDED,
    runs: W.runs,
    cable_install: W.installStep,
    conduit_price: W.conduit,
    conduit_install: W.conduitInstall,
    totals: W.totals,
    termination_supply: each([["runs", W.runs], ["the gland sizes and the rounding", NOT_RECORDED]]),
    termination_install: W.terminationInstall,
  },
  // ELR-4a (owner R-APPROVE, 2026-10-29 "option b"; the P6 answer): the three module-fitting categories' reasons, each
  // line's "why" as the owner approved it. The KEY ORDER IS THE LINE ORDER on the tab (`assemblyRuleOrder`).
  point_wiring: {
    wires: E.wires,
    floor: E.floor,
    points: E.points,
    switch: E.switch,
    quantities: E.quantities,
    box_colour: NOT_RECORDED,
    length: E.length,
    conduit_included: E.conduitIncluded,
    conduit_type: E.conduitType,
    circuit_wiring: E.circuitWiring,
    conduit_fit: NOT_RECORDED,
    plate: NOT_RECORDED,   // owner P6 edit: no plain-words quote of the 2026-08-06 / 2026-08-09 rulings is recorded
    supply: NOT_RECORDED,
    install: E.install,
  },
  switches_sockets: {
    switch: E.switch,
    bare_box: E.bareBox,
    quantities: E.quantities,
    box_colour: NOT_RECORDED,
    plate: E.moduleWidths,
    supply: NOT_RECORDED,
    install: NOT_RECORDED,
  },
  popup_boxes: {
    includes_modules: E.includesModules,
    box: E.boxAdded,
    quantities: `${E.quantities}; White: ${NOT_RECORDED}`,
    plate: E.moduleWidths,
    modules_price: NOT_RECORDED,
    totals: E.boxAdded,
  },
  // ELR-4b (owner R-APPROVE; the P6 answer 2026-10-29): the other eight categories, through `assemblyRuleOrder` like the
  // three above. The KEY ORDER IS THE LINE ORDER (the AI's read first, then the BoQ pipeline steps).
  db_switchgear: {
    db_parts: B.partial,
    db_board: B.board,
    db_breakers: B.breakers,
    db_pole: B.pole,
    db_rccb: B.rccb,
    db_phase: B.phase,
    db_quantities: NOT_RECORDED,
    db_supply: NOT_RECORDED,
    db_install: NOT_RECORDED,
  },
  industrial_sockets: {
    is_mcb: NOT_RECORDED,
    is_pole: B.mcbPole,
    is_curve: NOT_RECORDED,
    is_rating: B.mcbRating,
    is_interlocked: NOT_RECORDED,
    is_enclosure: NOT_RECORDED,
    is_supply: NOT_RECORDED,
    is_install: NOT_RECORDED,
  },
  earthing: {
    ea_item: B.earthItem,
    ea_busbar: B.busbar,
    ea_totals: NOT_RECORDED,
  },
  conduit_piping: {
    cp_type: W2.gi,
    cp_size: B.conduitSize,
    cp_price: NOT_RECORDED,
  },
  cabletray_raceway: {
    ct_material: B.trayMaterial,
    ct_thickness: NOT_RECORDED,
    ct_width: NOT_RECORDED,
    ct_defaults: B.trayDefaults,
    ct_supply: NOT_RECORDED,
    ct_install: NOT_RECORDED,
  },
  junction_box_raceway: {
    jb_face: B.jbFace,
    jb_price: NOT_RECORDED,
  },
  lighting_mgmt_system: {
    lm_item: B.lmsItem,
    lm_supply: B.lmsSupply,
  },
  miscellaneous: {
    mi_item: B.misc,
    mi_price: B.misc,
  },
};

/**
 * SLICE 12d-5: `plainSentence` and the Pricing-Input label resolver moved to `plainEnglish.ts` -- the ONE
 * plain-English function the panel and the calculator now share with this tab. Re-exported so every
 * 12d-4c caller and pin stands; do not copy either back here.
 */
import { plainSentence, pricingInputLabel } from "./plainEnglish";
import { GI_FRAMEWORK_CLADDING, PIECE_LENGTH_MIN_MM, familyDisplayName, itemListPricingSpec, plainBoxSurface, plainItemListWording, stockedUnitsWords, waysLabel } from "../../boq-wizard/rate-helper/itemListPricing";
export { plainSentence };

/**
 * The resolution order for a category that prices a row as a LIST OF ITEMS, or [] for one that does
 * not. Every line that can name a concrete fact from the config does; a line whose mechanism the
 * category does not use is OMITTED rather than shown as "none", so the list is what this category
 * actually does.
 */
/**
 * SLICE 12d-4c (owner, on approving 5d): a Pricing Input is named on the tab by its LABEL -- the `name` the
 * Pricing Inputs row carries (`GI framework sheet factor`), never its item id (`gi_framework_factor`). The
 * label lives on the ITEM, not in the config, so the caller passes the discipline's items (the SAME live
 * read the Derivation tab already holds); with no items the id is written as plain words, so no internal
 * name reaches the screen on either path.
 */
export type RuleOrderItem = { kind?: string; unit?: string | null; attributes?: Record<string, unknown>; rates?: Record<string, unknown> };

/**
 * SLICE 12d-5 (owner P1, finding F-C5a): whether the Derivation tab draws the "Rules" card -- the EXTRACTION
 * rules (`config.rules`, the owner-authored estimator guidance the prompt receives). An item-list category
 * keeps its rules inside `list_spec` and lists them in "How a row is priced", so beneath that list an empty
 * "No rules configured" card read as a contradiction. Decided by the CONFIG, never by a category name: the
 * card is hidden iff the category prices as a list of items (a `list_spec` is present) AND declares no
 * extraction rules; a category that carries rules keeps its card whatever its shape, and every
 * non-item-list category (Electrical) keeps its empty state exactly as before.
 */
export function extractionRulesCardShown(config: unknown): boolean {
  const c = config as any;
  const rules = Array.isArray(c?.rules) ? c.rules : [];
  const itemList = !!(c?.list_spec && typeof c.list_spec === "object");
  return rules.length > 0 || !itemList;
}

const famWordRaw = (f: string) => String(f).trim();

export function itemListRuleOrder(config: unknown, items: ReadonlyArray<RuleOrderItem> = []): RuleOrderLine[] {
  const inputLabel = (id: string): string => pricingInputLabel(id, items);
  const ls = (config as any)?.list_spec;
  const pr = ls?.pricing;
  if (!pr || typeof pr !== "object") return [];

  const out: RuleOrderLine[] = [];
  /**
   * ADP-4a (owner AC1, 2026-10-21; scope ruled at 14:4x: reasons and merges on ADP only): `plain` is the category
   * under the plain item wording (`plainItemListWording`). On it each line carries a KEY its reason is looked up by,
   * repeated lines are merged and the rules that ran with no line get one; on every other category `plain` is false
   * and every line below reads as it did, except the three generic fixes the owner ruled for all (lists in full, the
   * amber derived cells, line 30's units).
   */
  const specAll = itemListPricingSpec(config as any);
  const plain = !!specAll && plainItemListWording(specAll);
  const keys: Array<string | undefined> = [];
  const add = (title: string, detail?: string, key?: string) => { out.push({ n: out.length + 1, title, detail }); keys.push(key); };
  const famShown = (f: string) => (plain && specAll ? familyDisplayName(specAll, f) : famWordRaw(f));

  // the category's own words for its attributes and numbers -- never an id on screen
  const labels: Record<string, string> = {};
  for (const d of (ls?.attribute_definitions ?? []) as any[]) if (d?.id) labels[String(d.id)] = String(d.label ?? d.id);
  const name = (attr: string): string => {
    const n = pr.numbers?.[attr]?.name;
    if (n) return String(n);
    const l = labels[attr];
    if (!l) return attr.replace(/_/g, " ");
    const bare = l.replace(/\s*\(.*\)\s*$/, "");
    // a Title-cased label reads as a word mid-sentence ("Cladding" -> "cladding"); an acronym keeps its case ("UL listed")
    return /^[A-Z][a-z]/.test(bare) ? bare.charAt(0).toLowerCase() + bare.slice(1) : bare;
  };
  const famWord = famWordRaw;
  /** ADP-4b (owner AC5, 2026-10-21: "same rule everywhere"): a unit the family is not offered in (`units_not_offered`)
   *  counts as neither priced nor stocked -- its conversions into that unit are not listed as a way to price it, exactly
   *  as `priceOneItem` no longer runs them. */
  const convertsOf = (fv: any): Array<[string, any]> =>
    Object.entries<any>(fv?.convert ?? {}).filter(([cls]) => !((fv?.units_not_offered ?? []) as string[]).includes(cls));
  /**
   * ADP-4a (owner D2 "16 + 35", D3 "35 + 38"; wording from ADP-R4 R10): THE ONE SIZE LINE on the plain wording. The
   * face (Width + Height) and the box (Length x Width x Height) are typed in their own boxes or read from the size as
   * written; a part labelled as a length or depth is "named and not used" ONLY where it cannot be the face -- line 35
   * said it of every face size, which ADP-3c made false on a two-part size. Line 16's "depth" is said the same way:
   * on a BOX a depth label is the height side. Generated from the readers the config declares.
   */
  const faceReaders = Object.entries<any>(pr.numbers ?? {}).filter(([, x]) => x?.typed_only && x?.length_from && x?.face_side);
  const boxReaders = Object.entries<any>(pr.numbers ?? {}).filter(([, x]) => x?.typed_only && x?.length_from && x?.box_side);
  const sizesLineTitle = () => `The sizes are typed in their own boxes, else read from the ${name(String((boxReaders[0] ?? faceReaders[0])?.[1]?.length_from ?? "size"))} as written`;
  const sizesLineDetail = () => [
    faceReaders.length
      ? `a face (${faceReaders.map(([, x]) => String(x.face_side)).join(" x ")}): the size's first two parts ('550X300' -> width 550, height 300); a W / wide / width or H / Ht / high / height label decides between those two ('600 x 400 mm High' -> height 400); a two-part size fills both sides whatever its parts are called ('600(L)X150mm width' -> width 150, height 600; with no width or height label, first = width, second = height); a part labelled as a length or a depth is named and not used only where it cannot be the face -- a third part, or a kind that reads the height alone`
      : "",
    boxReaders.length
      // ADP-5a (owner 2026-10-22 10:49, item 6): ADDED at the end of the box's part -- "A x B-C depth" is three sides
      ? `a box (${boxReaders.map(([a]) => name(a)).join(" x ")}): in that order, the height last ('550 x 550 x 400 mm Ht' -> 550 / 550 / 400); a side written with its label goes to that side -- L / long / length, W / B / width, H / Ht / high, and on a box a D / deep / depth label is the height ('3000 mm Length' -> length 3000); 'A x B-C depth' is three sides ('1200x150-300 depth' -> 1200 / 150 / 300)`
      : "",
    "text that is not a size is read whole as the width; the field shows the value used, with a line saying so; a typed value always wins",
  ].filter(Boolean).join("; ");

  // ── 1. the row's unit ──────────────────────────────────────────────────────────────────────────────
  const classes = Object.keys(pr.unit_classes ?? {});
  const factors = Object.keys(pr.unit_factors ?? {});
  add("The row's unit decides which kind of rate applies",
      // ADP-4a (R6 / block 38): on the plain wording the units are the pricer's words, never the class ids
      [classes.length ? `the units it knows: ${list(plain ? classes.map((c) => String(pr.unit_words?.[c] ?? c)) : classes)}` : "",
       factors.length ? `${list(factors, 4)} convert to the catalogue's own unit` : "",
       classes.length ? "a row with no unit, or a rate-only unit (R/O, QRO), is priced in the item's own unit and says so; a row stating several units refuses, naming them" : "",
       // SLICE 12e-2 (owner Q19 / C2): the configured refusal for any other unit, in its own words
       typeof pr.unit_refusal === "string" && pr.unit_refusal.trim() ? `any other unit refuses: ${plainSentence(String(pr.unit_refusal).replace("{unit}", "nos"))}` : ""]
        .filter(Boolean).join("; ") || undefined, "unit");

  // ── 2. the kind ───────────────────────────────────────────────────────────────────────────────────
  const fams = Object.keys(pr.families ?? {});
  const aliases = Object.keys(pr.family_alias ?? {});
  add("The item's own kind decides which products can price it",
      [fams.length ? `${fams.length} kind${fams.length === 1 ? "" : "s"} in the catalogue` : "",
       // ADP-4a (R1 defect): the alias names the kind it prices as, under its shown name
       aliases.length ? (plain ? list(aliases.map((a) => `${famShown(a)} prices as ${famWord(String(pr.family_alias[a]))}`)) : `${list(aliases, 3)} price as another kind`) : ""]
        .filter(Boolean).join("; ") || undefined, "kind");

  // ── 2b. SLICE 12e-2 (owner Q16 / Q15 / Q18): a kind written as the BoQ writes it ─────────────────
  const famAttrId = String(ls?.family_attribute_id ?? "family");
  const ft = pr.family_text;
  if (ft && typeof ft === "object") {
    const maps = ((ft.map ?? []) as any[]).filter((m) => m?.from && m?.to);
    if (maps.length) {
      add(`A ${name(famAttrId)} written as ${list(maps.map((m) => String(m.from)), 4)} is priced as the kind it means`,
          `${list(maps.map((m) => `${String(m.from)} -> ${famWord(String(m.to))}`), 4)} -- with a line saying so`);
    }
    const refuses = ((ft.refuse ?? []) as any[]).filter((r) => r?.from && r?.refuse);
    add(`A ${name(famAttrId)} the catalogue does not stock refuses by name`,
        [...refuses.map((r) => `${String(r.from)}: ${plainSentence(r.refuse)}`), "any other spelling: no SKU in the catalogue for it -- the pricer decides"].join("; "));
    if (ft.from_row && typeof ft.from_row === "object" && ft.from_row.refuse) {
      add(`A row naming one ${name(famAttrId)} prices as it; two different ones with none chosen refuse`,
          `the names in the row's own text, read through the same map; ${plainSentence(String(ft.from_row.refuse).replace("{types}", "the names found"))}`);
      // SLICE 12e-6 (owner R2, amended 2026-10-16 14:22; U9): ADDED -- the line above keeps its words
      add(`One ${name(famAttrId)} written as two stocked kinds prices one of them`,
          "CPVC named with PVC or uPVC prices as CPVC; any other two stocked kinds price the lower cost for the row's size -- with a line saying so; the pricer can change it");
    }
    // SLICE 12e-4b (owner D-3; decisions 2 / 3 / 7): the family as the BoQ writes it, where the config names
    // the attribute that carries it
    if (typeof ft.from_attr === "string" && ft.from_attr.trim()) {
      const asWritten = labels[String(ft.from_attr)] ?? String(ft.from_attr).replace(/_/g, " ");
      add(`A ${name(famAttrId)} left unanswered is read from '${asWritten}'`,
          [`the BoQ's own word, from the row or else its headings, read exactly as the same word typed in the ${name(famAttrId)} box`,
           `a word naming several kinds prices as the one they all mean and refuses when they differ`,
           `an answered ${name(famAttrId)} always wins over it`,
           `shown read-only, and only where it differs from the kind priced`].join("; "));
      // SLICE 12e-6b (owner R1, 2026-10-16 23:43 IST; owner U9 precedent): ADDED -- the lines above keep their words
      if (pr.families?.CPVC) {
        add(`A drain pipe whose material the BoQ does not name prices as CPVC`,
            "a pipe the row or a heading calls a drain (drain, drainage, condensate) with no type told and no pipe material named -- in amber: 'drain pipe, no material stated -> priced as CPVC'; a material the BoQ names keeps its rule; the pricer can change it");
      }
    }
  }

  const fwn = pr.family_when_none;
  if (fwn && typeof fwn === "object") {
    const byClass = Object.entries<any>(fwn.by_unit_class ?? {}).map(([cls, f]) => `per ${pr.unit_words?.[cls] ?? cls}: ${famWord(f)}`);
    const byWords = ((fwn.when_words ?? []) as any[]).map((w) => `${quoteList(w.words ?? [], 4)} in the row or its headings${w.unit_class ? ` (per ${pr.unit_words?.[w.unit_class] ?? w.unit_class})` : ""}: ${famWord(w.family)}`);
    add("A row that names no material takes the kind its row implies",
        [...byClass, ...byWords].join("; ") + " -- shown as assumed, never silently");
  }
  const noSku: string[] = (pr.no_sku_families ?? []).map(String);
  if (noSku.length) {
    const by = pr.no_sku_named_by ? `, naming the material as the row wrote it` : "";
    // ADP-4a (AC1 b, R1 line 3): on an item catalogue the thing not matched is an ITEM, shown by its display name
    if (plain) add("An item the model could not match to any kind refuses",
        `an item answered as ${quoteList(noSku.map(famShown))} is a refusal for a person${by}`, "nosku");
    else add("A material the model could not match to any kind refuses",
        `the kind ${quoteList(noSku)} is a refusal for a person${by}`);
  }
  // SLICE 12e-6 (AC2; U9): ADDED
  if (noSku.length && fwn && typeof fwn === "object") {
    add(`A ${quoteList(noSku)} answer where the BoQ names no material takes the kind its row implies`,
        "nothing copied as the material and no unstocked material in the row or its headings -- shown as assumed; a material the BoQ names keeps the refusal");
  }
  // SLICE 12e-6c (owner R, 2026-10-18): ADDED -- the lines above keep their words
  const pufFam = fams.find((f) => /(^|[^a-z0-9])puf(?![a-z0-9])/i.test(f));
  if (pufFam && pr.no_sku_named_by) {
    add(`RPUF with no material answered prices as ${famWord(pufFam)}`,
        `RPUF in the row's own text or the ${name(String(pr.no_sku_named_by))}, where no material was answered or the answer was ${quoteList(noSku)} -- in amber: 'BoQ says RPUF -> priced as ${famWord(pufFam)}', at the next stocked thickness up; a thickness above the largest for the pipe still refuses; an answered material stands`);
    // ADP-1 (owner F4, 2026-10-19; U6): ADDED -- the line above keeps its words
    const unpriced = classes.filter((cls) => !pr.families?.[pufFam]?.units?.[cls]);
    if (unpriced.length) {
      add(`RPUF on a per-${list(unpriced.map((cls) => String(pr.unit_words?.[cls] ?? cls)))} row refuses by name`,
          `no ${famWord(pufFam)} is stocked per ${list(unpriced.map((cls) => String(pr.unit_words?.[cls] ?? cls)))}: 'No SKU in the catalogue for RPUF - price this row by hand', where no material was answered; an answered material stands`);
    }
  }
  const um = pr.unstocked_materials;
  if (um && Array.isArray(um.words) && um.words.length) {
    add("A material the catalogue does not stock refuses by name, whatever kind was picked",
        `${quoteList(um.words, 12)} in the row's own text${um.from_attr ? ` or in the ${name(String(um.from_attr))}` : ""}`);
    // SLICE 12e-6 (owner R1 / R3 / R5 / R8; U9): ADDED
    if (pr.no_sku_named_by) {
      add("A material written with an alternative prices the stocked one",
          "an unstocked material beside a stocked one ('nitrile rubber/XLPE', 'rockwool/glasswool') prices the stocked one; two stocked ones ('open-cell acoustic foam / fiberglass board') price the lower cost -- with a line saying so");
    }
    add("Cross-linked polyethylene, XPE, FR-XPE and a co-extruded jacket or covering are XLPE and refuse by name",
        "before closed cell polyethylene could be read as nitrile: 'No SKU in the catalogue for <the words as written> - price this row by hand'");
  }

  // ── 3. the rule for the unit, the facts it needs ──────────────────────────────────────────────────
  // SLICE 12e-2b (12e-2 cert finding 6, AC7): the unit words come from the config's own unit classes. A
  // category priced in ONE class (Piping: per metre) never reads "per square metre"; a category with several
  // keeps the sentence it has always had, byte for byte.
  // ADP-4a (AC1 b, R1 line 4): on the plain wording the units are the config's own, every one named ("per number" was
  // missing); every other category keeps its sentence byte for byte
  const perWords = classes.map((c) => `per ${String(pr.unit_words?.[c] ?? c)}`);
  add("That kind's rule for that unit",
      classes.length === 1
        ? "a kind is priced per " + String(pr.unit_words?.[classes[0]] ?? classes[0]) + " and has one rule for it"
        : plain
          ? `a kind priced ${perWords.slice(0, -1).join(", ")} or ${perWords[perWords.length - 1]} has a rule for each`
          : "a kind priced per metre and per square metre has a rule for each", "unit_rule");
  // SLICE 12e-6 (AC5; U9): ADDED
  const byKind = Object.entries<any>(fwn?.by_unit_class ?? {});
  if (byKind.length >= 2) {
    add("A row-kind material on the other row kind prices as the one for the row's unit",
        `${byKind.map(([cls, f]) => `per ${pr.unit_words?.[cls] ?? cls}: ${famWord(f)}`).join("; ")} -- with a line saying so ('priced as ... (row is per ...)')`);
  }
  const notOffered: string[] = [];
  for (const [f, fv] of Object.entries<any>(pr.families ?? {})) {
    for (const u of fv?.units_not_offered ?? []) notOffered.push(`${famWord(f)} is not offered per ${pr.unit_words?.[u] ?? u}`);
  }
  // ADP-4a (owner D2 "5 + 32"): on the plain wording this is said once, inside the line naming the stocked units
  if (notOffered.length && !plain) add("A kind the catalogue does not price in the row's unit", list(notOffered, 4));
  // ADP-1 (owner H3 / H4, 2026-10-19; U6): ADDED -- a conversion that shows its numbers, a refusal that names the missing
  // facts, a number the catalogue does not stock. Each keyed on its own config key; the lines above keep their words.
  for (const [f, fv] of Object.entries<any>(pr.families ?? {})) {
    for (const [cls, opts] of convertsOf(fv)) {
      // ADP-2 (owner H7; U6): several conversions that each name what is missing are ONE either-or rule -- the
      // single-fact option says which fact it takes, and one refusal line offers every way (the lines above keep their words)
      const optList = (Array.isArray(opts) ? opts : []) as any[];
      const eitherOr = optList.length > 1 && optList.every((o) => o?.name_missing);
      const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
      // ADP-4a (D1): the key a reason is looked up by -- the conversion's own facts say which rule it is
      const convKey = (o: any): string | undefined => {
        const n = (o?.needs ?? []) as string[];
        if (n.includes("slot_count")) return "slot_number";
        if (n.some((x) => /area/.test(x)) && n.some((x) => /^plenum_/.test(x))) return "plenum_area";
        if (n.some((x) => /^plenum_/.test(x))) return "plenum_box";
        return undefined;
      };
      for (const o of optList) {
        const from = pr.unit_words?.[cls] ?? cls, to = pr.unit_words?.[o?.to] ?? o?.to;
        const single = eitherOr && (o.needs ?? []).length === 1 ? ` with ${article(name(o.needs[0]))} ${name(o.needs[0])}` : "";
        if (o?.show_numbers) {
          add(`A per-${from} ${famWord(f)}${single} is priced from the per-${to} rate`,
              `${plainNumbers(plainSentence(String(o.rule ?? "")))} -- the working shows the arithmetic with the numbers`, convKey(o));
        }
        if (eitherOr) continue;
        if (o?.name_missing) {
          // ADP-4a (AC1 b, R1 line 7): the refusal as the pricer words it, not a placeholder
          const named = (o.needs ?? []).filter((n: string) => !pr.number_defaults?.[n]).map(name);
          add(`A per-${from} ${famWord(f)} without ${list(named)} refuses, naming what is missing`,
              `'per-${from} row: no ${named.join(" and ")} stated to convert the per-${to} rate'`, "slot_missing");
        }
      }
      if (eitherOr) {
        const ways = optList.map((o) => ((o.needs ?? []).length === 1 ? `${article(name(o.needs[0]))} ${name(o.needs[0])}` : (o.needs ?? []).map(name).join(" + "))).join(", or ");
        // ADP-4a (AC1 b, R1 line 10): the refusal as the pricer words it -- nothing stated, and the nearest way's gaps
        const last = (optList[optList.length - 1]?.needs ?? []) as string[];
        add(`A per-${pr.unit_words?.[cls] ?? cls} ${famWord(f)} without ${ways} refuses, naming what is missing`,
            `'${f} needs ${ways} - ${optList.length === 2 ? "neither" : "none"} stated - price this row by hand'; with part of a way stated, what the way the row came nearest to lacks is named instead ('${f} needs ${ways} - ${name(last[last.length - 1] ?? "")} not stated - price this row by hand')`,
            "plenum_missing");
      }
    }
  }
  // ADP-4a (AC1 c): the conversions that ran with no line -- one line per rule, naming the kinds it prices (the
  // show-the-numbers ones above keep theirs), and a kind's own per-unit formula that reads the row's sizes
  if (plain) {
    const byRule = new Map<string, { from: string; to: string; fams: string[]; needs: string[] }>();
    for (const [f, fv] of Object.entries<any>(pr.families ?? {})) {
      for (const [cls, opts] of convertsOf(fv)) {
        for (const o of (Array.isArray(opts) ? opts : []) as any[]) {
          if (o?.show_numbers || o?.name_missing || typeof o?.rule !== "string") continue;
          const k = `${cls}|${o.to}|${o.rule}`;
          if (!byRule.has(k)) byRule.set(k, { from: String(pr.unit_words?.[cls] ?? cls), to: String(pr.unit_words?.[o.to] ?? o.to), fams: [], needs: (o.needs ?? []).map(String) });
          byRule.get(k)!.fams.push(famWord(f));
        }
      }
    }
    for (const [k, v] of byRule) {
      const rule = plainNumbers(plainSentence(k.split("|").slice(2).join("|"))).replace(/^(?:R|D|T|S|Q|H)-?\d+[a-z]?\s+/, "");
      add(rule.charAt(0).toUpperCase() + rule.slice(1), `on ${list(v.fams)}`,
          v.needs.some((n) => /area/.test(n)) ? "conv_band" : undefined);
    }
    for (const [f, fv] of Object.entries<any>(pr.families ?? {})) {
      for (const [cls, u] of Object.entries<any>(fv?.units ?? {})) {
        for (const pl of Object.values<any>(u?.pipelines ?? {})) {
          const geo = (pl?.steps ?? []).find((st: any) => st?.step === "scale" && Object.keys(st?.params ?? {}).some((p) => p.endsWith("_from_attr")) && typeof st?.explain === "string");
          if (!geo) continue;
          const words = plainNumbers(plainSentence(String(geo.explain))).replace(/^sheet formula:\s*/, "").replace(/\s*(supply|install) cost\b/, " cost");
          add(`A per-${String(pr.unit_words?.[cls] ?? cls)} ${famWord(f)} is priced by its own formula`, words);
          break;
        }
      }
    }
  }

  for (const [attr, rd] of Object.entries<any>(pr.numbers ?? {})) {
    if (typeof rd?.not_stocked !== "string") continue;
    const stocked = [...new Set(items.filter((it) => it.kind === pr.kind && typeof it.attributes?.[attr] === "number").map((it) => Number(it.attributes![attr])))].sort((a, b) => a - b);
    // ADP-4a (AC4): where the field also takes a typed value ("Other..."), a typed unstocked one refuses the same way
    const typed = plain && pr.panel_controls?.[attr] === "dropdown_or_other" ? `; a ${name(attr)} typed in 'Other...' that the catalogue does not stock refuses the same way` : "";
    add(`A ${name(attr)} the catalogue does not stock refuses`,
        `${plainSentence(String(rd.not_stocked).replace("{value}", "<n>"))}${stocked.length ? ` -- the catalogue stocks ${list(stocked.map(String))}` : ""}; only where the kind's rule for the row's unit reads it${typed}`, "slot_stock");
  }

  const needs = new Set<string>();
  for (const f of Object.values<any>(pr.families ?? {})) {
    for (const k of f?.needs ?? []) needs.add(String(k));
    for (const u of Object.values<any>(f?.units ?? {})) for (const k of u?.needs ?? []) needs.add(String(k));
    // ADP-4a (AC1 b, R1 line 12): a fact only a CONVERSION asks for (a per-number row's width, height, area, slots,
    // piece length, plenum sides) is a fact the rule needs too; a category with no conversion lists what it did
    for (const opts of Object.values<any>(f?.convert ?? {})) for (const o of (Array.isArray(opts) ? opts : []) as any[]) for (const k of o?.needs ?? []) needs.add(String(k));
  }
  if (needs.size) {
    add("The facts that rule needs before it can price",
        // ADP-3a (U3): CHANGED -- every missing fact is named, not only the first, and each one's box is outlined
        `${list(plain ? [...new Set(Array.from(needs).sort().map(name))] : Array.from(needs).sort().map(name))} -- every one missing is named, and its box outlined`, "needs");
  }

  // ── 4. how the facts are read ─────────────────────────────────────────────────────────────────────
  const composed = pr.compose?.attr ? String(pr.compose.attr) : "";
  if (composed) {
    const outer = pr.compose.outer_only?.attr
      ? `, the ${name(String(pr.compose.outer_only.attr))} on the outer layer only`
      : "";
    add(`A ${name(composed)} the model writes as layers is priced as those layers`,
        `'a + b', 'a x 2', '2 layers of a', 'a mm - 2 layers', 'double layer of a' -- each layer at the row's own size${outer}; a value the pricer types is never read as layers`);
  }
  // SLICE 12e-6 (owner R7: "mm = NB and NB = mm"; U9): ADDED
  const os = pr.compose?.outer_surface;
  if (os?.pipe) {
    add(`A ${name(String(os.pipe))} in mm or NB is one size: the cladding is measured on the matched size`,
        "'50 mm', '50 mm dia', '50 NB' and '50 mm NB' are the same size; only an outside diameter -- written OD / O.D. / outer dia, an inch size, or a copper, refrigerant, VRF or VRV pipe -- is measured as read");
  }
  for (const [attr, rd] of Object.entries<any>(pr.numbers ?? {})) {
    if (rd?.several === "highest") {
      // SLICE 12d-8 (owner R5): the wording follows the code -- a range is read as its TOP value, not refused
      add(`Several ${name(attr)} values stated take the highest`,
          "a bare slash list ('19 / 25 / 32'); a size range ('25 to 50') takes its top value; a comma list and a tolerance ('25 +/- 2') still refuse");
      // SLICE 12e-6 (owner R10; U9): ADDED
      add(`A ${name(attr)} range takes the higher value`, "'25-50 mm' or '25 to 50' prices 50, with a line saying 'states a range - the higher, 50, is taken'");
    }
    // ADP-1 (owner H3; U6): ADDED -- a number the pricer types, read from the size as written when nothing is typed
    if (rd?.typed_only && rd?.length_from && rd?.box_side) {
      // ADP-2 (owner H7 / Q2; U6): ADDED -- ONE line for the sides of a box read from the same size
      const sides = Object.entries<any>(pr.numbers).filter(([, x]) => x?.typed_only && x?.box_side && x?.length_from === rd.length_from);
      if (sides[0]?.[0] === attr) {
        const sideNames = sides.map(([a]) => name(a));
        // ADP-4a (owner D2 "16 + 35", D3 "35 + 38"): on the plain wording the box sides and the face sides are ONE line
        if (plain) add(sizesLineTitle(), sizesLineDetail(), "sizes");
        else add(`The ${sideNames.length > 1 ? `${sideNames.slice(0, -1).join(", ")} and ${sideNames[sideNames.length - 1]}` : sideNames[0]} are typed in their own boxes, else read from the ${name(String(rd.length_from))}`,
            // ADP-5a (owner 2026-10-22 10:49, item 6): ADDED -- "A x B-C depth" is three sides
            `in the order length x width x height, the height last ('550 x 550 x 400 mm Ht' -> 550 / 550 / 400); a side written with its label -- L / long / length, W / B / width, H / Ht / high / depth -- goes to that side ('3000 mm Length' -> length 3000); 'A x B-C depth' is three sides ('1200x150-300 depth' -> 1200 / 150 / 300); the field shows the value used, with a line saying so; a typed value always wins`);
      }
    } else if (rd?.typed_only && rd?.length_from && rd?.face_side) {
      // ADP-3b: a face side is said by its own group, LAST (below), so no earlier line moves
    } else if (rd?.typed_only && rd?.length_from && rd?.unit !== "m") {
      // ADP-2 (owner H7 / Q3, "should be priced at max"; U6): ADDED
      add(`An ${name(attr)} is typed in '${String(rd.label ?? name(attr))}', else read from the ${name(String(rd.length_from))}${rd.range === "max" ? ", at its largest value" : ""}`,
          `'up to 0.5 sqm' -> 0.5 sq.m, with a line saying 'priced at 0.5 sq.m (the largest value)'; a typed value always wins`, "area_band");
    } else if (rd?.typed_only && rd?.length_from) {
      add(`A ${name(attr)} is typed in '${String(rd.label ?? name(attr))}', else read from the ${name(String(rd.length_from))}`,
          `the side written as the length ('1500 mm long'), else the longest side of a size written 'a x b' or 'a x b x c' ('1000x150' -> 1 ${rd.unit ?? "m"}), else a single number with no label of ${PIECE_LENGTH_MIN_MM} mm or more ('1000 mm' -> 1 ${rd.unit ?? "m"}); below ${PIECE_LENGTH_MIN_MM} mm it is a slot width and is not read; a typed value in mm or cm is converted -- with a line saying so`, "piece_length");
    }
    // ADP-2 (owner B3, 2026-10-19 14:24 "ok"; U6): ADDED -- a SQUARE size offered as a list with "Other..." (ADP's neck)
    // ADP-4a (owner D2 "13 + 24"): on the plain wording it is said once, in the line fitting every size to the catalogue
    if (!plain && rd?.square && pr.panel_controls?.[attr] === "dropdown_or_other") {
      const stocked = [...new Set(items.filter((it) => it.kind === pr.kind && typeof it.attributes?.[attr] === "number").map((it) => Number(it.attributes![attr])))].sort((x, y) => x - y);
      add(`A ${name(attr)} the catalogue does not stock can be typed in 'Other...'`,
          `the list offers the stocked ${name(attr)}s${stocked.length ? ` (${list(stocked.map(String))})` : ""}; a typed one between them takes the next stocked size up, with a line saying so; above the largest${stocked.length ? ` (${stocked[stocked.length - 1]})` : ""} it refuses`);
    }
    if (rd?.inches) {
      // SLICE 12e-2 (owner Q14): the second conversion, where the reader declares one
      const alt = typeof rd.inch_mm_alt === "number" ? `; converted at 25.4 ${rd.unit ?? "mm"} to the inch, then at ${rd.inch_mm_alt} where the first lands on no stocked size` : "";
      add(`A ${name(attr)} written in inches is converted to millimetres`, `a bare fraction (7/8") is read as inches on this reader${alt}`);
    }
    // SLICE 12e-2 (owner P2): a typed entry on this axis is ONE size
    if (rd?.typed_entry === "one_size") {
      add(`A typed ${name(attr)} is one size, in ${rd.unit ?? "mm"} or inches`,
          // SLICE 12e-3b (owner 2026-10-11): two or more sizes price the higher / highest (REPLACES "refuses naming the two sizes")
          "a number (an NB number is mm) or an inch size (5/8\", 1-1/4\", 2 inch); 'two inch' and '40-50' refuse: Type one pipe size, in mm or inches; two or more sizes written with a slash take the higher ('25/32' prices 32, '25/32/40' prices 40, 1\"/2\" prices 2\"), typed or read from the BoQ, with a line saying so; a slash is an inch fraction only when its top number is 16 or less and its bottom is 2, 4, 8, 16, 32 or 64");
    }
  }

  // ADP-4a (AC1 c): the reading rules that ran with no line -- each keyed on its own reader key, on the plain wording
  if (plain) {
    for (const [attr, rd] of Object.entries<any>(pr.numbers ?? {})) {
      if (typeof rd?.reject_below === "number") {
        const toks = Array.isArray(rd.reject_tokens) && rd.reject_tokens.length ? ` -- and so is one written with ${quoteList(rd.reject_tokens)} ('26G', '24 gauge')` : "";
        add(`A ${name(attr)} below ${rd.reject_below} ${String(rd.unit ?? "")} is a sheet gauge, not a thickness, and refuses`.replace(/\s+,/, ","),
            `'${name(attr)} stated as <as written> -- below ${rd.reject_below} ${String(rd.unit ?? "")}, a sheet gauge, not a thickness'${toks}`);
      }
      if (rd?.unit === "sqm" && !out.some((l) => l.title === `An ${name(attr)} written in square feet refuses`)) {
        add(`An ${name(attr)} written in square feet refuses`, `'${name(attr)} stated in square feet (<as written>)'`);
      }
      if (rd?.ratio) {
        add(`A ${name(attr)} is read from '1:N' as N`, `'1:6' -> 6; two ratios, or a ratio beside another number, refuse: 'several values stated for ${name(attr)}'`);
      }
    }
    if (Object.values<any>(pr.numbers ?? {}).some((rd) => rd?.unit === "mm")) {
      add("A size written in metres or centimetres is read in millimetres", "'1.2 m' -> 1200 mm, '20 cm' -> 200 mm, with a line saying so");
    }
  }

  // ── 5. the defaults (what is assumed) ─────────────────────────────────────────────────────────────
  const defaultLines: string[] = [];
  for (const [attr, d] of Object.entries<any>(pr.defaults ?? {})) {
    if (d && typeof d === "object" && d.value !== undefined) defaultLines.push(`${name(attr)} not mentioned -> ${String(d.value)}`);
    else if (d && typeof d === "object" && d.by_family) defaultLines.push(`${name(attr)} not mentioned -> by kind (${list(Object.entries<any>(d.by_family).map(([f, v]) => `${famWord(f)}: ${String(v)}`), 3)})`);
    else if (d && typeof d === "object") defaultLines.push(`${name(attr)} not mentioned -> its ruled value`);
  }
  for (const [attr, d] of Object.entries<any>(pr.number_defaults ?? {})) {
    // ADP-1: the unit is the reader's own and "then the ladder" is said only of a laddered number (a 1 m piece length is
    // neither mm nor laddered); Insulation's thickness (mm, laddered) reads byte-identically
    const unit = String(pr.numbers?.[attr]?.unit ?? "mm");
    const ladder = (pr.ladders ?? []).includes(attr) ? ", then the ladder" : "";
    if (d && d.value !== undefined) defaultLines.push(`${name(attr)} not mentioned at all -> ${String(d.value)} ${unit}${ladder}; a ${name(attr)} the row itself states always wins, over a heading's too`);
  }
  // ADP-2 (owner H5; U6): two or more rules deciding the SAME attribute from the SAME fact on the SAME families are one
  // rule (the air stream decides a damper not mentioned) and read as their own line; a single rule keeps its words
  const dwn = ((pr.derive_when_none ?? []) as any[]).filter((d) => d?.attr);
  // ADP-5a (owner 2026-10-20 12:51, AC2): one rule group per attribute and fact, its kinds the UNION of the rules' kinds and
  // a rule that leaves some out saying which ("fresh -> without (not on curved grille)"). BEFORE the key also held the kind
  // list, so v51's curved grille would have split the air-stream line in two; on every config whose rules name the same
  // kinds (v50 and before) the groups and the words are unchanged.
  const dwnKey = (d: any) => `${d.attr}|${d.when?.attr}`;
  const dwnGroups = new Map<string, any[]>();
  for (const d of dwn) dwnGroups.set(dwnKey(d), [...(dwnGroups.get(dwnKey(d)) ?? []), d]);
  const groupFams = (g: any[]): string[] => {
    const u: string[] = [];
    for (const d of g) for (const f of (d.families ?? []) as string[]) if (!u.includes(f)) u.push(f);
    return u;
  };
  const notOn = (d: any, union: string[]): string => {
    const miss = union.filter((f) => !((d.families ?? []) as string[]).includes(f));
    return miss.length ? ` (not on ${list(miss.map(famWord))})` : "";
  };
  // ADP-5a (AC2): a per-family default said as the value most kinds take, with the kinds that differ ("without (curved
  // grille: with)"); a single `value` reads as it always did
  const ruledWords = (d: any): string | undefined => {
    if (!d || typeof d !== "object") return undefined;
    if (d.value !== undefined) return String(d.value);
    const bf = d.by_family && typeof d.by_family === "object" ? Object.entries<any>(d.by_family) : [];
    if (!bf.length) return undefined;
    const counts = new Map<string, number>();
    for (const [, v] of bf) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    const main = [...counts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const odd = bf.filter(([, v]) => String(v) !== main).map(([f, v]) => `${famWord(f)}: ${String(v)}`);
    return odd.length ? `${main} (${list(odd)})` : main;
  };
  for (const d of dwn) {
    if ((dwnGroups.get(dwnKey(d)) ?? []).length > 1) continue;
    defaultLines.push(`${name(String(d.attr))} not mentioned on ${list((d.families ?? []).map(famWord), 3)} when ${d.when?.attr ? name(String(d.when.attr)) : "a fact"} is ${String(d.when?.equals ?? "stated")} -> ${String(d.then)}`);
  }
  // ADP-4a (owner D2 "17 + 19"): on the plain wording a fact decided by another fact is said INSIDE the one defaults
  // line, first, with its fallback value -- the ruled default the defaults line said a second time is dropped there
  const decidedBy: string[] = [];
  const decidedAttrs = new Set<string>();
  for (const g of dwnGroups.values()) {
    if (g.length < 2) continue;
    const d0 = g[0];
    const union = groupFams(g);
    if (plain) {
      const ruled = ruledWords(pr.defaults?.[String(d0.attr)]);   // ADP-5a: BEFORE `pr.defaults?.[attr]?.value`
      decidedAttrs.add(String(d0.attr));
      decidedBy.push(`${name(String(d0.attr))} not mentioned is decided by the ${name(String(d0.when?.attr))} on ${list(union.map(famWord))}: ${g.map((d) => `${String(d.when?.equals)} -> ${String(d.then)}${notOn(d, union)}`).join("; ")}; no ${name(String(d0.when?.attr))} stated, and on every other kind -> ${ruled !== undefined ? ruled : "its ruled value"}; a ${name(String(d0.attr))} the row states, with or without, always wins -- with a line naming the ${name(String(d0.when?.attr))}`);
      continue;
    }
    add(`A ${name(String(d0.attr))} not mentioned is decided by the ${name(String(d0.when?.attr))}`,
        `on ${list(union.map(famWord), 8)}: ${g.map((d) => `${String(d.when?.equals)} -> ${String(d.then)}${notOn(d, union)}`).join("; ")}; a ${name(String(d0.attr))} the row states, with or without, always wins; no ${name(String(d0.when?.attr))} stated -> the ruled default -- with a line naming the ${name(String(d0.when?.attr))}`);
  }
  const keptDefaults = plain ? defaultLines.filter((l) => ![...decidedAttrs].some((a) => l.startsWith(`${name(a)} not mentioned -> `))) : defaultLines;
  if (plain && (decidedBy.length || keptDefaults.length)) {
    // ADP-5a (AC2): a default with its own per-family line (v51's curved grille) carries that ruling as its reason too
    const perFamilyLine = Object.values<any>(pr.defaults ?? {}).some((d) => d && typeof d === "object" && d.rule_by_family);
    add("A fact the row does not mention takes its ruled value",
        `${[...decidedBy, ...(keptDefaults.length ? [list(keptDefaults)] : [])].join("; ")} -- shown as assumed, never silently`, perFamilyLine ? "defaults_by_family" : "defaults");
  }
  // ADP-2 (owner H5 fix (a), 2026-10-20; U6): ADDED wherever a rule reads an AIR STREAM (its values hold supply and
  // return) -- the code applies it there, so the tab says it there
  const airRules = dwn.filter((d) => {
    const v = ((ls?.attribute_definitions ?? []) as any[]).find((x) => x?.id === d.when?.attr)?.values ?? [];
    return Array.isArray(v) && v.includes("supply") && v.includes("return");
  });
  if (airRules.length) {
    const a = name(String(airRules[0].attr));
    add(`A row naming supply and return air leaves the ${a} as read`,
        `the row's own text naming exactly one air stream decides ('supply air diffuser'); a row naming both ('Supply / Return air diffuser'), or naming none under a heading that names both ('Supply & return air diffusers'), keeps the ${a} as the model read it (not mentioned -> the ruled default), whatever stream the model answered -- with a line 'BoQ names supply and return air -> ${a} as read'; only words used for the air count ('Supply and installation of ...' names no stream); 'supply cum return air' and 'SA / RA' name both streams, and the note of the heading directly above the row counts as that heading does`, "air_both");   // ADP-5a (owner 2026-10-22 10:49, item 3; HN-2 / HN-3): ADDED the last clause
  }
  if (defaultLines.length && !plain) {
    add("A fact the row does not mention takes its ruled value",
        `${list(defaultLines, 6)} -- shown as assumed, never silently`);
  }
  const overrides = ((pr.override_when ?? []) as any[]).filter((o) => o?.attr);
  if (overrides.length) {
    add("A ruling that replaces a value the row DID state",
        list(overrides.map((o) => `${name(String(o.attr))} on ${list((o.families ?? []).map(famWord), 3)} becomes ${String(o.display ?? o.then)} when ${o.when?.attr ? name(String(o.when.attr)) : "a fact"} is ${String(o.when?.equals ?? "stated")}`), 4), "override");
  }

  // ── 6. a stated value mapped or refused ───────────────────────────────────────────────────────────
  for (const m of (pr.value_map ?? []) as any[]) {
    if (!m?.attr) continue;
    const where = `${String(m.from)} as the ${name(String(m.attr))} on ${list((m.families ?? []).map(famWord), 3)}`;
    if (m.to !== undefined) add(`${where} is priced as ${String(m.display ?? m.to)}`);
    else if (m.refuse) add(`${where} refuses`, plainSentence(m.refuse));
  }
  for (const r of (pr.refuse_on_unit_class ?? []) as any[]) {
    if (!r?.attr) continue;
    const unitWord = pr.unit_words?.[r.unit_class] ?? r.unit_class;
    const words = Array.isArray(r.words) && r.words.length ? `; the same when the model read no ${name(String(r.attr))} but the row's own words say ${quoteList(r.words, 4)}` : "";
    // ADP-4a (AC1 b, R1 line 21): a title opens with a capital, whatever value word leads it ("without" -> "Without")
    const lead = String(r.value_contains);
    add(`${lead.charAt(0).toUpperCase()}${lead.slice(1)} as the ${name(String(r.attr))} on a per-${unitWord} row of ${list((r.families ?? []).map(famWord), 3)} refuses`,
        `${plainSentence(r.refuse)}${words}`, "slot_sqm");
  }
  for (const r of (pr.named_in_row ?? []) as any[]) {
    if (!r?.attr) continue;
    add(`A ${name(String(r.attr))} named in the row's own text but read as not mentioned refuses`,
        `${plainSentence(r.refuse)} -- the words: ${quoteList(r.words ?? [], 8)}; a heading never triggers it`);
    // SLICE 12e-6 (AC4; U9): ADDED
    add(`Fixings and duct material in the row are not a ${name(String(r.attr))}`,
        "GI strip, GI grid, a 'C' shape GI frame, GI bolts, clamps, channels, angles and an aluminium or GI duct never trigger the line above");
  }
  // SLICE 12e-6 (owner R4; U9): ADDED
  for (const c of (pr.choice_text ?? []) as any[]) {
    if (!c?.attr) continue;
    add(`A ${name(String(c.attr))} written as a coating with no glass cloth refuses by name`,
        `polyshield, fire retardant or protective coating, a paint: 'No SKU in the catalogue for <the coating as written> - price this row by hand'; a ${name(String(c.attr))} the model answered stands`);
    // SLICE 12e-6c (owner O3 / O4, 2026-10-18): ADDED -- the line above keeps its words
    const gauges = Object.entries<any>(c.to_by_gauge ?? {}).map(([g, to]) => `${g} G -> ${String(to)}`);
    if (Array.isArray(c.words) && c.words.length && c.default_to) {
      add(`A ${name(String(c.attr))} written as ${quoteList(c.words.slice(0, 2))} with none answered is priced as the stocked one of its gauge`,
          [`${quoteList(c.words, 5)} in the ${name(String(c.from_attr ?? ""))}`,
           gauges.length ? `${list(gauges, 3)}; no gauge: ${String(c.default_to)}; any other gauge refuses` : `priced as ${String(c.default_to)}`,
           `a fixing is not a ${name(String(c.attr))}: GI strip, GI grid, a GI frame, bolts, clamps, channels, angles or a duct never count`,
           "with a line saying 'BoQ says <the words> -> priced as <the option>'"].join("; "));
    }
    add(`A glass or fibre cloth facing copied as the ${name(String(c.attr))} with none answered prices as the glass cloth ${name(String(c.attr))}`,
        `'factory laminated fire resistant fibre cloth fabric', 'reinforced glass cloth' -> Glass Cloth with paint; with aluminium named too -> 24G / 26G Aluminium with Glass Cloth by its gauge (no gauge: 26G); with a line saying 'BoQ says <the words> -> priced as <the option>'; a ${name(String(c.attr))} the model answered stands`);
    // ADP-1 (owner F3, 2026-10-19; U6): ADDED, where the category's cladding offers the GI framework option
    const vals = ((ls?.attribute_definitions ?? []) as any[]).find((d) => d?.id === c.attr)?.values ?? [];
    if (Array.isArray(vals) && vals.includes(GI_FRAMEWORK_CLADDING)) {
      add(`A GI frame or framework with perforated aluminium sheet, with no ${name(String(c.attr))} answered, prices as ${GI_FRAMEWORK_CLADDING}`,
          `in the ${name(String(c.from_attr ?? ""))}, else the row's own text or its headings: 'GI frame with perforated Al sheet', 'GI framework and perforated aluminium sheet' -- read before the fixing words are set aside; with a line saying 'BoQ says <the words> -> priced as ${GI_FRAMEWORK_CLADDING}'; a ${name(String(c.attr))} the model answered stands`);
    }
  }
  for (const r of (pr.read_notes ?? []) as any[]) {
    if (!r?.line) continue;
    add(`A ${list((r.families ?? []).map(famWord), 2)} row stating its own figure in the ${name(String(r.from_attr ?? ""))} carries a line saying what was priced`,
        `'${String(r.line).replace("{match}", "<the stated figure>").replace("{family}", (r.families ?? []).map(famWord).join(" / "))}'${r.unless ? ` (not when the figure is ${String(r.unless)})` : ""}`);
  }

  // ── 6b. a second key beside the primary size ─────────────────────────────────────────────────────
  // SLICE 12d-8 (owner R6): the square diffuser's OUTER size (`second_key`, A-4 / A-5) executes on real rows
  // and had no line. Generated from the key's own words, in the order `priceOneItem` applies it.
  for (const sk of (pr.second_key ?? []) as any[]) {
    if (!sk?.primary || !sk?.name) continue;
    add(`A stated ${String(sk.name)} is matched beside the ${name(String(sk.primary))} on ${list((sk.families ?? []).map(famWord), 3)}`,
        `both stated: the ${String(sk.name)} narrows the products the ${name(String(sk.primary))} then fits; `
        + `${String(sk.name)} only: the one product behind it is used as it stands, else the largest ${name(String(sk.primary))} behind it; `
        + `an ${String(sk.name)} the catalogue does not stock is set aside and the ${name(String(sk.primary))} prices the row`
        + (Array.isArray(sk.alt_key) && sk.alt_key.length ? `; the catalogue's alternative wording of the same size counts as that size` : "")
        // ADP-3a (owner H2, U2; B6 #5): CHANGED -- the outer size is SHOWN beside the neck, one either-or group
        + `; the ${String(sk.name)} is shown beside the ${name(String(sk.primary))} as one either-or group, and with neither stated the row refuses naming both`, "outer");
  }

  // ── 7. fitting the sizes ──────────────────────────────────────────────────────────────────────────
  const ladders: string[] = (pr.ladders ?? []).map(String);
  /**
   * ADP-4a (owner D2 "23-27 into one 'fitting to the catalogue' line naming each attribute", "13 + 24"): on the plain
   * wording the ladders whose rule reads the same are ONE line, naming each attribute and the sizes the catalogue
   * stocks for it, with the "Other..." entry the fields offer (AC4). A ladder with a rule of its own (a composition,
   * a nearest-size or inch rule) keeps its own line below.
   */
  const plainLadders = plain
    ? ladders.filter((a) => a !== composed && typeof pr.numbers?.[a]?.near !== "number" && pr.numbers?.[a]?.inches !== true)
    : [];
  if (plainLadders.length) {
    const stockedOf = (a: string) => [...new Set(items.filter((it) => it.kind === pr.kind && typeof it.attributes?.[a] === "number").map((it) => Number(it.attributes![a])))].sort((x, y) => x - y);
    const typedIn = plainLadders.filter((a) => pr.panel_controls?.[a] === "dropdown_or_other");
    add(`Fitting the stated ${list(plainLadders.map(name).slice(0, -1))}${plainLadders.length > 1 ? " or " : ""}${name(plainLadders[plainLadders.length - 1])} to the catalogue`,
        ["the stated value, else the next value the catalogue stocks; above the largest stocked value refuses, naming it",
         `the catalogue stocks: ${plainLadders.map((a) => `${name(a)} ${list(stockedOf(a).map(String)) || "none"}`).join("; ")}`,
         typedIn.length ? `a ${list(typedIn.map(name))} the list does not offer is typed in 'Other...' and fitted the same way, with a line saying so` : ""]
          .filter(Boolean).join("; "), "ladders");
  }
  for (const a of ladders) {
    if (plainLadders.includes(a)) continue;
    const bits = ["the stated size, else the next size the catalogue stocks"];
    if (pr.size_match?.dp?.length) bits.push("the same size written to a different precision counts as that size");
    // SLICE 12e-2 (owner Q14a / Q17): the two declared rungs, in the order the ladder tries them
    if (typeof pr.size_match?.near === "number") bits.push(`a size within ${pr.size_match.near} ${pr.numbers?.[a]?.unit ?? "mm"} of a stocked size counts as that size`);
    if (pr.size_match?.below_smallest === "smallest") bits.push("below the smallest stocked size takes the smallest");
    if (a === composed) {
      bits.push(`above the largest stocked size, built from ${pr.compose.max_layers} or fewer layers`
                + ` within ${pr.compose.tolerance} -- the fewest layers, then the closest, then the cheapest, all at one ${ladders.filter((x) => x !== composed).map(name).join(" / ") || "size"}`);
    } else {
      bits.push("above the largest stocked size refuses, naming the size");
    }
    add(`Fitting the stated ${name(a)} to the catalogue`, bits.join("; "));
    // SLICE 12e-4b (owner F-1): the nearest-size rule declared for THIS axis alone
    const axisNear = pr.numbers?.[a]?.near;
    if (typeof axisNear === "number") {
      const unit = String(pr.numbers?.[a]?.unit ?? "mm");
      add(`A ${name(a)} within ${axisNear} ${unit} of a stocked size counts as that size`,
          `with a line saying so: '${name(a)} <stated> is <stocked> on the sheet (within ${axisNear} ${unit})'; a size further away takes the next size the catalogue stocks, as before`);
    }
    // SLICE 12e-4b (owner F-3): a bare number that could be an inch size, on an axis that reads inches two ways
    // and rules below-the-smallest
    // SLICE 12e-6c (owner U2): ... on EVERY axis that reads inches, tested at its own second factor or the ruled 25
    const rawAlt = pr.numbers?.[a]?.inch_mm_alt;
    const inchAlt = typeof rawAlt === "number" && rawAlt > 0 ? rawAlt : 25;
    if (pr.numbers?.[a]?.inches === true) {
      add(`A ${name(a)} written as a bare number that could be inches refuses`,
          [`a number with no unit, below the smallest stocked size, whose reading in inches (at 25.4 or ${inchAlt} ${String(pr.numbers?.[a]?.unit ?? "mm")} to the inch) falls within the stocked sizes: 'size <number> has no unit - price this row by hand'`,
           `the same number written with its unit ('1 inch', '1 mm') prices`,
           `a bare number that cannot be an inch size takes the smallest size, as before`].join("; "));
    }
    // ADP-1 (owner F1, 2026-10-19; U6): ADDED -- the line above keeps its words
    if (pr.numbers?.[a]?.inches === true && pr.numbers?.[a]?.bare_above_largest === "refuse") {
      add(`A ${name(a)} written as a bare number whose inch reading is above the largest refuses`,
          `a number with no unit, below the smallest stocked size, whose readings in inches (at 25.4 and ${inchAlt} ${String(pr.numbers?.[a]?.unit ?? "mm")} to the inch) are both above the largest stocked size: 'size <number> has no unit - price this row by hand'`);
    }
  }

  // ── 8. the priced steps ───────────────────────────────────────────────────────────────────────────
  const pipelineIds = new Set<string>();
  const inputs = new Set<string>();
  const crossRow = new Set<string>();
  const computed = new Set<string>();
  const walk = (pl: any) => {
    for (const st of pl?.steps ?? []) {
      if (st?.step === "rate_ref" && st?.ref?.item) {
        // a Pricing Input (its kind ends in `_pricing_input`) is read first; a ref to ANOTHER catalogue row is a live cross-row read
        if (/_pricing_input$/.test(String(st.ref.kind ?? ""))) inputs.add(String(st.ref.item)); else crossRow.add(String(st.ref.item));
      }
      if (st?.step === "component" && st?.target && typeof st?.formula === "string" && st.formula.trim() !== "base" && st?.name) computed.add(String(st.name));
    }
  };
  for (const f of Object.values<any>(pr.families ?? {})) {
    for (const u of Object.values<any>(f?.units ?? {})) {
      for (const [pid, pl] of Object.entries<any>(u?.pipelines ?? {})) { pipelineIds.add(pid); walk(pl); }
    }
    for (const opts of Object.values<any>(f?.convert ?? {})) for (const o of opts ?? []) for (const [pid, pl] of Object.entries<any>(o?.pipelines ?? {})) { pipelineIds.add(pid); walk(pl); }
  }
  for (const pl of Object.values<any>(pr.default_pipelines ?? {})) walk(pl);
  if (!pipelineIds.size) for (const pid of Object.keys((config as any)?.pipelines ?? {})) pipelineIds.add(pid);
  /**
   * ADP-4a (AC1 b, R1 line 28): on the plain wording the steps are named in words (never a pipeline id) and each
   * Pricing Input it reads shows its CURRENT value -- read from the same items the tab holds, so an edit to the input
   * shows here at once.
   */
  const inputValue = (id: string): string => {
    const it = items.find((x) => /_pricing_input$/.test(String(x?.kind ?? "")) && String(x?.attributes?.item ?? "") === id);
    const v = it ? Object.values(it.rates ?? {}).find((n) => typeof n === "number") : undefined;
    return typeof v === "number" ? ` ${v}${it?.unit ? ` ${it.unit}` : ""}` : "";
  };
  add("Then the priced steps below, in their own order",
      plain
        ? ["the supply rate and the install rate, each from the catalogue's cost and the SKU's markup, rounded up to the rupee",
           inputs.size ? `the pricing inputs are read first: ${list(Array.from(inputs).map((id) => `${inputLabel(id)}${inputValue(id)}`).sort())}` : ""].filter(Boolean).join("; ")
        : [pipelineIds.size ? list(Array.from(pipelineIds).sort().map((p) => p.replace(/_/g, " "))) : "",
           inputs.size ? `the pricing inputs are read first (${list(Array.from(inputs).map(inputLabel).sort(), 8)})` : ""].filter(Boolean).join("; ") || undefined,
      "steps");
  if (crossRow.size) {
    add("A rate read live from another catalogue row", `${list(Array.from(crossRow).sort(), 4)} -- a change to that row's rate flows through`);
  }
  if (computed.size) {
    add("A cost the rules compute from the Pricing Inputs and the row's own geometry is shown greyed, never typed",
        `${list(Array.from(computed).sort(), 4)} -- a change to a Pricing Input moves it; the catalogue stores no figure for it`);
  }
  const derived = Object.keys((config as any)?.derived_rates ?? {});
  if (derived.length) {
    const cells = Object.values<any>((config as any).derived_rates).reduce((n: number, v: any) => n + Object.keys(v ?? {}).length, 0);
    add("A catalogue cell derived from another row's cell follows its base",
        // ADP-4a (AC1 b, R1 line 29; owner U6 for every category): the viewer paints a derived cell AMBER
        // (`RateMasterDataViewer`: `derived && "bg-amber-50"`); grey is a computed cell
        `${cells} cell${cells === 1 ? "" : "s"} on ${derived.length} row${derived.length === 1 ? "" : "s"} (the amber 'derived' cells): editing the base row moves them; typing into them is refused`, "derived");
  }

  // ── 9. back to the row ────────────────────────────────────────────────────────────────────────────
  // ADP-4a (AC1 b, R1 line 30; owner U6 for every category): the units, the factor and the rounding, from the config's
  // own `unit_factors` -- the rate is converted, then rounded up to the rupee (`Math.ceil`, `priceOneItem`)
  if (factors.length) {
    const byFactor = new Map<string, string[]>();
    for (const [spelling, f] of Object.entries<any>(pr.unit_factors ?? {})) {
      const k = `${String(f?.word ?? spelling)}|${String(f?.class ?? "")}|${String(f?.factor ?? "")}`;
      byFactor.set(k, [...(byFactor.get(k) ?? []), spelling]);
    }
    add("The rate converts to the unit the row is written in",
        [...byFactor].map(([k, spellings]) => {
          const [word, cls, factor] = k.split("|");
          return `a row in ${word} (${list(spellings)}) takes the per-${String(pr.unit_words?.[cls] ?? cls)} rate x ${factor}, rounded up to the rupee`;
        }).join("; "), "convert_unit");
  }
  add("Multiplied by how many of the item one unit of the row pays for", undefined, "qty");

  // ── 10. SLICE 12e-3b (AC6): the sections another category prices (owner D1 / D1a / D3b / 13:40 / 13:42) ──
  // Each line is the section's own declaration in words: the toggle, whose rules price it, the kinds offered,
  // the mirror, the total. A config that declares no delegated section adds nothing.
  const sections = ((ls?.sections ?? []) as any[]).filter((sec) => sec && typeof sec === "object");
  const ownSec = sections.find((sec) => !sec.category_id);
  const ownWord = String(ownSec?.label ?? "item").toLowerCase();
  const delegated = sections.filter((sec) => sec.category_id);
  for (const sec of delegated) {
    const label = String(sec.label ?? sec.id);
    const low = label.toLowerCase();
    const inc = sec.include_when;
    if (inc?.attr) {
      add(`Each ${ownWord} says whether it has ${low}: ${labels[String(inc.attr)] ?? String(inc.attr)} ${String(inc.equals)} opens the ${low} section under that ${ownWord}`,
          [sec.absent?.line ? `${plainSentence(sec.absent.line)}, shown as assumed on a BoQ row` : "",
           `any other answer removes only that section`,
           sec.add_label ? `'${String(sec.add_label)}' adds a section that belongs to no ${ownWord}` : "",
           `in the calculator a section opens with nothing picked`].filter(Boolean).join("; "));
      // SLICE 12e-6 (AC3, owner D1b / D5b; U9): ADDED
      add(`${labels[String(inc.attr)] ?? String(inc.attr)} ${String(inc.equals)} with no ${low} facts opens the ${low} section on ${label}'s defaults`,
          "the material its row kind implies, the ruled thickness then the ladder, the cladding 'No' -- each shown as assumed with its line");
    }
    add(`The ${low} section is priced by ${label}'s rules`,
        [`its own catalogue, pricing inputs, defaults, ladders and refusals -- no rule of it is copied here`,
         Array.isArray(sec.families) && sec.families.length ? `the kinds offered: ${list(sec.families.map(famWord), 6)}` : ""].filter(Boolean).join("; "));
    if (sec.mirror?.from) {
      add(`The ${low} section takes the ${name(String(sec.mirror.from))} its ${ownWord} priced as`,
          [`shown '${String(sec.mirror.tag ?? "")}'`,
           `a ${ownWord} written as two sizes gives the one it priced`,
           sec.mirror.line ? `a size chosen in the section is kept and says so: '${String(sec.mirror.line).replace("{chosen}", "<chosen>").replace("{pipe}", `<${ownWord}>`)}'` : "",
           `a section that belongs to no ${ownWord} takes the first ${ownWord}'s`].filter(Boolean).join("; "));
    }
    // SLICE 12e-3c (owner F10, U6): a section that sits under an item takes that item's quantity
    if (inc?.attr) {
      add(`The ${low} section's quantity is its ${ownWord}'s until the pricer types their own`,
          [`shown '${String(sec.mirror?.tag ?? `from ${ownWord}`)}' and following the ${ownWord}'s box`,
           `a quantity typed in the section is kept`,
           `a section that belongs to no ${ownWord} keeps its own, 1 unless typed`].join("; "));
    }
  }
  if (delegated.length) {
    add(`The row total adds every ${ownWord} and every section`,
        "each line rounded by its own rules; one line that cannot price stops the row, and the count of lines that need a person is shown");
  }
  // ── 11. ADP-3a (owner 2026-10-20): the refusals that name what to change -- ADDED as their own group, LAST, so no
  //        earlier line moves (every line above keeps its number) ──
  // ADP-3a (owner 2026-10-20 13:35, U5): ADDED -- a row in a unit its kind is not stocked in (or a unit the catalogue
  // does not know) refuses NAMING the units the kind IS stocked in; the kind's fields stay, they price it in those units
  {
    const spec = itemListPricingSpec(config as any);
    const blocked: string[] = [];
    for (const f of Object.keys(pr.families ?? {})) {
      const missingUnits = classes.filter((c) => !(pr.families[f]?.units ?? {})[c] && !convertsOf(pr.families[f]).some(([k, o]) => k === c && (o ?? []).length));
      if (missingUnits.length && spec) blocked.push(`${famWord(f)} (stocked ${stockedUnitsWords(spec, f)})`);
    }
    add("A kind not stocked in the row's unit refuses, naming the units it is stocked in",
        `'<kind> is not stocked per <unit> (stocked per <units>) - price this row by hand'; a unit the catalogue does not know ('Lot', 'Nos/Ro') the same way`
        + (blocked.length ? ` -- e.g. ${list(blocked, 3)}` : "")
        // ADP-4a (owner D2 "5 + 32"): the kind the catalogue does not price in a unit it carries, said once, here
        + (plain && notOffered.length ? `; ${list(notOffered)}` : ""), "unit_refusal");
  }
  // ADP-3a (owner B6, 2026-10-20 13:32): ADDED -- an unstocked combination names ONLY the facts the kind's products vary on.
  // Only where a combination CAN be unstocked: a category with a choice attribute (Piping matches on its size alone)
  if ((pr.choice_attrs ?? []).length) add("An unstocked combination names only the facts the kind's products vary on",
      // 12e-2b (owner, AC7): a tab never reads a unit its category is not priced in -- this detail names no unit
      "'No SKU for <kind>: <the facts> - price this row by hand' -- a fact none of the kind's products carries (a size a product is not sold by), or one every product shares with the row, is never the reason and is left out; one every product shares that the row contradicts is the reason and stays", "combination");
  // ADP-3a (owner H2, U2; B6 #3): ADDED -- SEVERAL WAYS that do not each name what is missing (ADP's per-number "Size
  // (W x H), or Area band") are one either-or group on the panel and one refusal naming it; ONE line per unit and group,
  // listing the kinds, worded by the same helper the field and the sentence use
  {
    const spec = itemListPricingSpec(config as any);
    const byWays = new Map<string, { cls: string; fams: string[] }>();
    for (const [f, fv] of Object.entries<any>(pr.families ?? {})) {
      for (const [cls, opts] of convertsOf(fv)) {
        const optList = (Array.isArray(opts) ? opts : []) as any[];
        if (!spec || optList.length < 2 || optList.every((o) => o?.name_missing) || (fv?.units ?? {})[cls]) continue;
        const ways = waysLabel(spec, optList.map((o) => (o.needs ?? []) as string[]));
        const key = `${cls}|${ways}`;
        if (!byWays.has(key)) byWays.set(key, { cls, fams: [] });
        byWays.get(key)!.fams.push(famWord(f));
      }
    }
    for (const [key, v] of byWays) {
      const ways = key.slice(key.indexOf("|") + 1);
      // the title names the GROUP, never the kinds (which change between catalogue versions); the kinds are in the detail
      add(`A per-${pr.unit_words?.[v.cls] ?? v.cls} item needs ${ways}; with neither stated it refuses, naming both`,
          `${list(v.fams, 4)}: '<kind> needs ${ways} - neither stated - price this row by hand', every box of the group outlined; a size giving one length ('1500 mm long') is named as such, never read as width x height`, "either_or");
    }
  }
  // ── 12. ADP-3b (owner B1; D1 / D2, 2026-10-20 22:25): a face size in its own Width / Height boxes -- ADDED as their own
  // group, LAST, generated from `face_side` (a config without it adds nothing)
  {
    const faces = Object.entries<any>(pr.numbers ?? {}).filter(([, x]) => x?.typed_only && x?.length_from && x?.face_side);
    if (faces.length) {
      const sideNames = faces.map(([, x]) => String(x.face_side));
      const from = name(String(faces[0][1].length_from));
      // ADP-4a (owner D3 "35 + 38"): on the plain wording the face is said in THE size line (above, or here where the
      // config declares no box)
      if (!plain) add(`The ${sideNames.join(" and ")} are typed in their own boxes, else read from the ${from}`,
          `the face is the size's first two parts, width x height ('550X300' -> width 550, height 300); a label decides between those two -- W / wide / width, H / Ht / high / height ('600 x 400 mm High' -> height 400); a part labelled as a length or a depth ('600(L)') is named and not used; text that is not a size is read whole as the width, as before; the field shows the value used, with a line saying so; a typed value always wins`);
      else if (!boxReaders.length) add(sizesLineTitle(), sizesLineDetail(), "sizes");
      add("A third part of a size never displaces the face",
          "'300 x 300 x 450 mm Height' -> width 300, height 300; the 450 is named on the item as not used as the face", "third_part");
      // D2: only where a kind reads the HEIGHT alone (a per-metre grille)
      const heightOnly: string[] = [];
      for (const [f, fv] of Object.entries<any>(pr.families ?? {})) {
        for (const [cls, opts] of Object.entries<any>(fv?.convert ?? {})) {
          for (const o of (Array.isArray(opts) ? opts : []) as any[]) {
            const needs = (o?.needs ?? []) as string[];
            const sides = needs.map((n) => pr.numbers?.[n]?.face_side).filter(Boolean);
            if (sides.length === 1 && sides[0] === "height" && !heightOnly.includes(`${famWord(f)} per ${pr.unit_words?.[cls] ?? cls}`)) heightOnly.push(`${famWord(f)} per ${pr.unit_words?.[cls] ?? cls}`);
          }
        }
      }
      if (heightOnly.length) add("A kind that reads only the height, sized by one dimension written as a width, takes it as the height",
          `${list(heightOnly, 4)}: '150mm width' -> height 150 mm, with a line saying it is the narrow dimension; an unlabelled single number stays the width, as before`, "height_only");
    }
  }
  // ── 13. ADP-3c (owner 2026-10-21 01:31 / 01:55 "ok to both"): a two-part size on a Width + Height item is the face
  // whatever its parts are called -- ADDED LAST, generated where the config has BOTH face sides (a config without adds nothing)
  // ADP-4a (owner D3): on the plain wording it is said in the one size line
  {
    const sides = new Set(Object.values<any>(pr.numbers ?? {}).filter((x) => x?.typed_only && x?.length_from && x?.face_side).map((x) => String(x.face_side)));
    if (!plain && sides.has("width") && sides.has("height")) {
      add("A two-part size on a Width + Height item is the face, whatever its parts are called",
          "a width or height label decides that side, else first = width, second = height");
    }
  }
  // ── 13b. ADP-5a (owner 2026-10-22 10:45 / 10:48 / 10:49; SCOPE-5a-1): two kinds that are ONE item -- ADDED LAST, one line
  // per `family_merge` rule (a config without the key adds nothing, so every earlier tab is unchanged)
  for (const r of (Array.isArray(pr.family_merge) ? pr.family_merge : []) as any[]) {
    if (typeof r?.family !== "string" || typeof r?.into !== "string") continue;
    const abs = (Array.isArray(r.absorbs) ? r.absorbs : []).map((f: unknown) => famWord(String(f)));
    const at = typeof r.at === "string" ? name(r.at) : "";
    const unit = typeof r.at === "string" && pr.numbers?.[r.at]?.unit ? ` ${String(pr.numbers[r.at].unit)}` : "";
    add(`A ${famWord(r.family)} named with a ${list(abs.length ? abs : [famWord(r.into)])} is priced as one ${famWord(r.into)}`,
        [abs.length ? `a ${list(abs)} item on the same row is the same thing and is dropped -- its own answers, its size too, are not read` : "",
         Array.isArray(r.words) && r.words.length ? `${quoteList(r.words.map(String))} in the row, its headings or the note of the heading directly above it do the same` : "",
         at ? `priced at the ${famWord(r.family)}'s ${at}: the stated size, else the next stocked size up; above the largest it refuses` : "",
         typeof r.line === "string" ? `with a line '${r.line}${at ? `, <size>${unit}` : ""}'` : ""].filter(Boolean).join("; "), "family_merge");
  }
  // ── 14. ADP-4a (owner A1 / D1): WHY -- each line's reason on the plain wording, at the end of its detail ──
  if (plain) {
    const rulings = DERIVATION_RULINGS[String(pr.kind ?? "")] ?? {};
    out.forEach((l, i) => {
      const k = keys[i];
      const why = (k && rulings[k]) || NOT_RECORDED;
      l.reason = why;
      l.detail = l.detail ? `${l.detail} -- why: ${why}` : `why: ${why}`;
    });
  }
  return out;
}


// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ELR-1 (owner R-DERIV 2026-09-27: the rules "in plain English ... in run order", "say so" where a reason is not
// recorded; ADP-4b D1 / D8; owner R-ELR0 "1 ok", 2026-10-27) -- THE RULES LIST OF A CATEGORY PRICED FROM ROW-LEVEL
// ATTRIBUTES, wiring & cabling first. Every line is WRITTEN FROM THE CONFIG: a line exists iff the config step that
// carries its rule is present, its numbers are the step's own parameters, its Pricing Inputs are named by their
// Pricing Inputs row (never an id), and its reason comes from `DERIVATION_RULINGS[category_id]` or reads "reason not
// recorded". A category with no entry there keeps the tab's pointer line (`derivationNoticeLine`).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type AttrStep = {
  step?: string; name?: string; target?: string; result?: string; params?: Record<string, unknown>;
  ref?: Record<string, unknown>; conditions?: Array<{ when?: Record<string, unknown>; params?: Record<string, unknown> }>;
  qty?: { if_attr?: Record<string, unknown> }; rate_stages?: Array<Record<string, unknown>>;
  bands?: Array<{ when?: string }>; band_on?: string; none_skips?: boolean;
};

/** A `roundup` step's digits, in words. */
const roundWords = (digits: unknown): string =>
  Number(digits) === -1 ? "rounded up to the next 10" : Number(digits) === 0 ? "rounded up to the rupee" : `rounded up (${String(digits)} digits)`;

/** "below 35" / "from 35" for a `component_band` condition ("<35", ">=35"). */
const bandWords = (when: string): string => when.replace(/^<=/, "up to ").replace(/^>=/, "from ").replace(/^</, "below ").replace(/^>/, "above ");

/**
 * ELR-1 -- PURE. "How a row is priced" for a category priced from row-level attributes, or [] where the category has
 * no rules list yet (no `DERIVATION_RULINGS` entry), is priced as a list of items (`itemListRuleOrder` serves it), or
 * carries no BoQ pipeline. Run order: the BoQ pipelines in the config's own order, each step where it runs; the BCS
 * pipelines are not listed (owner deferral 2026-07-28: "NOT surfaced in the helper until the BCS module").
 */
export function attributeRuleOrder(config: unknown, items: ReadonlyArray<RuleOrderItem> = []): RuleOrderLine[] {
  const c = config as {
    category_id?: string; list_spec?: unknown; pipelines?: Record<string, { steps?: AttrStep[] }>;
    pipeline_labels?: Record<string, string>;
    attribute_definitions?: Array<{ id: string; label?: string; selector?: boolean }>;
  } | null;
  if (!c || (c.list_spec && typeof c.list_spec === "object")) return [];
  const rulings = DERIVATION_RULINGS[String(c.category_id ?? "")];
  if (!rulings) return [];
  // ELR-4a: a category whose lines are all assembly lines (point wiring, switches & sockets, pop-up boxes) lists its
  // rules through `assemblyRuleOrder`; wiring's keys are its own, so its thirteen lines below are untouched. Decided
  // by the reasons table, not by a step, so a deleted step removes its own line and never the whole list.
  if (isAssemblyRulings(rulings)) return assemblyRuleOrder(c, items, rulings);
  const pipelines = Object.entries(c.pipelines ?? {}).filter(([id]) => !/bcs/i.test(id));
  if (!pipelines.length) return [];
  const label = (id: string): string => c.attribute_definitions?.find((d) => d.id === id)?.label ?? id.replace(/_/g, " ");
  /** a block's name, its "per <unit>" dropped: "Cable -- per Mtr" -> "Cable" */
  const block = (id: string): string => String(c.pipeline_labels?.[id] ?? id.replace(/_/g, " ")).split(/\s+[—-]+\s+/)[0];

  // ctx name -> the Pricing Input it reads, from the `rate_ref` steps (`result` <- ref.item, the `target` column)
  const reads = new Map<string, string>();
  const scales = new Map<string, AttrStep>();
  for (const [, pl] of pipelines) for (const st of pl.steps ?? []) {
    if (st.step === "rate_ref" && typeof st.result === "string") reads.set(st.result, String(st.ref?.item ?? ""));
    else if (st.step === "scale" && typeof st.result === "string") scales.set(st.result, st);
  }
  const input = (ctxName: unknown): string => {
    const id = reads.get(String(ctxName ?? ""));
    return id ? `'${pricingInputLabel(id, items as never)}'` : "a Pricing Input";
  };
  const pairInput = (a: unknown, b: unknown): string => {
    const x = reads.get(String(a ?? "")), y = reads.get(String(b ?? ""));
    return x && y && x === y ? input(a) : `${input(a)} and ${input(b)}`;
  };
  const after = (steps: AttrStep[], i: number): string =>
    steps[i + 1]?.step === "roundup" ? `, ${roundWords(steps[i + 1].params?.digits)}` : "";

  const out: RuleOrderLine[] = [];
  const keys: string[] = [];
  const add = (key: string, title: string, detail: string) => {
    if (keys.includes(key)) return;
    keys.push(key);
    out.push({ n: out.length + 1, title, ...(detail ? { detail } : {}) });
  };

  // two BoQ blocks, both shown on every row; the row's own words choose the figure it offers
  if (pipelines.length > 1) {
    const [a, b] = pipelines.map(([id]) => block(id));
    // ELR-4b (owner P6, WC-a): and the two figures are never added (`groupFigures`: each block's own supply + install)
    add("both_blocks", `Every row shows both blocks, ${a} and ${b}`,
        `a row whose description names a ${b.toLowerCase()} offers the ${b} figure, any other row the ${a} figure; the two figures are never added together`);
  }
  // the catalogue match, on the attributes its rows are keyed by
  const matched: string[] = [];
  for (const [, pl] of pipelines) for (const st of pl.steps ?? []) {
    const k = st.params?.kind;
    if (st.step === "match_master_row" && typeof k === "string" && !matched.includes(k)) matched.push(k);
  }
  if (matched.length) {
    const keysOf = new Set<string>();
    for (const it of items) if (matched.includes(String(it.kind ?? ""))) for (const k of Object.keys(it.attributes ?? {})) keysOf.add(k);
    const on = (c.attribute_definitions ?? []).filter((d) => d.selector !== false && keysOf.has(d.id)).map((d) => d.label ?? d.id);
    const words = matched.map((k) => k.replace(/_/g, " "));
    add("match", `The ${words.join(" and the ")} ${matched.length > 1 ? "are each" : "is"} matched in the catalogue`,
        on.length ? `on ${on.length > 1 ? `${on.slice(0, -1).join(", ")} and ${on[on.length - 1]}` : on[0]}, exactly as the catalogue writes them` : "");
  }
  // ELR-4b (owner P6, WC-b): the base prompt's insulation rule, which applies to a category whose insulation
  // definition offers ARMOURED / UNARMOURED (boq_rate_attr_extraction_prompt.md) -- the definition is the marker
  const ins = c.attribute_definitions?.find((d) => d.id === "insulation") as { values?: unknown[] } | undefined;
  if (["ARMOURED", "UNARMOURED"].every((v) => (ins?.values ?? []).includes(v))) {
    add("insulation", `${label("insulation")}: the BoQ's answer`,
        "a flexible cable is unarmoured; where neither armoured nor unarmoured is stated on the row or its headings, unarmoured");
  }
  // ELR-4b (owner P6, WC-c): the runs / cores rule the AI is given, with the defaults it names
  const cfgRules = (c as { rules?: Array<{ id?: string; applies_to?: string }> }).rules ?? [];
  const xd = (c as { extraction_defaults?: Record<string, unknown> }).extraction_defaults ?? {};
  if (cfgRules.some((r) => r.applies_to === "runs") && xd.runs !== undefined && xd.core !== undefined) {
    add("runs_cores", `${label("runs")} and ${label("core").toLowerCase()}s: as the BoQ states them`,
        `where no run count is stated, ${Number(xd.runs)} run; where no core count is stated, ${Number(xd.core)} core`);
  }
  // ELR-4b (owner P6, WC-d): a synonym that turns one conduit material into another (the AI's read and the coercion)
  const conduitSyn = Object.entries((c as { synonyms?: Record<string, Record<string, string>> }).synonyms?.conduit_type ?? {});

  pipelines.forEach(([pid, pl], pIdx) => {
    const steps = pl.steps ?? [];
    const name = block(pid);
    steps.forEach((st, i) => {
      const p = st.params ?? {};
      if (st.step === "map_attribute" && typeof p.result_attr === "string") {
        const field = label(p.result_attr);
        const table = p.table && typeof p.table === "object" ? Object.entries(p.table as Record<string, unknown>) : [];
        if (table.length && typeof p.from_attr === "string") {
          const vals = [...new Set(table.map(([, v]) => String(v)))];
          // ELR-5 (owner R-W7, "Q4 a"): the title alone; WAS `${field}: the size the BoQ states`, which WC-f's fit made untrue
          add("conduit_size", field,
              `where a ${label(p.from_attr).toLowerCase()} is named and no size, ${vals.length === 1 ? `${vals[0]} mm` : table.map(([k, v]) => `${k} ${String(v)} mm`).join(", ")}`);
        } else if (p.default === "None") {
          add("conduit_type", `${field}: the BoQ's answer, never assumed`,
              `a row naming none prices no conduit${conduitSyn.map(([from, to]) => `; a ${from} conduit is priced as ${to}`).join("")}`);
        } else if (p.default !== undefined) {
          add("conduit_included", `${field}: the BoQ's answer`, `where it cannot be judged, ${String(p.default)}`);
        }
      } else if (st.step === "apply_effective_multiplier" && st.conditions?.length) {
        const parts = st.conditions.map((cond) => {
          const [attr, val] = Object.entries(cond.when ?? {})[0] ?? ["", ""];
          return `${pairInput(cond.params?.discount_from_ctx, cond.params?.markup_from_ctx)} when ${label(attr)} is ${String(val)}`;
        });
        // ELR-4b (owner P6, WC-e): an input carrying a wastage column is read here for its discount and markup only
        const wastage = st.conditions.some((cond) => /wastage/i.test(input(cond.params?.discount_from_ctx)));
        add("cable_supply", `${name} supply per metre = list price x (1 - discount) x (1 + supply markup)${after(steps, i)}`,
            `the discount and the markup from ${parts.join("; ")}${wastage ? "; the wastage in those inputs is not applied to the BoQ rate" : ""}`);
      } else if (st.step === "scale" && p.runs_from_attr && !p.runs_step_divisor && pIdx === 0 && /supply/.test(String(st.target))) {
        add("runs", "Parallel runs multiply the rounded supply", `${label(String(p.runs_from_attr))} x the rounded supply rate`);
      } else if (st.step === "scale" && p.install_markup_from_ctx) {
        const stepped = steps.find((s) => s.step === "scale" && s.params?.runs_step_divisor && s.target === st.result);
        const d = Number(stepped?.params?.runs_step_divisor);
        add("cable_install", `${name} install per metre = install base x (1 + ${input(p.install_markup_from_ctx)})${after(steps, i)}`,
            stepped ? `then x one install unit per ${d} runs (1 to ${d} runs = 1, ${d + 1} to ${2 * d} = 2, and so on)` : "");
      } else if (st.step === "component_ref" && st.qty?.if_attr) {
        const sc = scales.get(String((st.rate_stages ?? [])[0]?.mult_from_ctx ?? ""));
        const how = sc
          ? `list price x (1 - discount) x (1 + supply markup), from ${pairInput(sc.target, sc.params?.m_from_ctx)}, not rounded`
          : "its catalogue rate";
        const [gate, gv] = Object.entries(st.qty.if_attr)[0] ?? ["", ""];
        const what = String(st.name ?? "component");
        const bound = Object.keys(st.ref ?? {}).filter((k) => k !== "kind").map((k) => label(k).toLowerCase());
        // ELR-4b (owner P6, WC-f; R-W6): the line says how the component's size is read, from the pipeline's own catalog_fit
        // on its bind; ELR-4d added that fit (WAS: "at the size the BoQ states (it is not moved ...) -- a size not stocked ...")
        const refBinds = Object.values(st.ref ?? {}).filter((v): v is string => typeof v === "string" && v.startsWith("@"));
        const fitted = steps.some((s) => s.step === "catalog_fit" && refBinds.includes(`@${String((s.params as { bind?: unknown } | undefined)?.bind ?? "")}`));
        add("conduit_price", `The ${what} is priced at its catalogue rate: ${how}`,
            `one ${what} per row whatever the runs; only when ${label(gate)} is ${String(gv)}${st.none_skips && bound.length ? ` and a ${bound[0]} is named` : ""}${refBinds.length && !fitted ? `; at the size the BoQ states (it is not moved to the next stocked size, as the Conduit category does) -- a size not stocked for that type does not price` : ""}${fitted ? `; at the stated size, else the next larger size stocked for that type, with a note on the field, as the Conduit category does; above the largest stocked size the row does not price` : ""}`);
      } else if (st.step === "scale" && p.install_ratio_from_ctx) {
        add("conduit_install", `The ${String(st.target ?? "").replace(/_supply$/, "")} install = its supply x ${input(p.install_ratio_from_ctx)}${after(steps, i)}`, "");
      } else if (st.step === "scale" && p.conduit_from_ctx && /supply/.test(String(st.target))) {
        const r = steps[i + 1]?.step === "roundup" ? roundWords(steps[i + 1].params?.digits) : "not rounded";
        add("totals", `Supply = the ${name.toLowerCase()} supply + the ${String(p.conduit_from_ctx).replace(/_supply$/, "")} supply, ${r}`,
            "install = the two install legs added, not rounded again");
      } else if (st.step === "component" && pIdx > 0) {
        const band = steps.find((s) => s.step === "component_band");
        const rounded = steps.find((s, j) => j > i && s.step === "roundup");
        const runs = steps.find((s) => s.step === "scale" && s.params?.runs_from_attr);
        const bandName = String(band?.name ?? "");
        add("termination_supply",
            `${name} supply per set = the ${String(st.name ?? "")} + the ${bandName}, each list price x (1 - discount) x (1 + supply markup), ${roundWords(rounded?.params?.digits)}${runs ? ", x runs" : ""}`,
            `the ${String(st.name ?? "")} from ${pairInput(p.discount_from_ctx, p.markup_from_ctx)}; the ${bandName} by ${label(String(band?.band_on ?? ""))}: ${(band?.bands ?? []).map((b, j) => `${bandWords(String(b.when ?? ""))} the ${j === 0 ? "smaller" : "larger"} one`).join(", ")}, from ${pairInput(band?.params?.discount_from_ctx, band?.params?.markup_from_ctx)}`);
      } else if (st.step === "install_as_ratio") {
        add("termination_install", `${name} install = its supply (already x runs) x ${input(p.ratio_from_ctx)}${after(steps, i)}`, "runs are not applied again");
      }
    });
  });
  // the reason last, on every line: a ruling, or "reason not recorded" (ADP-4a D1)
  out.forEach((l, i) => {
    const why = rulings[keys[i]] || NOT_RECORDED;
    l.reason = why;
    l.detail = l.detail ? `${l.detail} -- why: ${why}` : `why: ${why}`;
  });
  return out;
}


// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ELR-4a (owner R-DERIV 2026-09-27; R-APPROVE 2026-10-29 "option b"; the P6 answer) -- THE RULES LIST OF A CATEGORY
// THAT FITS MODULES: point wiring, switches & sockets, pop-up boxes. Each line EXISTS ONLY WHILE ITS SOURCE DOES -- a
// config step, a config rule the AI is given, a config default, or the config marker a code rule reads -- and every
// Pricing Input, size, count, default and item name in it is READ FROM THAT SOURCE. The words around them are the
// owner's approved wording (2026-10-29), held per category as its reasons are; a line whose source goes, goes.
//
// THE CODE RULES, EACH TIED TO THE MARKER ITS FUNCTION READS (a test fails if the function is removed):
//   three conductors       `conductor_floor` on a wire definition  -> extraction.apply_conductor_floor
//   point type, n times    a `point_type` definition               -> extraction.point_type_of / secondary_length_m
//   quantities left blank  an `extraction_defaults` `requires_named` -> extraction.fill_paired_slot_defaults
//   circuit wiring No      a definition's `absent_dependents`      -> extraction.force_absent_dependents
// The AI-reading lines are tied to the config rule the AI is given (the wires, the points, the switch, the bare box,
// the includes-modules read). Run order: the AI's read first, then the BoQ pipeline steps; BCS is not listed.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The step keys the assembly lines read -- only those; everything else in a step is not this builder's business. */
type AsmLadder = { where?: { family?: string }; bind?: string; on_zero_from?: string; on_zero_modules?: number; pick_from?: string };
type AsmParams = {
  terms?: Array<{ weight?: number; none_when?: string; weight_from?: unknown }>; ladders?: AsmLadder[];
  blanks?: { item_when_positive?: string; qty_attr?: string }; include_when?: unknown;
  table_from_ctx?: Record<string, string>; constants_from_ctx?: { base?: string; per_extra?: string };
  from_attr?: string; result_attr?: string; default?: unknown; default_from_ctx?: string; table?: Record<string, unknown>;
  sizes?: number[]; usable_from_ctx?: Record<string, string[]>; m_from_ctx?: string; digits?: number;
  module_count_from_attr?: string; modules_from_ctx?: string;
};
type AnyStep = {
  step?: string; name?: string; target?: string; result?: string; ref?: Record<string, unknown>; params?: AsmParams;
  rate_stages?: Array<{ mult_from_ctx?: string; mult_step_divisor?: number } | null>; pricing_input?: boolean;
};
type AsmCfg = {
  category_id?: string; pipelines?: Record<string, { steps?: AnyStep[] }>;
  attribute_definitions?: Array<{ id: string; label?: string; conductor_floor?: { group?: string } }>;
  extraction_defaults?: Record<string, unknown>; rules?: Array<{ id?: string }>;
};

function boqPipelines(c: AsmCfg): Array<[string, { steps?: AnyStep[] }]> {
  return Object.entries(c.pipelines ?? {}).filter(([id]) => !/bcs/i.test(id));
}

/** Whether every line a category's reasons name is an assembly line (`ASSEMBLY_TEXT`). */
function isAssemblyRulings(rulings: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(rulings);
  return keys.length > 0 && keys.every((k) => k in ASSEMBLY_TEXT || k in ELECTRICAL_TEXT);
}

const andList = (xs: readonly string[]): string => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs.join(""));
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six"];
const countWord = (n: number): string => COUNT_WORDS[n] ?? String(n);
const num = (v: unknown): string => String(Number(v));

/** The facts one config gives the lines, or null where a line's source is absent. */
function assemblyFacts(c: AsmCfg, items: ReadonlyArray<RuleOrderItem>) {
  const steps = boqPipelines(c).flatMap(([, pl]) => pl.steps ?? []);
  const defs = c.attribute_definitions ?? [];
  const def = (id: unknown) => defs.find((d) => d.id === id);
  const label = (id: unknown): string => def(id)?.label ?? String(id ?? "").replace(/_/g, " ");
  const rule = (id: string): boolean => (c.rules ?? []).some((r) => r?.id === id);
  const dflt = (id: string): unknown => c.extraction_defaults?.[id];
  // ctx name -> the Pricing Inputs it is built from: a `rate_ref` reads one; a Pricing-Input `scale` combines its own
  const reads = new Map<string, string>();
  const scales = new Map<string, AnyStep>();
  for (const st of steps) {
    if (st.step === "rate_ref" && typeof st.result === "string") reads.set(st.result, String(st.ref?.item ?? ""));
    else if (st.step === "scale" && typeof st.result === "string" && (st as { pricing_input?: boolean }).pricing_input) scales.set(st.result, st);
  }
  const inputs = (ctx: unknown, seen = new Set<string>()): string[] => {
    const k = String(ctx ?? "");
    if (seen.has(k)) return [];
    seen.add(k);
    const id = reads.get(k);
    if (id) return [pricingInputLabel(id, items as never)];
    const sc = scales.get(k);
    if (!sc) return [];
    const out = [...inputs(sc.target, seen)];
    for (const [pk, pv] of Object.entries(sc.params ?? {})) if (/_from_ctx$/.test(pk)) out.push(...inputs(pv, seen));
    return [...new Set(out)];
  };
  const lastInput = (ctx: unknown): string => inputs(ctx).slice(-1)[0] ?? "a Pricing Input";
  const maps = steps.filter((s) => s.step === "map_attribute");
  const mapOf = (pred: (p: AsmParams) => boolean) => maps.find((s) => pred(s.params ?? {}));
  const mf = steps.find((s) => s.step === "module_fit");
  const ladders: AsmLadder[] = mf?.params?.ladders ?? [];
  const isBox = (L: AsmLadder) => /back box/i.test(String(L.where?.family ?? ""));
  const boxLadder = ladders.find(isBox);
  const plateLadder = ladders.find((L) => !isBox(L));
  const blanks = mf?.params?.blanks;
  const named = Object.entries(c.extraction_defaults ?? {})
    .filter((e): e is [string, { default?: unknown; requires_named: string }] => !!e[1] && typeof e[1] === "object" && !!(e[1] as { requires_named?: unknown }).requires_named);
  const plateQty = named.find(([, v]) => v.requires_named === plateLadder?.bind)?.[0];
  // the pipelines whose components add to the supply and to the install
  const sumPl = (result: string) => boqPipelines(c).find(([, pl]) => (pl.steps ?? []).some((s) => s.step === "sum_components" && s.result === result))?.[1].steps ?? [];
  const compIn = (pl: AnyStep[], name: string) => pl.find((s) => s.step === "component_ref" && s.name === name);
  const stageCtx = (s: AnyStep | undefined, i: number): unknown => s?.rate_stages?.[i]?.mult_from_ctx;
  const scaleTo = (result: string) => steps.find((s) => s.step === "scale" && s.result === result && s.params?.m_from_ctx);
  const roundOf = (target: string) => steps.find((s) => s.step === "roundup" && s.target === target);
  const fit = steps.find((s) => s.step === "circuit_fit");
  const lenMap = mapOf((p) => !!p.table_from_ctx);
  const lenDerive = steps.find((s) => s.step === "derive_attribute" && s.params?.constants_from_ctx);
  const handoff = mapOf((p) => p.from_attr === "conduit_handoff" && p.default !== undefined);
  const stretch = mapOf((p) => !!p.default_from_ctx);
  const assemblyComps = steps.some((s) => s.step === "component_ref" && Array.isArray(s.rate_stages) && s.rate_stages.some((r) => r?.mult_from_ctx));
  const supplyPl = sumPl("supply"), installPl = sumPl("install");
  return {
    // the AI's read
    wires: rule("R9") ? {} : null,
    floor: defs.some((d) => d.conductor_floor) ? { circuit: defs.some((d) => d.conductor_floor?.group === "circuit") } : null,
    points: rule("R9") && dflt("points") !== undefined ? { n: num(dflt("points")) } : null,
    switch: (() => {
      const cl = [["S1", "a 6A switch is priced as 10A"], ["S2", "an unstated way count is 1 way"], ["S3", "more than one socket makes it 16A"]]
        .filter(([id]) => rule(id)).map(([, t]) => t);
      return cl.length ? { clauses: cl } : null;
    })(),
    bare_box: rule("S4") && boxLadder?.on_zero_from ? { n: num(boxLadder.on_zero_modules) } : null,
    includes_modules: rule("P1") && mf?.params?.include_when ? {} : null,
    quantities: named.length && plateQty ? { q: num(named[0][1].default), plateQty: label(plateQty), colour: dflt("colour") } : null,
    box_colour: dflt("back_box") !== undefined && dflt("colour") !== undefined
      ? { box: dflt("back_box") === "Yes" ? "included" : "not included", colour: String(dflt("colour")) } : null,
    // the BoQ pipeline steps
    length: lenMap && lenDerive
      ? { first: lastInput(lenDerive.params?.constants_from_ctx?.base), further: lastInput(lenDerive.params?.constants_from_ctx?.per_extra), nTimes: !!def("point_type") }
      : null,
    conduit_included: handoff
      ? { other: !!mapOf((p) => p.from_attr === "other_conduit"), excluded: !!mapOf((p) => p.from_attr === "conduit_price_excluded") }
      : null,
    conduit_type: (() => {
      const m = mapOf((p) => p.result_attr === "conduit_type" && p.default !== undefined && !p.from_attr);
      return m ? { dflt: String(m.params?.default), drop: !!mapOf((p) => p.result_attr === "conduit_type" && !!p.from_attr) } : null;
    })(),
    circuit_wiring: stretch
      ? { stretch: lastInput(stretch.params?.default_from_ctx), silence: dflt(String(stretch.params?.from_attr)), secondary: !!mapOf((p) => p.from_attr === "point_type" && p.result_attr !== stretch.params?.result_attr && !!p.table && !p.table_from_ctx) }
      : null,
    conduit_fit: fit
      ? (() => {
        const sizes: number[] = fit.params?.sizes ?? [];
        const types = Object.entries<unknown[]>(fit.params?.usable_from_ctx ?? {}).map(([t, ks]) => [t, ks.map((k) => lastInput(k))] as const);
        return { sizes: sizes.map(num), types };
      })()
      : null,
    plate: mf
      ? {
        terms: (mf.params?.terms ?? []).map((t) => ({ what: label(t.none_when).toLowerCase().replace(/\s+\d+$/, ""), weight: num(t.weight), own: !!t.weight_from })),
        box: !!boxLadder, pick: !!boxLadder?.pick_from, zero: boxLadder?.on_zero_modules !== undefined && !boxLadder?.on_zero_from ? num(boxLadder.on_zero_modules) : null,
        noneRefusal: noneRefusal(c as ElcCfg), // ELR-5 (owner "Q3 b"): line 5's last sentence, from the config
        blanker: blanks?.item_when_positive ? String(blanks.item_when_positive) : null, blankQty: blanks?.qty_attr ? label(blanks.qty_attr) : null,
      }
      : null,
    supply: assemblyComps && supplyPl.length
      ? (() => {
        const w = lastInput(stageCtx(compIn(supplyPl, "wire1"), 0));
        return { assembly: true as const, wire: w, wastage: /wastage/i.test(w), conduit: lastInput(stageCtx(compIn(supplyPl, "conduit"), 0)), swsock: lastInput(stageCtx(compIn(supplyPl, "switch"), 0)) };
      })()
      : scaleTo("supply") && roundOf("supply")
        ? { assembly: false as const, input: lastInput(scaleTo("supply")!.params?.m_from_ctx), round: roundWords(roundOf("supply")!.params?.digits) }
        : null,
    install: assemblyComps && installPl.length
      ? (() => {
        const w = compIn(installPl, "wire1");
        return {
          assembly: true as const, cable: lastInput(stageCtx(w, 0)), divisor: num(w?.rate_stages?.[0]?.mult_step_divisor),
          conduit: lastInput(stageCtx(compIn(installPl, "conduit"), 1)), switchShare: lastInput(stageCtx(compIn(installPl, "switch"), 1)),
          accessory: lastInput(stageCtx(compIn(installPl, "socket"), 0)),
        };
      })()
      : scaleTo("install") && roundOf("install")
        ? { assembly: false as const, input: lastInput(scaleTo("install")!.params?.m_from_ctx), round: roundWords(roundOf("install")!.params?.digits) }
        : null,
    box: steps.some((s) => s.step === "match_master_row") && steps.find((s) => s.step === "scale" && s.params?.module_count_from_attr)
      ? { count: label(steps.find((s) => s.step === "scale" && s.params?.module_count_from_attr)!.params?.module_count_from_attr) }
      : null,
    modules_price: scaleTo("module_supply") && scaleTo("module_install")
      ? {
        supply: lastInput(scaleTo("module_supply")!.params?.m_from_ctx), supplyRound: roundWords(roundOf("module_supply")?.params?.digits),
        install: lastInput(scaleTo("module_install")!.params?.m_from_ctx), installRound: roundWords(roundOf("module_install")?.params?.digits),
      }
      : null,
    totals: steps.some((s) => s.step === "scale" && s.params?.modules_from_ctx) ? {} : null,
  };
}
type AsmFacts = ReturnType<typeof assemblyFacts>;
type AsmKey = keyof AsmFacts;

/** The owner-approved wording of each line (2026-10-29), filled from its facts; `at(key)` is another line's number. */
type AsmText = { [K in AsmKey]: (f: NonNullable<AsmFacts[K]>, cat: string, at: (k: string) => number | undefined) => [string, string] };
const ASSEMBLY_TEXT: AsmText = {
  wires: () => ["The wires",
    "Read as the BoQ states them: '3R x 1.5' or '3 x 1.5' is 3 runs of a 1-core 1.5 sqmm wire; a bare size is 1 run; a separately named earth is wire 2; with two sizes and no counts, the larger is wire 1, one run each; more than 1 core only when stated."],
  floor: (f) => ["Three conductors",
    `On the AI's read, the point wires${f.circuit ? ", and the circuit wires as well," : ""} are raised to three conductors: a single-core wire gets more runs (the bigger one when there are two); when every wire is multi-core, a 1-core wire of the same size is added; a BoQ stating more is never reduced. A value you type on the panel or the calculator is raised the same way, shown '(computed)' with the note 'Raised to three conductors.'; a typed value stating three or more stands.`],
  points: (f) => ["Points covered", `The number the BoQ states; where none is stated, ${f.n}.`],
  switch: (f) => ["Switch", `As stated, with ${countWord(f.clauses.length)} catalogue rule${f.clauses.length > 1 ? "s" : ""}: ${f.clauses.join("; ")}.`],
  bare_box: (f) => ["Back box size (a bare box)",
    `A module count the BoQ gives for the box itself is used only when nothing sits on the board. A size in millimetres, or a count of ports or outlets, is not a module count. With none readable, the box is ${f.n} modules, shown as assumed. Where the BoQ writes a range such as '9/8M', the box takes whatever count the AI read; the "higher of a range" rule is not applied today.`],
  includes_modules: () => ["Includes modules",
    "Yes only when the BoQ supplies the modules; a box \"with provision for\", \"suitable for\" or simply \"N module\" is a box without modules. No -> the box alone (the module picks stay on screen and are not charged). Blank -> the row does not price."],
  quantities: (f, cat) => ["Quantities left blank", cat === "point_wiring"
    ? `A named switch, socket or plate with no quantity -> ${f.q}; an unnamed plate on a board holding a switch or socket -> ${f.q}; a component the BoQ says is absent ("None") has no quantity. Clearing a "None" plate means "work it out": the plate is computed, or, where the board holds nothing, "${f.plateQty}" is asked.`
    : cat === "popup_boxes"
      ? `A named switch, socket or plate with no quantity -> ${f.q}; an unnamed plate in a box holding a switch or socket -> ${f.q}; colour ${f.colour} where unstated. Clearing a "None" plate means "work it out": the plate is computed, or, on an empty box, "${f.plateQty}" is asked.`
      : `A named switch, socket or plate with no quantity -> ${f.q}; an unnamed plate on a board holding a switch or socket -> ${f.q}; a component the BoQ says is absent has no quantity. Clearing a "None" plate means "work it out": the plate is computed, or, on an empty box, "${f.plateQty}" is asked.`],
  box_colour: (f) => ["Back box and colour", `Where unstated, a back box is ${f.box} and the colour is ${f.colour}.`],
  length: (f) => ["Circuit length",
    `The length the BoQ states. Otherwise: a row naming only a first or primary point takes '${f.first}'; a row naming only secondary, looped or further points takes '${f.further}'${f.nTimes ? ", or n times it when the row names n such points" : ""}; otherwise the first point's length + '${f.further}' for every additional point.${f.nTimes ? " The point type is read by code from the row and its headings." : ""}`],
  conduit_included: (f) => ["Conduit included",
    `Yes, unless the BoQ says the run uses something already there (a raceway, tray, trunking or existing conduit), which means no conduit. Also: ${[
      "a choice between a conduit and another container -> included", "silence -> included",
      ...(f.other ? ["a normal conduit named elsewhere on the row -> included"] : []),
      ...(f.excluded ? ["an explicit \"conduit paid separately\" -> no conduit, whatever else the row says"] : []),
    ].join("; ")}.`],
  conduit_type: (f) => ["Conduit type", `The BoQ's answer; where none is stated, ${f.dflt}${f.drop ? "; with no conduit included, none" : ""}.`],
  circuit_wiring: (f) => ["Circuit wiring",
    `Only when the BoQ says the rate includes it${f.silence ? `; silence is ${f.silence}` : ""}. When it is included, the circuit wires are priced over '${f.stretch}' (a stretch you type is kept), once per row. It is ${f.secondary ? "never charged on a secondary-point row (that row still shows the stretch) and " : ""}never multiplied by the points.`],
  conduit_fit: (f) => {
    const [first, ...rest] = f.types as Array<readonly [string, string[]]>;
    const prefix = (ls: string[]) => ls.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); }).trim();
    const others = rest.map(([t, ls]) => `the ${countWord(ls.length)} '${prefix(ls)} ...' inputs for an ${t} conduit`);
    return ["Conduit size and length",
      `Fitted to the wires: the wires' overall width (each wire's diameter x cores x runs) fits the smallest of ${andList(f.sizes)} mm whose usable share holds it. The shares are ${andList((first?.[1] ?? []).map((l) => `'${l}'`))}${others.length ? `, or ${others.join(", or ")}` : ""}. As many circuits as fit share one conduit, so the conduit length = the circuit length / circuits, rounded up. If even ${f.sizes[f.sizes.length - 1]} mm cannot hold the wires, the row does not price.`];
  },
  plate: (f, _cat, at) => {
    const t = f.terms as Array<{ what: string; weight: string; own: boolean }>;
    const counts = t.every((x) => x.own)
      ? `each ${andList([...t].reverse().map((x) => x.what).filter((w, i, a) => a.indexOf(w) === i))} counts its own module width`
      : t.map((x, i) => (i === 0 ? `a ${x.what} counts ${x.weight} modules` : `a ${x.what} ${x.weight}`)).join(" and ");
    const larger = "the plate is the larger of the stated and the computed size";
    if (!f.box) {
      return ["The plate and blanks",
        `Fitted to what the box holds: ${counts}; ${larger}; spare modules get '${f.blanker}'s ("${f.blankQty}" can lower, never raise). There is no back box: the pop-up box is the enclosure.`];
    }
    if (f.zero !== null) {
      return ["Plate, back box and blanks",
        `Fitted to what the board holds: ${counts}; ${larger}; the back box takes the plate's size (the computed size when the plate is "None"); with nothing on the board, a ${f.zero}-module back box and no plate; each spare module on the plate gets a '${f.blanker}'; "${f.blankQty}" can lower that count but never raise it above the spare.`];
    }
    const bare = at("bare_box");
    return ["Plate, back box and blanks",
      `Fitted to what the board holds: ${counts}; ${larger}; the back box is the plate's size, or the computed size with no plate${f.pick ? "; a back box size you pick is used if it holds the contents, else raised to fit" : ""}${bare ? `; with nothing on the board, see line ${bare}` : ""}; spare modules get '${f.blanker}'s ("${f.blankQty}" can lower that count, never raise it).${f.noneRefusal ? ` With nothing on the board and no back box, the row does not price; it says: '${f.noneRefusal}'` : ""}`];
  },
  supply: (f) => ["Supply", f.assembly
    ? `Each part at its own discount and supply markup, rounded up to the rupee per metre or per piece, x its quantity, then added up and not rounded again: each wire x its runs, from '${f.wire}'${f.wastage ? " (the wastage is not applied)" : ""}, x the circuit length; the circuit wires x the circuit stretch; the conduit from '${f.conduit}', x its fitted length; switch, socket, blanks, plate and back box from '${f.swsock}'.`
    : `The parts' list prices added, x (1 - discount) x (1 + supply markup) from '${f.input}', ${f.round}.`],
  install: (f) => ["Install", f.assembly
    ? `Each part's own install: wires: install base x (1 + '${f.cable}') x one install unit per ${f.divisor} runs, rounded up to the rupee, x the length; the conduit: its discounted rate x '${f.conduit}', rounded up; the switch: its rounded supply rate x '${f.switchShare}', not rounded again; socket, blanks, plate and back box: the switch & socket discounted rate x '${f.accessory}', rounded once.`
    : `The supply x '${f.input}', ${f.round}.`],
  box: (f) => ["The box", `The catalogue's per-module supply and install rates, as they stand, x the "${f.count}".`],
  modules_price: (f) => ["The modules' price",
    `Supply = their list prices added, x (1 - discount) x (1 + supply markup) from '${f.supply}', ${f.supplyRound}. Install = that x '${f.install}', ${f.installRound}.`],
  totals: () => ["Totals", "Supply = the box + the modules' supply; install = the box's install + the modules' install."],
};

/**
 * ELR-4a -- PURE. "How a row is priced" for a category that fits modules: the lines its `DERIVATION_RULINGS` entry
 * names, in that order, each only while its source is in the config, each ending with its reason.
 */
function assemblyRuleOrder(config: unknown, items: ReadonlyArray<RuleOrderItem>, rulings: Readonly<Record<string, string>>): RuleOrderLine[] {
  const c = config as AsmCfg;
  const cat = String(c.category_id ?? "");
  const facts = { ...assemblyFacts(c, items), ...electricalFacts(config as ElcCfg, items) };
  const out: RuleOrderLine[] = [];
  const keys: string[] = [];
  const at = (k: string): number | undefined => { const i = keys.indexOf(k); return i < 0 ? undefined : i + 1; };
  for (const key of Object.keys(rulings)) {
    const f = (facts as Record<string, unknown>)[key];
    const text = (ASSEMBLY_TEXT[key as AsmKey] ?? ELECTRICAL_TEXT[key as ElcKey]) as unknown as ((f: unknown, cat: string, at: (k: string) => number | undefined) => [string, string]) | undefined;
    if (f == null || !text) continue;
    const [title, body] = text(f, cat, at);
    keys.push(key);
    const why = rulings[key] || NOT_RECORDED;
    out.push({ n: out.length + 1, title, detail: `${body} -- why: ${why}`, reason: why });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ELR-4b (owner R-DERIV 2026-09-27; R-APPROVE 2026-10-29 "option b"; the P6 answer, 2026-10-29) -- THE RULES LISTS OF
// THE OTHER EIGHT ELECTRICAL CATEGORIES: DB & switchgear, industrial sockets, earthing, conduit, cable tray, junction
// box, lighting management and miscellaneous. The ELR-4a contract holds: each line EXISTS ONLY WHILE ITS SOURCE DOES,
// every Pricing Input, default, count, size and field label in it is READ FROM THAT SOURCE, and the words around them
// are the owner's approved wording (2026-10-29). Vocabulary lists the owner approved as words (the four-pole family,
// the breaker words, the parts the catalogue does not carry) stay words; a test ties each to the config that rules it.
//
// THE CODE RULES, EACH TIED TO THE MARKER ITS FUNCTION READS:
//   the pole ladder (DB4)     a composite config's breaker catalogue    -> extraction.breaker_catalog_for /
//                             (`composite_slots.repeatable.values_from`)    apply_pole_plus_neutral_ladder
//   the inch trade size (CP2) an `inch_trade_mm` table on a definition  -> extraction.apply_inch_trade_size
//   GI priced as MS (CP1)     the `synonyms` entry GI -> MS             -> the AI's synonym map + _coerce_value_ex
// The AI-reading lines are tied to the config rule the AI is given (R2 / R3 / R4 / R8 / R12 / R7 / R13 / R11) or to
// the composite's resolution rules; the pipeline lines to their step. BCS is not listed.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The step keys the eight categories' lines read. Params stay `unknown` and are read through `pv`. */
type ElcStep = {
  step?: string; name?: string; target?: string; result?: string; ref?: Record<string, unknown>; params?: Record<string, unknown>;
  conditions?: Array<{ when?: Record<string, unknown>; params?: Record<string, unknown> }>; qty?: unknown;
  rate_stages?: Array<{ round?: string; mult_from_ctx?: string } | null>; pricing_input?: boolean;
};
type ElcCfg = {
  category_id?: string; matching_mode?: string; identity_attribute_id?: string;
  pipelines?: Record<string, { output?: string[]; steps?: ElcStep[] }>;
  attribute_definitions?: Array<{ id: string; label?: string; values?: unknown[]; inch_trade_mm?: Record<string, unknown> }>;
  extraction_defaults?: Record<string, unknown>; rules?: Array<{ id?: string }>; synonyms?: Record<string, Record<string, unknown>>;
  composite_slots?: { repeatable?: { count?: unknown; values_from?: unknown }; fixed?: unknown[] };
  decomposition_rules?: Record<string, unknown>;
};

const POLE_WORDS: Record<string, string> = { SP: "single pole", DP: "double pole", TP: "three pole", FP: "four pole" };

/** The facts one config gives the eight categories' lines, or null where a line's source is absent. */
/** ELR-4d (owner R-DB-MANUAL): the sentence a primary pipeline's `sum_components` declares for a row with no part at all. */
function noneRefusal(c: ElcCfg): string | undefined {
  for (const [pid, pl] of Object.entries(c.pipelines ?? {})) {
    if (/bcs/i.test(pid)) continue;
    for (const st of pl.steps ?? []) {
      const r = (st as unknown as { step?: string; none_refusal?: unknown });
      if (r.step === "sum_components" && typeof r.none_refusal === "string") return r.none_refusal;
    }
  }
  return undefined;
}

function electricalFacts(c: ElcCfg, items: ReadonlyArray<RuleOrderItem>) {
  const pls = Object.entries(c.pipelines ?? {}).filter(([id]) => !/bcs/i.test(id));
  const steps = pls.flatMap(([, pl]) => pl.steps ?? []);
  const defs = c.attribute_definitions ?? [];
  const def = (id: string) => defs.find((d) => d.id === id);
  const label = (id: string): string => def(id)?.label ?? id.replace(/_/g, " ");
  const rule = (id: string): boolean => (c.rules ?? []).some((r) => r?.id === id);
  const dflt = (id: string): unknown => c.extraction_defaults?.[id];
  const pv = (s: { params?: Record<string, unknown> } | undefined, k: string): unknown => s?.params?.[k];
  // ctx name -> the Pricing Inputs it is built from (the ELR-4a reading: a `rate_ref`, or a Pricing-Input `scale`)
  const reads = new Map<string, string>();
  const scales = new Map<string, ElcStep>();
  for (const st of steps) {
    if (st.step === "rate_ref" && typeof st.result === "string") reads.set(st.result, String(st.ref?.item ?? ""));
    else if (st.step === "scale" && typeof st.result === "string" && st.pricing_input) scales.set(st.result, st);
  }
  const inputs = (ctx: unknown, seen = new Set<string>()): string[] => {
    const k = String(ctx ?? "");
    if (seen.has(k)) return [];
    seen.add(k);
    const id = reads.get(k);
    if (id) return [pricingInputLabel(id, items as never)];
    const sc = scales.get(k);
    if (!sc) return [];
    const out = [...inputs(sc.target, seen)];
    for (const [pk, pval] of Object.entries(sc.params ?? {})) if (/_from_ctx$/.test(pk)) out.push(...inputs(pval, seen));
    return [...new Set(out)];
  };
  const input = (ctx: unknown): string => inputs(ctx).slice(-1)[0] ?? "a Pricing Input";
  const condCtx = (s: ElcStep | undefined, key: string): unknown => s?.conditions?.map((cd) => cd.params?.[key]).find((v) => v !== undefined);
  const rounded = (target: string): string => {
    const r = steps.find((s) => s.step === "roundup" && s.target === target);
    return r ? roundWords(pv(r, "digits")) : "not rounded";
  };
  const scaleTo = (result: string, key: string) => steps.find((s) => s.step === "scale" && s.result === result && pv(s, key) !== undefined);
  const fitOn = (bind: string) => steps.find((s) => s.step === "catalog_fit" && pv(s, "bind") === bind && pv(s, "direction") === "up");
  const mapTo = (result: string, pred: (s: ElcStep) => boolean = () => true) => steps.find((s) => s.step === "map_attribute" && pv(s, "result_attr") === result && pred(s));
  const comp = (name: string) => steps.find((s) => (s.step === "component" || s.step === "component_ref") && s.name === name);
  const matches = steps.some((s) => s.step === "match_master_row");
  const outputs = pls.flatMap(([, pl]) => pl.output ?? []);
  const composite = c.matching_mode === "composite_decomposition";
  const identity = c.matching_mode === "item_identity";
  const rep = c.composite_slots?.repeatable;
  const dr = c.decomposition_rules ?? {};
  const qtyDefault = Object.entries(c.extraction_defaults ?? {}).find(([k, v]) => /_qty$/.test(k) && typeof v === "number")?.[1];
  const supplyStageCtx = (name: string): unknown => comp(name)?.rate_stages?.find((r) => r?.mult_from_ctx)?.mult_from_ctx;
  const enclosureDefault = dflt("enclosure") as { text_overrides?: unknown[] } | undefined;
  const installDefault = dflt("installation_type") as { text_overrides?: unknown[] } | undefined;
  const swg = mapTo("thickness_mm", (s) => pv(s, "from_attr") === "thickness_swg" && !!pv(s, "table"));
  const swgTable = (pv(swg, "table") ?? {}) as Record<string, unknown>;
  const trayFit = fitOn("width_mm");
  const mcbFit = steps.find((s) => s.step === "catalog_fit" && pv(s, "bind") === "paired_mcb");
  const busbar = steps.find((s) => s.step === "component_ref" && !!(s.ref as { attributes?: unknown } | undefined)?.attributes && !!s.conditions?.length);
  const sizeDef = defs.find((d) => d.inch_trade_mm && typeof d.inch_trade_mm === "object");
  return {
    // DB & switchgear -- the AI's read (slot spec, resolution rules, rules), then the build-up pipeline
    db_parts: composite && rep?.count !== undefined
      ? { n: countWord(Number(rep.count)), enclosure: Array.isArray(c.composite_slots?.fixed) && c.composite_slots!.fixed!.length > 0, partial: !!(dr.partial_pricing as { enabled?: unknown } | undefined)?.enabled }
      : null,
    db_board: rule("R2") ? {} : null,
    db_breakers: dr.amp && dr.curve ? {} : null,
    db_pole: composite && rep?.values_from ? {} : null,
    db_rccb: rule("R3") || rule("R4") ? { r3: rule("R3"), r4: rule("R4") } : null,
    db_phase: rule("R8") ? {} : null,
    db_quantities: composite && qtyDefault !== undefined ? { q: num(qtyDefault), noneRefusal: noneRefusal(c) } : null,
    db_supply: composite && steps.some((s) => s.step === "sum_components" && s.result === "supply") && scaleTo("supply", "m_from_ctx")
      ? { input: input(pv(scaleTo("supply", "m_from_ctx"), "m_from_ctx")), round: rounded("supply") } : null,
    db_install: composite && steps.find((s) => s.step === "scale" && s.target === "supply" && s.result === "install" && pv(s, "m_from_ctx"))
      ? { input: input(pv(steps.find((s) => s.step === "scale" && s.target === "supply" && s.result === "install"), "m_from_ctx")), round: rounded("install") } : null,
    // industrial sockets -- the paired MCB's facts (R12), its pole / curve maps and its ladder, then the two components
    is_mcb: rule("R12") && pv(mcbFit, "absent_when") ? { pick: !!pv(mcbFit, "prefer_attr") } : null,
    is_pole: mapTo("mcb_pole_norm", (s) => !!pv(s, "table")) && mapTo("mcb_pole", (s) => !!pv(s, "table"))
      ? { pins: Object.entries((pv(mapTo("mcb_pole", (s) => !!pv(s, "table")), "table") ?? {}) as Record<string, unknown>)
        .map(([pin, pole]) => `${String(/^\s*(\d+)\s*pin/i.exec(pin)?.[1] ?? pin)} pin -> ${POLE_WORDS[String(pole)] ?? String(pole)}`) }
      : null,
    is_curve: mapTo("mcb_curve", (s) => pv(s, "default") !== undefined) ? { dflt: String(pv(mapTo("mcb_curve", (s) => pv(s, "default") !== undefined), "default")) } : null,
    is_rating: fitOn("paired_mcb")
      ? { refuses: pv(fitOn("paired_mcb"), "on_miss") === "no_compute", silent: pv(fitOn("paired_mcb"), "on_missing_fact") === "none" } : null,
    is_interlocked: steps.some((s) => s.step === "component_ref" && (s.qty as { if_attr?: unknown; then?: unknown } | undefined)?.if_attr && Number((s.qty as { then?: unknown }).then) === 0) ? {} : null,
    is_enclosure: Array.isArray(enclosureDefault?.text_overrides) ? {} : null,
    is_supply: supplyStageCtx("socket") && supplyStageCtx("paired_mcb") ? { socket: input(supplyStageCtx("socket")), mcb: input(supplyStageCtx("paired_mcb")) } : null,
    is_install: comp("paired_mcb") && scaleTo("install", "m_from_ctx")
      ? { input: input(pv(scaleTo("install", "m_from_ctx"), "m_from_ctx")), round: rounded("install") } : null,
    // earthing -- the match, the conditional Bus bar adder, the two markups
    ea_item: matches && (def("type")?.values ?? []).includes("Bus bar") ? {} : null,
    ea_busbar: busbar && dflt("with_busbar") !== undefined ? { dflt: String(dflt("with_busbar")) } : null,
    ea_totals: busbar && scaleTo("supply", "markup_from_ctx") && scaleTo("install", "markup_from_ctx")
      ? { supply: input(pv(scaleTo("supply", "markup_from_ctx"), "markup_from_ctx")), install: input(pv(scaleTo("install", "markup_from_ctx"), "markup_from_ctx")),
        unrounded: rounded("supply") === "not rounded" && rounded("install") === "not rounded" } : null,
    // conduit -- the synonym, the size ladder with its inch table, the price
    cp_type: matches && Object.keys(c.synonyms?.conduit_type ?? {}).length && fitOn("size_mm")
      ? { swaps: Object.entries(c.synonyms!.conduit_type).map(([from, to]) => `${from} is priced as ${String(to)}`) } : null,
    cp_size: fitOn("size_mm")
      ? { refuses: pv(fitOn("size_mm"), "on_miss") === "no_compute",
        inch: Object.entries(sizeDef?.inch_trade_mm ?? {}).sort((a, b) => Number(a[1]) - Number(b[1])).map(([k, v]) => `${k}" = ${String(v)}`) } : null,
    cp_price: scaleTo("supply_per_mtr", "boq_multiplier_from_ctx") && scaleTo("install_per_mtr", "install_ratio_from_ctx")
      ? { supply: input(pv(scaleTo("supply_per_mtr", "boq_multiplier_from_ctx"), "boq_multiplier_from_ctx")), supplyRound: rounded("supply_per_mtr"),
        install: input(pv(scaleTo("install_per_mtr", "install_ratio_from_ctx"), "install_ratio_from_ctx")), installRound: rounded("install_per_mtr") } : null,
    // cable tray -- R7, the SWG map, the width ladder, the defaults, the two sums
    ct_material: rule("R7") ? {} : null,
    ct_thickness: swg && rule("R13")
      ? { gauge: "16" in swgTable ? "16" : Object.keys(swgTable)[0], mm: String(swgTable["16" in swgTable ? "16" : Object.keys(swgTable)[0]]),
        notFitted: !!trayFit && !!(pv(trayFit, "where") as Record<string, unknown> | undefined)?.thickness_mm } : null,
    ct_width: trayFit ? { refuses: pv(trayFit, "on_miss") === "no_compute" } : null,
    ct_defaults: dflt("tray_type") !== undefined && Array.isArray(installDefault?.text_overrides) ? {} : null,
    ct_supply: comp("base") && comp("cover") && comp("ceiling_accessories") && comp("floor_refilling") && scaleTo("supply_per_rmt", "markup_from_ctx")
      ? { discount: input(pv(comp("base"), "discount_from_ctx")), accessories: input(condCtx(comp("ceiling_accessories"), "accessories_per_mtr_from_ctx")),
        refilling: input(condCtx(comp("floor_refilling"), "refill_rate_from_ctx")), markup: input(pv(scaleTo("supply_per_rmt", "markup_from_ctx"), "markup_from_ctx")),
        round: rounded("supply_per_rmt"), cover: label("cover"), refill: label("floor_refilling") } : null,
    ct_install: comp("width_install") && comp("floor_cutting")
      ? { markup: input(pv(comp("width_install"), "install_markup_from_ctx")), cutting: input(condCtx(comp("floor_cutting"), "cutting_rate_from_ctx")),
        cuttingMarkup: input(condCtx(comp("floor_cutting"), "markup_from_ctx")), round: rounded("install_per_rmt"), cut: label("floor_cutting") } : null,
    // junction box -- R11 and an exact match (no ladder), the price
    jb_face: rule("R11") && matches && !steps.some((s) => s.step === "catalog_fit") ? {} : null,
    jb_price: scaleTo("supply", "discount_from_ctx") && scaleTo("install", "install_ratio_from_ctx")
      ? { discount: input(pv(scaleTo("supply", "discount_from_ctx"), "discount_from_ctx")), markup: input(pv(scaleTo("supply", "discount_from_ctx"), "markup_from_ctx")),
        supplyRound: rounded("supply"), share: input(pv(scaleTo("install", "install_ratio_from_ctx"), "install_ratio_from_ctx")), installRound: rounded("install") } : null,
    // lighting management and miscellaneous -- one catalogue item per row (identity matching), the price
    lm_item: identity && matches && def("brand") ? { item: label(String(c.identity_attribute_id ?? "")), brand: label("brand") } : null,
    lm_supply: steps.some((s) => s.step === "scale" && s.target === "rate") && scaleTo("supply", "markup_from_ctx")
      ? { input: input(pv(scaleTo("supply", "markup_from_ctx"), "markup_from_ctx")), round: rounded("supply"), noInstall: !outputs.some((o) => /^install/.test(o)) } : null,
    mi_item: identity && matches && !def("brand") ? {} : null,
    mi_price: identity && steps.some((s) => s.step === "scale" && s.target === "boq_supply") && steps.some((s) => s.step === "scale" && s.target === "boq_install") ? {} : null,
  };
}
type ElcFacts = ReturnType<typeof electricalFacts>;
type ElcKey = keyof ElcFacts;

/** The owner-approved wording of each line (2026-10-29, the P6 answer), filled from its facts. */
const ELECTRICAL_TEXT: { [K in ElcKey]: (f: NonNullable<ElcFacts[K]>) => [string, string] } = {
  db_parts: (f) => ["The DB is split into its parts",
    `The AI reads the row as the board (shell), up to ${f.n} breaker types with their quantities${f.enclosure ? ", and an enclosure only when one is named" : ""}; a breaker row with no board has no shell${f.partial ? "; parts the catalogue does not carry (ATS, bus bars, meters, IP enclosures, flexi boards) are left out and the rest is priced" : ""}`],
  db_board: () => ["Board size", "The way-count the BoQ states, else the next larger board in the catalogue -- never a smaller one; a range takes the highest"],
  db_breakers: () => ["Breakers",
    "The amperage the BoQ states, else the next higher rating -- never lower; a range such as '10/16 A' takes the highest. Curve as stated, else D for a board serving a UPS, else C"],
  db_pole: () => ["Four-pole and SP+N breakers",
    "TPN, TP+N, TP+NL, TP+2N, TP+2NL and 4P mean four pole. When the row's own words call a breaker TPN-family or SPN-family, it is matched at that named pole where the catalogue has one, else at four pole (TPN) or double pole (SPN), at the same amperage or the next one up (a note on the field says when the amperage moved up); with nothing at or above, the breaker is left blank and the row does not price until it is filled"],
  db_rccb: (f) => ["RCCB / RCBO and ELCB", [
    ...(f.r3 ? ["An RCCB or RCBO with no leakage current stated anywhere takes the highest mA at the stated device, amperage and pole"] : []),
    ...(f.r4 ? [`${f.r3 ? "an" : "An"} ELCB is priced as two parts, an MCB plus an RCCB`] : []),
  ].join("; ")],
  db_phase: () => ["Outgoings per phase", "A quantity stated per phase is multiplied by 3 on a TPN or VTPN board and by 1 on an SPN board"],
  db_quantities: (f) => ["Quantities and missing parts",
    `A part named with no quantity counts ${f.q}; a part the BoQ says is absent (None) is not priced; every part must be answered, a part or None, or the row does not price. ${f.noneRefusal ? `A row where no part is matched at all does not price; it says: '${f.noneRefusal}'` : "A row where no part is matched at all prices at 0 today"}`],
  db_supply: (f) => ["Supply", `The parts' list prices x their quantities, added, x (1 - discount) x (1 + supply markup) from '${f.input}', ${f.round}`],
  db_install: (f) => ["Install", `The rounded supply x '${f.input}', ${f.round} -- the share is of the whole board with its breakers, not the shell alone`],
  is_mcb: (f) => ["Paired MCB",
    `Added only when the BoQ names a breaker (MCB, MCCB, RCBO, RCCB, ELCB or "circuit breaker"); an amperage alone is not a breaker, so the socket is priced alone${f.pick ? ". A Paired MCB you pick is used as picked" : ""}`],
  is_pole: (f) => ["MCB pole",
    `The pole the BoQ states: TPN, TP+N, TP+NL, TP+2N, TP+2NL, 4P and Four Pole mean four pole; SPN, SP+N, SP+NL, SP&N and 1P+N mean double pole; none stated -> from the socket: ${f.pins.join(", ")}`],
  is_curve: (f) => ["MCB curve", `As stated, else ${f.dflt}`],
  is_rating: (f) => ["MCB rating", [
    `The amperage the BoQ states, else the next higher rating at that pole and curve${f.refuses ? "; nothing at or above -> the row does not price" : ""}.`,
    ...(f.silent ? ["If the amperage was not read, no MCB is added and the socket is priced alone, with no note on screen"] : []),
  ].join(" ").replace(/\.$/, "")],
  is_interlocked: () => ["Interlocked socket", "Includes its MCB: no separate MCB is added"],
  is_enclosure: () => ["Enclosure", "IP67 when the BoQ says IP67 or waterproof, else IP44/54 splash proof; this is on the AI's read, and the calculator does not assume it"],
  is_supply: (f) => ["Supply", `The socket at '${f.socket}' + the MCB at '${f.mcb}', each rounded up to the rupee, then added`],
  is_install: (f) => ["Install", `The supply x '${f.input}', ${f.round}`],
  ea_item: () => ["The earthing item",
    "Matched on Material and Type exactly. A row read as Type 'Bus bar' with Material CU or GI matches no earthing item and does not price (priced by hand for now); a row read as Material 'BUS BAR' matches the Bus bar item itself"],
  ea_busbar: (f) => ["With Bus bar", `As stated, else ${f.dflt}. With adds the Bus bar item's own supply rate; Without adds nothing`],
  ea_totals: (f) => ["Supply and install",
    `Supply = (the item's supply + the Bus bar) x (1 + '${f.supply}'); install = the item's install x (1 + '${f.install}')${f.unrounded ? "; neither is rounded" : ""}`],
  cp_type: (f) => ["Conduit type", `As stated; ${f.swaps.join("; ")}`],
  cp_size: (f) => ["Size",
    `The stated size, else the next larger size stocked for that type${f.inch.length ? `; an inch size in the row's own description is read as its trade size (${f.inch.join(", ")} mm)` : ""}${f.refuses ? "; above the largest stocked size the row does not price" : ""}`],
  cp_price: (f) => ["Supply and install",
    `Supply = list price x (1 - discount) x (1 + supply markup) from '${f.supply}', ${f.supplyRound}; install = the supply x '${f.install}', ${f.installRound}`],
  ct_material: () => ["Material", "As stated, with two substitutions: a uPVC tray is priced as GI Solid; a plain MS tray as MS powder coated"],
  ct_thickness: (f) => ["Thickness",
    `The millimetres the BoQ states; a thickness given only as a sheet gauge is converted to millimetres (${f.gauge} gauge = ${f.mm} mm), using the body's gauge where body and cover differ and the nearest heading's where several give one.${f.notFitted ? " The thickness is not fitted: one the catalogue does not stock for that type and material does not price" : ""}`],
  ct_width: (f) => ["Width", `The stated width, else the next wider stocked at that type, material and thickness${f.refuses ? "; above the widest the row does not price" : ""}`],
  ct_defaults: () => ["Where unstated",
    "Solid, no cover, no floor cutting, no floor refilling, ceiling-mounted; a raceway is floor-mounted. This is on the AI's read; on the calculator you choose the installation"],
  ct_supply: (f) => ["Supply per metre",
    `(the tray x (1 - '${f.discount}') + the cover x (1 - '${f.discount}') when ${f.cover} is Yes + '${f.accessories}' when ceiling-mounted + '${f.refilling}' when ${f.refill} is Yes) x (1 + '${f.markup}'), ${f.round}`],
  ct_install: (f) => ["Install per metre",
    `The tray's install rate x (1 + '${f.markup}') + '${f.cutting}' x (1 + '${f.cuttingMarkup}') when ${f.cut} is Yes; ${f.round}`],
  jb_face: () => ["Face size",
    "The face the BoQ states, the larger if the two differ; the depth does not matter. Matched exactly as stocked, so a face the catalogue does not stock, or a box with no face size, does not price"],
  jb_price: (f) => ["Supply and install",
    `Supply = list price x (1 - '${f.discount}') x (1 + '${f.markup}'), ${f.supplyRound}; install = the supply x '${f.share}', ${f.installRound}`],
  lm_item: (f) => ["One catalogue item per row",
    `Picked by its ${f.item} and ${f.brand}; both must be filled (a blank ${f.brand} does not price); a row naming several items is not priced here`],
  lm_supply: (f) => ["Supply", `The catalogue rate x (1 + '${f.input}'), ${f.round}${f.noInstall ? "; there is no install figure" : ""}`],
  mi_item: () => ["One catalogue item per row, by name", "A row naming several items is not priced here"],
  mi_price: () => ["Supply and install", "The item's own BoQ supply and install rates, as they stand; no Pricing Input and no rounding"],
};
