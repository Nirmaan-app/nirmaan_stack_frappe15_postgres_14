import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Pencil } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";

interface ReportSummaryCardProps {
  report?: {
    exists: boolean;
    name?: string;
    status?: string;
    submitted_by?: string;
    modified?: string;
    items?: any[];
  } | null;
  totalItems: number;
  onEdit?: () => void;
  cooldownMessage?: string;
}

export const ReportSummaryCard = ({
  report,
  totalItems,
  onEdit,
  cooldownMessage,
}: ReportSummaryCardProps) => {
  const filledCount =
    report?.items?.filter(
      (item) => item.remaining_quantity !== null && item.remaining_quantity !== -1
    ).length ?? 0;

  const formattedDate = report?.modified
    ? formatDate(report.modified)
    : null;

  return (
    <Card className="border-l-4 border-l-green-500">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>
                {filledCount} of {totalItems} items filled
              </span>
              <Badge variant="green">{report?.status ?? "Submitted"}</Badge>
            </div>
            {report?.submitted_by && (
              <p className="text-xs text-muted-foreground">
                Submitted by {report.submitted_by}
                {formattedDate ? ` on ${formattedDate}` : ""}
              </p>
            )}
          </div>
          {onEdit ? (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Edit Report
            </Button>
          ) : cooldownMessage ? (
            <div className="text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-md">
              {cooldownMessage}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};
