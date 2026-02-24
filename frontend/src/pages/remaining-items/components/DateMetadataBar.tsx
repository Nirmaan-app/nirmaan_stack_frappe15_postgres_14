import { Calendar, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/utils/FormatDate";

interface DateMetadataBarProps {
  hasProject: boolean;
  lastReport: { submitted_by: string; report_date: string } | null;
  todayReportExists: boolean;
}

export default function DateMetadataBar({
  hasProject,
  lastReport,
  todayReportExists,
}: DateMetadataBarProps) {
  const today = formatDate(new Date());

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="gap-1.5 py-1">
        <Calendar className="h-3.5 w-3.5" />
        Today: {today}
      </Badge>

      {hasProject && (
        <>
          <Badge variant="blue" className="gap-1.5 py-1">
            <Clock className="h-3.5 w-3.5" />
            {lastReport
              ? `Last Updated: ${formatDate(lastReport.report_date)} by ${lastReport.submitted_by}`
              : "No previous reports"}
          </Badge>

          {todayReportExists ? (
            <Badge variant="green" className="gap-1.5 py-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Submitted
            </Badge>
          ) : (
            <Badge variant="orange" className="gap-1.5 py-1">
              <AlertCircle className="h-3.5 w-3.5" />
              Pending
            </Badge>
          )}
        </>
      )}
    </div>
  );
}
