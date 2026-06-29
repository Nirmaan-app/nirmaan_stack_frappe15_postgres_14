/**
 * VersionRibbon -- the read-only version-history browser band for the pricing editor
 * (Phase 5 version-view). Renders ABOVE the editor's top ribbon as its own outermost band, so it
 * shows on ALL sheet types (including grid-only) -- it sits above the `{!isGridOnly}` bottom-ribbon
 * gate. A version dropdown selects a committed version; the CURRENT version is tagged
 * "Current (live)" (the only editable one) and earlier versions are labelled by their last pricing
 * change (or committed_at + "never priced" when the version was committed but never priced -- a
 * common case). Selecting an earlier version drops the editor into read-only history mode (the page
 * forces read-only via its `locked` choke); this band then shows a distinct read-only banner.
 *
 * Build-NO copy-forward here -- the read-only history mode is the surface copy-forward will later
 * launch from, but this slice builds NO copy/apply action (owner-locked scope).
 */
import { Copy, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/utils/FormatDate";
import type { SheetVersionRow } from "./boqTypes";

export type VersionLabelParts =
  | { kind: "current" }
  | { kind: "priced"; date: string | null }
  | { kind: "never_priced"; date: string | null };

/**
 * PURE label-shape decision (vitest-tested; deliberately does NO date formatting so it stays
 * locale-independent). The CURRENT version -> "current" (no date; the only editable one). Else, if
 * the version carries a last pricing change -> "priced" with that timestamp. Else (committed but
 * NEVER priced -- a common case: all of VRF, Electrical v1/v2, HVAC v1-v3) -> "never_priced" with
 * committed_at as the fallback timestamp.
 */
export function versionLabelParts(
  v: SheetVersionRow,
  currentVersion: number | null,
): VersionLabelParts {
  if (v.is_current || v.commit_version === currentVersion) return { kind: "current" };
  if (v.last_change_at) return { kind: "priced", date: v.last_change_at };
  return { kind: "never_priced", date: v.committed_at };
}

/** Render the parts to a human label (formats the date via the house dd-MMM-yyyy formatter). */
export function formatVersionLabel(v: SheetVersionRow, currentVersion: number | null): string {
  const parts = versionLabelParts(v, currentVersion);
  const base = `Version ${v.commit_version}`;
  if (parts.kind === "current") return `${base} — Current (live)`;
  if (parts.kind === "priced") return `${base} — ${parts.date ? formatDate(parts.date) : "edited"}`;
  return `${base} — ${parts.date ? formatDate(parts.date) : "committed"} · never priced`;
}

interface VersionRibbonProps {
  versions: SheetVersionRow[];
  /** The current committed version (null when nothing is committed). */
  currentVersion: number | null;
  /** The selected version, or null when viewing the current/live version. */
  selectedVersion: number | null;
  /** Called with the chosen version number; the page maps current -> null (back to live). */
  onSelectVersion: (version: number) => void;
  /** True when an EARLIER version is selected (the editor is read-only history). */
  isViewingHistory: boolean;
  /** Launch the copy-forward review dialog (carry this old version's rates into current). Optional
   * -- the button shows only when provided AND viewing history. */
  onCopyForward?: () => void;
}

export function VersionRibbon({
  versions,
  currentVersion,
  selectedVersion,
  onSelectVersion,
  isViewingHistory,
  onCopyForward,
}: VersionRibbonProps) {
  // A single-version sheet has no history to browse -> no ribbon. (Version-COUNT gated, NOT
  // sheet-type gated: a grid-only sheet with 2+ versions still gets the ribbon.)
  if (versions.length < 2) return null;

  // The dropdown's value: the selected version, else the current version when live.
  const value = String(selectedVersion ?? currentVersion ?? "");

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <History className="h-4 w-4" />
        Version
      </div>
      <Select value={value} onValueChange={(val) => onSelectVersion(Number(val))}>
        <SelectTrigger className="h-8 w-[18rem] text-xs">
          <SelectValue placeholder="Select a version" />
        </SelectTrigger>
        <SelectContent>
          {versions.map((v) => (
            <SelectItem key={v.commit_version} value={String(v.commit_version)} className="text-xs">
              {formatVersionLabel(v, currentVersion)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isViewingHistory && selectedVersion !== null && (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
          <History className="h-3.5 w-3.5" />
          Viewing Version {selectedVersion} — read-only history
        </span>
      )}

      {/* Copy-forward launch -- the ONE write action reachable from read-only history mode. It
          writes to the CURRENT version (not the viewed one); the dialog reviews every row first. */}
      {isViewingHistory && onCopyForward && (
        <Button size="sm" variant="outline" className="ml-auto h-8 gap-1.5" onClick={onCopyForward}>
          <Copy className="h-4 w-4" />
          Copy rates forward
        </Button>
      )}
    </div>
  );
}
