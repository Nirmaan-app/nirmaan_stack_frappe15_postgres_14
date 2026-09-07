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
import { toast } from "@/components/ui/use-toast";
import { originBadge } from "./boqOriginBadge";
import { useUserData } from "@/hooks/useUserData";
import { canOpenBoqHub, canOpenBoqWizard } from "./boqAccess";
import type { CommittedSheetState, GetCommittedStateResponse } from "./boqTypes";

/**
 * WHICH PAGE is rendering this list. It decides where a ROW CLICK goes, and NOTHING else.
 *
 * ⚠️ IT IS PASSED IN, NEVER DERIVED FROM `tendering_status` HERE, and that is not a style
 * preference. `project.tsx` branches on `data.tendering_status && data.tendering_status !== "Won"`,
 * so a legacy project with a BLANK tendering_status renders the WON page -- while
 * `isOperational("")` is false. Recomputing the surface inside this component would therefore give
 * such a project the Won page with pre-Won behaviour. Taking it from the caller makes the behaviour
 * match the page BY CONSTRUCTION.
 *
 * REQUIRED, with no default: a third call site must state which side it is on rather than silently
 * inherit whichever one happened to be written first.
 */
export type BoqProjectTabSurface = "won" | "pre-won";

interface BoqProjectTabProps {
  projectId: string;
  surface: BoqProjectTabSurface;
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

/**
 * Why a row click could not open the read-only preview.
 *
 * Two reasons, never folded into one line. "Nothing is committed" and "we could not find out"
 * lead a reader to different next actions, and a shared message would tell someone to go commit
 * a sheet they may already have committed.
 *
 * ⚠️ A TOAST, not an inline row -- owner ruling, and a DELIBERATE exception to the BoQ wizard's
 * "errors are inline, no toasts" convention. An earlier build put this in a row under the BoQ
 * and the owner rejected it; do not reinstate the inline form as a "fix" for toast noise.
 */
const NOTICE_TOAST = {
  "none-committed": {
    title: "Nothing to preview yet",
    description:
      "Nothing committed yet, so there is no sheet to preview. Commit a sheet in the wizard first.",
    variant: "warning" as const,
  },
  "check-failed": {
    title: "Could not open preview",
    description: "Could not check this BoQ's committed sheets. Try again.",
    variant: "destructive" as const,
  },
};

const WIZARD_STATE_LABELS: Record<string, string> = {
  "": "Not started",
  "In progress": "In progress",
  "Configured": "Configured",
  "Parsed": "Parsed",
};

const BoqProjectTab = ({ projectId, surface }: BoqProjectTabProps) => {
  const navigate = useNavigate();
  const { call } = useContext(FrappeContext) as FrappeConfig;
  const { role, user_id } = useUserData();
  const showAction = canOpenBoqWizard(role, user_id);
  // A pre-Won row click goes to the hub, but ONLY for a user the router would actually admit --
  // viewing a stub is not limited to the four wizard profiles, so an Accountant or Sales user can
  // reach this list on one. Everyone else keeps the preview path, which writes nothing.
  const rowClickOpensHub = surface === "pre-won" && canOpenBoqHub(role, user_id);
  // Which row is resolving its landing sheet (one at a time).
  const [openingBoq, setOpeningBoq] = useState<string | null>(null);

  // Two destinations off one row (owner ruling):
  //   Edit icon  -> the wizard hub (the editing surface).
  //   Row click  -> the READ-ONLY sheet viewer (SheetViewPage): tab strip + table, nothing
  //                 editable. The viewer is per-SHEET, so the landing sheet is resolved the
  //                 way the hub's Tendering direct-nav (WI-1) resolves it: the first
  //                 committed sheet by sheet_order, nulls last then by name, sheet_name
  //                 VERBATIM (#152).
  // A BoQ with nothing committed yet has NO sheet to view. That used to fall back to the hub
  // SILENTLY -- the click promised a preview and delivered a different screen, with nothing
  // anywhere saying why. The redirect is now GONE (owner ruling): a toast explains, and the
  // page does not move.
  //
  // ⚠️ ...ON THE WON PAGE. On a PRE-WON stub the row click goes STRAIGHT TO THE HUB (owner
  // ruling), which is why the two surfaces exist. A stub's BoQ is a bid being built, so the
  // editing surface IS the destination -- and it restores the only route into an EXISTING BoQ's
  // hub for the roles holding route access without a pencil (procurement, Project Lead), since
  // BoqUploadScreen's Continue only opens a BoQ uploaded in that same session. On the WON page
  // they still have no such route; widening canOpenBoqWizard is the fix if that is reported as a
  // bug there, and the silent preview-to-hub fallback must not come back as a shortcut.
  const handleOpenView = async (boqName: string) => {
    // The hub needs no landing SHEET, which is the only thing get_committed_state is read for --
    // so this branch does no async work at all: no request, no spinner, no toast.
    if (rowClickOpensHub) {
      navigate(`/upload-boq/hub/${boqName}`);
      return;
    }
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
      if (firstSheet) {
        navigate(`/upload-boq/hub/${boqName}/view/${encodeURIComponent(firstSheet)}`);
        return;
      }
      // Nothing committed: say so and go NOWHERE (owner ruling). The click asked for a preview
      // that does not exist, so it does nothing but explain itself -- landing on a different
      // screen was the behaviour being removed, not a feature to preserve.
      toast(NOTICE_TOAST["none-committed"]);
    } catch {
      // A failed READ is a different fact from an empty one and gets its own message: one is
      // "there is nothing to show yet", the other is "we could not find out". Folding them
      // together would tell a user to go commit a sheet they may well have committed already.
      // No navigation here -- on a failed read we do not know what is on the other side.
      toast(NOTICE_TOAST["check-failed"]);
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
