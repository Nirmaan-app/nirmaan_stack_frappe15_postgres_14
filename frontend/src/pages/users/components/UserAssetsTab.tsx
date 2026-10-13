import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useFrappeUpdateDoc, useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TailSpin } from "react-loader-spinner";
import { useToast } from "@/components/ui/use-toast";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { formatDate } from "@/utils/FormatDate";
import {
  CirclePlus,
  PackageSearch,
  Undo2,
  UserMinus,
  ExternalLink,
  Calendar,
  Hash,
  AlertTriangle,
  FileCheck,
  Upload,
  FileText,
  Briefcase,
  Laptop,
  PenLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserData } from "@/hooks/useUserData";
import { assetTabToOpen, canSignDeclaration } from "@/utils/assetDeclaration";
import { PendingDeclarationTooltip, pendingDeclarationLabel } from "@/components/helpers/PendingDeclarationIcon";
import { AssignAssetToUserDialog } from "./AssignAssetToUserDialog";
import { SignDeclarationDialog } from "@/pages/Assets/components/SignDeclarationDialog";
import { getAssetPermissions } from "@/pages/Assets/utils/permissions";
import { UnassignReasonFields } from "@/pages/Assets/components/UnassignReasonFields";
import { isUnassignReasonValid } from "@/utils/assetUnassign";
import { getFrappeError } from "@/utils/frappeErrors";
import { ASSET_MANAGEMENT_DOCTYPE } from "@/pages/Assets/assets.constants";

// Types for asset data
interface AssetManagementRecord {
  name: string;
  asset: string;
  asset_assigned_to: string;
  asset_assigned_on: string;
  asset_declaration_attachment: string | null;
  creation: string;
}

interface AssetMasterRecord {
  name: string;
  asset_name: string;
  asset_category: string;
  asset_condition: string;
  asset_serial_number: string;
  asset_value: number;
  current_assignee: string;
}

interface AssetCategoryRecord {
  name: string;
  asset_category: string;
  category_type?: "Project" | "IT";
}

type AssetSubTab = "Project" | "IT";

/** The mark on a Project / IT tab that has declarations still to sign or upload (same icon as the sidebar). */
function PendingDeclarationMark({ count, canSign }: { count: number; canSign: boolean }) {
  if (count === 0) return null;
  return <PendingDeclarationTooltip label={pendingDeclarationLabel(count, canSign)} />;
}

interface UserAssetsTabProps {
  user: NirmaanUsers;
  assetManagementList: AssetManagementRecord[] | undefined;
  assetMasterList: AssetMasterRecord[] | undefined;
  /** Assets the viewer can't open (their own, on a project they are not on): the card shows no link. */
  assetsWithoutPage?: ReadonlySet<string>;
  categoryList: AssetCategoryRecord[] | undefined;
  isAdmin: boolean;
  isOwnProfile: boolean;
  onMutate: () => void;
}

// Asset Card Component
function AssetCard({
  assignment,
  asset,
  isAdmin,
  canUploadDeclaration,
  canSign,
  hasPage = true,
  onUnassign,
  onUploadDeclaration,
  onSign,
}: {
  assignment: AssetManagementRecord;
  asset: AssetMasterRecord | undefined;
  isAdmin: boolean;
  /** False when the viewer can't open the asset's page: the name is shown without a link. */
  hasPage?: boolean;
  /** Uploading a scanned declaration is Admin only; the employee signs in the app instead. */
  canUploadDeclaration: boolean;
  /** The viewer is the assignee and the declaration is still pending. */
  canSign: boolean;
  onUnassign: () => void;
  onUploadDeclaration: () => void;
  onSign: () => void;
}) {
  const isPendingDeclaration = !assignment.asset_declaration_attachment;

  return (
    <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-md hover:border-primary/20">
      <CardContent className="p-4 space-y-3">
        {/* Header with Asset Name */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {hasPage ? (
              <Link
                to={`/asset-management/${assignment.asset}`}
                className="font-semibold text-base hover:text-primary transition-colors flex items-center gap-1 group/link"
              >
                <span className="truncate">{asset?.asset_name || assignment.asset}</span>
                <ExternalLink className="h-3 w-3 opacity-0 group-hover/link:opacity-100 transition-opacity flex-shrink-0" />
              </Link>
            ) : (
              <p className="font-semibold text-base truncate">{asset?.asset_name || assignment.asset}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {asset?.asset_category || "Uncategorized"}
            </p>
          </div>
          {asset?.asset_condition && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs flex-shrink-0",
                asset.asset_condition === "New" && "border-green-500 text-green-600",
                asset.asset_condition === "Good" && "border-blue-500 text-blue-600",
                asset.asset_condition === "Fair" && "border-amber-500 text-amber-600",
                asset.asset_condition === "Poor" && "border-orange-500 text-orange-600",
                asset.asset_condition === "Damaged" && "border-red-500 text-red-600"
              )}
            >
              {asset.asset_condition}
            </Badge>
          )}
        </div>

        {/* Asset Details */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          {asset?.asset_serial_number && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Hash className="h-3.5 w-3.5" />
              <span className="truncate">{asset.asset_serial_number}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            <span>{formatDate(assignment.asset_assigned_on)}</span>
          </div>
        </div>

        {/* Declaration Status */}
        <div className="flex items-center justify-between pt-2 border-t">
          {isPendingDeclaration ? (
            <div className="flex items-center gap-1.5 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-medium">Declaration Pending</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-green-600">
              <FileCheck className="h-4 w-4" />
              <a
                href={assignment.asset_declaration_attachment || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium hover:underline"
              >
                View Declaration
              </a>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-1">
            {canSign && (
              <Button
                size="sm"
                onClick={onSign}
                className="h-7 px-2.5 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
              >
                <PenLine className="h-3.5 w-3.5" />
                Sign
              </Button>
            )}
            {isPendingDeclaration && canUploadDeclaration && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onUploadDeclaration}
                className="h-7 px-2 text-xs gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={onUnassign}
                className="h-7 px-2 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
              >
                <UserMinus className="h-3.5 w-3.5" />
                Unassign
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function UserAssetsTab({
  user,
  assetManagementList,
  assetMasterList,
  assetsWithoutPage,
  categoryList,
  isAdmin,
  isOwnProfile,
  onMutate,
}: UserAssetsTabProps) {
  const { toast } = useToast();
  const userData = useUserData();
  const { canUploadDeclaration } = getAssetPermissions(userData?.user_id, userData?.role);
  const { updateDoc } = useFrappeUpdateDoc();
  // One request: the reason is checked, the assignment removed and the reason kept on the asset's
  // "Unassigned" history row (api/assets/assign.py).
  const { call: unassignAsset } = useFrappePostCall("nirmaan_stack.api.assets.assign.unassign_asset");
  const { upload } = useFrappeFileUpload();

  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<AssetManagementRecord | null>(null);
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [unassignReason, setUnassignReason] = useState("");
  const [unassignDetails, setUnassignDetails] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [declarationFile, setDeclarationFile] = useState<File | null>(null);
  const [subTab, setSubTab] = useState<AssetSubTab>("Project");
  // The dialog holds the row's name; the live row is read from the refetched list.
  const [signingAssignmentName, setSigningAssignmentName] = useState<string | null>(null);

  // Get asset details by ID
  const getAssetDetails = useCallback(
    (assetId: string) => assetMasterList?.find((a) => a.name === assetId),
    [assetMasterList]
  );

  // Map: category name -> category_type (Project | IT)
  const categoryTypeMap = useMemo(() => {
    const map = new Map<string, AssetSubTab>();
    categoryList?.forEach((c) => {
      if (c.category_type === "Project" || c.category_type === "IT") {
        map.set(c.name, c.category_type);
      }
    });
    return map;
  }, [categoryList]);

  // Determine an assignment's category type via its asset → category lookup.
  const getAssignmentType = useCallback(
    (assignment: AssetManagementRecord): AssetSubTab | undefined => {
      const asset = getAssetDetails(assignment.asset);
      if (!asset) return undefined;
      return categoryTypeMap.get(asset.asset_category);
    },
    [getAssetDetails, categoryTypeMap]
  );

  const { projectAssignments, itAssignments } = useMemo(() => {
    const project: AssetManagementRecord[] = [];
    const it: AssetManagementRecord[] = [];
    (assetManagementList ?? []).forEach((a) => {
      const t = getAssignmentType(a);
      if (t === "Project") project.push(a);
      else if (t === "IT") it.push(a);
    });
    return { projectAssignments: project, itAssignments: it };
  }, [assetManagementList, getAssignmentType]);

  const totalAssigned = (assetManagementList ?? []).length;
  const pendingDeclCount = (assetManagementList ?? []).filter(
    (a) => !a.asset_declaration_attachment
  ).length;

  // Declarations still waiting, per tab -- the same test as the "Declaration Pending" count above.
  const projectPending = projectAssignments.filter((a) => !a.asset_declaration_attachment).length;
  const itPending = itAssignments.filter((a) => !a.asset_declaration_attachment).length;

  // Open on the tab that needs attention: when the assignments first load, and again on every
  // navigation here -- the sidebar's pending-declaration icon navigates even when this profile is
  // already open, so it switches tabs too. A tab the user picks stays until the next navigation.
  const location = useLocation();
  const subTabDecidedFor = useRef<string | null>(null);
  useEffect(() => {
    if (subTabDecidedFor.current === location.key || projectAssignments.length + itAssignments.length === 0) return;
    subTabDecidedFor.current = location.key;
    setSubTab(
      assetTabToOpen(
        { total: projectAssignments.length, pending: projectPending },
        { total: itAssignments.length, pending: itPending }
      )
    );
  }, [location.key, projectAssignments.length, itAssignments.length, projectPending, itPending]);

  const visibleAssignments = subTab === "Project" ? projectAssignments : itAssignments;

  const signingAssignment = useMemo(
    () => (assetManagementList ?? []).find((a) => a.name === signingAssignmentName),
    [assetManagementList, signingAssignmentName]
  );

  // All unassigned assets — the dialog filters internally by its Asset Type
  // dropdown (defaults to the currently active sub-tab).
  const unassignedAssets = useMemo(
    () => (assetMasterList ?? []).filter((a) => !a.current_assignee),
    [assetMasterList]
  );

  const handleUnassign = async () => {
    if (!selectedAssignment) return;

    setIsUnassigning(true);
    try {
      // This card's own row: a leftover row for someone who no longer holds the asset is removed
      // without touching the real holder.
      await unassignAsset({
        asset: selectedAssignment.asset,
        assignment: selectedAssignment.name,
        reason: unassignReason,
        details: unassignDetails.trim() || undefined,
      });

      toast({
        title: "Asset Unassigned",
        description: "The asset has been unassigned successfully.",
        variant: "success",
      });

      setUnassignDialogOpen(false);
      setSelectedAssignment(null);
      onMutate();
    } catch (error: any) {
      toast({
        title: "Error",
        description: getFrappeError(error),
        variant: "destructive",
      });
    } finally {
      setIsUnassigning(false);
    }
  };

  const handleUploadDeclaration = async () => {
    if (!selectedAssignment || !declarationFile) return;

    setIsUploading(true);
    try {
      // Upload the file
      const fileArgs = {
        doctype: ASSET_MANAGEMENT_DOCTYPE,
        docname: selectedAssignment.name,
        fieldname: "asset_declaration_attachment",
        isPrivate: true,
      };
      const uploadedFile = await upload(declarationFile, fileArgs);

      // Update the Asset Management record with the file URL
      await updateDoc(ASSET_MANAGEMENT_DOCTYPE, selectedAssignment.name, {
        asset_declaration_attachment: uploadedFile.file_url,
      });

      toast({
        title: "Declaration Uploaded",
        description: "The declaration document has been uploaded successfully.",
        variant: "success",
      });

      setUploadDialogOpen(false);
      setSelectedAssignment(null);
      setDeclarationFile(null);
      onMutate();
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error?.message || "Failed to upload declaration.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div>
        <h3 className="text-lg font-semibold">Assigned Assets</h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
          <span className="tabular-nums">
            <span className="font-semibold text-emerald-700">{totalAssigned}</span> Total
          </span>
          <span className="text-slate-300">•</span>
          <span className="inline-flex items-center gap-1">
            <Briefcase className="h-3.5 w-3.5 text-blue-600" />
            <span className="tabular-nums">{projectAssignments.length}</span> Project
          </span>
          <span className="inline-flex items-center gap-1">
            <Laptop className="h-3.5 w-3.5 text-purple-600" />
            <span className="tabular-nums">{itAssignments.length}</span> IT
          </span>
          {pendingDeclCount > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="tabular-nums">{pendingDeclCount}</span> Declaration Pending
            </span>
          )}
        </div>
      </div>

      {/* Project / IT Sub-tabs + Assign button on the same row */}
      <div className="flex items-center justify-between gap-4">
        <Tabs
          value={subTab}
          onValueChange={(v) => {
            subTabDecidedFor.current = location.key;
            setSubTab(v as AssetSubTab);
          }}
        >
          <TabsList className="w-fit bg-gray-100/80 p-1">
            <TabsTrigger
              value="Project"
              className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-700"
            >
              <Briefcase className="h-4 w-4" />
              <span className="hidden sm:inline">Project Assets</span>
              <span className="sm:hidden">Project</span>
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-5 text-xs">
                {projectAssignments.length}
              </Badge>
              <PendingDeclarationMark count={projectPending} canSign={isOwnProfile} />
            </TabsTrigger>
            <TabsTrigger
              value="IT"
              className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-purple-700"
            >
              <Laptop className="h-4 w-4" />
              <span className="hidden sm:inline">IT Assets</span>
              <span className="sm:hidden">IT</span>
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-5 text-xs">
                {itAssignments.length}
              </Badge>
              <PendingDeclarationMark count={itPending} canSign={isOwnProfile} />
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {isAdmin && (
          <Button onClick={() => setAssignDialogOpen(true)} className="gap-2">
            <CirclePlus className="h-4 w-4" />
            <span className="max-md:hidden">Assign Asset</span>
            <span className="md:hidden">Assign</span>
          </Button>
        )}
      </div>

      {/* Assets Grid */}
      {visibleAssignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
            <PackageSearch className="h-8 w-8 text-muted-foreground" />
          </div>
          <h4 className="text-lg font-semibold">
            No {subTab === "Project" ? "Project" : "IT"} Assets Assigned
          </h4>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {isAdmin
              ? `Click 'Assign ${subTab === "Project" ? "Project" : "IT"} Asset' to assign equipment to this user.`
              : `No ${subTab === "Project" ? "project" : "IT"} assets have been assigned to this user yet.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleAssignments.map((assignment) => {
            const asset = getAssetDetails(assignment.asset);
            return (
              <AssetCard
                key={assignment.name}
                assignment={assignment}
                asset={asset}
                hasPage={!assetsWithoutPage?.has(assignment.asset)}
                isAdmin={isAdmin}
                canUploadDeclaration={canUploadDeclaration}
                canSign={
                  isOwnProfile &&
                  canSignDeclaration({
                    viewerId: userData?.user_id,
                    assignedTo: assignment.asset_assigned_to,
                    currentAssignee: asset?.current_assignee,
                    declaration: assignment.asset_declaration_attachment,
                  })
                }
                onUnassign={() => {
                  setSelectedAssignment(assignment);
                  setUnassignReason("");
                  setUnassignDetails("");
                  setUnassignDialogOpen(true);
                }}
                onUploadDeclaration={() => {
                  setSelectedAssignment(assignment);
                  setUploadDialogOpen(true);
                }}
                onSign={() => setSigningAssignmentName(assignment.name)}
              />
            );
          })}
        </div>
      )}

      {/* Assign Asset Dialog */}
      <AssignAssetToUserDialog
        isOpen={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        userId={user.name}
        userName={user.full_name}
        userDepartment={user.department}
        unassignedAssets={unassignedAssets}
        categoryList={categoryList}
        initialAssetType={subTab}
        canUploadDeclaration={canUploadDeclaration}
        onAssigned={onMutate}
      />

      {/* Sign Declaration Dialog (the assignee, on their own profile) */}
      {signingAssignment && (
        <SignDeclarationDialog
          isOpen={!!signingAssignment}
          onOpenChange={(open) => {
            if (!open) setSigningAssignmentName(null);
          }}
          assignmentId={signingAssignment.name}
          assetId={signingAssignment.asset}
          assetName={getAssetDetails(signingAssignment.asset)?.asset_name || ""}
          serialNumber={getAssetDetails(signingAssignment.asset)?.asset_serial_number}
          condition={getAssetDetails(signingAssignment.asset)?.asset_condition}
          assignedOn={signingAssignment.asset_assigned_on}
          onSigned={onMutate}
        />
      )}

      {/* Unassign Asset Dialog */}
      <Dialog open={unassignDialogOpen} onOpenChange={setUnassignDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Unassign Asset</DialogTitle>
            <DialogDescription>
              Are you sure you want to unassign{" "}
              <span className="font-semibold text-foreground">
                {getAssetDetails(selectedAssignment?.asset || "")?.asset_name || selectedAssignment?.asset}
              </span>
              ? This will remove the asset from this user.
            </DialogDescription>
          </DialogHeader>
          <UnassignReasonFields
            reason={unassignReason}
            details={unassignDetails}
            onReasonChange={setUnassignReason}
            onDetailsChange={setUnassignDetails}
            disabled={isUnassigning}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            {isUnassigning ? (
              <TailSpin color="hsl(var(--destructive))" height={40} width={40} />
            ) : (
              <>
                <DialogClose asChild>
                  <Button variant="outline" className="gap-1">
                    <Undo2 className="h-4 w-4" />
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={handleUnassign}
                  disabled={!isUnassignReasonValid(unassignReason, unassignDetails)}
                  className="gap-1"
                >
                  <UserMinus className="h-4 w-4" />
                  Unassign
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Declaration Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={(open) => {
        setUploadDialogOpen(open);
        if (!open) {
          setDeclarationFile(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
              <FileText className="h-6 w-6 text-amber-600" />
            </div>
            <DialogTitle className="text-center">Upload Declaration</DialogTitle>
            <DialogDescription className="text-center">
              Upload declaration document for{" "}
              <span className="font-medium text-foreground">
                {getAssetDetails(selectedAssignment?.asset || "")?.asset_name || selectedAssignment?.asset}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <CustomAttachment
              selectedFile={declarationFile}
              onFileSelect={setDeclarationFile}
              acceptedTypes={["image/*", "application/pdf"]}
              label="Upload Declaration Document"
              maxFileSize={10 * 1024 * 1024}
              onError={(err) =>
                toast({
                  title: "File Error",
                  description: err.message,
                  variant: "destructive",
                })
              }
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {isUploading ? (
              <TailSpin color="hsl(var(--primary))" height={40} width={40} />
            ) : (
              <>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button
                  onClick={handleUploadDeclaration}
                  disabled={!declarationFile}
                  className="gap-1 bg-amber-600 hover:bg-amber-700"
                >
                  <Upload className="h-4 w-4" />
                  Upload
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
