import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/utils/FormatDate";
import type { CommittedSheet } from "./revisionMapping";

/**
 * Zone 1 -- "What you're revising" (ADR-0014 D3, the F2 control).
 *
 * Shows the picked original's IDENTITY -- name, version, commit date and its committed-sheet
 * list. This is deliberately NOT a restatement of the pick: the sheet list is what the user did
 * NOT see at pick time and what differs between the right and a wrong original.
 *
 * ⚠️ The carry COUNTS deliberately do NOT render here (owner call, 2026-07-22). The endpoint
 * still returns `carry_counts`, but on this screen any number is a CEILING, not a projection:
 * the row match that decides what actually carries (same Excel row + same description + the
 * parent matched too) cannot run until the revised workbook is parsed, and rates never carry
 * automatically at all -- they are an explicit post-commit action (`cross_boq_carry`). Showing
 * it here read as a promise the screen cannot keep. The real, MATCHED numbers are reported
 * where they are known: `revisionCarryReport.ts` (hub parse modal + CommitResultsModal).
 * Do not re-add a count to this panel without a way to make it a real projection.
 */
export interface RevisionIdentity {
  boq_name: string;
  source_version: number | null;
  committed_at: string | null;
  committed_sheets: CommittedSheet[];
}

export function RevisionIdentityPanel({ identity }: { identity: RevisionIdentity }) {
  const { boq_name, source_version, committed_at, committed_sheets } = identity;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What you're revising</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="font-medium text-foreground">
          {boq_name}
          {source_version != null && (
            <span className="text-muted-foreground"> · v{source_version}</span>
          )}
          {committed_at && (
            <span className="text-muted-foreground"> · committed {formatDate(committed_at)}</span>
          )}
        </p>

        <div>
          <p className="text-xs text-muted-foreground mb-1">
            {committed_sheets.length} committed sheet{committed_sheets.length === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {committed_sheets.map((c) => (
              <Badge key={c.sheet_name} variant="secondary" className="font-normal">
                {c.sheet_name}
                {c.general_specs && (
                  <span className="ml-1 text-[10px] uppercase text-muted-foreground">specs</span>
                )}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
