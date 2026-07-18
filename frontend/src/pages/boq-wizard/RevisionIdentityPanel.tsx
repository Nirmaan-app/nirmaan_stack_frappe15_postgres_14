import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/utils/FormatDate";
import type { CommittedSheet } from "./revisionMapping";

/**
 * Zone 1 -- "What you're revising" (ADR-0014 D3, the F2 control).
 *
 * Shows the picked original's identity PLUS what will carry -- the committed-sheet list and
 * the carry counts (rates + classifications). This is deliberately NOT a restatement of the
 * pick: it must surface what the user did NOT see at pick time and that DIFFERS between the
 * right and a wrong original ("0 rates will carry" is the F2 alarm). Counts are cheap COUNTs
 * on the committed tier -- no parse.
 */
export interface RevisionIdentity {
  boq_name: string;
  source_version: number | null;
  committed_at: string | null;
  committed_sheets: CommittedSheet[];
  carry_counts: { rates: number; classifications: number };
}

export function RevisionIdentityPanel({ identity }: { identity: RevisionIdentity }) {
  const { boq_name, source_version, committed_at, committed_sheets, carry_counts } = identity;
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

        <p className="text-muted-foreground">
          This will carry{" "}
          <span className="font-medium text-foreground">{carry_counts.rates.toLocaleString()}</span>{" "}
          rate{carry_counts.rates === 1 ? "" : "s"} and{" "}
          <span className="font-medium text-foreground">
            {carry_counts.classifications.toLocaleString()}
          </span>{" "}
          classification{carry_counts.classifications === 1 ? "" : "s"}.
        </p>
      </CardContent>
    </Card>
  );
}
