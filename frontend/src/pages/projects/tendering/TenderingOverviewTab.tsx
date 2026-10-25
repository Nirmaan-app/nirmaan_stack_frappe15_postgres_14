import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import {
  Award,
  Building2,
  FilePenLine,
  FileSearch,
  GitMerge,
  Hourglass,
  Trash2,
  Undo2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import { PROJECT_STATUS_BADGE_CLASSES } from "@/components/common/projectStatus";
import { Projects } from "@/types/NirmaanStack/Projects";

import { canManageTendering } from "./tenderingAuth";
import {
  useDeleteTenderingProject,
  useMarkTenderingProjectLost,
} from "./hooks/useTenderingMutations";
import { TenderingProjectForm } from "./TenderingProjectForm";
import { MergeBoqsDialog, UndoMergeDialog, type MergeBoqRow } from "./TenderingMergeDialogs";
import { CopyProjectLinkButton } from "@/components/common/CopyProjectLink";

interface TenderingOverviewTabProps {
  /** The loaded Projects doc whose `tendering_status` is NOT "Won". */
  data: Projects;
  /** SWR mutate for the project doc — refreshes the view after a mutation. */
  onRefresh?: () => void;
}

/**
 * "Overview" tab body for a pre-Won (Tendering or Lost) Projects record.
 *
 * Mirrors the visual language of the won-project "Project Details" card
 * (shadcn Card + label/value grid) but shows only the fields a stub has
 * (customer, location, created) — the project name + ID live in the shell
 * header above the tabs. It also carries the tendering_status badge, an
 * explanatory banner, and the lifecycle actions (Edit / Convert to Won /
 * Mark as Lost / Delete — gated to tendering managers).
 *
 * Width is capped (`max-w-4xl`) so the sparse field set reads as a composed
 * card rather than a thin row stretched across a wide viewport. Tendering →
 * editable + convertible + mergeable (Admin); Lost → read-only, Delete only;
 * Merged → closed, Undo merge only (Admin; ADR-0038).
 */
const TenderingOverviewTab = ({ data, onRefresh }: TenderingOverviewTabProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { role, user_id } = useUserData();

  const canManage = canManageTendering(role, user_id);
  // Merge / Undo: anyone who can create projects (owner 2026-10-21; was Admin only).
  const canMerge = canManage;
  const isLost = data.tendering_status === "Lost";
  const isMerged = data.tendering_status === "Merged";
  const isOpen = !isLost && !isMerged;
  const tenderingStatus = data.tendering_status || "Tendering";

  const [isEditing, setIsEditing] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmLostOpen, setConfirmLostOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);

  // The BoQs a merge would move -- all of them (Q2). Read only when the button can show.
  const { data: projectBoqs, mutate: refreshProjectBoqs } = useFrappeGetDocList<MergeBoqRow>(
    "BOQs",
    {
      fields: ["name", "boq_name", "version"],
      filters: [["project", "=", data.name]],
      orderBy: { field: "boq_name", order: "asc" },
      // Far above any real tender's BoQ count; the server moves every BoQ either way, and the
      // success toast counts what the server moved.
      limit: 1000,
    },
    canMerge && isOpen ? `tendering-merge-boqs-${data.name}` : null
  );
  const boqsToMerge = projectBoqs ?? [];

  // The Won project a Merged project went into, for the banner.
  const { data: mergedIntoRows } = useFrappeGetDocList<Projects>(
    "Projects",
    {
      fields: ["name", "project_name"],
      filters: [["name", "=", data.merged_into ?? ""]],
      limit: 1,
    },
    isMerged && data.merged_into ? `tendering-merged-into-${data.merged_into}` : null
  );
  const mergedIntoTitle = mergedIntoRows?.[0]?.project_name || data.merged_into || "";

  const { deleteTenderingProject, loading: deleting } =
    useDeleteTenderingProject();
  const { markTenderingProjectLost, loading: markingLost } =
    useMarkTenderingProjectLost();

  const handleConvert = () => {
    // Open the project wizard in convert mode against this stub (7 steps: it adds BOQ).
    navigate(`/projects/new-project/convert/${data.name}`);
  };

  const handleDelete = async () => {
    try {
      const response = await deleteTenderingProject(data.name);
      if (response.message.status !== 200) {
        throw new Error(
          response.message.error || "Failed to delete tendering project"
        );
      }
      toast({
        title: "Deleted",
        description: (
          <>
            Tendering Project:{" "}
            <strong className="text-[14px]">
              {data.project_name || data.name}
            </strong>{" "}
            deleted successfully!
          </>
        ),
        variant: "success",
      });
      setConfirmDeleteOpen(false);
      navigate("/projects?tab=tendering");
    } catch (err: any) {
      toast({
        title: "Failed!",
        description: err?.message || "Error while deleting tendering project!",
        variant: "destructive",
      });
      console.error("Error while deleting tendering project:", err);
    }
  };

  const handleMarkLost = async () => {
    try {
      const response = await markTenderingProjectLost(data.name);
      if (response.message.status !== 200) {
        throw new Error(
          response.message.error || "Failed to mark tendering project Lost"
        );
      }
      toast({
        title: "Marked Lost",
        description: (
          <>
            Tendering Project:{" "}
            <strong className="text-[14px]">
              {data.project_name || data.name}
            </strong>{" "}
            marked Lost.
          </>
        ),
        variant: "success",
      });
      setConfirmLostOpen(false);
      onRefresh?.();
    } catch (err: any) {
      toast({
        title: "Failed!",
        description:
          err?.message || "Error while marking tendering project Lost!",
        variant: "destructive",
      });
      console.error("Error while marking tendering project Lost:", err);
    }
  };

  const fields: { label: string; value: string }[] = [
    { label: "Customer", value: data.customer || "—" },
    {
      label: "Location",
      value:
        [data.project_city, data.project_state].filter(Boolean).join(", ") ||
        "—",
    },
    {
      label: "Created",
      value: data.creation ? formatDate(data.creation) : "—",
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Banner — sets expectations for the current state */}
      {isMerged ? (
        <div
          className="relative overflow-hidden rounded-lg shadow-sm bg-gradient-to-r from-violet-50 to-violet-100 border-l-4 border-violet-400"
          role="note"
        >
          <div className="relative flex flex-wrap items-start gap-4 p-4">
            <GitMerge className="h-5 w-5 flex-shrink-0 mt-0.5 text-violet-500" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold tracking-tight text-violet-800">Merged</h3>
              <p className="mt-1 text-sm leading-relaxed text-violet-700">
                This project's BoQs were merged into{" "}
                {data.merged_into ? (
                  <Link
                    to={`/projects/${data.merged_into}`}
                    className="font-semibold underline underline-offset-2 hover:text-violet-900"
                  >
                    {mergedIntoTitle} ({data.merged_into})
                  </Link>
                ) : (
                  "a Won project"
                )}
                . It stays closed until the merge is undone.
              </p>
            </div>
            {canMerge && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUndoOpen(true)}
                className="flex items-center gap-1 border-violet-300 text-violet-800 hover:bg-violet-50"
              >
                <Undo2 className="h-4 w-4" />
                Undo merge
              </Button>
            )}
          </div>
        </div>
      ) : (
      <div
        className={cn(
          "relative overflow-hidden rounded-lg shadow-sm",
          isLost
            ? "bg-gradient-to-r from-rose-50 to-rose-100 border-l-4 border-rose-400"
            : "bg-gradient-to-r from-slate-50 to-slate-100 border-l-4 border-slate-400"
        )}
        role="note"
      >
        <div className="relative flex items-start gap-4 p-4">
          <div className="flex-shrink-0 mt-0.5">
            {isLost ? (
              <Hourglass className="h-5 w-5 text-rose-500" />
            ) : (
              <FileSearch className="h-5 w-5 text-slate-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3
              className={cn(
                "text-sm font-semibold tracking-tight",
                isLost ? "text-rose-800" : "text-slate-800"
              )}
            >
              {isLost
                ? "Lost Bid (Read-only)"
                : "Tendering Project (Prospect)"}
            </h3>
            <p
              className={cn(
                "mt-1 text-sm leading-relaxed",
                isLost ? "text-rose-700" : "text-slate-600"
              )}
            >
              {isLost
                ? "This bid was not awarded. The record is kept for pipeline reporting and is read-only — it cannot be converted to Won or re-marked. You can delete it if it is no longer needed."
                : "This is a lightweight bid/prospect stub — it has no address, work packages, team, or timeline, and is excluded from all operational modules. Convert it to a Won project once the bid is awarded, or mark it Lost if the bid is dead."}
            </p>
          </div>
        </div>
      </div>
      )}

      {isEditing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Edit Tendering Project</CardTitle>
            <p className="text-sm text-muted-foreground">
              Update the stub's Name, City, State or Customer. Editing the city
              will not change the frozen project ID.
            </p>
          </CardHeader>
          <CardContent>
            <TenderingProjectForm
              editProject={{
                name: data.name,
                project_name: data.project_name,
                project_state: data.project_state,
                project_city: data.project_city,
                customer: data.customer,
              }}
              onSuccess={() => {
                setIsEditing(false);
                onRefresh?.();
              }}
              onCancel={() => setIsEditing(false)}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5 text-slate-500 flex-shrink-0" />
              Project Details
            </CardTitle>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <Badge
                variant="outline"
                className={cn(
                  "font-medium",
                  PROJECT_STATUS_BADGE_CLASSES[tenderingStatus]
                )}
              >
                {tenderingStatus}
              </Badge>
              <div className="flex items-center gap-2">
                <CopyProjectLinkButton projectId={data.name} />
                {canManage && isOpen && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-1"
                  >
                    <FilePenLine className="h-4 w-4" />
                    Edit
                  </Button>
                )}
                {/* A Merged project is closed until undone (ADR-0038 D6): no Delete. */}
                {canManage && !isMerged && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="flex items-center gap-1"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Stub fields — mirrors the won "Project Details" grid */}
            <div className="grid grid-cols-3 max-md:grid-cols-1 gap-6 w-full">
              {fields.map((f) => (
                <CardDescription key={f.label} className="space-y-2">
                  <span className="text-xs uppercase tracking-wide">
                    {f.label}
                  </span>
                  <p className="font-bold text-black break-words">{f.value}</p>
                </CardDescription>
              ))}
            </div>

            {/* Tendering-only actions: Convert + Merge BoQs + Mark as Lost. */}
            {canManage && isOpen && (
              <div className="border-t pt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="lg"
                      onClick={handleConvert}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700"
                    >
                      <Award className="h-4 w-4" />
                      Convert to Won
                    </Button>
                    {canMerge && (
                      <Button
                        size="lg"
                        variant="outline"
                        onClick={() => setMergeOpen(true)}
                        disabled={boqsToMerge.length === 0}
                        title={boqsToMerge.length === 0 ? "No BoQ to merge" : undefined}
                        className="flex items-center gap-2 border-violet-300 text-violet-800 hover:bg-violet-50"
                      >
                        <GitMerge className="h-4 w-4" />
                        Merge BoQs
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Awarded the bid? This opens the full 7-step wizard pre-filled
                    with this stub and completes the project in place — its ID is
                    preserved. You tick the BoQs it was won on; they become Selected
                    and the others stay Draft. Conversion is one-way.
                  </p>
                  {canMerge && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Won as part of a job that already exists? Merge BoQs moves
                      this project's BoQs into that Won project. You can undo it.
                    </p>
                  )}
                </div>
                <div className="sm:text-right">
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => setConfirmLostOpen(true)}
                    className="flex items-center gap-2 border-rose-300 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                  >
                    <Hourglass className="h-4 w-4" />
                    Mark as Lost
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Bid lost? This closes the pipeline record. Marking Lost is
                    one-way — it cannot be reverted.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this {isLost ? "Lost" : "Tendering"} project?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the prospect stub{" "}
              <strong>{data.project_name || data.name}</strong>. A stub has no
              operational data, so nothing else is affected. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mark-as-Lost confirmation (Tendering only) */}
      <AlertDialog open={confirmLostOpen} onOpenChange={setConfirmLostOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this project Lost?</AlertDialogTitle>
            <AlertDialogDescription>
              The prospect stub{" "}
              <strong>{data.project_name || data.name}</strong> will be marked
              Lost and become read-only. This is a one-way transition — Lost
              cannot be reverted to Tendering or converted to Won.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markingLost}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={markingLost}
              onClick={(e) => {
                e.preventDefault();
                handleMarkLost();
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {markingLost ? "Marking..." : "Mark as Lost"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canMerge && isOpen && (
        <MergeBoqsDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          projectName={data.name}
          projectTitle={data.project_name || data.name}
          boqs={boqsToMerge}
          onMerged={() => {
            void refreshProjectBoqs();
            onRefresh?.();
          }}
        />
      )}
      {canMerge && isMerged && (
        <UndoMergeDialog
          open={undoOpen}
          onOpenChange={setUndoOpen}
          projectName={data.name}
          projectTitle={data.project_name || data.name}
          targetTitle={mergedIntoTitle || "the Won project"}
          onUndone={() => onRefresh?.()}
        />
      )}
    </div>
  );
};

export default TenderingOverviewTab;
