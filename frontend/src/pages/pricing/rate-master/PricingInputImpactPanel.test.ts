/**
 * SLICE 12b(B) -- the impact panel, the ITEMS column and the page wiring.
 *
 * ⚠️ SOURCE PINS, BY NECESSITY. There is NO DOM test environment in this repo
 * (`frontend/CLAUDE.md`), so a component's rendering cannot be asserted -- only its source can. The
 * ARITHMETIC lives in `pricingInputImpact.ts` and is tested properly there; what these pins protect is
 * the set of decisions that are invisible to a pure test and would otherwise be silently reversible:
 * the panel being a flex sibling rather than an overlay, the count being distinct SKUs, nothing being
 * written until Save, and the column only existing where the page opted in.
 *
 * The precedent is `RateHelperPanel.test.ts`, which does exactly this for the same reason.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { IMPACT_PANEL_WIDTH, IMPACT_COPY } from "./PricingInputImpactPanel";
import { NOT_MOVED_NOTE } from "./pricingInputImpact";

const read = (f: string) => fs.readFileSync(path.join(__dirname, f), "utf-8");
const PANEL = read("PricingInputImpactPanel.tsx");
const VIEWER = read("RateMasterDataViewer.tsx");
const PAGE = read("RateMasterPage.tsx");
const REACH = read("pricingInputReach.ts");

describe("SLICE 12b(B) -- the impact panel's shape", () => {
  it("is 470px, the width the owner ruled", () => {
    expect(IMPACT_PANEL_WIDTH).toBe(470);
    expect(PANEL).toContain("style={{ width: IMPACT_PANEL_WIDTH }}");
  });

  it("⚠️ NEGATIVE: it is a FLEX SIBLING, never a Sheet -- 'beside the table, not covering it'", () => {
    // `components/ui/sheet.tsx` OVERLAYS, which is the thing the owner ruled out. The panel must
    // occupy real layout width so the table narrows instead of being hidden.
    // ⚠️ assert on the IMPORT, not the text: the panel's own comment NAMES sheet.tsx in order to say
    // why it is not used, and a substring check on that comment would fail for the right reason stated.
    expect(PANEL).not.toMatch(/from "@\/components\/ui\/sheet"/);
    expect(PANEL).not.toMatch(/<Sheet[\s>]/);
    expect(PANEL).toContain("<aside");
    // and the PAGE puts it in a flex row beside the viewer, not on top of it
    expect(PAGE).toContain('<div className="flex items-start gap-3">');
    expect(PAGE).toContain("<PricingInputImpactPanel");
  });

  it("opens on the ITEMS count and closes by toggling the same count", () => {
    expect(VIEWER).toContain("onOpenImpact?.(");
    expect(VIEWER).toContain("openImpactUid === r.it.item_uid ? null :");
  });

  it("ACCEPTANCE 9: each category group has its OWN scroll box, and the counter reads N of M", () => {
    expect(PANEL).toContain('g.rows.length > 8 && "max-h-[340px] overflow-y-auto"');
    expect(PANEL).toContain("${shown} of ${total}");
    expect(PANEL).toContain('data-testid="impact-search"');
    expect(PANEL).toContain('data-testid="impact-count"');
  });

  it("ACCEPTANCE 10: the four columns, and the leg is NAMED in the header", () => {
    for (const h of [">Item<", ">now<", ">becomes<", ">change<"]) expect(PANEL).toContain(h);
    // the leg label comes from the pure module, so the panel cannot invent a different one
    expect(PANEL).toContain("impact.legLabel");
  });

  it("ACCEPTANCE 10: Save is DISABLED until something changes, and Cancel restores", () => {
    expect(PANEL).toContain("disabled={!impact.changed || saving}");
    expect(PANEL).toContain("onClick={() => { setEdited({}); setError(null); }}");
  });

  it("⚠️ NOTHING IS WRITTEN WHILE TYPING -- the only write is inside the Save handler", () => {
    // `onSave` must appear exactly once outside the prop declaration: in `doSave`. A second call site
    // would mean an edit could reach the database without Save being pressed.
    const calls = PANEL.match(/await onSave\(/g) ?? [];
    expect(calls).toHaveLength(1);
    // the field handler only ever touches local state
    const setField = PANEL.slice(PANEL.indexOf("const setField ="), PANEL.indexOf("const valueOf ="));
    expect(setField).toContain("setEdited(");
    expect(setField).not.toContain("onSave");
  });

  it("ACCEPTANCE 11: the working names both legs, highlights only the CHANGED parameter, shows 'was'", () => {
    expect(PANEL).toContain('data-testid="impact-verdict"');
    expect(PANEL).toContain("Where each number comes from");
    // the changed field is amber; an unchanged one is plain blue -- never both, never neither
    expect(PANEL).toContain("isDirtyField(k)");
    expect(PANEL).toContain("bg-amber-100");
    expect(PANEL).toContain("— was ${");
    expect(PANEL).toContain(IMPACT_COPY.back);
  });

  it("the amber line says it is a PREVIEW, and says the opposite when nothing is edited", () => {
    expect(IMPACT_COPY.preview).toContain("nothing is saved until you press Save");
    expect(IMPACT_COPY.unchanged).toContain("as they stand today");
    expect(PANEL).toContain("impact.changed ? IMPACT_COPY.preview : IMPACT_COPY.unchanged");
  });

  it("⚠️ N-1: the panel states that a ROW is rounded, so its per-SKU figure is not mistaken for one", () => {
    // the per-SKU number is UNROUNDED by ruling; the row's own change differs because the row is
    // rounded once at the end (measured: 13.0%-17.8% over 136 switchgear SKUs against a flat 16.667%)
    expect(IMPACT_COPY.rowRounding).toContain("rounded once at the end");
    expect(PANEL).toContain("IMPACT_COPY.rowRounding");
  });

  /**
   * ⚠️ INVERTED (owner ruling, 2026-09-29). The adder's panel used to render ONE SENTENCE and no
   * rows. The owner's rule is whose PRICE moves: an adder moves all 450 trays, so it lists them --
   * as rate PLUS adder, with the condition it applies under stated beneath.
   */
  it("a FLAT ADDER lists its SKUs like every other shape, as an addition, with its condition", () => {
    expect(IMPACT_COPY.flatAdder).not.toContain("no SKU rate is listed");
    expect(IMPACT_COPY.flatAdder).toContain("not multiplied");
    // the "not moved" note stays, and stays TRUE: no SKU's stored rate is scaled by an adder --
    // which is a different claim from "no SKU is listed", the one that was wrong.
    expect(NOT_MOVED_NOTE.flat_adder).toContain("added to the row");
    expect(NOT_MOVED_NOTE.flat_adder).not.toContain("listed");
    // the list is no longer behind a shape test -- nothing suppresses it
    expect(PANEL).not.toContain('{IMPACT_COPY.flatAdder}');
    expect(PANEL).toContain("NO SHAPE SUPPRESSES THE LIST");
    expect(PANEL).toContain("adderConditionText");
  });

  it("N-7 NEGATIVE: no category ID reaches the screen -- every label goes through the resolver", () => {
    expect(PANEL).toContain("categoryLabel(");
    expect(PAGE).toContain("categoryLabel={categoryDisplayName}");
    // the resolver prefers the config's own display name, then the registry, and only then the id
    expect(PAGE).toContain("?.category_display");
  });

  it("a non-admin gets the panel READ-ONLY -- the controls are absent, not merely disabled", () => {
    expect(PANEL).toContain("{canEdit ? (");
    expect(PAGE).toContain("canEdit={isAdmin && !writesBlocked}");
  });
});

describe("SLICE 12b(B) -- the ITEMS column", () => {
  it("ACCEPTANCE 8: it shows DISTINCT SKUs and is clickable", () => {
    expect(VIEWER).toContain('data-testid="pi-items-count"');
    expect(VIEWER).toContain("r?.distinctSkus.length");
  });

  it("⚠️ NEGATIVE: it is NOT the used_by site count -- those correlate with nothing", () => {
    // measured on v65: tray_supply is 1 site / 450 SKUs; conduit is 10 sites / 8 SKUs
    const start = VIEWER.indexOf("const impactCountFor");
    const body = VIEWER.slice(start, VIEWER.indexOf("[inputReach],", start));
    expect(body).toContain("distinctSkus.length");
    expect(body).not.toContain("used_by");
  });

  /**
   * ⚠️ INVERTED (owner ruling, 2026-09-29). The dash said "this moves no SKU rate", which is true of
   * the RATE and false of the PRICE. An adder counts like every other input.
   */
  it("a FLAT ADDER counts its SKUs like every other input -- no dash special case", () => {
    expect(VIEWER).not.toContain("if (r?.isFlatAdder) return \"—\";");
    expect(VIEWER).toContain("AN ADDER COUNTS LIKE EVERY OTHER INPUT");
  });

  it("⚠️ NEGATIVE: the column is ABSENT unless the page opted in, so every other grid is unchanged", () => {
    expect(VIEWER).toContain("const showImpactCol = piMode && !!onOpenImpact && !!inputReach;");
    // every render site is gated on it -- header, colgroup and body
    expect((VIEWER.match(/showImpactCol \?/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("SLICE 12b(B) -- the page's config load", () => {
  it("reuses the SHARED N-fetch plumbing rather than minting a second fetcher", () => {
    expect(PAGE).toContain("RATE_MASTER_CONFIG_TARGETS");
    expect(PAGE).toContain("RateConfigFetcher");
    expect(PAGE).toContain("useConfigsByCategory");
    expect(PAGE).toContain("rateHelperPlumbing");
  });

  it("⚠️ the fetchers mount ONLY on the Pricing Inputs category -- no other grid pays for them", () => {
    expect(PAGE).toContain("isPricingInputConfig(config)\n              ? RATE_MASTER_CONFIG_TARGETS");
  });

  it("the reach walk is memoised on [configs, items], not recomputed per render", () => {
    expect(PAGE).toContain("const inputReach = useMemo(");
    expect(PAGE).toContain("[allConfigs, items],");
  });
});

describe("SLICE 12b(B) -- the reach walk's three measured invariants are documented in the module", () => {
  it("records WHY provenance, narrowing and install_as_ratio each matter, with the measured numbers", () => {
    // these comments are the only place the wrong answers are written down; a future reader who
    // "simplifies" the walk needs to find the reason it is not simple.
    expect(REACH).toContain("PROVENANCE, NOT THE CONSUMING STEP");
    expect(REACH).toContain("A COLUMN IS NARROWED, NOT JUST TYPED");
    expect(REACH).toContain("install_as_ratio` CARRIES NO `target`");
    expect(REACH).toContain("163");   // the switchgear over-count
    expect(REACH).toContain("292");   // the cable over-count
  });
});
