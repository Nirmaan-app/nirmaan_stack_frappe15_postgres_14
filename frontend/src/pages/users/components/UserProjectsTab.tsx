import { useState, useMemo, useCallback } from "react";
import ReactSelect from "react-select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TailSpin } from "react-loader-spinner";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { NirmaanUserPermissions } from "@/types/NirmaanStack/NirmaanUserPermissions";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProjectCard } from "./ProjectCard";
import {
  CirclePlus,
  ListChecks,
  Undo2,
  Trash2,
  FolderSearch,
  ShieldAlert,
} from "lucide-react";

interface SelectOption {
  label: string;
  value: string;
}

interface UserProjectsTabProps {
  user: NirmaanUsers;
  permissionList: NirmaanUserPermissions[] | undefined;
  projectList: Projects[] | undefined;
  addressData: any[] | undefined;
  isAdmin: boolean;
  onAssignProject: (
    projectId: string,
    projectName: string,
    toggleDialog: () => void
  ) => void;
  onDeleteProject: (
    projectId: string,
    permissionList: NirmaanUserPermissions[],
    toggleDialog: () => void
  ) => void;
  createLoading: boolean;
  deleteLoading: boolean;
}

export function UserProjectsTab({
  user,
  permissionList,
  projectList,
  addressData,
  isAdmin,
  onAssignProject,
  onDeleteProject,
  createLoading,
  deleteLoading,
}: UserProjectsTabProps) {
  const [curProj, setCurProj] = useState("");
  const [projectSelected, setProjectSelected] = useState<string | null>(null);
  const [assignProjectDialog, setAssignProjectDialog] = useState(false);
  const [unlinkProjectDialog, setUnlinkProjectDialog] = useState(false);

  const toggleAssignProjectDialog = useCallback(
    () => setAssignProjectDialog((prev) => !prev),
    []
  );
  const toggleUnlinkProjectDialog = useCallback(
    () => setUnlinkProjectDialog((prev) => !prev),
    []
  );

  // Available projects for assignment (not already assigned)
  const options: SelectOption[] = useMemo(() => {
    const filteredProjects = projectList?.filter(
      (p) => !permissionList?.find((pl) => pl.for_value === p.name)
    );
    return (
      filteredProjects?.map((item) => ({
        label: item.project_name,
        value: item.name,
      })) || []
    );
  }, [projectList, permissionList]);

  // Get project attributes helper
  const getProjectAttributes = useCallback(
    (id: string) => {
      const project = projectList?.find((proj) => proj.name === id);
      const projectName = project?.project_name;
      const address = addressData?.find(
        (add) => add.address_title === projectName
      );
      const formatAddress = `${address?.city || project?.project_city || "—"}, ${address?.state || project?.project_state || "—"}`;
      return { projectName, formatAddress };
    },
    [projectList, addressData]
  );

  // Check if user is admin or estimates executive (can't be assigned projects)
  const isRestrictedRole = [
    "Nirmaan Admin Profile",
    "Nirmaan Estimates Executive Profile",
  ].includes(user.role_profile || "");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Assigned Projects</h3>
          <p className="text-sm text-muted-foreground">
            {permissionList?.length || 0} project
            {(permissionList?.length || 0) !== 1 ? "s" : ""} assigned
          </p>
        </div>

        {isAdmin && (
          <>
            {isRestrictedRole ? (
              <Button disabled className="gap-2">
                <ShieldAlert className="h-4 w-4" />
                <span className="max-md:hidden">Assign Project</span>
                <span className="md:hidden">Assign</span>
              </Button>
            ) : (
              <Button onClick={toggleAssignProjectDialog} className="gap-2">
                <CirclePlus className="h-4 w-4" />
                <span className="max-md:hidden">Assign Project</span>
                <span className="md:hidden">Assign</span>
              </Button>
            )}
          </>
        )}
      </div>

      {/* Projects Grid */}
      {permissionList?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
            <FolderSearch className="h-8 w-8 text-muted-foreground" />
          </div>
          <h4 className="text-lg font-semibold">No Projects Assigned</h4>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {isAdmin
              ? isRestrictedRole
                ? "Admin and Estimates Executive users have access to all projects."
                : "Click 'Assign Project' to give this user access to projects."
              : "This user doesn't have any project assignments yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {permissionList?.map((project) => {
            const attrs = getProjectAttributes(project.for_value);
            return (
              <ProjectCard
                key={project.name}
                projectId={project.for_value}
                projectName={attrs.projectName}
                address={attrs.formatAddress}
                dateAdded={project.creation}
                showDeleteButton={isAdmin}
                onDelete={() => {
                  setProjectSelected(project.for_value);
                  toggleUnlinkProjectDialog();
                }}
              />
            );
          })}
        </div>
      )}

      {/* Assign Project Dialog */}
      <Dialog open={assignProjectDialog} onOpenChange={setAssignProjectDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              Assign New Project
            </DialogTitle>
            <DialogDescription>
              Select a project to assign to {user.full_name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project</label>
              <ReactSelect
                options={options}
                value={options.find((option) => option.value === curProj) || null}
                onChange={(val) => setCurProj(val ? (val.value as string) : "")}
                menuPosition="fixed"
                isClearable={true}
                placeholder="Select a project..."
                noOptionsMessage={() => "No projects available"}
                styles={{
                  control: (base) => ({
                    ...base,
                    borderColor: "hsl(var(--border))",
                    "&:hover": { borderColor: "hsl(var(--border))" },
                  }),
                  menu: (base) => ({
                    ...base,
                    zIndex: 50,
                  }),
                }}
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Assign to:</span>
              <span className="font-semibold">{user.full_name}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="gap-1">
                <Undo2 className="h-4 w-4" />
                Cancel
              </Button>
            </DialogClose>
            {createLoading ? (
              <TailSpin color="hsl(var(--primary))" height={40} width={40} />
            ) : (
              <Button
                disabled={!curProj}
                onClick={() => {
                  const selectedOption = options.find((o) => o.value === curProj);
                  onAssignProject(
                    curProj,
                    selectedOption?.label || "",
                    toggleAssignProjectDialog
                  );
                  setCurProj("");
                }}
                className="gap-1"
              >
                <ListChecks className="h-4 w-4" />
                Assign
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Unlink Project Dialog */}
      <Dialog open={unlinkProjectDialog} onOpenChange={setUnlinkProjectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Remove Project Access
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove access to{" "}
              <span className="font-semibold text-foreground">
                {getProjectAttributes(projectSelected || "").projectName}
              </span>
              ? This user will no longer be able to view or work on this project.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            {deleteLoading ? (
              <TailSpin color="hsl(var(--destructive))" height={40} width={40} />
            ) : (
              <>
                <DialogClose asChild>
                  <Button variant="secondary" className="gap-1">
                    <Undo2 className="h-4 w-4" />
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (projectSelected && permissionList) {
                      onDeleteProject(
                        projectSelected,
                        permissionList,
                        toggleUnlinkProjectDialog
                      );
                    }
                  }}
                  className="gap-1"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove Access
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
