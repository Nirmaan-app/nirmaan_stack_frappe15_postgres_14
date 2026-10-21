import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FrappeConfig,
  FrappeContext,
  useFrappeGetDocList,
  useFrappePostCall,
} from "frappe-react-sdk";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { getFrappeErrorText } from "@/utils/frappeErrors";
import {
  canAddBoqToWonProject,
  canManageWonProjectBoqs,
  canOpenBoqHub,
  canOpenBoqWizard,
} from "./boqAccess";
import { BoqListTable, BoqSelectionBar, type BoqListRow } from "./BoqListTable";
import { BoqSelectionConfirmDialog } from "./BoqSelectionConfirmDialog";
import { leavesNoSelectedBoq, splitWonProjectBoqs, type BoqSelectionTarget } from "./boqSelection";
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
  const isWon = surface === "won";
  // After Won only an Admin adds a BoQ (server: controllers/boqs.assert_can_add_boq).
  const canUpload = !isWon || canAddBoqToWonProject(role, user_id);
  // Won page (ADR-0037 D6/D7): only an Admin edits an Other BoQ and moves BoQs between the tables.
  const canManage = isWon && canManageWonProjectBoqs(role, user_id);
  // Checked boxes per table -- "checked", never "selected" (that word is the status).
  const [checkedSelected, setCheckedSelected] = useState<Set<string>>(new Set());
  const [checkedOther, setCheckedOther] = useState<Set<string>>(new Set());
  const [pendingTarget, setPendingTarget] = useState<BoqSelectionTarget | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const { call: setBoqSelection, loading: moving } = useFrappePostCall(
    "nirmaan_stack.api.projects.boq_selection.set_boq_selection"
  );

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

  const { data, isLoading, error, mutate } = useFrappeGetDocList<BoqListRow>(
    "BOQs",
    {
      fields: ["name", "boq_name", "version", "wizard_state", "status", "uploaded_at", "creation", "origin"],
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

  const allRows = data ?? [];
  const openHub = (boqName: string) => navigate(`/upload-boq/hub/${boqName}`);

  const uploadButton = canUpload ? (
    <Button onClick={() => navigate(`/upload-boq?project=${projectId}`)}>
      <FileSpreadsheet className="mr-2 h-4 w-4" />
      Upload BoQ
    </Button>
  ) : null;

  if (allRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <FileSpreadsheet className="h-12 w-12 text-muted-foreground opacity-40" />
        <div>
          <p className="text-sm font-medium text-foreground">No BoQs uploaded yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            {canUpload
              ? "Upload an Excel Bill of Quantities to get started."
              : "Only an Admin can add a BoQ once the project is Won."}
          </p>
        </div>
        {uploadButton && <div className="mt-2">{uploadButton}</div>}
      </div>
    );
  }

  // Pre-Won stub: one table, as before. The Selected / Other split is the Won page's only.
  if (!isWon) {
    return (
      <div className="space-y-3">
        {uploadButton && <div className="flex justify-end">{uploadButton}</div>}
        <BoqListTable
          rows={allRows}
          canEdit={showAction}
          checkable={false}
          checked={new Set()}
          onCheckedChange={() => {}}
          openingBoq={openingBoq}
          onOpenView={handleOpenView}
          onEdit={openHub}
        />
      </div>
    );
  }

  // Won page (ADR-0037 D5): Selected BoQs, then Other BoQs (only when it has rows). Checks are
  // read through the current rows, so a BoQ that moved table since it was checked drops out.
  const { selected, other } = splitWonProjectBoqs(allRows);
  const checkedSelectedRows = selected.filter((row) => checkedSelected.has(row.name));
  const checkedOtherRows = other.filter((row) => checkedOther.has(row.name));
  const pendingRows = pendingTarget === "Draft" ? checkedSelectedRows : checkedOtherRows;
  const emptiesSelected =
    pendingTarget !== null &&
    leavesNoSelectedBoq(pendingTarget, checkedSelectedRows.length, selected.length);

  const closeConfirm = () => {
    setPendingTarget(null);
    setMoveError(null);
  };

  const confirmMove = async () => {
    if (!pendingTarget || pendingRows.length === 0) return;
    setMoveError(null);
    try {
      await setBoqSelection({
        project: projectId,
        boqs: pendingRows.map((row) => row.name),
        status: pendingTarget,
      });
      setCheckedSelected(new Set());
      setCheckedOther(new Set());
      setPendingTarget(null);
      await mutate();
    } catch (err) {
      // The server refuses the whole batch by name (e.g. a BoQ someone else already moved), so
      // the reason stays in the open dialog rather than a toast that would vanish.
      setMoveError(getFrappeErrorText(err));
    }
  };

  return (
    <div className="space-y-6">
      {/* Selected BoQs, headed plain "BoQs" (owner 2026-10-21) -- it is the project's main list. */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">BoQs</h3>
          {uploadButton}
        </div>
        <BoqListTable
          rows={selected}
          canEdit={showAction}
          checkable={canManage}
          checked={checkedSelected}
          onCheckedChange={setCheckedSelected}
          openingBoq={openingBoq}
          onOpenView={handleOpenView}
          onEdit={openHub}
          emptyMessage={
            <>
              No BoQ selected.
              {canManage && other.length > 0 && " Check BoQs in Other BoQs and choose Mark as Selected."}
            </>
          }
        />
        {canManage && (
          <BoqSelectionBar
            target="Draft"
            checkedCount={checkedSelectedRows.length}
            onAction={() => setPendingTarget("Draft")}
            onClear={() => setCheckedSelected(new Set())}
          />
        )}
      </section>

      {other.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Other BoQs ({other.length})</h3>
          <BoqListTable
            rows={other}
            canEdit={canManage}
            checkable={canManage}
            checked={checkedOther}
            onCheckedChange={setCheckedOther}
            openingBoq={openingBoq}
            onOpenView={handleOpenView}
            onEdit={openHub}
            tinted
          />
          {canManage && (
            <BoqSelectionBar
              target="Selected"
              checkedCount={checkedOtherRows.length}
              onAction={() => setPendingTarget("Selected")}
              onClear={() => setCheckedOther(new Set())}
            />
          )}
        </section>
      )}

      <BoqSelectionConfirmDialog
        target={pendingTarget}
        boqs={pendingRows}
        emptiesSelected={emptiesSelected}
        saving={moving}
        error={moveError}
        onConfirm={() => void confirmMove()}
        onClose={closeConfirm}
      />
    </div>
  );
};

export default BoqProjectTab;
