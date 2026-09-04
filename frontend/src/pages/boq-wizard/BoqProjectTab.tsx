import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FrappeConfig, FrappeContext, useFrappeGetDocList } from "frappe-react-sdk";
import { FileSpreadsheet, Loader2, Pencil } from "lucide-react";
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
import { originBadge } from "./boqOriginBadge";
import { useUserData } from "@/hooks/useUserData";
import { canOpenBoqWizard } from "./boqAccess";
import type { CommittedSheetState, GetCommittedStateResponse } from "./boqTypes";

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
  // Deliberately widened to a plain string, NOT the "upload" | "template" union in boqTypes.ts:
  // live data already violates that union (see boqOriginBadge.ts).
  origin?: string | null;
}

const WIZARD_STATE_LABELS: Record<string, string> = {
  "": "Not started",
  "In progress": "In progress",
  "Configured": "Configured",
  "Parsed": "Parsed",
};

const BoqProjectTab = ({ projectId }: BoqProjectTabProps) => {
  const navigate = useNavigate();
  const { call } = useContext(FrappeContext) as FrappeConfig;
  const { role, user_id } = useUserData();
  const showAction = canOpenBoqWizard(role, user_id);
  // Which row is resolving its landing sheet (one at a time).
  const [openingBoq, setOpeningBoq] = useState<string | null>(null);

  // Two destinations off one row (owner ruling):
  //   Edit icon  -> the wizard hub (the editing surface).
  //   Row click  -> the READ-ONLY sheet viewer (SheetViewPage): tab strip + table, nothing
  //                 editable. The viewer is per-SHEET, so the landing sheet is resolved the
  //                 way the hub's Tendering direct-nav (WI-1) resolves it: the first
  //                 committed sheet by sheet_order, nulls last then by name, sheet_name
  //                 VERBATIM (#152).
  // A BoQ with nothing committed yet has no sheet to view, so the row click falls back to
  // the hub -- as does a failed read.
  const handleOpenView = async (boqName: string) => {
    // One resolve at a time: a second row clicked mid-flight would race the first and both
    // would navigate, last one winning -- so the click is ignored rather than queued.
    if (openingBoq) return;
    setOpeningBoq(boqName);
    try {
      const res = await call.get(
        "nirmaan_stack.api.boq.wizard.commit_gate.get_committed_state",
        { boq_name: boqName }
      );
      const committed =
        (res?.message as GetCommittedStateResponse | undefined)?.committed_state ?? [];
      // ⚠️ sheet_name BREAKS THE TIE, and not only for tidiness: `Infinity - Infinity` is NaN,
      // and a comparator returning NaN is undefined behaviour -- so a BoQ whose committed sheets
      // ALL carry a null sheet_order (the type allows it) would land on whichever sheet the API
      // happened to return first. Ordering the landing sheet must be deterministic.
      const order = (s: CommittedSheetState) => s.sheet_order ?? Number.POSITIVE_INFINITY;
      const firstSheet = [...committed].sort(
        (a, b) => order(a) - order(b) || a.sheet_name.localeCompare(b.sheet_name)
      )[0]?.sheet_name;
      navigate(
        firstSheet
          ? `/upload-boq/hub/${boqName}/view/${encodeURIComponent(firstSheet)}`
          : `/upload-boq/hub/${boqName}`
      );
    } catch {
      navigate(`/upload-boq/hub/${boqName}`);
    } finally {
      setOpeningBoq(null);
    }
  };

  const { data, isLoading, error } = useFrappeGetDocList<BoqListRow>(
    "BOQs",
    {
      fields: ["name", "boq_name", "version", "wizard_state", "uploaded_at", "creation", "origin"],
      // Project-less template seeds (ADR-0013 A1) are already excluded by the project filter.
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
            {Array.from({ length: showAction ? 6 : 5 }).map((_, i) => (
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
              <TableHead>Type</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Uploaded</TableHead>
              {showAction && <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => {
              const origin = originBadge(row.origin);
              return (
              /* The row IS the primary action (open pricing), so it needs its own keyboard
                 path -- the pencil beside it is a <Button> and therefore focusable, and a design
                 where only the SECONDARY destination is reachable by keyboard is worse than one
                 where neither is.
                 ⚠️ tabIndex + onKeyDown ONLY -- NO role override. A `role="link"`/`"button"` on a
                 <tr> replaces its implicit `row` role, which detaches the <td>s from the table
                 structure for assistive tech: it would trade a keyboard gap for a semantics bug.
                 The row keeps its row role and its cells keep their headers; Enter/Space activate
                 it, and the focus ring says it is reachable. */
              <TableRow
                key={row.name}
                tabIndex={0}
                className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onClick={() => handleOpenView(row.name)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault(); // Space would scroll the page
                  handleOpenView(row.name);
                }}
              >
                <TableCell className="py-2 px-3 font-medium">
                  <span className="inline-flex items-center gap-2">
                    {row.boq_name || row.name}
                    {openingBoq === row.name && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                  </span>
                </TableCell>
                <TableCell className="py-2 px-3">
                  <Badge variant={origin.variant} className="whitespace-nowrap font-medium">
                    {origin.label}
                  </Badge>
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
                {showAction && (
                  <TableCell className="py-2 px-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Edit BoQ"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/upload-boq/hub/${row.name}`);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default BoqProjectTab;
