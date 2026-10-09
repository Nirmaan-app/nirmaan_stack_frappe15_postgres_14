import { useCallback, useContext } from "react";
import { TailSpin } from "react-loader-spinner";

import ProjectSelect from "@/components/custom-select/project-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserContext } from "@/utils/auth/UserProvider";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";

import { MTCProjectTable } from "./components/MTCProjectTable";
import { useMTCProjects, useMTCsForProject } from "./hooks/useMTCs";

/**
 * The MTC list page (Project Manager and Project Lead dashboards).
 *
 * The project picker works exactly like the DC & MIR page's: the shared `ProjectSelect`, the
 * selection kept in `UserContext` + sessionStorage so it carries across pages. A PM / PL with
 * no project assigned sees a message instead (owner rulings Q37/Q38); the server also scopes
 * them to their assigned projects. View only: upload, edit and delete happen on the PO page.
 */
export const MaterialTestCertificates = () => {
  const { selectedProject, setSelectedProject } = useContext(UserContext);
  const { result, isLoading: scopeLoading } = useMTCProjects();
  const { mtcs, isLoading } = useMTCsForProject(selectedProject);
  const { data: usersList } = useUsersList();

  const getUserName = useCallback(
    (id?: string) => {
      if (!id) return "--";
      if (id === "Administrator") return "Administrator";
      return usersList?.find((u) => u.name === id)?.full_name || id;
    },
    [usersList]
  );

  // Same as the DC & MIR page.
  const handleProjectChange = (selectedItem: { value: string } | null) => {
    const projectValue = selectedItem ? selectedItem.value : null;
    setSelectedProject(projectValue);
    if (projectValue) {
      sessionStorage.setItem("selectedProject", JSON.stringify(projectValue));
    } else {
      sessionStorage.removeItem("selectedProject");
    }
  };

  const noAssignment = !!result && result.scoped && !result.has_projects;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8">
      <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Material Test Certificates</h2>

      <Card>
        <CardHeader>
          <CardTitle>Select Project</CardTitle>
          <p className="text-sm text-muted-foreground pt-1">
            Select a project to view its Material Test Certificates.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {scopeLoading ? (
            <div className="flex justify-center py-6" role="status">
              <TailSpin color="red" height={28} width={28} />
            </div>
          ) : noAssignment ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              You have not been assigned any project. Ask an admin to assign your projects to see their
              Material Test Certificates.
            </p>
          ) : (
            <>
              <div className="w-full md:max-w-md">
                <ProjectSelect onChange={handleProjectChange} />
              </div>

              {!selectedProject ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Select a project to see its Material Test Certificates.
                </p>
              ) : (
                // Keyed by project so the search and Vendor filter reset when the project changes.
                <MTCProjectTable
                  key={selectedProject}
                  mtcs={mtcs ?? []}
                  getUserName={getUserName}
                  isLoading={isLoading}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export { MaterialTestCertificates as Component };
