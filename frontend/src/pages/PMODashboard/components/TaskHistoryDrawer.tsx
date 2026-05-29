import React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TailSpin } from "react-loader-spinner";
import { Check, X, FileText, History } from "lucide-react";
import { useFrappeGetDocList } from "frappe-react-sdk";

interface SubmissionLogRow {
  name: string;
  cycle_number: number;
  cycle_start_date: string | null;
  cycle_end_date: string | null;
  result: "Done" | "Not Done";
  was_force_marked: 0 | 1;
  closed_on: string | null;
  attachment: string | null;
}

interface TaskHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskName: string | null;
  taskLabel?: string;
}

const formatDate = (d: string | null) => {
  if (!d) return "---";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
};

const TaskHistoryDrawer: React.FC<TaskHistoryDrawerProps> = ({
  open,
  onOpenChange,
  taskName,
  taskLabel,
}) => {
  const { data, isLoading, error } = useFrappeGetDocList<SubmissionLogRow>(
    "PMO Task Submission Log",
    {
      filters: taskName ? [["task", "=", taskName]] : [],
      fields: [
        "name",
        "cycle_number",
        "cycle_start_date",
        "cycle_end_date",
        "result",
        "was_force_marked",
        "closed_on",
        "attachment",
      ],
      orderBy: { field: "cycle_number", order: "desc" },
      limit: 0,
    },
    open && taskName ? undefined : null
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl w-full overflow-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-lg">
            <History className="h-4 w-4 text-red-500" />
            Submission History
          </SheetTitle>
          <SheetDescription className="text-sm text-gray-500">
            {taskLabel ? `All past entries for "${taskLabel}".` : "All past entries for this task."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <TailSpin height={28} width={28} color="#dc2626" />
            </div>
          )}

          {!isLoading && error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Failed to load history.
            </div>
          )}

          {!isLoading && !error && (!data || data.length === 0) && (
            <div className="rounded-md border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
              Nothing here yet. Past entries will show up once the first due
              date passes.
            </div>
          )}

          {!isLoading && !error && data && data.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="text-xs font-semibold uppercase text-gray-500">
                      #
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-gray-500">
                      From → To
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-gray-500">
                      Status
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-gray-500">
                      Marked On
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-gray-500">
                      Attachment
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row) => (
                    <TableRow key={row.name} className="hover:bg-gray-50/50">
                      <TableCell className="text-sm font-medium text-gray-900">
                        #{row.cycle_number}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                        {formatDate(row.cycle_start_date)} → {formatDate(row.cycle_end_date)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {row.result === "Done" ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-green-100 bg-green-50 px-2 py-1 text-xs font-medium text-green-600">
                              <Check className="h-3 w-3" />
                              Done
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs font-medium text-red-600">
                              <X className="h-3 w-3" />
                              Not Done
                            </span>
                          )}
                          {row.was_force_marked === 1 && (
                            <Badge
                              variant="secondary"
                              className="px-1.5 py-0 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200"
                              title="Marked automatically — nobody updated this before the due date."
                            >
                              auto
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                        {formatDate(row.closed_on)}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {row.attachment ? (
                          <a
                            href={row.attachment}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            View
                          </a>
                        ) : (
                          <span className="text-gray-400">---</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default TaskHistoryDrawer;
