// RM-2 Tab 1 -- DATA VIEWER. The full item master for the discipline, with
// DYNAMIC columns (kind, brand, one per attribute definition, the rate fields
// present in the data, unit, source). Kind filter + a CASE-SENSITIVE text search
// across all displayed cell values (so "106.04" finds the cleaned lug rows and
// "Aluminium" finds nothing -- the data is canonical UPPERCASE). No virtualization
// by design -- this is an admin table, not the editor.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Trash2, Check, X, Plus, Filter, Download, Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AttributeDefinition, RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import { parseFiniteInput } from "./rateMasterEdit";
import { DOWNLOAD_COPY, downloadErrorMessage } from "./rateMasterDownload";
import { RateMasterUploadDialog } from "./RateMasterUploadDialog";
import { FREEZE_BLOCKED_MESSAGE } from "./rateMasterFreeze";
import {
  gridColumnKeys, attrColKey, rateColKey,
  COL_ACTIONS, COL_KIND, COL_SPEC, COL_PI_NAME, COL_BRAND, COL_UNIT,
  COL_PI_SHARED_BY, COL_PI_USED_BY, COL_PI_ITEMS,
  COL_SOURCE_SHEET, COL_SOURCE_ROW, COL_FORMULA_SUPPLY, COL_FORMULA_INSTALL,
} from "./rateMasterGridColumns";
import {
  DEFAULT_RATE_FILE_FORMAT, FORMAT_COPY, RATE_FILE_FORMATS, TWIN_COPY, twinNumbers,
  type RateFileFormat, type TwinDecision, type UploadPlan, type UploadResult, type UploadTwin,
} from "./rateMasterUpload";
import {
  categoryItemKinds,
  isCategoryDataScopeEmpty,
  isDropdownAttributeType,
  isNumericAttributeType,
} from "./rateMasterStructure";
import {
  SPEC_COPY, SPEC_CONFIRM_COPY, confirmedTag, isSpecDrivenConfig, specConfirmedInfo, specNotUnderstoodReason,
  specQuestion, splitSpecColumns,
  // SLICE 12a: the derived-cost marking and the two formula surfaces, rendered by the SAME helpers the
  // rate file uses on the server side (see the cross-language pin in rateMasterSpec.ts).
  DERIVED_COPY, FORMULA_TYPED, columnNote, derivedCountsByKey, isDerivedCell,
  rowFormula, sideOfRateKey,
  type CreateItemPayload, type SaveItemPatch, type SpecConfirmationReply, type SpecDecision,
  isPricingInputConfig,
  pricingInputCell,
  PRICING_INPUT_VALUE_COLUMNS,
  PRICING_INPUT_COLUMN_LABELS,
  PRICING_INPUT_COLUMN_SHORT_LABELS,
  // SLICE 12b(B): the derived rate-column kind for the header (acceptance item 1).
  deriveRateColumnLabels,
  rateColumnLabel,
  columnOrderForFile,
  pricingInputUsedByText,
  sourceOrder,
} from "./rateMasterSpec";

/**
 * THE THIRD COERCION SITE. What an edited / newly-entered attribute value is STORED as on a master
 * item row.
 *
 * An attribute value is coerced in SEVERAL places -- the frontend match path
 * (`rateMasterStructure.coerceForMatch`), the server extraction path
 * (`extraction._coerce_value`), and HERE, where a human types a value into the item master. All of
 * them must agree, because matching is strict identity: a row written with the string "1" where
 * every other row carries the number 1 can never be matched by anything.
 *
 * This branched on `"number"` alone, so a `number_choice` value was stored as a STRING -- the same
 * defect that had already been missed twice (the frontend twin, then the server). It was LATENT
 * rather than live only because the only `number_choice` attributes today belong to point_wiring,
 * which is kind-less and therefore owns no master rows to edit. `isNumericAttributeType` is the ONE
 * shared predicate all three sites now key on.
 *
 * A blank stays blank (the caller decides whether to skip it); a non-numeric entry against a numeric
 * def is left VERBATIM rather than becoming NaN -- the server canonicalises and the row round-trips
 * visibly wrong instead of silently nulled. PURE.
 */
export function coerceAttributeForStorage(
  def: Pick<AttributeDefinition, "type">,
  raw: string,
): string | number {
  if (!isNumericAttributeType(def.type)) return raw;
  if (raw.trim() === "") return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

interface Props {
  items: RateMasterItem[];
  config: RateCategoryConfig;
  disciplineLabel: string;
  categoryLabel: string;
  // RM-4a: admin-only editing (owner option (a)). When !isAdmin the actions column + Add control are
  // HIDDEN and the table renders exactly as the RM-2 read-only viewer.
  isAdmin?: boolean;
  // RMF-1: the DEPLOYMENT FREEZE. While true the rate-master WRITE controls are DISABLED (never
  // hidden -- a hidden control teaches nothing, and B5's whole point is that the user meets the
  // state before they meet an error). Each disabled control carries the owner's approved message
  // as its tooltip, so the reason is on screen without a new string.
  // ⚠️ THE DOWNLOADS AND THE UPLOAD PREVIEW ARE NOT GATED BY THIS (owner ruling R3) -- exporting
  // is the action the freeze exists to protect, and both buttons live in the same dashed panel as
  // the upload, so this distinction is easy to lose and must not be.
  frozen?: boolean;
  // SLICE 1d: both return the endpoint's reply -- for an opted-in kind whose text the exact read refused
  // and the suggester matched, the server writes NOTHING and answers `needs_confirmation` with the best
  // match; the form then asks Accept / Reject and re-calls with `spec_decision` (+ the fingerprint).
  onSaveItem?: (name: string, patch: SaveItemPatch) => Promise<SpecConfirmationReply | undefined | void>;
  onCreateItem?: (payload: CreateItemPayload) => Promise<SpecConfirmationReply | undefined | void>;
  onDeactivateItem?: (name: string) => Promise<void>;
  /** SLICE 12b(B): {pricing-input id -> its reach}. Absent => no ITEMS column (every non-PI grid). */
  inputReach?: Record<string, { distinctSkus: string[]; isFlatAdder: boolean }>;
  /** SLICE 12c: the DERIVED "used by", computed by the PAGE because it needs every category's config
   *  (the same reason `inputReach` is). Used only where an item carries no stored `used_by`. */
  derivedUsedBy?: Record<string, { sites: number; categories: string[] }>;
  /** {category id: its display name} -- the used-by cell names the categories, not their ids (owner
   * 2026-10-03). Built by the PAGE, the only holder of every category's config. */
  categoryNameById?: Record<string, string>;
  /** SLICE 12c FINISH (owner F4): {item_uid: [rate keys]} the RULES compute -- greyed, not editable.
   *  Told by the server beside the items, so the screen never re-derives the rule. */
  computedRateKeys?: Record<string, string[]>;
  /** SLICE 12d-2F (owner F1): {item_uid: {rate key: live figure}} -- what a COMPUTED cell DISPLAYS.
   *  `items[].rates` is the STORED catalogue (what pricing reads) and no longer carries the figure. */
  computedRates?: Record<string, Record<string, number>>;
  /** opens the impact panel on that catalogue row; null closes it */
  onOpenImpact?: (itemUid: string | null) => void;
  openImpactUid?: string | null;
  // SLICE 5: the two download surfaces. The page owns the SDK calls and hands these down, exactly
  // as it already does for save/create/deactivate -- the viewer stays free of frappe-react-sdk.
  // `categoryId === null` means MODE B (every category in one file). SLICE 1e: `fmt` is the file format
  // the user chose -- Excel by default, CSV as the second option (owner X-a).
  onDownloadCsv?: (categoryId: string | null, fmt: RateFileFormat) => Promise<void>;
  onDownloadAsset?: () => Promise<void>;
  // SLICE 6: the upload half of the round trip. Withheld (not disabled) for a non-admin, like
  // every other write affordance here; the endpoints re-gate server-side, which is the boundary.
  // SLICE 1e: both carry the selected category as an OPTIONAL hint for typing a new row in a
  // headers-only template; the file's own rows win over it server-side.
  onPreviewCsv?: (contentBase64: string, categoryId?: string | null) => Promise<UploadPlan>;
  onApplyCsv?: (
    contentBase64: string, expectedDigest: string,
    // SLICE 1d: the per-row Accept / Reject answers and the accepted suggestions' fingerprints, both optional.
    decisions?: Record<number, SpecDecision>, acceptedFingerprints?: Record<number, string>,
    categoryId?: string | null,
    // SLICE 1f: the per-row Confirm / Decline answers to the duplicate warning + the confirmed targets'
    // fingerprints, both optional (absent -> the payload is byte-identical to before).
    twinDecisions?: Record<number, TwinDecision>, twinFingerprints?: Record<number, string>,
  ) => Promise<UploadResult>;
  onUploadApplied?: () => void;
}

type KindFilter = "all" | string;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

/**
 * THE PRICING-INPUTS COLUMN PLAN, in pixels, sized from the REAL data rather than the mock:
 * `name` runs to 50 characters, `remarks` to 255 (median 115), `used_by` to 65 and `shared_by` to 46.
 *
 * ⚠️ IT IS FIXED, AND THAT IS THE POINT (owner, 2026-09-29). With the `input` column taking the slack,
 * opening the impact panel re-flowed every column and re-wrapped every row. In pixels the table cannot
 * respond to its container at all: the panel covers part of it and the scroll bar below reaches the
 * rest. Nothing here is a percentage, and no row may exceed FIVE lines -- which is what the 3-line
 * remark clamp and the 2-line clamps on `shared by` / `used by` buy.
 */
const PI_W = {
  actions: 64, kind: 120,
  /** ⚠️ 420, NOT 360. The longest input name is 50 characters and wrapped to a second line at 360,
   *  which put the tallest row at 5.6 lines -- over the owner's five-line rule. At 420 every name
   *  fits one line and the row is name + a 2-line remark. */
  input: 420,
  /** ⚠️ 72, NOT 68. The header, not the data, sets this floor: the data cells hold "70%" or a dash,
   *  but the shortened two-line labels ("Supply mkup", "Inst. markup") need 56px of content box. */
  rate: 72,
  unit: 90, sharedBy: 150, usedBy: 190, items: 84,
} as const;

/** what the hover says on a cell whose figure the rules compute (owner F4) */
const COMPUTED_CELL_TITLE =
  "Calculated from the Pricing Inputs and this row's own size. Change the Pricing Inputs to move it.";

/**
 * SLICE 12d-2F (owner F1, 2026-10-07): THE FIGURE A RATE CELL DISPLAYS. A COMPUTED cell (one the server
 * names in `computed_rate_keys`) shows the live figure from `computed_rates`; every other cell shows the
 * STORED rate. ⚠️ `items[].rates` is what every pricing path reads -- the rate-helper panel, the
 * calculator, the impact panel -- so the display figure lives in its own map and is never written into
 * it: a projected 555 in `rates` priced the GI framework TWICE (2574 where the catalogue prices 1757).
 * PURE, exported for its own test.
 */
export function displayedRateValue(
  it: Pick<RateMasterItem, "item_uid" | "rates">,
  k: string,
  computed: boolean,
  computedRates?: Record<string, Record<string, number>>,
): number | undefined {
  if (computed) {
    const v = computedRates?.[String(it.item_uid ?? "")]?.[k];
    if (v !== undefined) return v;
  }
  return it.rates?.[k];
}

export function RateMasterDataViewer({
  items, config, disciplineLabel, categoryLabel, isAdmin, frozen, onSaveItem, onCreateItem,
  onDeactivateItem, onDownloadCsv, onDownloadAsset, onPreviewCsv, onApplyCsv, onUploadApplied,
  // SLICE 12b(B): the ITEMS column. The reach map is computed by the PAGE (it needs every category's
  // config, which this component does not have), so the viewer only RENDERS it. Both absent => no
  // column at all, which is what keeps every other category's grid byte-identical.
  inputReach, derivedUsedBy, categoryNameById, computedRateKeys, computedRates, onOpenImpact, openImpactUid,
}: Props) {
  // SLICE 5: which download is in flight, so a slow one cannot be double-fired. One string rather
  // than three booleans -- only one download can be running at a time by construction.
  const [downloading, setDownloading] = useState<null | "cat" | "all" | "asset">(null);
  // SLICE 1e: the rate-file format for the two edit downloads -- Excel by default (owner X-a).
  const [fileFormat, setFileFormat] = useState<RateFileFormat>(DEFAULT_RATE_FILE_FORMAT);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const runDownload = async (which: "cat" | "all" | "asset", fn: () => Promise<void>) => {
    setDownloading(which);
    setDownloadErr(null);
    try {
      await fn();
    } catch (e) {
      // The server's OWN words, not "there was an error" -- see downloadErrorMessage for why.
      setDownloadErr(downloadErrorMessage(e));
    } finally {
      setDownloading(null);
    }
  };
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const canEdit = !!isAdmin && !!onSaveItem;
  // RMF-1: DELIBERATELY NOT folded into `canEdit`. canEdit decides whether the actions COLUMN
  // exists at all; folding the freeze in would make the column vanish and the table change shape,
  // which is a hidden control, not a disabled one. The freeze disables the BUTTONS and leaves the
  // layout alone.
  const writeBlocked = !!frozen;
  // RM-4a edit state: the row being inline-edited + its draft attr/rate values (strings, per input).
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [draftAttrs, setDraftAttrs] = useState<Record<string, string>>({});
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});
  const [rowSaving, setRowSaving] = useState(false);
  const [rowErr, setRowErr] = useState<string | null>(null);
  // SLICE 1d: an edit the exact read refused, awaiting the user's Accept / Reject of the server's best match.
  const [rowAsk, setRowAsk] = useState<{ name: string; patch: SaveItemPatch; reply: SpecConfirmationReply } | null>(null);
  // SLICE 1f (owner Y-e): an edit that would make this item mean the same as ANOTHER item -- the warning is
  // answered in the row; Confirm sends the answer (the OTHER item takes the rates, this one stays), Decline
  // sends nothing at all.
  const [rowTwinAsk, setRowTwinAsk] = useState<{ name: string; patch: SaveItemPatch; twin: UploadTwin } | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ name: string; label: string } | null>(null);
  // SLICE 12b(A), owner ruling 2026-09-28 -- THE SCREEN MUST NOT LIE ABOUT A REFUSAL.
  // `doDeactivate` was try/finally with NO catch, so a server refusal was swallowed: the dialog
  // closed, the row stayed, and nothing said why. That is indistinguishable from "it worked but the
  // grid has not refetched" -- which is exactly what it looked like during the cert, when the write
  // HAD gone through. The refusal now stays ON the dialog and the dialog stays OPEN.
  const [deactivateErr, setDeactivateErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // EA-1c change 1: SCOPE the Data tab to the selected category's items. The kinds come from the
  // config's declared item_kinds, else (legacy wiring) derived from its pipelines' match_master_row.
  // The `items` prop is discipline-wide; we show only rows whose kind belongs to this category.
  // EA-DIFF (owner-observed D5 defect): a category whose resolved kind set is EMPTY -- declared
  // item_kinds:[] AND no pipeline-derivable kind (point_wiring, the first kind-less category) -- owns
  // NO data rows of its own; its pricing derives from OTHER categories' items. It MUST render an honest
  // empty state, NEVER fall through to the discipline-wide all-items list (the old `: items` fallback,
  // which surfaced all 1356 rows with mixed columns). LMS (item_kinds:["lms_item"], empty pipelines)
  // still resolves a kind, so it is UNCHANGED.
  const categoryKinds = useMemo(() => categoryItemKinds(config), [config]);
  const emptyScope = useMemo(() => isCategoryDataScopeEmpty(config), [config]);
  // SLICE 12c / ACCEPTANCE 4: the ROWS come out in the SOURCE WORKBOOK'S order -- the same order the
  // rate file is written in (`sourceOrder`, the mirror of `csv_exporter._source_order`). The screen used
  // to render the fetch order (kind, then source_row), which interleaved two categories drawn from two
  // sheets and did not match the file a reader had just downloaded. PRESENTATION ONLY.
  const scopedItems = useMemo(
    () => (emptyScope ? [] : sourceOrder(items.filter((it) => categoryKinds.includes(it.kind)))),
    [items, categoryKinds, emptyScope]
  );
  // The kind column + chips only appear when the category spans MORE THAN ONE kind.
  const showKindCol = categoryKinds.length > 1;

  // Attribute columns = every definition EXCEPT brand (brand is its own named column).
  // SLICE 1c: a SPEC-DRIVEN category (`attributes_from_spec: true`) splits them into the TEXT columns
  // (item_name, item_detail -- editable, rendered FIRST) and the DERIVED columns (read-only, greyed,
  // "read from spec"). Any other category takes the branch that was here, unchanged.
  const specMode = isSpecDrivenConfig(config);
  const specCols = useMemo(() => splitSpecColumns(config.attribute_definitions), [config]);
  const textCols = useMemo(() => (specMode ? specCols.text : []), [specMode, specCols]);
  // SLICE 12c / ACCEPTANCE 4: ordered the way the FILE orders them -- `columnOrderForFile`, the mirror
  // of `csv_exporter.column_order_for`. A category declaring `rate_composition` keeps its declaration
  // order (which IS the sheet's); every other category takes the sorted order the file uses. Any
  // definition the items do not carry keeps its declared place at the end, so a template column never
  // disappears off the screen.
  const fileOrder = useMemo(() => columnOrderForFile(config, scopedItems), [config, scopedItems]);
  // SLICE 12c: the DERIVED used-by, for an input whose item carries no stored copy. See the cell below.
  const usedByText = useCallback((it: RateMasterItem) => {
    const stored = it.attributes?.used_by;
    if (stored !== undefined && stored !== null && String(stored).trim() !== "") return String(stored);
    const id = String(it.attributes?.item ?? "");
    return id
      ? pricingInputUsedByText((derivedUsedBy ?? {})[id], (c) => (categoryNameById ?? {})[c] ?? c)
      : "";
  }, [derivedUsedBy, categoryNameById]);
  const attrCols = useMemo(() => {
    const defs = specMode ? specCols.derived : config.attribute_definitions.filter((d) => d.id !== "brand");
    const rank = new Map(fileOrder.attrs.map((id, i) => [id, i]));
    const known = defs.filter((d) => rank.has(d.id))
      .sort((x, y) => (rank.get(x.id) as number) - (rank.get(y.id) as number));
    return [...known, ...defs.filter((d) => !rank.has(d.id))];
  }, [config, specMode, specCols, fileOrder]);
  // The attribute definitions a human may TYPE into: the text pair in spec mode, every column otherwise.
  const editableAttrCols = specMode ? textCols : attrCols;

  // SLICE 12b(A): is this the discipline's Pricing Inputs category? Suffix-keyed on the item kind, so
  // no discipline is named here and 12c's HVAC inputs flow through with no change.
  const piMode = useMemo(() => isPricingInputConfig(config), [config]);
  // SLICE 12b(B): the ITEMS column exists only on a Pricing Inputs grid, and only once the page has
  // supplied both the reach map and the click handler -- so a caller that has not opted in sees the
  // grid exactly as before.
  const showImpactCol = piMode && !!onOpenImpact && !!inputReach;
  const impactCountFor = useCallback(
    (it: RateMasterItem) => {
      const id = String((it.attributes ?? {}).item ?? "");
      const r = inputReach?.[id];
      /**
       * ⚠️ AN ADDER COUNTS LIKE EVERY OTHER INPUT (owner ruling, 2026-09-29). This returned a DASH,
       * on the reading that a flat adder moves no SKU's rate -- true of the rate, false of the PRICE,
       * and the owner's rule is whose price moves. An adder moves all 450 trays, so it shows 450 and
       * its panel lists them. The dash is kept for an input that genuinely reaches nothing, which as
       * of v65 is none of the 35.
       */
      return String(r?.distinctSkus.length ?? 0);
    },
    [inputReach],
  );
  // ACCEPTANCE 4 / 13: the used-by count. It is COMPUTED FROM THE PIPELINES at mint time and carried
  // on the item, because the page fetches one category's config at a time and a cross-category count
  // cannot be derived from that one config.
  //
  // ⚠️ SO IT IS RECOMPUTED ON EVERY MINT, NEVER EDITED. The one computation lives in
  // `csv_exporter.pricing_input_used_by`, and it is what `csv_importer.refuse_if_in_use` reads to
  // refuse a delete or a rename -- the file, the screen and the refusal cannot disagree.

  // Rate columns = union of rate keys across THIS CATEGORY's items, in first-seen order.
  // ⚠️ PRICING INPUTS ARE THE ONE EXCEPTION: their columns are a FIXED, ORDERED set (acceptance 4/9),
  // so a discount always sits where a reader expects it rather than wherever the first row happened to
  // carry one. Only the columns actually in use are shown, so the file is not padded with empties.
  const rateCols = useMemo(() => {
    if (piMode) {
      return (PRICING_INPUT_VALUE_COLUMNS as readonly string[]).filter((k) =>
        scopedItems.some((it) => (it.rates || {})[k] !== undefined && (it.rates || {})[k] !== null),
      );
    }
    // SLICE 12c / ACCEPTANCE 4: the FILE's order, not first-seen. First-seen depended on which row the
    // mint happened to write first, so the screen and the file agreed only by accident.
    return fileOrder.rates;
  }, [fileOrder, scopedItems, piMode]);

  /** the plan's total, so the table declares its own width and cannot be squeezed by its container */
  const piTableWidth = useMemo(() => (
    (canEdit ? PI_W.actions : 0) + (showKindCol ? PI_W.kind : 0) + PI_W.input
    + rateCols.length * PI_W.rate + PI_W.unit + PI_W.sharedBy + PI_W.usedBy
    + (showImpactCol ? PI_W.items : 0)
  ), [canEdit, showKindCol, rateCols.length, showImpactCol]);

  /**
   * THE ONE ORDERING of this grid's columns. The header row, the formula row, every body row and the
   * empty-state colSpan all read THIS -- there is no second list to drift against (see
   * `rateMasterGridColumns.ts` for what drifting cost).
   */
  const gridCols = useMemo(() => gridColumnKeys({
    canEdit, showKindCol, piMode, specMode, showImpactCol, textCols, attrCols, rateCols,
  }), [canEdit, showKindCol, piMode, specMode, showImpactCol, textCols, attrCols, rateCols]);

  // SLICE 12a: the row-level formula text for every scoped item, and how many rows declare each rate
  // column derived (what the formula row's count names). ONE pass, memoised on the items + config.
  const formulaByUid = useMemo(() => {
    const byUid = new Map(scopedItems.map((it) => [it.item_uid ?? "", it] as const));
    const m = new Map<string, [string, string]>();
    for (const it of scopedItems) {
      m.set(it.item_uid ?? "", [
        rowFormula(config, it, "supply", (u) => byUid.get(u ?? "")),
        rowFormula(config, it, "install", (u) => byUid.get(u ?? "")),
      ]);
    }
    return m;
  }, [scopedItems, config]);
  const derivedCounts = useMemo(() => derivedCountsByKey(config, scopedItems), [config, scopedItems]);

  // SLICE 12b(B) -- THE DERIVED RATE-COLUMN LABEL, for this category's headers.
  //
  // ⚠️ DERIVED FROM THIS ONE CONFIG, AND THAT IS PROVEN SUFFICIENT, NOT ASSUMED. The category that
  // owns a kind is also the category that prices it, so its own pipelines carry all the evidence.
  // MEASURED on v65: a per-category derivation agrees with the whole-discipline derivation on EVERY
  // owned kind -- 0 differences across all 13 categories. That is what lets this header avoid fetching
  // twelve configs. If a future category ever prices a kind it does not declare, the two would
  // diverge and the header would go quiet (never wrong) -- the same fail-to-silence as an
  // unlabelled column.
  // ⚠️ The DISCIPLINE is passed, and the deriver REQUIRES it: the label is Electrical BY RULE (owner
  // ruling 2026-09-28), so an HVAC config gets an empty map here exactly as it does in the exporter.
  // The stored config carries its own `discipline` -- verified on v65 -- so the viewer needs no new prop.
  const rateLabels = useMemo(
    () => deriveRateColumnLabels(
      config ? { [config.category_id]: config } : {},
      String((config as unknown as { discipline?: string })?.discipline ?? ""),
    ),
    [config],
  );
  // The kinds actually present, so a rate key carried by two kinds is labelled only where they agree
  // -- one header cell cannot say two things. Mirrors `csv_exporter.header_label_for_rate`.
  const rateLabelFor = useCallback(
    (rateKey: string): string | undefined => {
      const seen = new Set<string>();
      for (const it of scopedItems) {
        const lab = rateColumnLabel(rateLabels, it.kind, rateKey);
        if (lab) seen.add(lab);
      }
      return seen.size === 1 ? Array.from(seen)[0] : undefined;
    },
    [rateLabels, scopedItems],
  );

  // Kind filter chips = this category's kinds (present in its items), sorted.
  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const it of scopedItems) set.add(it.kind);
    return Array.from(set).sort();
  }, [scopedItems]);

  const batchId = scopedItems[0]?.import_batch ?? "(none)";

  // EA-1c change 3: the RM-3b PROXY H-SCROLLBAR -- ONE always-visible bar. The real scroller's native
  // H-bar is suppressed (boq-embed-hidehbar), a sticky bottom proxy mirrors its scrollLeft two-way, and
  // the proxy's visible width == the scroller's clientWidth (V-bar leak accounted) with a spacer ==
  // scrollWidth (full extent, live-measured via ResizeObserver). Same pattern as PricingGrid.tsx.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const proxyRef = useRef<HTMLDivElement | null>(null);
  const [hScroll, setHScroll] = useState({ clientWidth: 0, scrollWidth: 0 });

  // Reset the filter/search state when switching category (the component persists across categories).
  useEffect(() => {
    setKind("all");
    setSearch("");
    setColumnFilters({});
  }, [config.category_id]);

  // Per-column faceted filters: a unified column model (key + how to read the cell) drives BOTH the
  // distinct-value dropdowns and the row predicate, so a new attribute/rate column self-registers.
  const columns = useMemo(
    () => [
      ...(showKindCol ? [{ key: "kind", get: (it: RateMasterItem) => it.kind }] : []),
      ...textCols.map((d) => ({ key: `attr:${d.id}`, get: (it: RateMasterItem) => it.attributes?.[d.id] })),
      ...(specMode
        ? [{ key: "spec", get: (it: RateMasterItem) => specNotUnderstoodReason(it) ?? SPEC_COPY.readFromSpec }]
        : []),
      { key: "brand", get: (it: RateMasterItem) => it.brand },
      ...attrCols.map((d) => ({ key: `attr:${d.id}`, get: (it: RateMasterItem) => it.attributes?.[d.id] })),
      ...rateCols.map((k) => ({ key: `rate:${k}`, get: (it: RateMasterItem) => it.rates?.[k] })),
      // SLICE 12b(A): the four Pricing-Input columns. `used_by` is READ-ONLY -- it is derived.
      ...(piMode
        ? [
            { key: "pi:name", get: (it: RateMasterItem) => it.attributes?.name },
            { key: "pi:shared_by", get: (it: RateMasterItem) => it.attributes?.shared_by },
            { key: "pi:used_by", get: (it: RateMasterItem) => it.attributes?.used_by },
          ]
        : []),
      { key: "unit", get: (it: RateMasterItem) => it.unit },
      { key: "source_sheet", get: (it: RateMasterItem) => it.source_sheet },
      { key: "source_row", get: (it: RateMasterItem) => it.source_row },
    ],
    [showKindCol, specMode, textCols, attrCols, rateCols],
  );
  const distinctByColumn = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const c of columns) {
      const set = new Set<string>();
      for (const it of scopedItems) {
        const v = cellText(c.get(it));
        if (v !== "") set.add(v);
      }
      m[c.key] = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return m;
  }, [columns, scopedItems]);
  const getForColumn = useMemo(() => {
    const m: Record<string, (it: RateMasterItem) => unknown> = {};
    for (const c of columns) m[c.key] = c.get;
    return m;
  }, [columns]);
  // Selected values per column (empty / absent => that column does not filter).
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const setColumnFilter = (key: string, next: string[]) =>
    setColumnFilters((p) => {
      const n = { ...p };
      if (next.length) n[key] = next;
      else delete n[key];
      return n;
    });
  const activeColumnFilterCount = Object.keys(columnFilters).length;

  // Precompute a per-row searchable string over EVERY displayed cell.
  const rows = useMemo(() => {
    return scopedItems.map((it) => {
      const cells: string[] = [
        cellText(it.kind),
        ...textCols.map((d) => cellText(it.attributes?.[d.id])),
        ...(specMode ? [specNotUnderstoodReason(it) ?? SPEC_COPY.readFromSpec] : []),
        cellText(it.brand),
        ...attrCols.map((d) => cellText(it.attributes?.[d.id])),
        ...rateCols.map((k) => cellText(it.rates?.[k])),
        cellText(it.unit),
        cellText(it.source_sheet),
        cellText(it.source_row),
        // ⚠️ SLICE 12b(B): a Pricing Input's TEXT was never searchable. Its config declares no
        // `attribute_definitions`, so `attrCols` is empty and this haystack held only the rates and the
        // unit -- typing an input's own NAME into the search box matched nothing. Found while checking
        // a claim that the search still covered the remark after its column moved under the name; it
        // did not, and asserting it would have been wrong. Absent on every other category (these keys
        // do not exist there), so no other grid's search changes.
        ...(piMode
          ? [cellText(it.attributes?.name), cellText(it.attributes?.remarks),
             cellText(it.attributes?.shared_by), cellText(it.attributes?.used_by)]
          : []),
      ];
      return { it, cells, haystack: cells.join("  ") };
    });
  }, [scopedItems, specMode, textCols, attrCols, rateCols, piMode]);

  const filtered = useMemo(() => {
    const filterEntries = Object.entries(columnFilters);
    return rows.filter((r) => {
      if (kind !== "all" && r.it.kind !== kind) return false;
      if (search && !r.haystack.includes(search)) return false; // CASE-SENSITIVE
      // per-column facets: a row passes iff its cell value is in EVERY active column's selected set (AND
      // across columns, OR within a column). A stale filter key whose column no longer exists (e.g. the
      // kind funnel after switching to a single-kind category) is skipped, not treated as no-match.
      for (const [key, sel] of filterEntries) {
        const getter = getForColumn[key];
        if (!getter) continue;
        if (!sel.includes(cellText(getter(r.it)))) return false;
      }
      return true;
    });
  }, [rows, kind, search, columnFilters, getForColumn]);

  // Proxy scrollbar metrics: live-measure the real scroller (+ its table for content-width changes)
  // via a ResizeObserver. clientWidth (excludes the V-bar -> no end clamp) = proxy visible width;
  // scrollWidth (full extent) = spacer width. A guarded no-op keeps re-renders to genuine size changes.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () =>
      setHScroll((m) => {
        const clientWidth = scroller.clientWidth;
        const scrollWidth = scroller.scrollWidth;
        return m.clientWidth === clientWidth && m.scrollWidth === scrollWidth ? m : { clientWidth, scrollWidth };
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    const table = scroller.querySelector("table");
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, [columns.length, filtered.length]);
  // Two-way scrollLeft sync between the proxy bar and the real scroller (layout only; a latch stops the
  // ping-pong). Re-wired when the content width changes.
  useEffect(() => {
    const proxy = proxyRef.current;
    const scroller = scrollRef.current;
    if (!proxy || !scroller) return;
    let syncing = false;
    const fromProxy = () => {
      if (syncing) return;
      syncing = true;
      scroller.scrollLeft = proxy.scrollLeft;
      syncing = false;
    };
    const fromScroller = () => {
      if (syncing) return;
      syncing = true;
      proxy.scrollLeft = scroller.scrollLeft;
      syncing = false;
    };
    proxy.addEventListener("scroll", fromProxy, { passive: true });
    scroller.addEventListener("scroll", fromScroller, { passive: true });
    fromScroller(); // seed the proxy thumb to the current position
    return () => {
      proxy.removeEventListener("scroll", fromProxy);
      scroller.removeEventListener("scroll", fromScroller);
    };
  }, [hScroll.scrollWidth]);

  // RM-4a edit handlers -----------------------------------------------------------------------------
  const beginEdit = (it: RateMasterItem) => {
    setRowErr(null);
    const a: Record<string, string> = {};
    for (const d of editableAttrCols) a[d.id] = cellText(it.attributes?.[d.id]);
    const rr: Record<string, string> = {};
    for (const k of rateCols) rr[k] = cellText(it.rates?.[k]);
    setDraftAttrs(a);
    setDraftRates(rr);
    setEditingRow(it.name ?? null);
  };
  const cancelEdit = () => {
    setEditingRow(null);
    setRowErr(null);
    setRowAsk(null);
    setRowTwinAsk(null);
  };
  const saveEdit = async (it: RateMasterItem) => {
    if (!onSaveItem || !it.name) return;
    // Only the CHANGED cells go in the patch. Rates are numeric-or-null; a blank rate cell => null.
    const rates_patch: Record<string, number | null> = {};
    for (const k of rateCols) {
      const raw = draftRates[k] ?? "";
      const orig = cellText(it.rates?.[k]);
      if (raw === orig) continue;
      if (raw.trim() === "") {
        rates_patch[k] = null;
      } else {
        const n = parseFiniteInput(raw);
        if (n === null) {
          setRowErr(`Rate '${k}' must be a number.`);
          return;
        }
        rates_patch[k] = n;
      }
    }
    const attributes_patch: Record<string, string | number> = {};
    // SLICE 1c: in spec mode ONLY the two text columns can be patched (editableAttrCols); the server
    // re-reads the derived attributes from them and refuses any other key -- no back door.
    for (const d of editableAttrCols) {
      const raw = draftAttrs[d.id] ?? "";
      const orig = cellText(it.attributes?.[d.id]);
      if (raw === orig) continue;
      // NUMERIC-typed attributes (number AND number_choice) are stored numeric; choice/text stay
      // as-is (the server canonicalises). See coerceAttributeForStorage -- the third coercion site.
      attributes_patch[d.id] = specMode ? raw : coerceAttributeForStorage(d, raw);
    }
    if (Object.keys(rates_patch).length === 0 && Object.keys(attributes_patch).length === 0) {
      cancelEdit();
      return;
    }
    const patch: SaveItemPatch = {
      rates_patch: Object.keys(rates_patch).length ? rates_patch : undefined,
      attributes_patch: Object.keys(attributes_patch).length ? attributes_patch : undefined,
    };
    await sendSave(it.name, patch);
  };
  // SLICE 1d: the ONE sender for a row save. A `needs_confirmation` reply keeps the row in edit mode and
  // shows the question; the answer re-sends the SAME patch with spec_decision (+ fingerprint on accept).
  const sendSave = async (name: string, patch: SaveItemPatch) => {
    if (!onSaveItem) return;
    setRowSaving(true);
    setRowErr(null);
    try {
      const reply = await onSaveItem(name, patch);
      if (reply && reply.needs_confirmation) {
        setRowAsk({ name, patch, reply });
        return;
      }
      setRowAsk(null);
      if (reply && reply.needs_twin_confirmation && reply.twin) {
        setRowTwinAsk({ name, patch, twin: reply.twin });   // NOTHING written -- ask first
        return;
      }
      setRowTwinAsk(null);
      setEditingRow(null);
    } catch (e) {
      setRowErr((e as { message?: string })?.message ?? "Save failed");
    } finally {
      setRowSaving(false);
    }
  };
  const answerRowAsk = async (d: SpecDecision) => {
    if (!rowAsk) return;
    const fp = rowAsk.reply.suggestion?.fingerprint;
    await sendSave(rowAsk.name, { ...rowAsk.patch, spec_decision: d, spec_fingerprint: d === "accept" ? fp : undefined });
  };
  const answerRowTwin = async (d: TwinDecision) => {
    if (!rowTwinAsk) return;
    if (d === "decline") {
      // Declined: no request, no change (owner Y-a / Y-e). The row stays in edit mode with its draft.
      setRowTwinAsk(null);
      return;
    }
    await sendSave(rowTwinAsk.name, { ...rowTwinAsk.patch, twin_decision: "confirm", twin_fingerprint: rowTwinAsk.twin.fingerprint });
  };
  const doDeactivate = async () => {
    if (!onDeactivateItem || !confirmDeactivate) return;
    setDeactivateErr(null);
    try {
      await onDeactivateItem(confirmDeactivate.name);
      setConfirmDeactivate(null);
    } catch (e) {
      // The dialog is deliberately LEFT OPEN so the reason is attached to the action that caused it.
      // The server's OWN words. `downloadErrorMessage` already digs them out of
      // `_server_messages` -- ONE definition of "what did the server actually say",
      // reused rather than re-invented.
      setDeactivateErr(downloadErrorMessage(e));
    }
  };

  // A column header = its label + a per-column faceted filter (funnel -> search + checkbox list).
  // SLICE 12b(B): `note` is the DERIVED rate-column kind ("List price" / "BCS price" / "BoQ price",
  // with "(install)" where the leg applies). It is deliberately NOT rendered through `tag`, whose
  // uppercase styling belongs to the spec-mode marker and would read as "LIST PRICE" -- these are
  // words, not a badge. Absent => the header is byte-identical to before.
  /** the FULL column name, for the hover -- the header itself shows the short form */
  /**
   * ⚠️ THE `th` MUST CLIP, AND EVERY HEADER MUST SHARE ONE HEIGHT. `overflow: visible` is what let a
   * too-wide label draw over its neighbour in the first place, and a per-cell height made the labels
   * sit on different baselines. Both only in pricing-inputs mode; every other grid is untouched.
   */
  const piHead = piMode ? "h-12 overflow-hidden align-top py-1 px-1" : "";

  const fullLabelFor = (colKey: string, shown: string) => {
    const k = colKey.startsWith("rate:") ? colKey.slice(5) : "";
    return (k && PRICING_INPUT_COLUMN_LABELS[k]) || shown;
  };

  const hdr = (colKey: string, label: string, rightAlign = false, tag?: string, note?: string) => (
    /**
     * ⚠️ IN PRICING-INPUTS MODE THE FILTER IS TAKEN OUT OF THE FLOW AND THE LABEL IS CLAMPED.
     * Wrapping alone did NOT work and the owner saw the result: a flex item will not shrink below its
     * longest word, so "Installation" (73px) drew outside a 52px content box, and the filter icon --
     * a flex SIBLING -- was pushed on top of the next column's label. Three things fix it together:
     * the label gets the WHOLE column (`min-w-0`, clamped to two lines), the filter is positioned in
     * the cell's own corner so it steals no width, and the `th` clips (see `piHeadClass`). The labels
     * are shortened too, because even the full width does not hold "Installation markup".
     */
    <div className={cn(
      piMode ? "relative flex items-start pr-3.5" : "flex items-center gap-1",
      !piMode && rightAlign && "justify-end",
    )}>
      <span
        className={cn(piMode && "min-w-0 text-[10px] leading-tight line-clamp-2 break-normal")}
        title={piMode ? fullLabelFor(colKey, label) : undefined}
      >{label}</span>
      {note ? (
        <span className="font-normal text-[10px] text-muted-foreground whitespace-nowrap">{note}</span>
      ) : null}
      {tag ? (
        <span className="rounded bg-muted px-1 text-[9px] font-normal uppercase tracking-wide text-muted-foreground">{tag}</span>
      ) : null}
      <span className={cn(piMode && "absolute right-0 top-0 shrink-0")}>
        <ColumnFilter
          label={fullLabelFor(colKey, label)}
          values={distinctByColumn[colKey] ?? []}
          selected={columnFilters[colKey] ?? []}
          onChange={(next) => setColumnFilter(colKey, next)}
        />
      </span>
    </div>
  );

  // EA-DIFF: kind-less category -> honest empty state (zero rows, no chips, no Add-row, a note). It
  // NEVER renders the all-items list. A category may legitimately own no data rows of its own.
  // SLICE 5: bound once and rendered in BOTH branches. The kind-less-category early return
  // below (point_wiring) must still offer the downloads -- MODE B covers every category, and a
  // MODE A file for a category with no rows is a usable headers-only template, not an error.
  // SLICE 5 -- THE TWO DOWNLOAD SURFACES.
  // They are grouped by PURPOSE, not by file format, and that is the whole point of the layout: a
  // user choosing between "CSV" and "JSON" is choosing an extension, not an intention. The failure
  // this guards against is someone taking the backup, editing it, and finding nothing reads it
  // back. Admin-only, HIDDEN not disabled, matching every other write affordance in this component
  // -- and the endpoints re-gate server-side, which is the real boundary.
  //
  // NOTE: a `{/* ... */}` comment is JSX-CHILD syntax. Written here it parses as an empty object
  // literal and silently swallows the element into a `{}` -- which is what it did, until tsc named
  // it. Outside JSX children, comments are `//`.
  // SLICE 6: the upload sits IN the same dashed panel as the downloads, immediately after the
  // "Download to edit" group, because it is the SECOND HALF of that one action -- download, edit,
  // upload. Putting it beside the backup group instead would pair it with the file nothing reads
  // back, which is exactly the confusion the purpose-based grouping exists to prevent.
  const downloadPanel = isAdmin && (onDownloadCsv || onDownloadAsset || onPreviewCsv) && (
      <div className="flex flex-wrap items-start gap-6 rounded border border-dashed p-3">
        {onDownloadCsv && (
          <div className="space-y-1">
            <div className="text-xs font-medium">{DOWNLOAD_COPY.editGroup}</div>
            <div className="flex items-center gap-2">
              <Button
                size="sm" variant="outline" disabled={downloading !== null}
                onClick={() => void runDownload("cat", () => onDownloadCsv(config.category_id, fileFormat))}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                {downloading === "cat" ? "Preparing..." : DOWNLOAD_COPY.editThisCategory}
              </Button>
              <Button
                size="sm" variant="outline" disabled={downloading !== null}
                onClick={() => void runDownload("all", () => onDownloadCsv(null, fileFormat))}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                {downloading === "all" ? "Preparing..." : DOWNLOAD_COPY.editAllCategories}
              </Button>
              {/* SLICE 1e (owner X-a): Excel by default; CSV is the second option. A segmented pair, not a
                  select -- two choices, always visible, no menu to open. */}
              <div className="ml-1 flex items-center gap-1" role="radiogroup" aria-label={FORMAT_COPY.label} title={FORMAT_COPY.hint}>
                <span className="text-[11px] text-muted-foreground">{FORMAT_COPY.label}</span>
                {RATE_FILE_FORMATS.map((f) => (
                  <Button
                    key={f.id} size="sm" variant={fileFormat === f.id ? "default" : "ghost"}
                    className="h-7 px-2 text-[11px]" role="radio" aria-checked={fileFormat === f.id}
                    data-testid={`rate-file-format-${f.id}`} onClick={() => setFileFormat(f.id)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">{DOWNLOAD_COPY.editHint}</p>
            <p className="text-[11px] text-muted-foreground">{DOWNLOAD_COPY.newRowHint}</p>
          </div>
        )}
        {onPreviewCsv && onApplyCsv && (
          <RateMasterUploadDialog
            frozen={writeBlocked}
            // SLICE 1e: the selected category rides as the optional hint (see the prop comments above)
            onPreview={(b64) => onPreviewCsv(b64, config.category_id)}
            onApply={(b64, digest, decisions, fps, tdec, tfps) => onApplyCsv(b64, digest, decisions, fps, config.category_id, tdec, tfps)}
            targetLabels={{ disciplineLabel, categoryId: config.category_id, categoryLabel }}
            onApplied={onUploadApplied}
          />
        )}
        {onDownloadAsset && (
          <div className="space-y-1">
            <div className="text-xs font-medium">{DOWNLOAD_COPY.backupGroup}</div>
            <Button
              size="sm" variant="ghost" className="border" disabled={downloading !== null}
              onClick={() => void runDownload("asset", () => onDownloadAsset())}
            >
              <Archive className="mr-1 h-3.5 w-3.5" />
              {downloading === "asset" ? "Preparing..." : DOWNLOAD_COPY.backupAsset}
            </Button>
            <p className="text-[11px] text-muted-foreground">{DOWNLOAD_COPY.backupHint}</p>
          </div>
        )}
        {downloadErr && <p className="text-xs text-destructive">{downloadErr}</p>}
        {/* ⚠️ THE REFUSAL LIVES HERE, NOT IN THE DIALOG, AND THAT WAS LEARNED THE HARD WAY. Radix's
            AlertDialog closes itself on the action click; `preventDefault` stops that but then leaves
            its internal state out of step with the controlled `open` prop, so the box LINGERED after a
            SUCCESS -- certified on screen, row gone and count fallen, dialog still there. Putting the
            message on the PAGE lets the dialog behave exactly as Radix intends and the reason still
            survives, which is what the owner's ruling actually asked for: the screen must show the true
            state whatever the endpoint answers. */}
        {deactivateErr && <p className="text-xs text-destructive" role="alert" data-testid="deactivate-error">{deactivateErr}</p>}
      </div>
    );

  if (emptyScope) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{disciplineLabel} / {categoryLabel}</span>
          <Badge variant="outline">0 items</Badge>
        </div>
        <div className="rounded border border-dashed p-6 text-sm text-muted-foreground">
          This category has no data rows of its own &mdash; its pricing derives from other categories&rsquo; items.
        </div>
        {downloadPanel}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* header line: batch id + item count */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{disciplineLabel} / {categoryLabel}</span>
        <Badge variant="secondary">batch {batchId}</Badge>
        <Badge variant="outline">{scopedItems.length} items</Badge>
        <span className="text-muted-foreground">showing {filtered.length}</span>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant={kind === "all" ? "default" : "outline"} onClick={() => setKind("all")}>all</Button>
          {kinds.map((k) => (
            <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>{k}</Button>
          ))}
        </div>
        <Input
          className="h-8 w-64"
          placeholder="Search cell values (case-sensitive)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {/* clear every per-column filter at once (shown only when some are active) */}
        {activeColumnFilterCount > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setColumnFilters({})}>
            <X className="mr-1 h-3.5 w-3.5" /> Clear filters ({activeColumnFilterCount})
          </Button>
        )}
        {/* RM-4a: admin-only Add control (HIDDEN for non-admins). */}
        {isAdmin && onCreateItem && (
          <Button
            size="sm" variant="outline"
            disabled={writeBlocked}
            title={writeBlocked ? FREEZE_BLOCKED_MESSAGE : undefined}
            onClick={() => setAddOpen(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add row
          </Button>
        )}
      </div>

      {downloadPanel}

      {specMode && (
        <p className="text-[11px] text-muted-foreground" data-testid="spec-hint">{SPEC_COPY.hint}</p>
      )}

      {/* SLICE 12a (owner I-2 / I-3): the one rule a user needs about a derived cost, said once beside
          the table -- and ONLY where the category actually has one, so no other screen gains a line. */}
      {Object.keys(derivedCounts).length > 0 && (
        <p className="text-[11px] text-amber-800" data-testid="derived-hint">{DERIVED_COPY.hint}</p>
      )}

      {/* table -- EA-1c change 3: native H-bar hidden (proxy below is the single bar).
          EA-2 rider 3: force the sticky header's top:0 with a scoped rule -- the Tailwind `top-0`
          utility is overridden to `top:auto` here (a global table reset from Ant Design), which
          silently defeated `position:sticky`. z-index is left to the cell classes (z-20 / corner
          z-30). The container is the scroller (max-h), so this pins the header under vertical scroll. */}
      <style>{".rm-data-hidehbar::-webkit-scrollbar:horizontal{display:none;height:0}.rm-data-hidehbar thead th{position:sticky;top:0;background:hsl(var(--background))}"}</style>
      <div ref={scrollRef} className="overflow-auto rounded border rm-data-hidehbar max-h-[calc(100vh-19rem)]">
        <Table className={cn(piMode && "table-fixed")}
               style={piMode ? { width: piTableWidth, minWidth: piTableWidth } : undefined}>
          {/* ══════════════════════════════════════════════════════════════════════════════════════
              SLICE 12b(B) / ACCEPTANCE ITEM 6 -- THE PRICING INPUTS COLUMN PLAN.

              The owner: "functionally correct, but the column widths are all wrong which make reading
              them very difficult." ONE cause: this table declared NO widths at all -- no colgroup, no
              `table-fixed`, not a width class on a single header -- so the browser's AUTO layout sized
              every column by its CONTENT. Measured on the real 35 rows: the longest remark is 255
              characters and the longest used-by 56, so those two took whatever they wanted and the
              eight percentage columns were squeezed to nothing.

              ⚠️ `table-fixed` + this colgroup are applied in `piMode` ONLY. Every other category's grid
              keeps the auto layout it has always had -- a SKU grid has a different shape (a dozen
              attribute columns of unpredictable width) and forcing a plan on it is a separate change
              nobody asked for.

              ⚠️ THE REAL TABLE IS ~14 COLUMNS, NOT THE MOCK'S 8. The mock draws five value columns;
              the data uses all EIGHT (`discount`, `supply_markup`, `installation_markup`,
              `bcs_markup`, `wastage`, `ratio`, `share`, `amount`), and the screen also carries `unit`
              and the admin `actions` column the mock omits. So the mock's exact pixel proportions
              cannot be copied -- what is copied is its INTENT: the name takes the slack, every numeric
              column is narrow and right-aligned, and the remark wraps under the name rather than
              stealing a column's width.
              ══════════════════════════════════════════════════════════════════════════════════════ */}
          {piMode ? (
            <colgroup>
              {canEdit ? <col style={{ width: PI_W.actions }} /> : null}
              {showKindCol ? <col style={{ width: PI_W.kind }} /> : null}
              {/* ⚠️ FIXED, NOT SLACK. A width-less `input` column is what made every column re-flow
                  when the impact panel opened; with the plan in pixels the table keeps its shape and
                  the panel simply covers part of it, which the scroll bar below reaches. */}
              <col style={{ width: PI_W.input }} />
              {rateCols.map((k) => (
                <col key={`w-${k}`} style={{ width: PI_W.rate }} />
              ))}
              <col style={{ width: PI_W.unit }} />{/* unit */}
              <col style={{ width: PI_W.sharedBy }} />{/* shared by -- clamped to 2 lines */}
              <col style={{ width: PI_W.usedBy }} />{/* used by -- plain category names, ruling N-7 */}
              {showImpactCol ? <col style={{ width: PI_W.items }} /> : null}
            </colgroup>
          ) : null}
          <TableHeader>
            <TableRow>
              {/* ⚠️ RENDERED BY MAPPING `gridCols` -- THE ONE ORDERING. Each cell's markup is unchanged;
                  only its PLACEMENT now comes from the shared list, so the header cannot move without
                  the body moving with it. That is precisely what broke on 2026-10-03 (`8fa8d3262`):
                  the `unit` header moved here and the body cell stayed after the rate columns, and
                  every value between the two rendered under the wrong heading.
                  EA-1c change 2: actions FIRST + sticky-left (absent entirely for non-admins).
                  EA-2 rider 3: the whole header row is ALSO sticky-top; the actions CORNER cell gets
                  z-30 so it wins over both the sticky row (z-20) and the sticky body column (z-10) and
                  never ghosts. */}
              {gridCols.map((key) => {
                if (key === COL_ACTIONS) {
                  return <TableHead key={key} className="sticky left-0 top-0 z-30 bg-background text-right">actions</TableHead>;
                }
                if (key === COL_KIND) {
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)}>{hdr("kind", "kind")}</TableHead>;
                }
                if (key === COL_SPEC) {
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)}>{hdr("spec", SPEC_COPY.specColumn)}</TableHead>;
                }
                if (key === COL_PI_NAME) {
                  /* SLICE 12b(A): a Pricing Input's NAME leads the row -- it is what the reader is
                     looking for, and `brand` / `source` mean nothing for a number a pricer edits. */
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)}>{hdr("pi:name", "input")}</TableHead>;
                }
                if (key === COL_BRAND) {
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)}>{hdr("brand", "brand")}</TableHead>;
                }
                if (key === COL_UNIT) {
                  /* SLICE 12c / ACCEPTANCE 4 (U4, approved): on a SKU grid `unit` sits right after
                     `brand`, where the rate file puts it; in Pricing Inputs it stays after the rate
                     columns. `gridColumnKeys` decides which, for the header AND the body at once. */
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)}>{hdr("unit", "unit")}</TableHead>;
                }
                if (key.startsWith("attr:")) {
                  const id = key.slice(5);
                  const d = [...textCols, ...attrCols].find((c) => c.id === id);
                  if (!d) return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)} />;
                  const isText = textCols.some((c) => c.id === id);
                  /* SLICE 1c (U3): the text pair FIRST, then the spec verdict, then brand, then the
                     derived attributes each tagged "read from spec". */
                  return (
                    <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)}>
                      {isText ? hdr(`attr:${d.id}`, d.label)
                              : hdr(`attr:${d.id}`, d.label, false, specMode ? SPEC_COPY.readFromSpec : undefined)}
                    </TableHead>
                  );
                }
                if (key.startsWith("rate:")) {
                  const k = key.slice(5);
                  return (
                    <TableHead key={key} className={cn("sticky top-0 z-20 bg-background text-right", piHead)}>
                      {/* SLICE 12b(B) acceptance 1: the DERIVED kind rides beside the key. A Pricing
                          Input carries its own fixed column label instead -- it is not a SKU rate. */}
                      {hdr(`rate:${k}`,
                           piMode ? (PRICING_INPUT_COLUMN_SHORT_LABELS[k] ?? PRICING_INPUT_COLUMN_LABELS[k] ?? k) : k, true,
                           undefined, piMode ? undefined : rateLabelFor(k))}
                    </TableHead>
                  );
                }
                /* ACCEPTANCE 12: sharing has its OWN column, never the name. ACCEPTANCE 4/13: the
                   remark and the READ-ONLY used-by count. The SKU columns (source sheet / row, the two
                   formula columns) are absent in Pricing Inputs -- they are what "nothing borrowed
                   from a SKU file" means. */
                if (key === COL_PI_SHARED_BY) {
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)}>{hdr("pi:shared_by", "shared by")}</TableHead>;
                }
                if (key === COL_PI_USED_BY) {
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)}>{hdr("pi:used_by", "used by")}</TableHead>;
                }
                if (key === COL_PI_ITEMS) {
                  /* SLICE 12b(B) / ACCEPTANCE 8: DISTINCT SKUs whose rate this input moves, clickable.
                     ⚠️ NOT the `used_by` site count -- measured on v65 those correlate with nothing
                     (`tray_supply` is 1 site / 450 SKUs; `conduit` is 10 sites / 8 SKUs). */
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background text-right", piHead)}>items</TableHead>;
                }
                if (key === COL_SOURCE_SHEET) {
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)}>{hdr("source_sheet", "source sheet")}</TableHead>;
                }
                if (key === COL_SOURCE_ROW) {
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background text-right", piHead)}>{hdr("source_row", "row", true)}</TableHead>;
                }
                if (key === COL_FORMULA_SUPPLY) {
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)}>{DERIVED_COPY.columnHeaderSupply}</TableHead>;
                }
                if (key === COL_FORMULA_INSTALL) {
                  return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)}>{DERIVED_COPY.columnHeaderInstall}</TableHead>;
                }
                return <TableHead key={key} className={cn("sticky top-0 z-20 bg-background", piHead)} />;
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* SLICE 12a (owner I-7 / I-7a): THE FORMULA ROW -- what each computed rate column is and
                how to update it, in the first row under the header, exactly as the rate file carries it
                (`csv_exporter.formula_row_cells`). Generated from the category's own pipelines, its
                `rate_composition` and its `derived_rates`; an explanation, never data. */}
            <TableRow data-testid="formula-row" className="bg-sky-50/60 align-top [&>td]:max-h-24 [&>td]:overflow-y-auto">
              {/* ⚠️ ALSO RENDERED FROM `gridCols` -- this row carried a THIRD ordering of its own (one
                  label cell where the header has brand + unit, then three bare cells and two formula
                  cells against four header columns), so it drifted too. Mapping the shared list is what
                  makes that impossible. In Pricing-Inputs mode the rate columns collapse to ONE
                  colSpan cell, which is handled by skipping the rest of the rate keys. */}
              {gridCols.map((key, idx) => {
                if (key === COL_PI_NAME || key === COL_BRAND) {
                  /* the label sits in the first NAME-ish column, as it always has */
                  return (
                    <TableCell key={key} className="text-[10px] uppercase tracking-wide text-sky-800">
                      {DERIVED_COPY.formulaRowLabel}
                    </TableCell>
                  );
                }
                if (key.startsWith("rate:")) {
                  const k = key.slice(5);
                  if (piMode) {
                    /* ⚠️ IN PRICING-INPUTS MODE THIS IS ONE CELL ACROSS THE NUMERICS, NOT NINE NARROW
                       COPIES. Each numeric column is ~68px wide, so the same sentence repeated under
                       every one of them wrapped to five or six lines apiece and the formula row became
                       a wall of prose. The FULL per-column explanation is unchanged in the rate file
                       and stays on the hover, which is what `columnNote` is pinned to byte-for-byte
                       across the two languages -- it is the RENDERING that is short here, never the
                       note. Emitted once, on the FIRST rate column; the others render nothing. */
                    if (k !== rateCols[0]) return null;
                    return (
                      <TableCell
                        key={key}
                        colSpan={rateCols.length}
                        className="whitespace-normal align-top text-[11px] italic leading-snug text-sky-900"
                        title={rateCols.map((rk) => `${PRICING_INPUT_COLUMN_LABELS[rk] ?? rk}: ${columnNote(config, rk, derivedCounts[rk] ?? 0)}`).join("\n\n")}
                        data-testid="formula-note-pi"
                      >
                        {DERIVED_COPY.formulaRowPiShort}
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell
                      key={key}
                      // The note is scrollable rather than tall: unbounded, ONE long explanation made the
                      // formula row ~250px and pushed the first item row off the screen. Same reasoning as
                      // the .xlsx, where the owner asked for three standard rows and no more.
                      className="max-w-[24rem] max-h-24 overflow-y-auto whitespace-pre-line text-left align-top text-[11px] italic text-sky-900"
                      title={columnNote(config, k, derivedCounts[k] ?? 0)}
                      data-testid={`formula-note-${k}`}
                    >
                      {columnNote(config, k, derivedCounts[k] ?? 0)}
                    </TableCell>
                  );
                }
                if (key === COL_FORMULA_SUPPLY || key === COL_FORMULA_INSTALL) {
                  return (
                    <TableCell key={key} className="max-w-[22rem] whitespace-pre-line text-[11px] italic text-sky-900">
                      {DERIVED_COPY.formulaRowHint}
                    </TableCell>
                  );
                }
                /* every other column of the plan gets an empty cell -- one per column, never more */
                return <TableCell key={key ? key : `blank-${idx}`} />;
              })}
            </TableRow>
            {filtered.map((r, i) => {
              const editing = canEdit && editingRow === r.it.name;
              /**
               * ⚠️ EVERY CELL'S MARKUP IS UNCHANGED -- only its PLACEMENT moved. Each cell is built
               * into a keyed map and the row then renders `gridCols.map(...)`, so the body cannot
               * carry an ordering of its own. That is the defect this replaces: on 2026-10-03
               * (`8fa8d3262`) the `unit` HEADER moved to just after `brand` and this row kept its cell
               * after the rate columns, so every value in between rendered under the wrong heading --
               * on Electrical's wiring grid the unit "Set" sat under `lug_list`, "COPPER" under
               * `Insulation`; on HVAC Insulation a markup sat under `cost_supply`. The FILE was right
               * throughout, which is why nothing downstream noticed and no test could: the screen
               * showed plausible numbers under the wrong names.
               */
              const cells: Record<string, React.ReactNode> = {};

              cells[COL_ACTIONS] = (
                  <TableCell key={COL_ACTIONS} className="sticky left-0 z-10 bg-background text-right">
                    {editing ? (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center justify-end gap-1">
                          {rowErr && <span className="text-[10px] text-destructive">{rowErr}</span>}
                          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={rowSaving || !!rowTwinAsk} aria-label="Save row" onClick={() => void saveEdit(r.it)}>
                            <Check className="h-4 w-4 text-emerald-600" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={rowSaving} aria-label="Cancel edit" onClick={cancelEdit}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {rowTwinAsk && rowTwinAsk.name === r.it.name ? (
                          // SLICE 1f (owner Y-e): the edit would make this item mean the same as another one.
                          <TwinQuestion twin={rowTwinAsk.twin} busy={rowSaving} onAnswer={(d) => void answerRowTwin(d)} testId="row-twin-question" />
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit row"
                          disabled={writeBlocked}
                          title={writeBlocked ? FREEZE_BLOCKED_MESSAGE : undefined}
                          onClick={() => beginEdit(r.it)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {onDeactivateItem && (
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="Deactivate row"
                            disabled={writeBlocked}
                            title={writeBlocked ? FREEZE_BLOCKED_MESSAGE : undefined}
                            onClick={() => setConfirmDeactivate({
                              name: r.it.name ?? "",
                              label: specMode
                                ? `${cellText(r.it.attributes?.item_name)} ${cellText(r.it.attributes?.item_detail)}`.trim()
                                : `${r.it.kind} ${cellText(r.it.attributes?.material)}`,
                            })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
              );

              cells[COL_KIND] = <TableCell key={COL_KIND}>{r.it.kind}</TableCell>;

              for (const d of textCols) {
                cells[attrColKey(d.id)] = (
                  <TableCell key={attrColKey(d.id)} className="max-w-[20rem] whitespace-normal">
                    {editing ? (
                      <Input
                        className="h-7 w-56 text-xs"
                        value={draftAttrs[d.id] ?? ""}
                        disabled={rowSaving}
                        onChange={(e) => setDraftAttrs((p) => ({ ...p, [d.id]: e.target.value }))}
                        aria-label={`${d.label} value`}
                      />
                    ) : (
                      cellText(r.it.attributes?.[d.id])
                    )}
                  </TableCell>
                );
              }

              cells[COL_SPEC] = (
                  <TableCell key={COL_SPEC} className="whitespace-normal" data-testid="spec-cell">
                    {editing && rowAsk && rowAsk.name === r.it.name && rowAsk.reply.suggestion ? (
                      // SLICE 1d (owner T-b 6): the edit's text was not read exactly -- ask before saving.
                      <div className="max-w-[18rem] rounded border border-amber-500/40 bg-amber-50 p-1.5 text-[10px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="row-spec-question">
                        <div>{specQuestion(
                          String(rowAsk.patch.attributes_patch?.item_name ?? r.it.attributes?.item_name ?? ""),
                          String(rowAsk.patch.attributes_patch?.item_detail ?? r.it.attributes?.item_detail ?? ""),
                          rowAsk.reply.suggestion,
                        )}</div>
                        <div className="mt-1 flex gap-1">
                          <Button size="sm" className="h-6 px-2 text-[10px]" disabled={rowSaving} onClick={() => void answerRowAsk("accept")} aria-label="Accept suggestion">{SPEC_CONFIRM_COPY.accept}</Button>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={rowSaving} onClick={() => void answerRowAsk("reject")} aria-label="Reject suggestion">{SPEC_CONFIRM_COPY.reject}</Button>
                        </div>
                      </div>
                    ) : specConfirmedInfo(r.it) ? (
                      // SLICE 1d (owner T-b 5): a CONFIRMED item -- amber, who and when, distinct from the grey
                      // "read from spec" and the red "won't price".
                      <Badge
                        className="h-auto whitespace-normal border-amber-500/50 bg-amber-100 px-1 py-0.5 text-[10px] font-normal leading-tight text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200"
                        variant="outline"
                        data-testid="spec-confirmed"
                      >
                        {confirmedTag(specConfirmedInfo(r.it)!.by, specConfirmedInfo(r.it)!.at)}
                      </Badge>
                    ) : specNotUnderstoodReason(r.it) ? (
                      <div>
                        <Badge variant="destructive" className="h-4 px-1 text-[10px] leading-none">{SPEC_COPY.wontPrice}</Badge>
                        <div className="mt-0.5 max-w-[16rem] text-[10px] text-destructive">{specNotUnderstoodReason(r.it)}</div>
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">{SPEC_COPY.readFromSpec}</span>
                    )}
                  </TableCell>
              );

              {/* SLICE 12b(A): the input's NAME leads the row, where brand sits for a SKU.
                  SLICE 12b(B) / ACCEPTANCE ITEM 6: the remark sits UNDER the name, as the mock draws
                  it, instead of holding a column of its own. Measured: the longest remark is 255
                  characters, so as a column it took the width the eight percentage columns needed. */}
              cells[COL_PI_NAME] = (
                  <TableCell key={COL_PI_NAME} className="font-medium align-top">
                    <div>{String(r.it.attributes?.name ?? "")}</div>
                    {String(r.it.attributes?.remarks ?? "") ? (
                      <div
                        className="mt-0.5 line-clamp-2 text-[11px] font-normal leading-snug text-muted-foreground"
                        title={String(r.it.attributes?.remarks ?? "")}
                      >
                        {String(r.it.attributes?.remarks ?? "")}
                      </div>
                    ) : null}
                  </TableCell>
              );

              cells[COL_BRAND] = <TableCell key={COL_BRAND}>{r.it.brand}</TableCell>;
              cells[COL_UNIT] = <TableCell key={COL_UNIT}>{r.it.unit}</TableCell>;

              for (const d of attrCols) {
                cells[attrColKey(d.id)] = (
                  <TableCell
                    key={attrColKey(d.id)}
                    className={specMode ? "bg-muted/40 text-muted-foreground" : undefined}
                    title={specMode ? SPEC_COPY.readFromSpec : undefined}
                  >
                    {editing && !specMode ? (
                      <Input
                        className="h-7 w-28 text-xs"
                        value={draftAttrs[d.id] ?? ""}
                        disabled={rowSaving}
                        onChange={(e) => setDraftAttrs((p) => ({ ...p, [d.id]: e.target.value }))}
                        aria-label={`${d.label} value`}
                      />
                    ) : (
                      cellText(r.it.attributes?.[d.id])
                    )}
                  </TableCell>
                );
              }

              for (const k of rateCols) {
                  // SLICE 12a (owner I-2 / I-3): a DERIVED cost belongs to another catalogue row. It is
                  // MARKED and NOT editable -- no input is rendered, so the value cannot be typed over;
                  // the upload path refuses it server-side as well (`csv_importer`). Every OTHER cell of
                  // the row, its own cost parts and its markups included, stays exactly as editable as
                  // it was.
                  const derived = isDerivedCell(config, r.it.item_uid, k);
                  /**
                   * SLICE 12c FINISH (owner F4): a COMPUTED cell shows the LIVE figure, GREYED and not
                   * editable -- the owner asked to SEE the calculated number, which is what separates
                   * it from a DERIVED cell (amber, and showing the word). Which cells are computed is
                   * told to us by the server beside the items, so the screen never re-derives the rule.
                   * An Aluminium Foil row is absent from that map and stays typed and editable.
                   */
                  const computed = !derived
                    && (computedRateKeys?.[String(r.it.item_uid ?? "")] ?? []).includes(k);
                  const readOnlyCell = derived || computed;
                  // SLICE 12d-2F (owner F1): the figure this cell SHOWS. A computed cell shows the live
                  // figure from `computed_rates`; `r.it.rates` is the stored catalogue and is never the
                  // display source for it (nor is the display figure ever a price input).
                  const shown = displayedRateValue(r.it, k, computed, computedRates);
                  cells[rateColKey(k)] = (
                  <TableCell
                    key={rateColKey(k)}
                    className={cn("text-right tabular-nums", derived && "bg-amber-50 text-amber-900",
                                  computed && "bg-muted text-muted-foreground")}
                    title={derived
                      ? formulaByUid.get(r.it.item_uid ?? "")?.[sideOfRateKey(k) === "install" ? 1 : 0]
                      : computed ? COMPUTED_CELL_TITLE : undefined}
                    data-testid={derived ? "derived-rate-cell" : computed ? "computed-rate-cell" : undefined}
                  >
                    {editing && !readOnlyCell ? (
                      <Input
                        className="h-7 w-24 text-right text-xs"
                        inputMode="decimal"
                        value={draftRates[k] ?? ""}
                        disabled={rowSaving}
                        onChange={(e) => setDraftRates((p) => ({ ...p, [k]: e.target.value }))}
                        aria-label={`${k} value`}
                      />
                    ) : shown === undefined ? (
                      derived ? <span className="text-[10px] italic">{DERIVED_COPY.cellTag}</span> : ""
                    ) : (
                      <>
                        {/* ACCEPTANCE 6: a Pricing Input's factor reads as a PERCENTAGE. The stored
                            value is untouched -- `pricingInputCell` mirrors the server's `as_percent`,
                            so the screen and the rate file can never disagree about which number it is. */}
                        {piMode ? pricingInputCell(k, shown) : shown}
                        {derived && (
                          <span className="ml-1 text-[10px] italic">{DERIVED_COPY.cellTag}</span>
                        )}
                      </>
                    )}
                  </TableCell>
                  );
              }

              cells[COL_PI_SHARED_BY] = (
                    <TableCell key={COL_PI_SHARED_BY} className="align-top text-[11px] text-muted-foreground">
                      <span className="line-clamp-2" title={String(r.it.attributes?.shared_by ?? "")}>
                        {String(r.it.attributes?.shared_by ?? "") || "—"}
                      </span>
                    </TableCell>
              );
                    {/* the remark moved under the NAME (acceptance item 6) -- no column of its own */}
                    {/* READ-ONLY: derived from the pricing rules, so there is no input to type into. */}
                    {/* ⚠️ NEVER `whitespace-nowrap` HERE. In a fixed 190px column a 65-character list
                        overflowed its cell and ran under the items badge -- the owner saw it. */}
                    {/* ⚠️ SLICE 12c: STORED FIRST, DERIVED WHERE NOTHING IS STORED. The rate FILE always
                        DERIVES this (`csv_exporter.pricing_input_used_by`), and the comment at the top of
                        this file says it is "derived from the pricing rules, never edited" -- but the
                        SCREEN has always rendered a STORED attribute, and Electrical's items carry one in
                        a DIFFERENT format (display names joined by a middot) from the derived string. So
                        deriving unconditionally would change Electrical's column, which cert step 6
                        requires byte-identical. */}
              cells[COL_PI_USED_BY] = (
                    <TableCell key={COL_PI_USED_BY} className="align-top text-[11px] text-muted-foreground" data-testid="pi-used-by">
                      <span className="line-clamp-2" title={usedByText(r.it)}>
                        {usedByText(r.it)}
                      </span>
                    </TableCell>
              );
              cells[COL_PI_ITEMS] = (
                      <TableCell key={COL_PI_ITEMS} className="text-right">
                        <button
                          type="button"
                          onClick={() => onOpenImpact?.(
                            openImpactUid === r.it.item_uid ? null : (r.it.item_uid ?? null))}
                          className={cn(
                            "inline-flex h-5 min-w-[2.5rem] items-center justify-center rounded-full border px-2",
                            "text-[11px] font-semibold tabular-nums",
                            openImpactUid === r.it.item_uid
                              ? "border-rose-600 bg-rose-600 text-white"
                              : "border-input bg-background text-muted-foreground hover:text-foreground")}
                          data-testid="pi-items-count"
                        >
                          {impactCountFor(r.it)}
                        </button>
                      </TableCell>
              );

              cells[COL_SOURCE_SHEET] = <TableCell key={COL_SOURCE_SHEET}>{r.it.source_sheet}</TableCell>;
              cells[COL_SOURCE_ROW] = <TableCell key={COL_SOURCE_ROW} className="text-right tabular-nums">{r.it.source_row}</TableCell>;
              {/* SLICE 12a (owner I-6): the two READ-ONLY formula columns, on every row of every
                  discipline -- the same text the rate file carries, rendered by the same helpers. */}
              cells[COL_FORMULA_SUPPLY] = (
                  <TableCell key={COL_FORMULA_SUPPLY} className="max-w-[22rem] whitespace-pre-line text-[11px] text-muted-foreground">
                    {formulaByUid.get(r.it.item_uid ?? "")?.[0] ?? FORMULA_TYPED}
                  </TableCell>
              );
              cells[COL_FORMULA_INSTALL] = (
                  <TableCell key={COL_FORMULA_INSTALL} className="max-w-[22rem] whitespace-pre-line text-[11px] text-muted-foreground">
                    {formulaByUid.get(r.it.item_uid ?? "")?.[1] ?? FORMULA_TYPED}
                  </TableCell>
              );

              return (
              /* ⚠️ COMPACT PADDING IN PRICING-INPUTS MODE ONLY -- the owner's rule is that no row
                 exceeds five lines of text, and the default cell padding alone was over a line. */
              <TableRow key={r.it.name ?? i} className={cn(piMode && "[&>td]:py-1.5 align-top")}>
                {gridCols.map((key) => cells[key] ?? <TableCell key={key} />)}
              </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={gridCols.length} className="text-center text-muted-foreground">
                  No rows match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {/* EA-1c change 3: the single proxy H-scrollbar -- sticky at the bottom of the visible area,
          full extent (spacer == scrollWidth, visible width == clientWidth). Rendered only when the
          content actually overflows horizontally. */}
      {hScroll.scrollWidth > hScroll.clientWidth && (
        <div
          ref={proxyRef}
          // border-t only (a left/right border would shrink the content width -> proxy range != scroller range).
          className="sticky bottom-0 z-20 overflow-x-auto overflow-y-hidden border-t border-border bg-background/95"
          style={{ height: 14, width: hScroll.clientWidth || undefined }}
          aria-hidden
        >
          <div style={{ width: `${hScroll.scrollWidth}px`, height: 1 }} />
        </div>
      )}

      {/* RM-4a: deactivate confirm (freeze-and-supersede -- the row is retained inactive, never deleted). */}
      <AlertDialog open={!!confirmDeactivate} onOpenChange={(o) => { if (!o) { setConfirmDeactivate(null); setDeactivateErr(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this rate row?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeactivate?.label} will drop from the active list (it is retained inactive, never
              deleted). New suggestions stop using it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doDeactivate()}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* RM-4a: add a manual item (built from the attribute definitions + known rate keys). EA-1c: keyed
          by category so its internal state (kind/attrs/rates) is fresh per category, and category-scoped. */}
      {isAdmin && onCreateItem && (
        <AddItemDialog
          key={config.category_id}
          open={addOpen}
          onOpenChange={setAddOpen}
          config={config}
          rateCols={rateCols}
          kinds={kinds}
          specMode={specMode}
          textDefs={textCols}
          onCreate={onCreateItem}
        />
      )}
    </div>
  );
}

// RM-4a: the Add-item form -- selects/inputs built from the attribute definitions + the known rate
// keys. Attribute choices come from each definition's stored values; numbers + rates are free inputs.
// Manual provenance ("Manual entry", batch manual-...) is stamped server-side.
/**
 * SLICE 1f -- the duplicate warning in a form (owner Y-a / Y-b 3 / Y-e): the approved sentence with BOTH wordings
 * and BOTH sets of numbers, Confirm / Decline. The same text as the upload preview; nothing is decided here.
 */
function TwinQuestion({ twin, busy, onAnswer, testId }: {
  twin: UploadTwin; busy: boolean; onAnswer: (d: TwinDecision) => void; testId: string;
}) {
  return (
    <div className="max-w-[24rem] rounded border border-orange-500/50 bg-orange-50 p-1.5 text-left text-[10px] text-orange-950 dark:bg-orange-950/30 dark:text-orange-200" data-testid={testId}>
      <div>{TWIN_COPY.warning(twin.existing_wording, twin.item_uid, twin.row_wording)}</div>
      {twin.case === "edit" && twin.edited_item_uid ? <div className="mt-0.5">{TWIN_COPY.editNote(twin.edited_item_uid)}</div> : null}
      <div className="mt-0.5 font-mono">{TWIN_COPY.existingNumbers}: {twinNumbers(twin.existing_rates) || "—"}</div>
      <div className="font-mono">{TWIN_COPY.rowNumbers}: {twinNumbers(twin.row_rates) || "—"}</div>
      <div className="mt-1 flex gap-1">
        <Button size="sm" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => onAnswer("confirm")} aria-label="Confirm duplicate">{TWIN_COPY.confirm}</Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => onAnswer("decline")} aria-label="Decline duplicate">{TWIN_COPY.decline}</Button>
      </div>
    </div>
  );
}

function AddItemDialog({
  open, onOpenChange, config, rateCols, kinds, specMode, textDefs, onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  config: RateCategoryConfig;
  rateCols: string[];
  kinds: string[];
  // SLICE 1c: a spec-driven category -- the form takes Item + Item detail + unit + the numbers, and
  // NOTHING else; the server runs the reader on save (the same one the upload uses) and flags what it
  // cannot understand. No brand, no attribute inputs: there is no back door.
  specMode?: boolean;
  textDefs?: AttributeDefinition[];
  onCreate: (payload: CreateItemPayload) => Promise<SpecConfirmationReply | undefined | void>;
}) {
  const attrDefs = useMemo(() => config.attribute_definitions.filter((d) => d.id !== "brand"), [config]);
  const brandDef = useMemo(() => config.attribute_definitions.find((d) => d.id === "brand"), [config]);
  const [kind, setKind] = useState(kinds[0] ?? "cable");
  const [brand, setBrand] = useState(String(brandDef?.values?.[0] ?? ""));
  const [unit, setUnit] = useState("");
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // SLICE 1d: the server's "needs confirmation" reply for THIS entry -- the form asks before anything is saved.
  const [ask, setAsk] = useState<{ payload: CreateItemPayload; reply: SpecConfirmationReply } | null>(null);
  // SLICE 1f (owner Y-a): the entry means the same as an existing item -- the server wrote NOTHING and asks;
  // Confirm updates the EXISTING item's rates (no new item), Decline sends nothing and leaves the form open.
  const [twinAsk, setTwinAsk] = useState<{ payload: CreateItemPayload; twin: UploadTwin } | null>(null);

  const send = async (payload: CreateItemPayload) => {
    setSaving(true);
    setErr(null);
    try {
      const reply = await onCreate(payload);
      if (reply && reply.needs_confirmation) {
        setAsk({ payload, reply });
        return;
      }
      setAsk(null);
      if (reply && reply.needs_twin_confirmation && reply.twin) {
        setTwinAsk({ payload, twin: reply.twin });
        return;
      }
      setTwinAsk(null);
      onOpenChange(false);
      setAttrs({});
      setRates({});
    } catch (e) {
      setErr((e as { message?: string })?.message ?? "Create failed");
    } finally {
      setSaving(false);
    }
  };
  const answerAsk = async (d: SpecDecision) => {
    if (!ask) return;
    const fp = ask.reply.suggestion?.fingerprint;
    await send({ ...ask.payload, spec_decision: d, spec_fingerprint: d === "accept" ? fp : undefined });
  };
  const answerTwin = async (d: TwinDecision) => {
    if (!twinAsk) return;
    if (d === "decline") {
      setTwinAsk(null);          // no request, no change; the entry stays for the user to change or cancel
      return;
    }
    await send({ ...twinAsk.payload, twin_decision: "confirm", twin_fingerprint: twinAsk.twin.fingerprint });
  };

  const submit = async () => {
    setAsk(null);
    setTwinAsk(null);
    const attributes: Record<string, string | number> = {};
    if (specMode) {
      for (const d of textDefs ?? []) attributes[d.id] = attrs[d.id] ?? "";
      if (!String(attributes.item_name ?? "").trim()) {
        setErr(`${SPEC_COPY.itemLabel} is required.`);
        return;
      }
    } else {
      for (const d of attrDefs) {
        const raw = attrs[d.id];
        if (raw === undefined || raw === "") continue;
        attributes[d.id] = coerceAttributeForStorage(d, raw);
      }
    }
    const rateOut: Record<string, number | null> = {};
    for (const k of rateCols) {
      const raw = rates[k];
      if (raw === undefined || raw.trim() === "") continue;
      const n = parseFiniteInput(raw);
      if (n === null) {
        setErr(`Rate '${k}' must be a number.`);
        return;
      }
      rateOut[k] = n;
    }
    await send({ kind, brand: specMode ? undefined : (brand || undefined), unit: unit || undefined, attributes, rates: rateOut });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add rate master item</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">kind</span>
            {/* EA-1c change 4: preselected read-only text when the category has one kind; a select when several. */}
            {kinds.length <= 1 ? (
              <div className="flex h-8 items-center rounded border px-3 text-sm text-muted-foreground">{kind || "(none)"}</div>
            ) : (
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </label>
          {!specMode && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">brand</span>
              <Input className="h-8" value={brand} onChange={(e) => setBrand(e.target.value)} />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">unit</span>
            <Input className="h-8" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
          {specMode && (textDefs ?? []).map((d) => (
            <label key={d.id} className="col-span-2 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{d.label}</span>
              <Input
                className="h-8"
                value={attrs[d.id] ?? ""}
                onChange={(e) => setAttrs((p) => ({ ...p, [d.id]: e.target.value }))}
                aria-label={`${d.label} value`}
              />
            </label>
          ))}
          {specMode && (
            <p className="col-span-2 text-[11px] text-muted-foreground">{SPEC_COPY.addHint}</p>
          )}
          {!specMode && attrDefs.map((d) => (
            <label key={d.id} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{d.label}</span>
              {/* a DROPDOWN type with a static list gets a Select; a number_choice whose domain is
                  values_from carries no static list here (the Data tab does not resolve it) and so
                  falls through to the numeric input below -- byte-identical for choice/number. */}
              {isDropdownAttributeType(d.type) && d.values?.length ? (
                <Select value={attrs[d.id] ?? ""} onValueChange={(v) => setAttrs((p) => ({ ...p, [d.id]: v }))}>
                  <SelectTrigger className="h-8"><SelectValue placeholder={`Select ${d.label}`} /></SelectTrigger>
                  <SelectContent>
                    {d.values.map((v) => (
                      <SelectItem key={String(v)} value={String(v)}>{String(v)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-8"
                  inputMode={isNumericAttributeType(d.type) ? "decimal" : "text"}
                  value={attrs[d.id] ?? ""}
                  onChange={(e) => setAttrs((p) => ({ ...p, [d.id]: e.target.value }))}
                />
              )}
            </label>
          ))}
          {rateCols.map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{k}</span>
              <Input
                className="h-8"
                inputMode="decimal"
                value={rates[k] ?? ""}
                onChange={(e) => setRates((p) => ({ ...p, [k]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        {ask && ask.reply.suggestion ? (
          // SLICE 1d (owner T-b 6): the entry was not read exactly -- the same question the upload asks,
          // answered BEFORE anything is saved. Reject saves it flagged; Accept saves it confirmed.
          <div className="rounded border border-amber-500/40 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="add-spec-question">
            <div>{specQuestion(String(ask.payload.attributes.item_name ?? ""), String(ask.payload.attributes.item_detail ?? ""), ask.reply.suggestion)}</div>
            {ask.reply.suggestion.notes.length ? (
              <div className="mt-0.5 text-[11px] opacity-80">{Array.from(new Set(ask.reply.suggestion.notes)).join("; ")}</div>
            ) : null}
            <div className="mt-1.5 flex gap-2">
              <Button size="sm" className="h-7" disabled={saving} onClick={() => void answerAsk("accept")} aria-label="Accept suggestion">{SPEC_CONFIRM_COPY.accept}</Button>
              <Button size="sm" variant="outline" className="h-7" disabled={saving} onClick={() => void answerAsk("reject")} aria-label="Reject suggestion">{SPEC_CONFIRM_COPY.reject}</Button>
            </div>
          </div>
        ) : null}
        {twinAsk ? (
          <TwinQuestion twin={twinAsk.twin} busy={saving} onAnswer={(d) => void answerTwin(d)} testId="add-twin-question" />
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !kind || !!ask || !!twinAsk}>Add item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Per-column faceted filter: a funnel button in the column header opens a popover with a type-to-search
// box + a checkbox list of that column's DISTINCT values. Multi-select (OR within the column; the table
// composes columns with AND). A count badge + Clear show when active. Values come from the live data.
function ColumnFilter({
  label,
  values,
  selected,
  onChange,
}: {
  label: string;
  values: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => (q ? values.filter((v) => v.toLowerCase().includes(q.toLowerCase())) : values),
    [values, q],
  );
  const active = selected.length > 0;
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filter ${label}`}
          className={cn(
            "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring",
            active && "text-primary",
          )}
        >
          <Filter className="h-3 w-3" />
          {active && <span className="text-[10px] font-semibold tabular-nums">{selected.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <Input
          autoFocus
          className="h-7 text-xs"
          placeholder={`Search ${label}...`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
          {shown.length === 0 && (
            <div className="px-1 py-2 text-xs text-muted-foreground">No values.</div>
          )}
          {shown.map((v) => (
            <label
              key={v}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted"
            >
              <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} />
              <span className="truncate">{v}</span>
            </label>
          ))}
        </div>
        {active && (
          <button
            type="button"
            className="mt-2 w-full rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            onClick={() => onChange([])}
          >
            Clear ({selected.length})
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
