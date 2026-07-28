/**
 * CategoryVerdictPicker -- the CL-3 click-to-edit human category verdict picker (BoQ Phase 5).
 *
 * A small Radix Popover anchored to an EXTERNAL grid cell (via a virtual anchor -- the cell lives
 * in the memoized PricingGrid row, NOT inside this component). The page owns the open-state +
 * anchor element; this component only renders the choices. Picking a category calls
 * onSelect(id); the bottom "Clear verdict" action calls onSelect("") (revert to the machine
 * answer). The parent closes the picker after onSelect.
 *
 * The pure helpers (deriveVerdictState / isRowEditable / labelFor / buildEngineGroups) are the
 * vitest-tested surface -- the grid cell reads deriveVerdictState/isRowEditable/labelFor for its
 * display + editability gate, and the page reads buildEngineGroups to build the picker's groups.
 */
import { Check, RotateCcw } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { EngineCatalog, SheetCategoryRow } from "./boqTypes";

// ── Pure helpers (vitest-tested) ─────────────────────────────────────────────────

/**
 * The verdict "state" of a category row -- drives the grid cell's visual treatment + editability.
 *   unclassified -- no effective verdict (blank / skipped / not classified). NOT editable.
 *   carried      -- the verdict arrived via the cross-BoQ revision carry, not from this sheet.
 *                   Editable like any other verdict.
 *   human        -- the user set an explicit human_category_id (trimmed non-empty). The "edited" cue.
 *   needs_review -- routed to review with no human pick yet (the amber cue).
 *   auto         -- an auto-accepted machine verdict.
 *
 * ORDER MATTERS: a blank effective short-circuits to "unclassified" first; then PROVENANCE
 * (carried) outranks decision-type; then a local human pick; then the routing.
 *
 * ⚠️ "carried" covers EVERY carried row, machine or human (ADR-0014 Amendment E, owner ruling
 * 2026-07-28). Provenance is the axis being reported: a reviewer auditing a revision wants to see
 * at a glance which rows were INHERITED from the original versus decided on this sheet, and that
 * question is not answered by who decided them. The cost is accepted and is real -- on a freshly
 * carried sheet most rows read sky, and the auto-vs-human distinction is not visible on those rows
 * until the carried ones are worked through.
 *
 * ⚠️ The one ordering interaction worth naming: a CARRIED row that is also routed "Needs review"
 * with no human pick now reads "carried" rather than "needs_review". That combination is
 * unreachable from the resolved read -- a resolved review row has a BLANK effective, which
 * short-circuits to "unclassified" two lines above -- so no amber review cue is actually masked.
 * If a future read makes it reachable, review is an ACTION signal and should win; move the routing
 * check above the provenance check at that point.
 */
export function deriveVerdictState(
  cat: SheetCategoryRow | undefined,
): "unclassified" | "auto" | "needs_review" | "human" | "carried" {
  if (!cat) return "unclassified";
  const effective = (cat.effective_category_id ?? "").trim();
  if (!effective) return "unclassified";
  if (cat.carried_from_boq) return "carried";
  if ((cat.human_category_id ?? "").trim()) return "human";
  if (cat.routing === "Needs review") return "needs_review";
  return "auto";
}

/**
 * A row is editable (the verdict can be picked) iff it is CLASSIFIED -- i.e. it has some effective
 * verdict. A blank / unclassified / skipped row has nothing to override, so it is read-only.
 */
export function isRowEditable(cat: SheetCategoryRow | undefined): boolean {
  return !!cat && deriveVerdictState(cat) !== "unclassified";
}

/**
 * The display label for a category id -- the mapped label, falling back to the raw id when the id
 * is missing from the map / maps to a blank label. An empty id yields "" (no verdict).
 */
export function labelFor(
  id: string,
  labelById: Map<string, string> | Record<string, string>,
): string {
  if (!id) return "";
  const hit = labelById instanceof Map ? labelById.get(id) : labelById[id];
  return hit && hit.trim() ? hit : id;
}

/**
 * The groups the picker renders: ENGINE-SCOPED -- only catalogs whose discipline was actually run
 * on this sheet (`runDisciplines`), deduped and order-stable (catalog order), each keeping ONLY
 * its own categories. NOT the full all-engines catalog unconditionally. v1: runDisciplines =
 * ["Electrical"] -> one group.
 */
export function buildEngineGroups(
  runDisciplines: string[],
  catalogs: EngineCatalog[],
): EngineCatalog[] {
  const wanted = new Set(runDisciplines);
  const seen = new Set<string>();
  const out: EngineCatalog[] = [];
  for (const c of catalogs) {
    if (!wanted.has(c.discipline)) continue;
    if (seen.has(c.discipline)) continue;
    seen.add(c.discipline);
    out.push(c);
  }
  return out;
}

// ── Component ────────────────────────────────────────────────────────────────────

interface CategoryVerdictPickerProps {
  open: boolean;
  /** The grid cell the popover anchors to (a virtual anchor -- the element lives outside this tree). */
  anchorEl: HTMLElement | null;
  /** The engine groups to render (buildEngineGroups output). */
  groups: EngineCatalog[];
  /** The currently-selected verdict id (human pick, else effective) -- marked with a check. */
  currentId: string;
  /**
   * Pick a category, or clear the verdict. HV-10: the pick CARRIES its group's discipline so the
   * write lands on that engine's row identity. A category pick passes `(id, group.discipline)`;
   * "Clear verdict" passes `("", null)` -- the page clears the row's currently-resolved human
   * discipline (which the picker does not know). The parent closes the picker after this.
   */
  onSelect: (id: string, discipline: string | null) => void;
  /** Fired on escape / outside-click so the page can drop its open-state. */
  onClose: () => void;
}

export function CategoryVerdictPicker({
  open,
  anchorEl,
  groups,
  currentId,
  onSelect,
  onClose,
}: CategoryVerdictPickerProps) {
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {/* Virtual anchor: renders no DOM -- it positions the popover at the external grid cell. */}
      <PopoverAnchor virtualRef={{ current: anchorEl }} />
      <PopoverContent align="start" sideOffset={4} className="w-64 p-0">
        <div className="max-h-72 overflow-y-auto py-1">
          {groups.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No classification engines were run on this sheet.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.discipline} className="py-1">
                <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </div>
                {group.categories.map((c) => {
                  const active = c.id === currentId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onSelect(c.id, group.discipline)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/60",
                        active ? "font-medium text-foreground" : "text-foreground",
                      )}
                    >
                      <Check
                        aria-hidden
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-primary",
                          active ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{c.label}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => onSelect("", null)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/60"
          >
            <RotateCcw aria-hidden className="h-3.5 w-3.5 shrink-0" />
            Clear verdict (use machine answer)
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
