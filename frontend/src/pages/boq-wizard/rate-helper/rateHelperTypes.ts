/**
 * U1 rate-helper chassis -- the TYPED HELPER CONTRACT (guardrail G3: N-generic).
 *
 * A rate helper receives a row context (durable excel_row + the resolved category/discipline the
 * page already holds in categoriesByExcelRow + the rate-kinds present on the row) and returns either
 * a Suggestion (values per rate-kind + a one-line basis + STRUCTURED workings) or a NoSuggestion
 * (a reason). The panel renders ONLY this contract -- zero helper-specific rendering -- so a new
 * helper is a registry entry, never a panel change.
 *
 * NOTHING here persists (guardrail G2): the whole chassis is synchronous + frontend-only in U1.
 */

/** The rate-kind token, mirroring the grid's descriptor kind (rate_supply/install/combined ->
 * "supply_rate" | "install_rate" | "combined_rate"). Kept as a string so the contract stays
 * N-generic over whatever kinds a sheet's rate columns carry. */
export type RateKind = string;

/** One editable attribute in a helper's workings. `options` present => a select; absent => free text.
 * Editing an attribute re-runs the helper's compute (panel-session only). RM-3: choice/number attrs
 * carry the AI `confidence` and a `corroborated` tick (regex agreed) for display -- never gating. */
export interface WorkingsAttribute {
  id: string;
  label: string;
  options?: string[];
  value: string;
  /** AI confidence 0..1 for the EXTRACTED value (absent for a manually-added attr). */
  confidence?: number;
  /** The regex corroborator agreed with the AI value (display-only tick). */
  corroborated?: boolean;
  /** EA-4a-r: greyed + non-editable because an allow_none controller is set to "None" (positive absence). */
  disabled?: boolean;
  /** EA-4a-r: this def may itself be "None" (positive absence). For a NUMBER def the panel renders a "None"
   * checkbox beside the numeric input (a choice def carries None as its top option instead). */
  allowNone?: boolean;
  /**
   * SLICE 2d, OPTION B -- did the pipeline SUBSTITUTE or INFER anything behind this value?
   *
   * Set only by a mechanism that can answer it (today `catalog_fit`, via its own `substituted` plus
   * the `map_attribute` outcomes its `where` rests on, and `module_fit`'s take-the-larger upgrade).
   * ABSENT means "this mechanism does not answer", and the pre-2d blank-and-derived rule applies --
   * which is what keeps every other derived attribute rendering exactly as it did.
   */
  substituted?: boolean;
  /** U2: the extraction filled this value from a CONFIG DEFAULT -- the row text gave no positive
   * identification. The panel tints it amber so the pricer can see, and correct, every defaulted value
   * before using the rate. A human override CLEARS this (the helper drops the mark on recompute), so the
   * highlight can never outlive the correction. */
  defaulted?: boolean;
  /**
   * F4b -- THE LABELLED GROUP. A GENERAL capability, not a point_wiring feature: any attribute
   * definition in any category may declare `group_label`, and the panel emits a header row whenever
   * this label CHANGES between consecutive rendered attributes. Undefined => no header, which is why
   * every category that declares none renders exactly as it did before.
   *
   * ⚠️ IT IS A LABEL, NOT AN ID, AND THAT IS WHAT KEEPS IT CONTAINED. There is no group registry to
   * keep in step, no second config key to validate, and no ordering rule of its own -- the grouping
   * IS the definition order, which the panel already follows. Adjacent definitions sharing a label
   * are one group; a category may declare several.
   *
   * ⚠️ IT LIVES ON THE ATTRIBUTE DEFINITION, NEVER AT THE CONFIG'S TOP LEVEL. Top-level keys are
   * allowlisted by `_KNOWN_CONFIG_KEYS` in `api/boq/rate_master.py` and a new one would need a
   * backend edit; that same validator documents attribute definitions as having NO key allowlist.
   * So this ships with zero backend change -- and moving it upward later would not.
   */
  groupLabel?: string;
  // (see `startsAttributeGroup` below for the rule the panel applies to this field)
  /** DERIVED DISPLAY: the PIPELINE computes this attribute (a `module_fit` ladder bind, or a
   * `{from_fit}` quantity that superseded its `<name>_qty`). Read from CONFIG via `derivedAttrIds` --
   * never a hardcoded id. A derived attribute is NEVER missing user input: blank means "the row did
   * not state it", not "the row is incomplete", which is why `isAttrBlank` exempts it. */
  derived?: boolean;
  /** DERIVED DISPLAY: the value the PIPELINE computed for this attribute, as a display string
   * ("3M", "0"). ⚠️ It is deliberately NOT written into `value` -- `value` means "what the user or
   * extraction SUPPLIED", and collapsing the two makes a computed number indistinguishable from a
   * stated one to every later reader (the same rule the Rate Master Derivation screen follows).
   * Absent => nothing computed (a "None" plate, a bailed fit), which renders EMPTY, never 0. */
  derivedValue?: string;
  /** DERIVED DISPLAY: the computed value ALWAYS wins for this attribute and the field does not accept
   * an edit. TRUE only for a FULLY SUPERSEDED attribute (the blanker quantity: its component reads
   * `{from_fit}`, so the pipeline never reads the attribute at all and an editable field would be a
   * lie). A ladder bind with a `floor_from` is the OPPOSITE case -- a stated value IS read, as the
   * floor -- so it stays editable. */
  readOnly?: boolean;
  /** DERIVED DISPLAY: everything the panel must SAY about this field, in render order.
   *
   * ⚠️ THIS REPLACED A SINGLE `upgrade?` SLOT, and the generalisation is the point. That slot could
   * only ever express ONE meaning -- "we overrode you" -- in three independent places: its name, its
   * fixed ladder-shaped payload, and the `— using X` tail of its sentence. The blanker quantity needs
   * a note that means the OPPOSITE ("we used your number; here is the consequence"), and a warning
   * that reads as a correction when the value was HONOURED is worse than no warning at all. So the
   * field is a LIST of DISCRIMINATED notes and each kind words itself.
   *
   * Absent or empty => the field says nothing, exactly as an absent `upgrade` did. */
  notes?: AttrNote[];
}

/**
 * One thing the panel must say about a field. DISCRIMINATED BY `kind` -- each kind carries only the
 * numbers ITS sentence needs, and `attrNoteText` is the ONE place a kind becomes prose.
 *
 * ⚠️ THE THREE KINDS MEAN DELIBERATELY DIFFERENT THINGS AND MUST NOT BE COLLAPSED:
 *   upgrade   -> WE OVERRODE YOU. The stated rung cannot hold the contents, so a bigger one is priced.
 *   capped    -> WE OVERRODE YOU. More blankers were asked for than the plate has SPARE modules.
 *   uncovered -> WE USED YOUR NUMBER. Fewer blankers than spare modules; the rest stay uncovered.
 * The first two are physical impossibilities and are corrected; the third is merely untidy and is
 * HONOURED. That asymmetry is the owner's ruling and is why `uncovered` must never borrow the
 * override wording.
 */
export type AttrNote =
  | ({ kind: "upgrade" } & AttrUpgradeNote)
  | ({ kind: "rating_up" } & AttrRatingUpNote)
  // F-25 SLICE 2 -- the two things a bare box's size field must say (owner 2026-09-07):
  //   assumed -> WE GUESSED. Nothing readable stated the box's module size, so the declared default
  //              (3M) was priced. THE MOST IMPORTANT NOTE OF THE SLICE: a defaulted 3M on a row whose
  //              text says 8M is a finished-looking price 184 rupees short, and nothing else on screen
  //              would distinguish it. Neither existing kind can carry it: `upgrade` is module-shaped
  //              around a STATED rung, and the amber `default` badge reads the EXTRACTION flag, which
  //              a pipeline value never carries.
  //   size_up -> WE MOVED YOU UP. The stated count has no exact rung on the box ladder, so the next
  //              stocked size was priced (9 -> 12M). `upgrade`'s sentence ("holds N; contents occupy
  //              M") is about capacity vs contents and would read as nonsense here; `rating_up` is
  //              amp-shaped. Both are corrections, so both sit in the "what is priced" half of the
  //              render order.
  | { kind: "assumed"; assumed: number; using: string }
  | { kind: "size_up"; asked: number; using: string }
  // F-25 SLICE 3 (owner 2026-09-08, "agree" on raising to the PLATE's size):
  //   plate_floor -> WE OVERRODE YOU. The pricer picked a back box SMALLER than the face plate, so
  //                  the plate's size was priced. `upgrade` cannot carry it: its sentence is
  //                  contents-shaped ("holds N; contents occupy M") and a plate-driven raise would
  //                  read "3M holds 3 modules; contents occupy 3 -- using 6M", which explains
  //                  nothing. A contents-driven raise (no plate) DOES use `upgrade`, verbatim.
  | { kind: "plate_floor"; picked: string; plate: string; using: string }
  // WIDTH DROPDOWN (owner 2026-09-10, "show the fitted value with a brief note"):
  //   fit_up -> WE MOVED YOU UP, on a plain catalogue SIZE. A stored number is not one the catalogue
  //             stocks, so `catalog_fit` priced the next size up (a tray width of 80 -> 100). Neither
  //             existing hop kind can carry it: `size_up` bakes the module suffix into its sentence
  //             ("No 80M in the catalogue") and `rating_up` is amp-shaped and needs a device word.
  //             The field itself shows the FITTED value (the dropdown can only show a stocked size),
  //             so this note is the one place the row's own number survives on screen. A direct pick
  //             and an exact hit carry no note -- there is nothing to raise from.
  | { kind: "fit_up"; stated: number; using: string }
  // TWO WAYS (owner 2026-09-10, "left blank in the helper panel for the user to decide rather than
  // silently picking up a wrong thickness ... we can have a note explaining"):
  //   no_match -> NOTHING WAS PRICED, and here is why. The row states a value that has no stocked
  //               match -- a width above the top rung, a gauge the conversion table does not carry, a
  //               millimetre not stocked -- so the field is left BLANK for the pricer. Every other kind
  //               says what was priced INSTEAD; `assumed` is the nearest in subject and the opposite in
  //               meaning (WE GUESSED). This is the first note that rides a blank field.
  //               `stated` is the row's own words ("2.5", "1500", "8 SWG (4.1 mm)"), `field` the def
  //               label, `stocked` the list the value was checked against.
  | { kind: "no_match"; stated: string; field: string; stocked: string }
  | { kind: "capped"; stated: number; spare: number }
  | { kind: "uncovered"; stated: number; spare: number; uncovered: number };

/**
 * F-30 slice A (owner ruling 2, 2026-09-05) -- WE OVERRODE YOU, on the RATING. The server-side
 * poles-plus-neutral ladder counted a stated neutral into the next pole (SPN -> 2 pole, TPN -> 4 pole)
 * and found that pole NOT STOCKED at the stated amp on that curve, so it priced the next rating UP.
 * A fourth kind rather than a reuse of `upgrade`: that kind's payload is module-shaped (holds /
 * occupies) and its sentence says so; this one is amp-shaped. Both are corrections, so both sit in
 * the "what is priced" half of `ATTR_NOTE_ORDER`, ahead of the quantity notes.
 * Carried as DATA (numbers + the words the catalogue row supplies) so the sentence lives in ONE place.
 */
export interface AttrRatingUpNote {
  /** The amp the row STATED. */
  askedAmp: number;
  /** The amp actually priced -- the next one the catalogue stocks at that pole and curve. */
  usedAmp: number;
  /** The pole in a pricer's words ("2 pole", "4 pole"), from the priced row's catalogue attributes. */
  poleWord: string;
  /** The device word from the priced row ("MCB"). */
  device: string;
  /** The curve letter, unchanged by the ladder -- it is named so the pricer sees it was HELD. */
  curve: string;
}

/** The catalogue's four pole codes in a pricer's words; anything else passes through unchanged. */
export const POLE_WORDS: Readonly<Record<string, string>> = { SP: "single pole", DP: "2 pole", TP: "3 pole", FP: "4 pole" };

/**
 * RENDER ORDER, declared rather than incidental.
 *
 * Two notes on one field must render deterministically, and push order is an implementation accident
 * -- it changes the moment a producer is reordered, silently and with no test able to see it. The
 * order is WHAT IS PRICED FIRST, THEN HOW MUCH OF IT: an `upgrade` changes WHICH rung the row buys,
 * and `capped` / `uncovered` change HOW MANY fillers go in it, so the size has to be settled before
 * the count reads sensibly. `capped` and `uncovered` are mutually exclusive by construction (a stated
 * count is either above the spare or below it, never both), so their relative order never arises.
 */
// F-25 slice 2: `assumed` (why THIS count) precedes `size_up` (how it was fitted); both precede the
// quantity notes because they settle WHICH rung is priced.
// F-25 slice 3 (owner 2026-09-08): `plate_floor` sits directly after `upgrade` -- both are
// module-shaped corrections of WHICH rung is bought, and a plate-driven raise is the pick's own
// upgrade. Six -> seven, registered rather than incidental.
// TWO WAYS (2026-09-10): `no_match` joins after `fit_up` -- a blank field has nothing "priced instead" to
// precede, so it sits with the substitutions and ahead of the quantity notes.
export const ATTR_NOTE_ORDER: readonly AttrNote["kind"][] = ["upgrade", "plate_floor", "rating_up", "assumed", "size_up", "fit_up", "no_match", "capped", "uncovered"];

/** PURE. Notes in `ATTR_NOTE_ORDER`. A STABLE sort, so two notes of one kind keep producer order. */
export function sortAttrNotes(notes: AttrNote[]): AttrNote[] {
  return [...notes].sort(
    (a, b) => ATTR_NOTE_ORDER.indexOf(a.kind) - ATTR_NOTE_ORDER.indexOf(b.kind),
  );
}

/** The numbers behind a take-the-larger UPGRADE, carried as DATA so each surface words it itself. */
export interface AttrUpgradeNote {
  /** The rung the row STATED (a catalog label, e.g. "1M & 2M"). */
  stated: string;
  /** How many modules that stated rung can hold. */
  statedHolds: number;
  /** How many modules the row's contents occupy. */
  occupied: number;
  /** The rung actually priced. */
  using: string;
}

/**
 * PURE. The panel's warning for a too-small stated entry. It NAMES BOTH NUMBERS and what is being
 * priced, because "the arithmetic underneath is correct" is not a defence of a field that appears to
 * ignore the user. The derivation trace already prints UPGRADED -- but the trace is a separate
 * surface a pricer may never open, so the sentence has to live on the form.
 */
export function upgradeWarningText(u: AttrUpgradeNote): string {
  return `${u.stated} holds ${u.statedHolds} module${u.statedHolds === 1 ? "" : "s"}; contents occupy ${u.occupied} — using ${u.using}.`;
}

/**
 * PURE. One note's sentence. The ONE place a note kind becomes prose, so the panel renders notes it
 * does not have to understand.
 *
 * ⚠️ THE `upgrade` CASE DELEGATES to `upgradeWarningText` rather than restating it. That function is
 * SHIPPED and its wording is pinned; copying the template here would make the migration's inertness a
 * claim to re-verify on every future edit instead of a property of the code. Delegation makes the two
 * byte-identical BY CONSTRUCTION.
 *
 * ⚠️ `capped` and `uncovered` are worded to be unmistakable for one another. `capped` says what was
 * PRICED INSTEAD (an override); `uncovered` says what the row's own number LEAVES BEHIND (a
 * consequence). Neither borrows the other's verb -- an honoured value described as a correction is
 * the defect this whole mechanism exists to prevent.
 */
export function attrNoteText(n: AttrNote): string {
  switch (n.kind) {
    case "upgrade":
      return upgradeWarningText(n);
    case "rating_up":
      // Names what was asked for, why it could not be used, and what was used instead -- the
      // face-plate shape ("... holds 2 modules; contents occupy 3 — using 3M."), amp-shaped.
      return `No ${n.poleWord} ${n.device} at ${n.askedAmp}A on the ${n.curve} curve — using ${n.usedAmp}A.`;
    case "assumed":
      // F-25 slice 2 -- WE GUESSED, and the pricer must be told to look. Names what was priced and
      // that nothing stated the size.
      // Calculator slice 1 (owner 2026-09-08, "ok. reword"): the sentence used to name WHERE we looked
      // ("in the row or its headings"). The same panel now serves a surface with no row, so it says
      // only what is true on both: no size was STATED. On a BoQ row that is still exactly the case --
      // the extractor read the row and its headings and found none.
      return `No module size stated — assumed ${n.assumed}M. Check it.`;
    case "size_up":
      // F-25 slice 2 -- the rating_up shape, module-sized: what was asked, why, what was used.
      return `No ${n.asked}M in the catalogue — using ${n.using}, the next size up.`;
    case "plate_floor":
      // F-25 slice 3 -- WE OVERRODE YOU, on the box: what was picked, why it could not be used (the
      // face plate is bigger), what was used instead. The one place this sentence lives.
      return `${n.picked} is smaller than the ${n.plate} face plate — using ${n.using}.`;
    case "fit_up":
      // Width dropdown -- WE MOVED YOU UP on a catalogue size: what the row stated, what was priced,
      // why. The owner's own wording ("the row states 80 - using 100, the next size stocked").
      return `The row states ${n.stated} — using ${n.using}, the next size stocked.`;
    case "no_match":
      // TWO WAYS -- NOTHING WAS PRICED: what the row stated, what it was checked against, and that
      // the decision is the pricer's. The one place this sentence lives.
      return `The row states ${n.stated} — nothing stocked matches for ${n.field} (${n.stocked}); left blank for you to decide.`;
    case "capped":
      return (
        `${n.spare === 0 ? "No" : n.spare} spare module${n.spare === 1 ? "" : "s"} on this plate; ` +
        `${n.stated} will not fit — pricing ${n.spare}.`
      );
    case "uncovered":
      return (
        `${n.uncovered} module${n.uncovered === 1 ? "" : "s"} will be left uncovered ` +
        `(${n.spare} spare, ${n.stated} blanked).`
      );
  }
}

/**
 * PURE. What the field SHOWS.
 *
 * ⚠️ SLICE 2d NARROWED THIS CONTRACT BY OWNER RULING, and the old sentence is recorded here because
 * the change is easy to read as a regression. It used to say, flatly, that a stated value "must never
 * be overwritten on screen". That was right while the only alternative was hiding the pricer's entry
 * behind a number they could not see -- but it made the TAKE-THE-LARGER upgrade case dishonest: the
 * row states 1M, the pipeline buys 3M, and the field showed 1M. The rule is now split by WHO WON:
 *
 *   readOnly (fully superseded)   -> the COMPUTED value, always.
 *   stated AND SUBSTITUTED        -> WHAT WAS BOUGHT, marked "(computed)" and explained by the note.
 *                                    The pipeline overrode the entry, so showing the entry would name
 *                                    a size the row is not being charged for.
 *   stated AND USED               -> the STATED value. Untouched -- this half of the old rule stands.
 *   blank + derived               -> the COMPUTED value.
 *
 * The narrowing is exact: a stated value the pipeline USED is still never overwritten.
 */
export function attrDisplayValue(
  a: Pick<WorkingsAttribute, "value" | "derived" | "derivedValue" | "readOnly" | "substituted">,
): string {
  if (a.readOnly) return a.derivedValue ?? "";
  if (a.substituted && a.derivedValue !== undefined) return a.derivedValue;
  if (a.value !== "") return a.value;
  return a.derived ? a.derivedValue ?? "" : "";
}

/**
 * PURE. Is the value on screen the PIPELINE's rather than the row's? Drives the "(computed)" marker.
 *
 * ⚠️ SLICE 2d, OPTION B: the marker now means "something was SUBSTITUTED OR INFERRED", not merely
 * "the row left this blank". A `catalog_fit` that hit its ladder exactly on facts the row STATED has
 * computed nothing the row did not already say, so it renders PLAIN -- and a step that hopped a
 * ladder, inferred a pole or took a default renders "(computed)" even when the row said nothing.
 * `substituted` is the step's own verdict where it publishes one; where it does not, the pre-2d
 * blank-and-derived rule stands, so every other mechanism is unchanged.
 */
export function isShowingDerived(
  a: Pick<WorkingsAttribute, "value" | "derived" | "derivedValue" | "readOnly" | "substituted">,
): boolean {
  if (a.readOnly) return a.derivedValue !== undefined;
  if (a.derivedValue === undefined) return false;
  if (a.substituted !== undefined) return a.substituted;
  return !!a.derived && a.value === "";
}

/**
 * U2 -- the two per-attribute HIGHLIGHT predicates, pure so they are unit-testable in the node env
 * (component render is not). They encode a THREE-WAY distinction that must not be collapsed:
 *
 *   BLANK              value === ""      the AI could not read it / a manual row -> RED border, needs filling
 *   DEFAULTED          defaulted === true  filled from a config default, not read -> AMBER, worth checking
 *   POSITIVELY ABSENT  value === "None" (NONE_SENTINEL) or `disabled` (its controller is None)
 *                                       -> NEITHER highlight. This is a DECISION, not a gap; flagging it
 *                                          as missing would be wrong.
 *
 * DERIVED DISPLAY adds a FOURTH state, and it exempts the red border for the same reason the helper's
 * missing-attribute gate already exempts it (owner-locked): AN ATTRIBUTE THE PIPELINE DERIVES IS NEVER
 * MISSING USER INPUT. The gate stopped REFUSING these rows, but the field kept rendering red -- so the
 * form still said "incomplete" about a row that priced. One predicate, so the two can no longer differ.
 */
/**
 * F4b -- does a GROUP HEADER render above the attribute at `i`? PURE.
 *
 * The rule is CHANGE-DETECTION over the rendered order, which is what makes the capability general:
 * consecutive attributes sharing a label are one group, a category declaring no label never gets a
 * header, and a config may declare several groups without registering anything.
 *
 * ⚠️ IT LIVES HERE, EXPORTED, BECAUSE THIS PROJECT HAS NO DOM TEST ENVIRONMENT (see
 * `frontend/CLAUDE.md`): a header rendered inline in `RateHelperPanel` would be structurally
 * untestable. Extracting the DECISION keeps the one thing that can be got wrong under test, while
 * the panel keeps only the markup.
 *
 * ⚠️ It reads the RENDERED list, not the config. Attributes hidden from the panel (`panel: false`)
 * are already absent here, so a hidden definition sitting inside a group cannot split it in two.
 */
export function startsAttributeGroup(
  attrs: ReadonlyArray<Pick<WorkingsAttribute, "groupLabel">>,
  i: number,
): boolean {
  const label = attrs[i]?.groupLabel;
  if (!label) return false;
  return label !== attrs[i - 1]?.groupLabel;
}

export function isAttrBlank(a: Pick<WorkingsAttribute, "value" | "disabled" | "derived">): boolean {
  return !a.disabled && !a.derived && a.value === "";
}
export function isAttrDefaulted(a: Pick<WorkingsAttribute, "disabled" | "defaulted">): boolean {
  return !a.disabled && a.defaulted === true;
}

/** One row's AI-extracted attributes from a suggestion run (RM-3). The value is null when the AI
 * could not determine it (honest partial); confidence is per-attribute; corroborated is the
 * display-only regex-agreement tick. */
export interface ExtractedAttr {
  value: string | number | null;
  confidence: number;
  corroborated?: boolean;
  /** EA-4a: the server filled this from the category config's `extraction_defaults` because the row text
   * gave no positive identification. It ALWAYS arrived on the wire; U2 declares it so the helper can carry
   * it onto the per-attribute contract instead of reading it through an undeclared cast. */
  defaulted?: boolean;
  /** F-30 slice A: the server-side poles-plus-neutral ladder's record for THIS attribute, stamped only
   * when it has something to say beyond a plain same-amp swap -- a rung-1 hit (`rung: 1`), a rating
   * moved UP (`amp_moved_up`), or a blank with its `reason`. `to` is the catalogue item name priced. The
   * helper turns `amp_moved_up` into a `rating_up` note; the other shapes carry no panel text yet. */
  pole_ladder?: {
    to?: string | null;
    rung?: number;
    reason?: string;
    amp_moved_up?: { from: number; to: number };
  };
}
export interface ExtractionRow {
  excelRow: number;
  description?: string;
  attributes: Record<string, ExtractedAttr>;
}

/** One LABELLED group of workings (RM-3a). Lets a helper split a suggestion into visually distinct
 * blocks (e.g. Cable vs Termination) that the panel renders each as its OWN section (header + own
 * derivation + own final values). DISPLAY-ONLY: the applied value still comes from Suggestion.values,
 * never a group's finals. */
export interface WorkingsGroup {
  /** Section header shown above the block (e.g. "Cable -- per Mtr"). */
  label: string;
  /** Derivation lines for THIS group, one string per line. */
  derivation: string[];
  /** This group's OWN final values (display-only), keyed by the helper's output/label name. */
  finals: Record<string, number>;
  /**
   * Calculator slice 1 (owner 2026-09-08, verbatim: "for such catgeories which price 2 or more things
   * at once, supply install and combined (spply + install) should be mentioned for each"; and for a
   * single-line category, "show the same three figures -- yes"). THIS GROUP'S OWN three figures,
   * keyed by rate kind: `supply_rate` / `install_rate` / `combined_rate`, where combined is THIS
   * LINE's supply + THIS LINE's install and nothing else. A kind the line did not produce is ABSENT
   * (the panel renders its em dash) -- never 0, never borrowed from another group.
   *
   * ⚠️ NEVER A TOTAL ACROSS LINES. Cable is per Mtr and termination per Set; every entry is computed
   * by `groupFigures` over ONE group's `finals`, so no code path can add two groups. DISPLAY-ONLY:
   * `values` (what "Use this value" applies) is untouched by this field -- the `headlines` scope
   * guard, applied one level down.
   *
   * ABSENT (an older producer, or a group that priced nothing) => the panel renders three em dashes.
   */
  figures?: Partial<Record<RateKind, number>>;
  /** Optional group-scoped matched-row line(s). */
  matchedRows?: string[];
  /** Optional group-scoped attributes (unused this slice; SHARED attrs live on WorkingsSection). */
  attributes?: WorkingsAttribute[];
}

/** The STRUCTURED workings a Suggestion carries -- rendered generically by the panel. */
export interface WorkingsSection {
  /** Editable attributes; a change re-runs compute with the edited values. */
  attributes: WorkingsAttribute[];
  /** The matched-row line(s) -- what the helper matched against (human-readable). */
  matchedRows: string[];
  /** Derivation lines -- how the value was reached, one string per line. */
  derivation: string[];
  /** The final computed value per rate-kind (the panel pre-fills the final-value field from this). */
  finalValues: Partial<Record<RateKind, number>>;
  /** RM-3a: when present (>= 1), the panel renders these LABELLED groups (each its own block) INSTEAD
   * of the flat matchedRows/derivation; the shared `attributes` above still render ONCE above the
   * groups. ABSENT => flat rendering, byte-identical to pre-RM-3a -- so single-group suggestions stay
   * backward-shaped (the pricing-sheet helper omits `sections` on termination rows). */
  sections?: WorkingsGroup[];
}

/**
 * The three rate kinds a priced line shows, in RENDER ORDER (owner: supply, install, combined -- the
 * same three on every line, a missing one as an em dash rather than hidden). Declared once so the
 * panel and any later surface (the calculator) iterate the same list in the same order.
 */
export const DISPLAY_RATE_KINDS: readonly RateKind[] = ["supply_rate", "install_rate", "combined_rate"];

/**
 * PURE. The text a copy control puts on the clipboard for a figure: THE BARE NUMBER (owner 2026-09-08,
 * verbatim: "bare number"). No currency symbol, no thousands separator, no unit -- `String(v)`, so
 * 1490 -> "1490" and 187.2 -> "187.2", exactly what the figure reads. The one place this rule lives.
 */
export function bareNumberText(v: number): string {
  return String(v);
}

/** A helper produced a suggestion. */
export interface Suggestion {
  kind: "suggestion";
  /** Suggested value per rate-kind. A kind absent here => this helper has no COMPUTED value for
   * that kind yet (e.g. a partial extraction missing an attribute). */
  values: Partial<Record<RateKind, number>>;
  /** The rate-kinds this helper CAN price for the row (even when the current value is missing due
   * to a partial extraction) -- so a partial row still BADGES (the pricer opens the panel to
   * complete it). Absent => fall back to `values` for badge counting (the two dead helpers). */
  producibleKinds?: RateKind[];
  /** 2026-08-22 (owner Ruling A + C): when a helper prices a row through MORE THAN ONE pipeline and
   * the pricer must see each figure separately, it publishes one entry per block here and the panel
   * renders them STACKED in the collapsed header, one line per entry, label then figure.
   *
   * ⚠️ DISPLAY-ONLY, and the ONE reason this field exists rather than a rule the panel could infer:
   * `sections.length >= 2` is NOT a usable signal -- cabletray_raceway, db_switchgear,
   * industrial_sockets and point_wiring all emit two sections too, so inferring from structure would
   * hand them a second headline as well. Only the helper knows its figures are DIFFERENT UNITS that
   * must never be added (wiring: cable per_mtr vs termination per_set), so only the helper may ask
   * for the stacked treatment.
   *
   * ⚠️ IT MUST NEVER FEED `values`. "Use this value" keeps reading `values[kind]` -- the PRIMARY
   * pipeline's figure -- exactly as before (owner Ruling B). A `kind` absent from an entry's `values`
   * renders the panel's existing em dash; it is never a zero and never borrowed from the other entry.
   *
   * ABSENT => the panel renders its single headline exactly as it always has, so every category that
   * does not set this is byte-unchanged. */
  headlines?: { label: string; values: Partial<Record<RateKind, number>> }[];
  /** One-line basis (what the suggestion rests on). */
  basis: string;
  workings: WorkingsSection;
}

/** A helper declined -- with an honest reason (rendered greyed). */
export interface NoSuggestion {
  kind: "none";
  reason: string;
}

export type HelperResult = Suggestion | NoSuggestion;

/** The per-row context handed to every helper. Sourced from the page's existing data (the grid row +
 * categoriesByExcelRow) -- no new fetch. */
export interface RateHelperRowContext {
  /** Durable Excel row number (source_row_number) -- the identity, never a window index. */
  excelRow: number;
  description: string;
  nodeType: string;
  /** Resolved effective category id for the row (from categoriesByExcelRow), or null. */
  category: string | null;
  /** Resolved discipline for the row (from categoriesByExcelRow), or null. */
  discipline: string | null;
  /** The rate-kinds present on this row's rate cells (derived from the row's rate descriptors). */
  rateKinds: RateKind[];
}

/** A registered rate helper. `compute` is PURE + synchronous.
 * `attrOverrides` lets the panel re-run the helper with edited attribute values (live recompute);
 * the first call (no overrides) returns the helper's default suggestion + default attributes. */
export interface RateHelper {
  id: string;
  label: string;
  compute(ctx: RateHelperRowContext, attrOverrides?: Record<string, string>): HelperResult;
}

export function isSuggestion(r: HelperResult): r is Suggestion {
  return r.kind === "suggestion";
}

/** Per rate-cell badge state (page-session only, never persisted). `count` = how many helpers
 * suggest a value for this cell's kind (the chip number); `used` = a suggested value has been
 * applied to this cell this session (chip -> check). */
export interface SuggestionCell {
  count: number;
  used: boolean;
}

/** A row's badge state, keyed by the rate cell's Excel column letter. This is the ONLY per-row
 * value the grid receives for the feature -- compared BY VALUE in the row comparator (P1 memo
 * shield), so a rebuild of the whole Map only re-renders the rows whose entry actually changed. */
export interface RowSuggestions {
  byCol: Record<string, SuggestionCell>;
}

/** Value-equality for a row's RowSuggestions entry (the row comparator uses this so an unchanged
 * row bails even when the page rebuilds the Map). Two absent entries are equal. */
export function rowSuggestionsEqual(a?: RowSuggestions, b?: RowSuggestions): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a.byCol);
  const bk = Object.keys(b.byCol);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const ca = a.byCol[k];
    const cb = b.byCol[k];
    if (!cb || ca.count !== cb.count || ca.used !== cb.used) return false;
  }
  return true;
}
