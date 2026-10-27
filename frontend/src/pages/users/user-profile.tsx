import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useFrappeDocumentEventListener,
  useFrappeGetCall,
  useFrappeGetDoc,
  useFrappeGetDocList,
} from "frappe-react-sdk";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserProfileSkeleton } from "@/components/ui/skeleton";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { PROJECT_REQUIRED_PROFILES } from "@/constants/roles";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useMyAssets, useRefreshUserAssignments, useUserAssignments } from "@/hooks/useUserAssignments";
import { withOwnAssets } from "@/utils/ownAssets";
import { useAssetDataRefresh } from "@/pages/Assets/hooks/useAssetDataRefresh";
import { urlStateManager } from "@/utils/urlStateManager";
import { seesAllClaims } from "@/utils/reimbursements/rules";
import type { OwnBankAccount } from "@/types/NirmaanStack/Reimbursement";
import { useUserSubmitHandlers } from "@/hooks/useUserSubmitHandlers";
import { NirmaanUserPermissions } from "@/types/NirmaanStack/NirmaanUserPermissions";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Pencil2Icon } from "@radix-ui/react-icons";
import { User, FolderKanban, Package, Landmark } from "lucide-react";
import EditUserForm from "./EditUserForm";
import {
  UserProfileActions,
  UserOverviewTab,
  UserProjectsTab,
  UserAssetsTab,
  UserPayeesTab,
} from "./components";
import {
  ASSET_MASTER_DOCTYPE,
  ASSET_CATEGORY_DOCTYPE,
  ASSET_MASTER_FIELDS,
  ASSET_CATEGORY_FIELDS,
} from "@/pages/Assets/assets.constants";

export default function Profile() {
  const { userId: id } = useParams<{ userId: string }>();

  if (!id) return <div>No User ID Provided</div>;

  const userData = useUserData();
  const isAdmin = userData.role === "Nirmaan Admin Profile" || userData.role === "Nirmaan PMO Executive Profile" || userData.role === "Nirmaan HR Executive Profile";
  const isOwnProfile = userData.user_id === id;
  const tabParam = useUrlParam("tab");

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

  // Fetch user permissions — Frappe's built-in `User Permission` doctype is
  // restricted to admin/system-manager roles. Non-admin users (even viewing
  // their own profile) get a 403 PermissionError and SWR's default retry
  // would then keep firing the same failed request, looking like a "page
  // auto-refresh" with the error toast popping repeatedly.
  //
  // Strategy:
  //   - Admin viewers   → fetch `User Permission` (matches doc names for delete ops)
  //   - Non-admin own   → fetch `Nirmaan User Permissions` mirror (readable by all roles)
  // Then combine into a single `permission_list` that the UI can consume.
  const {
    data: admin_permission_list,
    isLoading: admin_permission_loading,
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
    isAdmin ? undefined : null,
    { shouldRetryOnError: false }
  );

  const {
    data: mirror_permission_list,
    isLoading: mirror_permission_loading,
  } = useFrappeGetDocList<NirmaanUserPermissions>(
    "Nirmaan User Permissions",
    {
      fields: ["name", "for_value", "creation"],
      filters: [
        ["user", "=", id],
        ["allow", "=", "Projects"],
      ],
      limit: 1000,
      orderBy: { field: "creation", order: "desc" },
    },
    !isAdmin && isOwnProfile ? `nirmaan_user_permissions_${id}` : null,
    { shouldRetryOnError: false }
  );

  const permission_list = isAdmin ? admin_permission_list : mirror_permission_list;
  const permission_list_loading = isAdmin ? admin_permission_loading : mirror_permission_loading;

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

  // Fetch asset management records for this user (for admin OR own profile). Same query and key as
  // the app access gate's count, so a signature here lifts the gate too.
  const {
    data: assetManagementList,
    isLoading: assetManagementLoading,
    mutate: assetManagementMutate,
  } = useUserAssignments(id, isAdmin || isOwnProfile);

  // Fetch all asset masters (for assignment dialog - admins only)
  const { data: assetMasterList, isLoading: assetMasterLoading, mutate: assetMasterMutate } =
    useFrappeGetDocList(
      ASSET_MASTER_DOCTYPE,
      {
        fields: ASSET_MASTER_FIELDS as unknown as string[],
        limit: 1000,
        orderBy: { field: "asset_name", order: "asc" },
      },
      (isAdmin || isOwnProfile) ? "asset_masters_for_user_profile" : null
    );

  // Fetch asset categories — needed for both the assignment dialog (admin only)
  // AND the Project/IT sub-tab partitioning in UserAssetsTab (visible to the
  // user themselves too). Without this fetch on own-profile, every assignment
  // falls through neither bucket and shows "0 Project / 0 IT".
  const { data: categoryList } =
    useFrappeGetDocList(
      ASSET_CATEGORY_DOCTYPE,
      {
        fields: ASSET_CATEGORY_FIELDS as unknown as string[],
        // Every category (0 = no limit): a category past a cut-off would put its assets in neither tab, while the
        // app access gate still counts their declarations and audits (code review #3).
        limit: 0,
        orderBy: { field: "asset_category", order: "asc" },
      },
      (isAdmin || isOwnProfile) ? "asset_categories_for_user_profile" : null
    );

  // On their own profile a person also gets their own assets from the server: the list above follows
  // their project permissions and misses an asset assigned to them for a project they are not on, so
  // its card, its Project / IT tab and its Sign button never showed (owner, 2026-10-13).
  const { data: myAssets } = useMyAssets(isOwnProfile);
  const { assets: profileAssets, withoutPage: assetsWithoutPage } = useMemo(
    () => withOwnAssets(assetMasterList, isOwnProfile ? myAssets : undefined),
    [assetMasterList, myAssets, isOwnProfile]
  );

  // After an assign, unassign, upload or sign on this tab: the person's assignments, the asset list
  // the Assign dialog picks free assets from (a freed asset must show up, an assigned one must not),
  // the app access gate's "held" list, and the Assets page summary counts.
  const refreshUserAssignments = useRefreshUserAssignments();
  const { refreshSummaryCards } = useAssetDataRefresh();
  const handleAssetsChanged = useCallback(() => {
    assetManagementMutate();
    assetMasterMutate();
    refreshUserAssignments(id);
    refreshSummaryCards();
  }, [assetManagementMutate, assetMasterMutate, refreshUserAssignments, id, refreshSummaryCards]);

  // Asset count for stats
  // Payee tab: the person's own bank account (Reimbursements; one per person). The person, Admin, HR and
  // Accounts see it, as they see the person's claims; the endpoint refuses anyone else.
  const canSeePayees = isOwnProfile || seesAllClaims({ role: userData.role, userId: userData.user_id });
  const { data: payeeData, isLoading: payeeLoading, mutate: mutatePayee } = useFrappeGetCall<{ message: OwnBankAccount | null }>(
    "nirmaan_stack.api.reimbursements.bank_accounts.bank_account_of",
    { user: id },
    canSeePayees && id ? `bank_account_of:${id}` : null
  );
  const payee = payeeData?.message ?? null;

  const assetCount = useMemo(() => {
    return assetManagementList?.length || 0;
  }, [assetManagementList]);

  // Project count for stats
  const projectCount = useMemo(() => {
    if (
      ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Estimates Executive Profile", "Nirmaan Billing Executive Profile"].includes(
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

  // Only the profiles that need a project get the Projects tab and count -- the same list as the app access gate's
  // no-project lock, `PROJECT_REQUIRED_PROFILES` (owner, 2026-10-22, code review #10: one list, not two).
  const isProjectExemptRole = !PROJECT_REQUIRED_PROFILES.includes(data.role_profile || "");
  // ?tab=assets opens the Assets tab (the app access gate's "Open my assets" links here).
  const profileTabs = [
    "overview",
    ...(isProjectExemptRole ? [] : ["projects"]),
    "assets",
    ...(canSeePayees ? ["payees"] : []),
  ];
  const tabGridCols = ["", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"][profileTabs.length];
  const activeTab = tabParam && profileTabs.includes(tabParam) ? tabParam : "overview";

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
            onEditUser={() => setEditSheetOpen(true)}
            onResetPassword={handlePasswordReset}
            onDeleteUser={handleDeleteUser}
            onRenameEmail={handleRenameEmail}
            deleteLoading={delete_loading}
            renameLoading={rename_loading}
          />
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(tab) => urlStateManager.updateParam("tab", tab)} className="w-full">
        <TabsList className={`grid w-full ${tabGridCols} ${profileTabs.length > 3 ? "max-w-xl" : "max-w-md"}`}>
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
          {canSeePayees && (
            <TabsTrigger value="payees" className="gap-2">
              <Landmark className="h-4 w-4" />
              <span className="max-sm:hidden">Payee</span>
            </TabsTrigger>
          )}
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
            assetMasterList={profileAssets as any}
            assetsWithoutPage={assetsWithoutPage}
            categoryList={categoryList as any}
            isAdmin={isAdmin}
            isOwnProfile={isOwnProfile}
            onMutate={handleAssetsChanged}
          />
        </TabsContent>

        {canSeePayees && (
          <TabsContent value="payees" className="mt-6">
            <UserPayeesTab account={payee} loading={payeeLoading} isOwnProfile={isOwnProfile} onChanged={() => mutatePayee()} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
