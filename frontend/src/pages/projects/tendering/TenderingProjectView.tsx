import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Award,
  Building2,
  CalendarDays,
  FilePenLine,
  FileSearch,
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
import { useDeleteTenderingProject } from "./hooks/useTenderingMutations";
import { TenderingProjectForm } from "./TenderingProjectForm";

interface TenderingProjectViewProps {
  /** The loaded Tendering Projects doc (status === "Tendering"). */
  data: Projects;
  /** SWR mutate for the project doc — refreshes the view after an edit. */
  onRefresh?: () => void;
}

/**
 * Lightweight detail view for a "Tendering" project stub.
 *
 * `project.tsx` early-returns this view when `status === "Tendering"`, so the
 * heavy role-based operational-tab machinery (Procurement, Financials,
 * DC/MIR, etc.) never runs for a stub. The view shows only the four stub
 * fields (Name / City / State / Customer) + creation date + a Tendering badge,
 * a prominent "Convert to Won" CTA placeholder (real convert is Slice 7), and
 * inline Edit + Delete for authorized users (Admin / PMO / Administrator).
 *
 * The full edit-project form is intentionally NOT reachable from here — Edit
 * opens the minimal `TenderingProjectForm` in EDIT mode.
 */
const TenderingProjectView = ({ data, onRefresh }: TenderingProjectViewProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { role, user_id } = useUserData();

  const canManage = canManageTendering(role, user_id);

  const [isEditing, setIsEditing] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const { deleteTenderingProject, loading: deleting } =
    useDeleteTenderingProject();

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

  return (
    <div className="flex-1 space-y-4 max-w-3xl mx-auto py-2">
      {/* Header: back + title + Tendering badge */}
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
            PROJECT_STATUS_BADGE_CLASSES["Tendering"]
          )}
        >
          Tendering
        </Badge>
      </div>

      {/* Prospect banner — sets expectations that this is a stub */}
      <div
        className={cn(
          "relative overflow-hidden rounded-lg",
          "bg-gradient-to-r from-slate-50 to-slate-100",
          "border-l-4 border-slate-400 shadow-sm"
        )}
        role="note"
      >
        <div className="relative flex items-start gap-4 p-4">
          <div className="flex-shrink-0 mt-0.5">
            <FileSearch className="h-5 w-5 text-slate-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-800 tracking-tight">
              Tendering Project (Prospect)
            </h3>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              This is a lightweight bid/prospect stub — it has no address, work
              packages, team, or timeline, and is excluded from all operational
              modules. Convert it to a Won project once the bid is awarded.
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1"
                >
                  <FilePenLine className="h-4 w-4" />
                  Edit
                </Button>
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

            {/* Convert to Won — opens the 6-step wizard in convert mode. */}
            {canManage && (
              <div className="border-t pt-4">
                <Button
                  size="lg"
                  onClick={handleConvert}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700"
                >
                  <Award className="h-4 w-4" />
                  Convert to Won
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Awarded the bid? This opens the full 6-step wizard pre-filled
                  with this stub and completes the project in place — its ID is
                  preserved. Conversion is one-way.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Tendering project?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the prospect stub{" "}
              <strong>{data.project_name || data.name}</strong>. A Tendering
              stub has no operational data, so nothing else is affected. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                // Keep the dialog open until the async delete resolves.
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
    </div>
  );
};

export default TenderingProjectView;
