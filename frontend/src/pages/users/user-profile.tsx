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
import { User, FolderKanban, Package } from "lucide-react";
import EditUserForm from "./EditUserForm";
import {
  UserProfileActions,
  UserOverviewTab,
  UserProjectsTab,
  UserAssetsTab,
} from "./components";
import {
  ASSET_MASTER_DOCTYPE,
  ASSET_MANAGEMENT_DOCTYPE,
  ASSET_CATEGORY_DOCTYPE,
  ASSET_MASTER_FIELDS,
  ASSET_MANAGEMENT_FIELDS,
  ASSET_CATEGORY_FIELDS,
} from "@/pages/Assets/assets.constants";

// Roles that have access to all projects (no assignment required)
const PROJECT_EXEMPT_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan HR Executive Profile",
  "Nirmaan Accountant Profile",
  "Nirmaan Estimates Executive Profile",
  "Nirmaan Design Lead Profile",
];

export default function Profile() {
  const { userId: id } = useParams<{ userId: string }>();

  if (!id) return <div>No User ID Provided</div>;

  const userData = useUserData();
  const isAdmin = userData.role === "Nirmaan Admin Profile" || userData.role === "Nirmaan PMO Executive Profile" || userData.role === "Nirmaan HR Executive Profile";
  const isOwnProfile = userData.user_id === id;

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

  // Fetch user permissions (for admin OR when viewing own profile)
  // Note: We fetch from "User Permission" (Frappe's built-in) instead of
  // "Nirmaan User Permissions" (mirror) so that the document names match
  // when performing delete operations
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
    (isAdmin || isOwnProfile) ? undefined : null
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

  // Fetch asset management records for this user (for admin OR own profile)
  const {
    data: assetManagementList,
    isLoading: assetManagementLoading,
    mutate: assetManagementMutate,
  } = useFrappeGetDocList(
    ASSET_MANAGEMENT_DOCTYPE,
    {
      fields: ASSET_MANAGEMENT_FIELDS as unknown as string[],
      filters: [["asset_assigned_to", "=", id]],
      limit: 1000,
      orderBy: { field: "creation", order: "desc" },
    },
    (isAdmin || isOwnProfile) ? `asset_management_${id}` : null
  );

  // Fetch all asset masters (for assignment dialog - admins only)
  const { data: assetMasterList, isLoading: assetMasterLoading } =
    useFrappeGetDocList(
      ASSET_MASTER_DOCTYPE,
      {
        fields: ASSET_MASTER_FIELDS as unknown as string[],
        limit: 1000,
        orderBy: { field: "asset_name", order: "asc" },
      },
      (isAdmin || isOwnProfile) ? "asset_masters_for_user_profile" : null
    );

  // Fetch asset categories (for assignment dialog filter)
  const { data: categoryList } =
    useFrappeGetDocList(
      ASSET_CATEGORY_DOCTYPE,
      {
        fields: ASSET_CATEGORY_FIELDS as unknown as string[],
        limit: 100,
        orderBy: { field: "asset_category", order: "asc" },
      },
      isAdmin ? "asset_categories_for_user_profile" : null
    );

  // Asset count for stats
  const assetCount = useMemo(() => {
    return assetManagementList?.length || 0;
  }, [assetManagementList]);

  // Project count for stats
  const projectCount = useMemo(() => {
    if (
      ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Estimates Executive Profile"].includes(
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
    addressDataLoading ||
    assetManagementLoading ||
    assetMasterLoading
  ) {
    return <UserProfileSkeleton />;
  }

  if (error) {
    return <AlertDestructive error={error} />;
  }

  if (!data) {
    return <AlertDestructive error={new Error("User not found")} />;
  }

  // Check if viewed user's role is exempt from project assignment
  const isProjectExemptRole = PROJECT_EXEMPT_ROLES.includes(data.role_profile || "");

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

        {isAdmin && !isOwnProfile && data && (
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
        <TabsList className={`grid w-full ${isProjectExemptRole ? "grid-cols-2" : "grid-cols-3"} max-w-md`}>
          <TabsTrigger value="overview" className="gap-2">
            <User className="h-4 w-4" />
            <span className="max-sm:hidden">Overview</span>
          </TabsTrigger>
          {!isProjectExemptRole && (
            <TabsTrigger value="projects" className="gap-2">
              <FolderKanban className="h-4 w-4" />
              <span className="max-sm:hidden">Projects</span>
              <span className="ml-1 text-xs font-semibold text-muted-foreground">
                {projectCount}
              </span>
            </TabsTrigger>
          )}
          <TabsTrigger value="assets" className="gap-2">
            <Package className="h-4 w-4" />
            <span className="max-sm:hidden">Assets</span>
            {assetCount > 0 && (
              <span className="ml-1 text-xs font-semibold text-muted-foreground">
                {assetCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <UserOverviewTab
            user={data}
            projectCount={projectCount}
            assetCount={assetCount}
            showProjectStats={!isProjectExemptRole}
            showAssetStats={assetCount > 0}
          />
        </TabsContent>

        {!isProjectExemptRole && (
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
                permissionList={permission_list}
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
        )}

        <TabsContent value="assets" className="mt-6">
          <UserAssetsTab
            user={data}
            assetManagementList={assetManagementList as any}
            assetMasterList={assetMasterList as any}
            categoryList={categoryList as any}
            isAdmin={isAdmin}
            isOwnProfile={isOwnProfile}
            onMutate={() => {
              assetManagementMutate();
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
