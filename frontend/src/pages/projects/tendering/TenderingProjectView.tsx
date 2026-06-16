import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Award,
  Building2,
  CalendarDays,
  FilePenLine,
  FileSearch,
  Hourglass,
  MapPin,
  Trash2,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import BoqProjectTab from "@/pages/boq-wizard/BoqProjectTab";

interface TenderingProjectViewProps {
  /** The loaded Projects doc whose `tendering_status` is NOT "Won". */
  data: Projects;
  /** SWR mutate for the project doc — refreshes the view after a mutation. */
  onRefresh?: () => void;
}

/**
 * Lightweight detail view for a pre-Won (Tendering or Lost) Projects record.
 *
 * `project.tsx` early-returns this view whenever `tendering_status !== "Won"`,
 * so the heavy role-based operational-tab machinery (Procurement, Financials,
 * DC/MIR, etc.) never runs for a stub. The view branches by `tendering_status`:
 *   - "Tendering": stub fields + Convert + Edit + Mark-as-Lost + Delete
 *                  (gated to Admin / PMO / Administrator).
 *   - "Lost":      stub fields read-only + Delete only (terminal — no Convert,
 *                  no Edit, no Mark-as-Lost).
 *
 * The full edit-project form is intentionally NOT reachable from here.
 */
const TenderingProjectView = ({ data, onRefresh }: TenderingProjectViewProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { role, user_id } = useUserData();

  const canManage = canManageTendering(role, user_id);
  const isLost = data.tendering_status === "Lost";

  const [isEditing, setIsEditing] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmLostOpen, setConfirmLostOpen] = useState(false);

  const { deleteTenderingProject, loading: deleting } =
    useDeleteTenderingProject();
  const { markTenderingProjectLost, loading: markingLost } =
    useMarkTenderingProjectLost();

  const handleConvert = () => {
    // Open the existing 6-step wizard in convert mode against this stub.
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
        description:
          err?.message || "Error while deleting tendering project!",
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

  const fields: {
    label: string;
    value: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      label: "Project Name",
      value: data.project_name || data.name,
      icon: FileSearch,
    },
    { label: "City", value: data.project_city || "—", icon: MapPin },
    { label: "State", value: data.project_state || "—", icon: MapPin },
    {
      label: "Customer",
      value: data.customer || "—",
      icon: UserRound,
    },
    {
      label: "Created",
      value: data.creation ? formatDate(data.creation) : "—",
      icon: CalendarDays,
    },
  ];

  const tenderingStatus = data.tendering_status || "Tendering";

  return (
    <div className="flex-1 space-y-4 max-w-3xl mx-auto py-2">
      {/* Header: back + Tendering/Lost badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/projects?tab=tendering")}
            className="text-muted-foreground hover:text-foreground -ml-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "font-medium",
            PROJECT_STATUS_BADGE_CLASSES[tenderingStatus]
          )}
        >
          {tenderingStatus}
        </Badge>
      </div>

      {/* Banner — sets expectations for the current state */}
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
            <div className="space-y-1">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5 text-slate-500" />
                {data.project_name || data.name}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Project ID: <span className="font-mono">{data.name}</span>
              </p>
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                {!isLost && (
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
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="flex items-center gap-1"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Stub fields */}
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {fields.map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.label} className="flex items-start gap-3">
                    <Icon className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        {f.label}
                      </dt>
                      <dd className="text-sm font-medium text-foreground break-words">
                        {f.value}
                      </dd>
                    </div>
                  </div>
                );
              })}
            </dl>

            {/* Tendering-only actions: Convert + Mark as Lost. */}
            {canManage && !isLost && (
              <div className="border-t pt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Button
                    size="lg"
                    onClick={handleConvert}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Award className="h-4 w-4" />
                    Convert to Won
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Awarded the bid? This opens the full 6-step wizard
                    pre-filled with this stub and completes the project in
                    place — its ID is preserved. Conversion is one-way.
                  </p>
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

      {/* Bill of Quantities */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Bill of Quantities</h3>
        <BoqProjectTab projectId={data.name} />
      </div>

      {/* Delete confirmation */}
      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
      >
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
    </div>
  );
};

export default TenderingProjectView;
