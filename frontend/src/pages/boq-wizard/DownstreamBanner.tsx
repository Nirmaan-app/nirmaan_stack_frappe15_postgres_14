import { AlertTriangle } from "lucide-react";
import { useFrappeGetCall } from "frappe-react-sdk";

interface DownstreamState {
  committed_version: number | null;
  orphanable_count: number;
  live_holder: string | null;
}

/**
 * On-entry directional banner (ADR-0011 Amendment A1). Read-only AWARENESS: the sheet you are
 * viewing is an UPSTREAM (pre-pricing) stage, and its CURRENT committed version already carries
 * priced work. Re-parsing / re-committing / un-finalizing it -- or reworking it and re-committing
 * -- would ORPHAN that pricing onto the frozen version. This banner never blocks (the interrupting
 * confirm is on save); it just makes the risk visible on entry. When ANOTHER user holds a fresh
 * pricing lock it NAMES them (the "Live" case), else it is count-only (the "Vacated" case).
 *
 * Renders NOTHING when there is no orphanable work (uncommitted / unpriced sheet). On-mount read
 * only (no live-refresh in v1) -- the save-time guard re-checks live state authoritatively.
 */
export function DownstreamBanner({ boqId, sheetName }: { boqId?: string; sheetName?: string }) {
  const { data } = useFrappeGetCall<{ message: DownstreamState }>(
    "nirmaan_stack.api.boq.wizard.directional_guard.get_downstream_state",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName ? undefined : null, // swrKey null disables until both are set
  );
  const state = data?.message;
  if (!state || state.orphanable_count === 0) return null;

  const { committed_version, orphanable_count, live_holder } = state;
  const cells = `${orphanable_count} priced cell${orphanable_count !== 1 ? "s" : ""}`;
  return (
    <div className="rounded-md border border-amber-400/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200 flex items-start gap-2.5">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <div>
        <span className="font-semibold">
          This sheet is committed
          {committed_version != null ? ` (v${committed_version})` : ""} and priced.
        </span>{" "}
        {live_holder ? (
          <span className="font-semibold">{live_holder} is pricing it right now. </span>
        ) : null}
        Re-parsing, re-committing or un-finalizing it will orphan {cells} on the frozen version
        &mdash; they are not carried forward. You can still proceed; you&rsquo;ll be asked to
        confirm on save.
      </div>
    </div>
  );
}
