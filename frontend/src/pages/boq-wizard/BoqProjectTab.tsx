import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/utils/FormatDate";

interface BoqProjectTabProps {
  projectId: string;
}

interface BoqListRow {
  name: string;
  boq_name: string;
  version: number;
  wizard_state: string;
  uploaded_at: string;
  creation: string;
}

const WIZARD_STATE_LABELS: Record<string, string> = {
  "": "Not started",
  "In progress": "In progress",
  "Configured": "Configured",
  "Parsed": "Parsed",
};

const COLUMN_COUNT = 4;

const BoqProjectTab = ({ projectId }: BoqProjectTabProps) => {
  const navigate = useNavigate();

  const { data, isLoading, error } = useFrappeGetDocList<BoqListRow>(
    "BOQs",
    {
      fields: ["name", "boq_name", "version", "wizard_state", "uploaded_at", "creation"],
      filters: [["project", "=", projectId]],
      orderBy: { field: "uploaded_at", order: "desc" },
      limit: 50,
    },
    projectId ? `boq-list-${projectId}` : null
  );

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <div className="bg-muted/30 px-3 py-3">
          <div className="flex gap-4">
            {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-24" />
            ))}
          </div>
        </div>
        <div className="p-3 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive py-4">Failed to load BoQs.</p>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <FileSpreadsheet className="h-12 w-12 text-muted-foreground opacity-40" />
        <div>
          <p className="text-sm font-medium text-foreground">No BoQs uploaded yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Upload an Excel Bill of Quantities to get started.
          </p>
        </div>
        <Button
          className="mt-2"
          onClick={() => navigate(`/upload-boq?project=${projectId}`)}
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Upload BoQ
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          onClick={() => navigate(`/upload-boq?project=${projectId}`)}
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Upload BoQ
        </Button>
      </div>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader className="bg-background">
            <TableRow>
              <TableHead>BoQ Name</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Uploaded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow
                key={row.name}
                className="cursor-pointer"
                onClick={() => navigate(`/upload-boq/hub/${row.name}`)}
              >
                <TableCell className="py-2 px-3 font-medium">
                  {row.boq_name || row.name}
                </TableCell>
                <TableCell className="py-2 px-3 text-sm text-muted-foreground">
                  v{row.version}
                </TableCell>
                <TableCell className="py-2 px-3">
                  <Badge variant="outline">
                    {WIZARD_STATE_LABELS[row.wizard_state ?? ""] ?? row.wizard_state}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 px-3 text-sm text-muted-foreground">
                  {formatDate(row.uploaded_at || row.creation)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default BoqProjectTab;
