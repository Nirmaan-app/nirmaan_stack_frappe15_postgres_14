/**
 * GeminiSuggestionColumn -- DUAL-AI (ADR-0003 sec 8A). The "Gemini" provider column for the
 * BoQ review tree: a header <th> + a body <td> rendering confidence badges for a PENDING
 * Gemini suggestion. A VISUAL CLONE of Nitesh's Claude "AI Rec" column (ReviewTree.tsx), only
 * reading the gemini_* fields and computing divergence vs the PARSER classification.
 *
 * Nitesh's Claude column stays byte-identical; this is a SECOND fixed column mounted directly
 * after it. The pieces are exported so ReviewTree mounts the header + cell next to the Claude
 * ones, sharing the same sticky-header / border idiom.
 *
 * Parity rules (mirror Claude, swap ai_ -> gemini_):
 *   - Badges show ONLY while gemini_suggestion_status === "Pending" (Accepted/Rejected are
 *     resolved -> no badge). Classification + parent each get one H/M/L pill; both -> two.
 *   - DIVERGENCE marker (the column's job, R1 / ADR-0006 sec 5): DIFFS-ONLY vs the PARSER. A
 *     class suggestion "counts" only when it differs from the parser classification AND is not a
 *     detection-only class (subtotal_marker / header_repeat -- never accept targets). A parent
 *     suggestion "counts" only when the gemini parent differs from the parser parent_index (a
 *     real new parent, or a re-root of a previously-parented row); root-vs-root is no signal.
 *     This vs-PARSER comparison is the column's display intent and is intentionally DISTINCT from
 *     the accept block's vs-effective gating (what is applicable) -- the two must not be unified.
 */
import { cn } from "@/lib/utils";
import { Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ReviewRow } from "./boqTypes";

// ── Gemini suggestion shape (mirror of ReviewTree's AiSuggestionInfo, gemini_* namespace) ──
// A suggestion only "counts" while gemini_suggestion_status === "Pending". R1 (ADR-0006 sec 5):
// DIFFS-ONLY vs the PARSER -- a class suggestion shows only when it diverges from the parser
// classification (and is NOT a detection-only class); a parent suggestion shows only when the
// gemini parent differs from the parser parent_index (root-vs-root carries no signal).
export interface GeminiSuggestionInfo {
  pending: boolean;
  hasClass: boolean;
  hasParent: boolean;
  classConf: "High" | "Medium" | "Low" | null;
  parentConf: "High" | "Medium" | "Low" | null;
}

export function geminiSuggestionInfo(row: ReviewRow): GeminiSuggestionInfo {
  const pending = row.gemini_suggestion_status === "Pending";
  // R1 (ADR-0006 sec 5): DIFFS-ONLY vs the PARSER. The column highlights a Gemini divergence
  // only when it actually differs from the parser on classification or parent -- matching how
  // Claude behaves (its corrector only writes ai_* on changed rows). NOTE: this vs-PARSER
  // comparison is intentionally distinct from the ACCEPT BLOCK's vs-effective gating (which
  // governs what can be applied); do not unify them.
  //
  // Classification divergence: gemini class differs from parser classification. R1 EXCLUDES a
  // divergence TO a detection-only class (subtotal_marker / header_repeat) -- those are parser
  // detections, never accept targets, so a suggestion to one carries no actionable signal.
  const DETECTION_ONLY = row.gemini_suggested_classification === "subtotal_marker" ||
    row.gemini_suggested_classification === "header_repeat";
  const hasClass =
    pending &&
    row.gemini_suggested_classification != null &&
    row.gemini_suggested_classification !== row.classification &&
    !DETECTION_ONLY;
  // Parent divergence vs the PARSER parent_index (NOT effective_parent_index):
  //   (a) gemini roots this row (gemini_suggested_is_root === 1) while the parser had a real
  //       parent (parent_index != null && >= 0)  -- a real re-root signal; or
  //   (b) a real gemini_suggested_parent (!= null && !== -1) that differs from parent_index.
  // Root-vs-root (parser already root + gemini root) carries no signal -> false.
  const geminiRoot = row.gemini_suggested_is_root === 1;
  const parserHasParent = row.parent_index != null && row.parent_index >= 0;
  const hasParent =
    pending &&
    ((geminiRoot && parserHasParent) ||
      (!geminiRoot &&
        row.gemini_suggested_parent != null &&
        row.gemini_suggested_parent !== -1 &&
        row.gemini_suggested_parent !== row.parent_index));
  return {
    pending,
    hasClass,
    hasParent,
    classConf: hasClass ? (row.gemini_classification_confidence ?? null) : null,
    parentConf: hasParent ? (row.gemini_parent_confidence ?? null) : null,
  };
}

// Does a row carry a pending Gemini suggestion at the given confidence (either axis)?
export function geminiHasConfidence(
  info: GeminiSuggestionInfo,
  level: "High" | "Medium" | "Low",
): boolean {
  return info.classConf === level || info.parentConf === level;
}

// Gemini column filter (mirror of ReviewTree's AiFilter). "all" = no narrowing; "any" = a
// pending Gemini suggestion exists; high/medium/low = a pending suggestion at that confidence
// in either axis.
export type GeminiFilter = "all" | "any" | "high" | "medium" | "low";
export const GEMINI_FILTER_LABELS: Record<GeminiFilter, string> = {
  all: "Show all rows",
  any: "Any Gemini suggestion",
  high: "Has High",
  medium: "Has Medium",
  low: "Has Low",
};

// Confidence -> small-pill classes. Mirrors AI_CONF_PILL (High=green, Medium=amber, Low=gray).
const GEMINI_CONF_PILL: Record<"High" | "Medium" | "Low", string> = {
  High: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200",
  Medium: "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200",
  Low: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300",
};

// One H/M/L pill (clone of ReviewTree's AiConfBadge). Exported for reuse by GeminiAcceptBlock.
export function GeminiConfBadge({
  conf,
  title,
}: {
  conf: "High" | "Medium" | "Low" | null;
  title: string;
}) {
  const label = conf ? conf[0] : "?"; // H / M / L (or ? when the model omitted confidence)
  const cls = conf
    ? GEMINI_CONF_PILL[conf]
    : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
  return (
    <span
      title={title}
      className={cn(
        "rounded-full py-0.5 px-1.5 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap",
        cls,
      )}
    >
      {label}
    </span>
  );
}

// ── Header cell ───────────────────────────────────────────────────────────────
// Clones the Claude "AI Rec" <th> (sticky-top, w-20, border-r, filter Popover), reading
// "Gemini" + the gemini filter. Mounted by ReviewTree directly after the Claude header <th>.
export function GeminiHeaderCell({
  geminiFilter,
  setGeminiFilter,
}: {
  geminiFilter: GeminiFilter;
  setGeminiFilter: (f: GeminiFilter) => void;
}) {
  const geminiFilterActive = geminiFilter !== "all";
  return (
    <th className="px-2 py-2 text-left font-medium text-muted-foreground w-20 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
      <div className="flex items-center gap-1">
        <span>Gemini</span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex items-center justify-center h-4 w-4 rounded transition-colors",
                geminiFilterActive
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-muted-foreground/60 hover:text-foreground",
              )}
              aria-label="Filter by Gemini suggestion"
              title="Filter by Gemini suggestion"
            >
              <Filter className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto min-w-[160px] p-2">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Gemini suggestion
            </p>
            <div className="space-y-0.5">
              {(["all", "any", "high", "medium", "low"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setGeminiFilter(opt)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors",
                    geminiFilter === opt
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {GEMINI_FILTER_LABELS[opt]}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </th>
  );
}

// ── Body cell ─────────────────────────────────────────────────────────────────
// Clones the Claude "AI Rec" body <td>: classification + parent badges for a PENDING Gemini
// suggestion; blank when none / resolved. Mounted by ReviewTree directly after the Claude cell.
export function GeminiBodyCell({ row }: { row: ReviewRow }) {
  const info = geminiSuggestionInfo(row);
  return (
    <td className="px-2 py-1.5 align-top w-20 border-r border-border">
      {info.hasClass || info.hasParent ? (
        <div className="flex items-center gap-1">
          {info.hasClass && (
            <GeminiConfBadge
              conf={info.classConf}
              title={`Gemini suggests classification: ${row.gemini_suggested_classification ?? "?"}${info.classConf ? ` (${info.classConf})` : ""}`}
            />
          )}
          {info.hasParent && (
            <GeminiConfBadge
              conf={info.parentConf}
              title={
                row.gemini_suggested_is_root === 1
                  ? `Gemini suggests making this a top-level root${info.parentConf ? ` (${info.parentConf})` : ""}`
                  : `Gemini suggests a new parent${info.parentConf ? ` (${info.parentConf})` : ""}`
              }
            />
          )}
        </div>
      ) : null}
    </td>
  );
}
