import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { useFrappeUpdateDoc, useFrappeDeleteDoc, useFrappeFileUpload } from "frappe-react-sdk";
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
import { TailSpin } from "react-loader-spinner";
import { useToast } from "@/components/ui/use-toast";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { formatDate } from "@/utils/FormatDate";
import {
  CirclePlus,
  PackageSearch,
  Trash2,
  Undo2,
  ExternalLink,
  Calendar,
  Hash,
  AlertTriangle,
  FileCheck,
  Upload,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AssignAssetToUserDialog } from "./AssignAssetToUserDialog";
import {
  ASSET_MASTER_DOCTYPE,
  ASSET_MANAGEMENT_DOCTYPE,
} from "@/pages/Assets/assets.constants";

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
}

interface UserAssetsTabProps {
  user: NirmaanUsers;
  assetManagementList: AssetManagementRecord[] | undefined;
  assetMasterList: AssetMasterRecord[] | undefined;
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
  isOwnProfile,
  onUnassign,
  onUploadDeclaration,
}: {
  assignment: AssetManagementRecord;
  asset: AssetMasterRecord | undefined;
  isAdmin: boolean;
  isOwnProfile: boolean;
  onUnassign: () => void;
  onUploadDeclaration: () => void;
}) {
  const isPendingDeclaration = !assignment.asset_declaration_attachment;
  const canUploadDeclaration = isAdmin || isOwnProfile;

  return (
    <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-md hover:border-primary/20">
      <CardContent className="p-4 space-y-3">
        {/* Header with Asset Name */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <Link
              to={`/asset-management/${assignment.asset}`}
              className="font-semibold text-base hover:text-primary transition-colors flex items-center gap-1 group/link"
            >
              <span className="truncate">{asset?.asset_name || assignment.asset}</span>
              <ExternalLink className="h-3 w-3 opacity-0 group-hover/link:opacity-100 transition-opacity flex-shrink-0" />
            </Link>
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
                variant="ghost"
                size="sm"
                onClick={onUnassign}
                className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
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
  categoryList,
  isAdmin,
  isOwnProfile,
  onMutate,
}: UserAssetsTabProps) {
  const { toast } = useToast();
  const { updateDoc } = useFrappeUpdateDoc();
  const { deleteDoc } = useFrappeDeleteDoc();
  const { upload } = useFrappeFileUpload();

  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<AssetManagementRecord | null>(null);
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [declarationFile, setDeclarationFile] = useState<File | null>(null);

  // Get asset details by ID
  const getAssetDetails = useCallback(
    (assetId: string) => assetMasterList?.find((a) => a.name === assetId),
    [assetMasterList]
  );

  // Unassigned assets for assignment dialog
  const unassignedAssets = useMemo(
    () => assetMasterList?.filter((a) => !a.current_assignee) || [],
    [assetMasterList]
  );

  const handleUnassign = async () => {
    if (!selectedAssignment) return;

    setIsUnassigning(true);
    try {
      // Clear current_assignee in Asset Master
      await updateDoc(ASSET_MASTER_DOCTYPE, selectedAssignment.asset, {
        current_assignee: "",
      });

      // Delete the Asset Management record
      await deleteDoc(ASSET_MANAGEMENT_DOCTYPE, selectedAssignment.name);

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
        description: error?.message || "Failed to unassign asset.",
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Assigned Assets</h3>
          <p className="text-sm text-muted-foreground">
            {assetManagementList?.length || 0} asset
            {(assetManagementList?.length || 0) !== 1 ? "s" : ""} assigned
          </p>
        </div>

        {isAdmin && (
          <Button onClick={() => setAssignDialogOpen(true)} className="gap-2">
            <CirclePlus className="h-4 w-4" />
            <span className="max-md:hidden">Assign Asset</span>
            <span className="md:hidden">Assign</span>
          </Button>
        )}
      </div>

      {/* Assets Grid */}
      {assetManagementList?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
            <PackageSearch className="h-8 w-8 text-muted-foreground" />
          </div>
          <h4 className="text-lg font-semibold">No Assets Assigned</h4>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {isAdmin
              ? "Click 'Assign Asset' to assign equipment to this user."
              : "No assets have been assigned to this user yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {assetManagementList?.map((assignment) => (
            <AssetCard
              key={assignment.name}
              assignment={assignment}
              asset={getAssetDetails(assignment.asset)}
              isAdmin={isAdmin}
              isOwnProfile={isOwnProfile}
              onUnassign={() => {
                setSelectedAssignment(assignment);
                setUnassignDialogOpen(true);
              }}
              onUploadDeclaration={() => {
                setSelectedAssignment(assignment);
                setUploadDialogOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Assign Asset Dialog */}
      <AssignAssetToUserDialog
        isOpen={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        userId={user.name}
        userName={user.full_name}
        unassignedAssets={unassignedAssets}
        categoryList={categoryList}
        onAssigned={onMutate}
      />

      {/* Unassign Asset Dialog */}
      <Dialog open={unassignDialogOpen} onOpenChange={setUnassignDialogOpen}>
        <DialogContent>
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
                  className="gap-1"
                >
                  <Trash2 className="h-4 w-4" />
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
