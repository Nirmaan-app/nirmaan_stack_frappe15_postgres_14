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
 */
import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RATE_MASTER_DISCIPLINES } from "./rate-master/rateMasterRegistry";
import {
  RATE_MASTER_CONFIG_TARGETS,
  RateConfigFetcher,
  useConfigsByCategory,
  useRateMasterItems,
} from "@/pages/boq-wizard/rate-helper/rateHelperPlumbing";
import { categoryLabel, makePricingSheetHelper } from "@/pages/boq-wizard/rate-helper/pricingSheetHelper";
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
  const ready = !!ctx && !!helper && configsByCategory.has(categoryId) && items.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3" data-testid="pricing-calculator">
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
              and refusal sentences as the BoQ editor -- rendered by the same component. */}
          <RateHelperPanel
            variant="calculator"
            excelRow={ctx!.excelRow}
            col={CALCULATOR_COL}
            kind={CALCULATOR_KIND}
            ctx={ctx!}
            helpers={helpers}
          />
        </div>
      )}
    </div>
  );
}
