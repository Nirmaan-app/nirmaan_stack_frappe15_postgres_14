import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useFrappeDocumentEventListener,
  useFrappeGetDoc,
  useFrappeGetDocList,
} from "frappe-react-sdk";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserProfileSkeleton } from "@/components/ui/skeleton";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { useUserSubmitHandlers } from "@/hooks/useUserSubmitHandlers";
import { NirmaanUserPermissions } from "@/types/NirmaanStack/NirmaanUserPermissions";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Pencil2Icon } from "@radix-ui/react-icons";
import { User, FolderKanban } from "lucide-react";
import EditUserForm from "./EditUserForm";
import {
  UserProfileActions,
  UserOverviewTab,
  UserProjectsTab,
} from "./components";

export default function Profile() {
  const { userId: id } = useParams<{ userId: string }>();

  if (!id) return <div>No User ID Provided</div>;

  const userData = useUserData();
  const isAdmin = userData.role === "Nirmaan Admin Profile";

  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const toggleEditSheet = useCallback(() => {
    setEditSheetOpen((prevState) => !prevState);
  }, []);

  // Fetch user data
  const {
    data,
    isLoading,
    error,
    mutate: user_mutate,
  } = useFrappeGetDoc<NirmaanUsersType>(
    "Nirmaan Users",
    id,
    id ? `Nirmaan Users ${id}` : null
  );

  // Real-time updates
  useFrappeDocumentEventListener(
    "Nirmaan Users",
    id,
    (event) => {
      console.log("Nirmaan Users document updated (real-time):", event);
      toast({
        title: "Document Updated",
        description: `Nirmaan Users ${event.name} has been modified.`,
      });
      user_mutate();
    },
    true
  );

  // Fetch user permissions (only for admin)
  const {
    data: permission_list,
    isLoading: permission_list_loading,
    mutate: permission_list_mutate,
  } = useFrappeGetDocList<NirmaanUserPermissions>(
    "User Permission",
    {
      fields: ["name", "for_value", "creation"],
      filters: [
        ["user", "=", id],
        ["allow", "=", "Projects"],
      ],
      limit: 1000,
      orderBy: { field: "creation", order: "desc" },
    },
    isAdmin ? undefined : null
  );

  // Submit handlers
  const {
    handleSubmit,
    handleDeleteUser,
    handleDeleteProject,
    handlePasswordReset,
    handleRenameEmail,
    create_loading,
    delete_loading,
    rename_loading,
  } = useUserSubmitHandlers(data, permission_list_mutate);

  // Fetch all projects
  const { data: project_list, isLoading: project_list_loading } =
    useFrappeGetDocList<Projects>(
      "Projects",
      {
        fields: ["*"],
        limit: 1000,
        orderBy: { field: "creation", order: "desc" },
      },
      "Projects"
    );

  // Fetch address data
  const { data: addressData, isLoading: addressDataLoading } =
    useFrappeGetDocList(
      "Address",
      {
        fields: ["*"],
        limit: 10000,
        orderBy: { field: "creation", order: "desc" },
      },
      "Address"
    );

  // Project count for stats
  const projectCount = useMemo(() => {
    if (
      ["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"].includes(
        data?.role_profile || ""
      )
    ) {
      return project_list?.length || 0;
    }
    return permission_list?.length || 0;
  }, [data?.role_profile, project_list, permission_list]);

  if (
    isLoading ||
    permission_list_loading ||
    project_list_loading ||
    addressDataLoading
  ) {
    return <UserProfileSkeleton />;
  }

  if (error) {
    return <AlertDestructive error={error} />;
  }

  if (!data) {
    return <AlertDestructive error={new Error("User not found")} />;
  }

  return (
    <div className="flex-1 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl max-md:text-xl font-semibold">User Profile</h2>
          <Sheet open={editSheetOpen} onOpenChange={toggleEditSheet}>
            <SheetTrigger>
              <Pencil2Icon className="w-5 h-5 text-blue-600 hover:text-blue-800 transition-colors" />
            </SheetTrigger>
            <SheetContent className="overflow-y-auto">
              <EditUserForm toggleEditSheet={toggleEditSheet} />
            </SheetContent>
          </Sheet>
        </div>

        {isAdmin && data && (
          <UserProfileActions
            user={data}
            onResetPassword={handlePasswordReset}
            onDeleteUser={handleDeleteUser}
            onRenameEmail={handleRenameEmail}
            deleteLoading={delete_loading}
            renameLoading={rename_loading}
          />
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-xs">
          <TabsTrigger value="overview" className="gap-2">
            <User className="h-4 w-4" />
            <span className="max-sm:hidden">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="projects" className="gap-2">
            <FolderKanban className="h-4 w-4" />
            <span className="max-sm:hidden">Projects</span>
            <span className="ml-1 text-xs font-semibold text-muted-foreground">
              {projectCount}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <UserOverviewTab user={data} projectCount={projectCount} />
        </TabsContent>

        <TabsContent value="projects" className="mt-6">
          {isAdmin ? (
            <UserProjectsTab
              user={data}
              permissionList={permission_list}
              projectList={project_list}
              addressData={addressData}
              isAdmin={isAdmin}
              onAssignProject={handleSubmit}
              onDeleteProject={handleDeleteProject}
              createLoading={create_loading}
              deleteLoading={delete_loading}
            />
          ) : (
            <UserProjectsTab
              user={data}
              permissionList={
                userData.has_project === "true"
                  ? project_list?.map((p) => ({
                      name: p.name,
                      for_value: p.name,
                      creation: p.creation,
                    })) as NirmaanUserPermissions[]
                  : []
              }
              projectList={project_list}
              addressData={addressData}
              isAdmin={false}
              onAssignProject={() => {}}
              onDeleteProject={() => {}}
              createLoading={false}
              deleteLoading={false}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
