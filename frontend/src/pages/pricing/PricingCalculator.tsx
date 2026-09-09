/**
 * Calculator slice 2 (2026-09-09) -- THE PRICING CALCULATOR SCREEN.
 *
 * Owner (2026-09-08, verbatim): "create a new tab beside the excel screen"; "calculator lays out its
 * own screen. functionally it should be excatly same with the helper"; "it can be used by multiple
 * users simultaneously"; on the tab switch releasing the sheet's lock: "release"; on warning first:
 * "Don't warn. - no work is lost".
 *
 * WHAT THIS IS: a category dropdown, that category's fields (all starting BLANK), and a price panel.
 * WHAT IT IS NOT: it reads NO BoQ, no row, no run; it saves nothing; it takes no lock; it has no
 * "Use this value" (there is no cell to write to); it shows no BCS figure; it mounts no stub cards.
 *
 * ⚠️ THE HELPER IS CONSTRUCTED, NOT COPIED. `makePricingSheetHelper({ configsByCategory, items,
 * extractionByRow: new Map() })` -- the SAME factory the BoQ panel calls, on the SAME configs and
 * items (the shared plumbing), with an EMPTY extraction map so every row is a manual row; the user's
 * picks reach `compute` as `overrides` through the SAME `RateHelperPanel` the BoQ editor mounts. There
 * is NO second arithmetic and NO second render of a figure anywhere in this file: it decides which
 * category, hands the panel a sentinel row context, and gets out of the way. That construction, not a
 * test, is what makes "the same value for the same attributes at all times" a property.
 *
 * ⚠️ THE PARKED SHAPE IS REPRODUCED, NOT FIXED (owner 2026-09-09: "let it be for now ... we will fix
 * both calvulator and helper later together"). On the split-pipeline categories (point_wiring,
 * cabletray_raceway, industrial_sockets) the panel renders two blocks each showing one figure and two
 * em dashes; this screen shows exactly that, because it renders the same panel. The owner's corrected
 * intent -- one line per THING PRICED (cable and termination are two things; a category's supply and
 * install halves are one thing) -- is recorded in the plan doc for the day both surfaces move together.
 *
 * ⚠️ Units are NOT ruled. Wiring's two `pipeline_labels` are the only units that exist; nothing is added.
 *
 * CALCULATOR LAYOUT SLICE (owner 2026-09-09) -- LAYOUT ONLY, no engine change. Owner, verbatim:
 *   "the grid has expanded too much and its difficult to assciate the field labels with the boxes."
 *   "pricing show n in top is better. but we need to keep a separate block for it. we just put these
 *    bl;ocks at the top and maybe side by side and not one below the other. we can show in 1*2 grid
 *    per row which then gets repeated as required if therie are more than 2 blocks."
 *   "empty blocks at the top" / "split as per order" /
 *   "can we make the column layout dynamic so that it renders 1/2/3 column as required."
 * This screen decides TWO numbers and hands them to the shared panel's `calculator` variant: the
 * block labels the category WILL produce (known from its config before anything prices) and the
 * column count for its fields (content sets the maximum, width may only reduce it). The panel
 * arranges; nothing here reads a figure.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RATE_MASTER_DISCIPLINES } from "./rate-master/rateMasterRegistry";
import type { RateCategoryConfig } from "./rate-master/rateMasterTypes";
import {
  RATE_MASTER_CONFIG_TARGETS,
  RateConfigFetcher,
  useConfigsByCategory,
  useRateMasterItems,
} from "@/pages/boq-wizard/rate-helper/rateHelperPlumbing";
import { categoryLabel, makePricingSheetHelper, nonBcsPipelines, pipelineLabel } from "@/pages/boq-wizard/rate-helper/pricingSheetHelper";
import { RateHelperPanel } from "@/pages/boq-wizard/rate-helper/RateHelperPanel";
import { DISPLAY_RATE_KINDS, type RateHelper, type RateHelperRowContext } from "@/pages/boq-wizard/rate-helper/rateHelperTypes";

/**
 * Which pricing-workbook pages carry a Calculator tab, and for which rate-master discipline. Keyed by
 * the registry path (`pricingWorkbooks.ts`). ONE entry today -- the owner asked for the tab "in the
 * electrical pricing menu item"; HVAC / ELV have no rate master and get no tab. Adding a discipline =
 * one line here once its rate master exists. Kept in this file (not the workbook registry) so the
 * registry's contract is untouched.
 */
export const CALCULATOR_WORKBOOKS: Readonly<Record<string, string>> = {
  "/electrical-pricing": "Electrical",
};

/** PURE. The calculator discipline for a route path (first segment), or null when the page has no tab. */
export function calculatorDisciplineForPath(pathname: string): string | null {
  const first = `/${(pathname || "").split("/").filter(Boolean)[0] ?? ""}`;
  return CALCULATOR_WORKBOOKS[first] ?? null;
}

/** The sentinel column and kind the panel is handed. `col` is only ever echoed back through `onUse`,
 * which the calculator does not provide; `kind` scopes the collapsed header figure, which the
 * calculator opens past. Neither reaches `compute`. */
export const CALCULATOR_COL = "calculator";
export const CALCULATOR_KIND = "supply_rate";

/**
 * PURE. The sentinel ROW for a category. The panel's edit state is ROW-SCOPED (a pick typed on one
 * row can never be read on another -- the guard that stopped a plate_item typed on point_wiring
 * reaching switches_sockets), so each category must present a DIFFERENT row, or a pick made under one
 * category would silently price the next. The registry index is stable for the session; -1 for an
 * unknown category means "no selection" to the panel's `excelRow == null` guards.
 */
export function calculatorRowFor(discipline: string, categoryId: string): number {
  const d = RATE_MASTER_DISCIPLINES.find((x) => x.discipline === discipline);
  const idx = d ? d.categories.findIndex((c) => c.category_id === categoryId) : -1;
  return idx < 0 ? -1 : idx + 1;
}

/**
 * PURE. The row context the calculator hands the shared helper: no text (there is no row to read),
 * the picked category, the three display kinds. `description: ""` means a wiring row is cable-primary
 * -- both blocks are computed and shown regardless (the 2026-08-22 ruling), so the only thing the
 * empty text decides is which block's figure sits in the collapsed header.
 */
export function calculatorCtx(discipline: string, categoryId: string): RateHelperRowContext {
  return {
    excelRow: calculatorRowFor(discipline, categoryId),
    description: "",
    nodeType: "",
    category: categoryId,
    discipline,
    rateKinds: [...DISPLAY_RATE_KINDS],
  };
}

// ── CALCULATOR LAYOUT SLICE: the two numbers this screen decides ────────────────────────────────

/**
 * PURE. THE PRICE BLOCKS A CATEGORY WILL PRODUCE, known BEFORE anything prices: one per non-BCS
 * pipeline, in config declaration order, labelled exactly as the helper labels the priced section
 * (`pipelineLabel` -- config `pipeline_labels` first, else the category label with a Supply/Install
 * suffix on a split category). The helper's generic path emits ONE section per `nonBcsPipelines`
 * entry and the wiring path one per its two pipelines, so this list IS the block count once priced --
 * pinned per golden in the test. That is what lets the blocks stand on screen with em dashes from the
 * first render instead of appearing when the first price lands.
 */
export function calculatorBlockLabels(config: RateCategoryConfig): string[] {
  return nonBcsPipelines(config).map(([id]) => pipelineLabel(config, id));
}

/**
 * PURE. THE FIELDS THE PANEL RENDERS, in the ORDER it renders them: the config's attribute
 * definitions minus `selector: false` and minus `panel: false` (the two exclusions
 * `pricingSheetHelper.compute` applies -- `selectableDefs` then the `d.panel === false` skip). The
 * columns are filled by splitting THIS order -- "split as per order" (owner); no grouping is
 * invented, and a config's own group heading renders where it falls.
 */
export function visibleFieldIds(config: RateCategoryConfig): string[] {
  return (config.attribute_definitions ?? [])
    .filter((d) => d.selector !== false && d.panel !== false)
    .map((d) => d.id);
}

/**
 * CONTENT SETS THE MAXIMUM COLUMN COUNT. Measured over the 12 live Electrical configs on 2026-09-09
 * (panel-visible fields): junction_box_raceway 1, miscellaneous 1, conduit_piping 2,
 * lighting_mgmt_system 2, earthing 3 | industrial_sockets 5, cabletray_raceway 8, wiring_cabling 8 |
 * db_switchgear 14, popup_boxes 17, switches_sockets 17, point_wiring 27. The two band edges (4/5 and
 * 12/13) fall in the EMPTY gaps of that distribution (3 -> 5 and 8 -> 14), so no live category sits
 * on a boundary. Three columns for two fields would leave a lonely box in the corner of an empty
 * screen -- the thing this slice exists to remove -- which is why content, not width, sets the cap.
 */
export const COLUMN_BANDS: ReadonlyArray<{ readonly maxFields: number; readonly columns: 1 | 2 | 3 }> = [
  { maxFields: 4, columns: 1 },
  { maxFields: 12, columns: 2 },
  { maxFields: Number.POSITIVE_INFINITY, columns: 3 },
];

/** PURE. The most columns a category's field count justifies. */
export function maxColumnsForFields(fieldCount: number): 1 | 2 | 3 {
  const n = Number.isFinite(fieldCount) ? Math.max(0, Math.floor(fieldCount)) : 0;
  return (COLUMN_BANDS.find((b) => n <= b.maxFields) ?? COLUMN_BANDS[COLUMN_BANDS.length - 1]).columns;
}

/**
 * WIDTH MAY ONLY REDUCE THE COUNT, NEVER RAISE IT. The calculator's own container width (a
 * ResizeObserver, not the window) caps the columns: below 640 px one column, below 1024 px two, else
 * three -- Tailwind's `sm` / `lg` edges. The price blocks read the SAME width through
 * `blockColumnsFor`, so they fold to one per row at exactly the width the fields fold to one column.
 */
export const WIDTH_COLUMN_CAPS: ReadonlyArray<{ readonly minWidth: number; readonly columns: 1 | 2 | 3 }> = [
  { minWidth: 1024, columns: 3 },
  { minWidth: 640, columns: 2 },
  { minWidth: 0, columns: 1 },
];

/** PURE. The most columns a width allows. */
export function maxColumnsForWidth(widthPx: number): 1 | 2 | 3 {
  const w = Number.isNaN(widthPx) ? 0 : widthPx; // an unbounded width is still a width
  return (WIDTH_COLUMN_CAPS.find((c) => w >= c.minWidth) ?? WIDTH_COLUMN_CAPS[WIDTH_COLUMN_CAPS.length - 1]).columns;
}

/**
 * PURE. THE COLUMN COUNT: the content maximum, reduced by the width cap. `min` is the whole rule --
 * a narrow window takes a three-column category to two, then one; a wide window never takes a
 * one-field category above one.
 */
export function columnsFor(fieldCount: number, widthPx: number): 1 | 2 | 3 {
  return Math.min(maxColumnsForFields(fieldCount), maxColumnsForWidth(widthPx)) as 1 | 2 | 3;
}

/**
 * PURE. PRICE BLOCKS PER ROW: two ("1*2 grid per row which then gets repeated as required" -- owner),
 * folding to one on a calculator narrower than the one-column width. Never more than two.
 */
export function blockColumnsFor(widthPx: number): 1 | 2 {
  return maxColumnsForWidth(widthPx) >= 2 ? 2 : 1;
}

/** The calculator's OWN width, observed -- the panel's columns follow the space it actually has. */
function useObservedWidth<T extends HTMLElement>(ref: React.RefObject<T>): number {
  const [width, setWidth] = useState<number>(() => (typeof window === "undefined" ? 0 : window.innerWidth));
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setWidth(w);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export function PricingCalculator({ discipline }: { discipline: string }) {
  const entry = useMemo(() => RATE_MASTER_DISCIPLINES.find((d) => d.discipline === discipline), [discipline]);
  const targets = useMemo(() => RATE_MASTER_CONFIG_TARGETS.filter((t) => t.discipline === discipline), [discipline]);
  // THE SHARED PLUMBING -- the same fetches, keys and accumulate-once map the BoQ page uses.
  const { configsByCategory, onConfigLoaded } = useConfigsByCategory();
  const { data: itemsData } = useRateMasterItems(true, discipline);
  const items = useMemo(() => itemsData?.message?.items ?? [], [itemsData]);

  const [categoryId, setCategoryId] = useState<string>("");

  // THE ONE HELPER, constructed exactly as the BoQ page constructs it -- with an EMPTY extraction map.
  const helper = useMemo<RateHelper | null>(
    () =>
      configsByCategory.size > 0
        ? makePricingSheetHelper({ configsByCategory, items, extractionByRow: new Map() })
        : null,
    [configsByCategory, items],
  );
  // The panel renders one card per helper; the calculator mounts the pricing-sheet helper ALONE (no
  // stub cards -- owner).
  const helpers = useMemo<RateHelper[]>(() => (helper ? [helper] : []), [helper]);
  const ctx = useMemo(() => (categoryId ? calculatorCtx(discipline, categoryId) : null), [discipline, categoryId]);
  const config = categoryId ? configsByCategory.get(categoryId) ?? null : null;
  const ready = !!ctx && !!helper && !!config && items.length > 0;

  // CALCULATOR LAYOUT SLICE: the two numbers the panel's calculator variant needs.
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useObservedWidth(rootRef);
  const blockLabels = useMemo(() => (config ? calculatorBlockLabels(config) : []), [config]);
  const fieldColumns = useMemo(() => (config ? columnsFor(visibleFieldIds(config).length, width) : 1), [config, width]);
  const blockColumns = useMemo(() => blockColumnsFor(width), [width]);

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col gap-3 p-3" data-testid="pricing-calculator">
      {/* the same hook-safe N-fetch children the BoQ page renders; one hook per instance */}
      {targets.map((t) => (
        <RateConfigFetcher
          key={`calc-cfg-${t.discipline}-${t.categoryId}`}
          discipline={t.discipline}
          categoryId={t.categoryId}
          onLoaded={onConfigLoaded}
        />
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium" htmlFor="pricing-calculator-category">
          Category
        </label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger id="pricing-calculator-category" className="h-9 w-80" aria-label="Category">
            <SelectValue placeholder="Pick a category to price" />
          </SelectTrigger>
          <SelectContent>
            {(entry?.categories ?? []).map((c) => {
              const cfg = configsByCategory.get(c.category_id);
              return (
                <SelectItem key={c.category_id} value={c.category_id}>
                  {cfg ? categoryLabel(cfg) : c.label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Every field starts blank; a blank withholds the price. Nothing here is saved.
        </span>
      </div>

      {!categoryId ? (
        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
          Pick a category to open its fields.
        </div>
      ) : !ready ? (
        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
          Loading the rate master…
        </div>
      ) : (
        // A COLUMN with min-w-0, so the panel's width is the container's and a long basis line
        // truncates instead of pushing the header figures past the viewport edge (seen in the cert).
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto rounded-md border">
          {/* THE SHARED PANEL, calculator variant: the same fields, the same figures, the same notes
              and refusal sentences as the BoQ editor -- rendered by the same component. The layout
              slice adds only the block labels (known before pricing) and the column count. */}
          <RateHelperPanel
            variant="calculator"
            excelRow={ctx!.excelRow}
            col={CALCULATOR_COL}
            kind={CALCULATOR_KIND}
            ctx={ctx!}
            helpers={helpers}
            calculatorBlocks={blockLabels}
            fieldColumns={fieldColumns}
            blockColumns={blockColumns}
          />
        </div>
      )}
    </div>
  );
}
