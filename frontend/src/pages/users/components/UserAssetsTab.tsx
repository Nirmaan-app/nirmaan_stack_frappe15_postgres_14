import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useFrappePostCall } from "frappe-react-sdk";
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
import { formatDate } from "@/utils/FormatDate";
import {
  CirclePlus,
  PackageSearch,
  Undo2,
  CheckCircle2,
  UserMinus,
  ExternalLink,
  Calendar,
  Hash,
  AlertTriangle,
  FileCheck,
  Briefcase,
  Laptop,
  PenLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserData } from "@/hooks/useUserData";
import { assetTabToOpen, canSignDeclaration } from "@/utils/assetDeclaration";
import {
  AUDIT_PENDING,
  AssetCardTone,
  AuditBadge,
  assetCardTone,
  auditBadge,
  canSubmitAudit,
  isAuditOverdue,
  parseAuditAnswers,
} from "@/utils/assetAudit";
import { PendingDeclarationTooltip, pendingAssetActionsLabel } from "@/components/helpers/PendingDeclarationIcon";
import { AssignAssetToUserDialog } from "./AssignAssetToUserDialog";
import { SignDeclarationDialog } from "@/pages/Assets/components/SignDeclarationDialog";
import { SubmitAuditDialog } from "@/pages/Assets/components/SubmitAuditDialog";
import { AuditStatusRow } from "@/pages/Assets/components/AuditStatusRow";
import { UnassignReasonFields } from "@/pages/Assets/components/UnassignReasonFields";
import { isUnassignReasonValid } from "@/utils/assetUnassign";
import { getFrappeError } from "@/utils/frappeErrors";

// Types for asset data
interface AssetManagementRecord {
  name: string;
  asset: string;
  asset_assigned_to: string;
  asset_assigned_on: string;
  asset_declaration_attachment: string | null;
  creation: string;
  /** Ticked by the server when the declaration arrives (signed or uploaded). */
  received?: 0 | 1;
  received_on?: string | null;
  /** Monthly asset audit (owner, 2026-10-14), written by the server. */
  audit_status?: string | null;
  audit_month?: string | null;
  last_audit_on?: string | null;
  audit_proof?: string | null;
  /** The latest audit's questions and answers (owner, 2026-10-15); read through parseAuditAnswers. */
  audit_answers?: unknown;
}

interface AssetMasterRecord {
  name: string;
  asset_name: string;
  asset_category: string;
  asset_condition: string;
  asset_serial_number: string;
  asset_value: number;
  current_assignee: string;
  /** Marked Lost/Damaged (owner, 2026-10-31): never offered in Assign. */
  lost_damaged?: 0 | 1;
}

interface AssetCategoryRecord {
  name: string;
  asset_category: string;
  category_type?: "Project" | "IT";
  /** "Monthly audit required" (owner, 2026-10-14). */
  audit_required?: 0 | 1;
}

type AssetSubTab = "Project" | "IT";

/**
 * The mark on a Project / IT tab with declarations still to sign or upload, or audits still to send
 * (same icon as the sidebar; red while an audit is waiting to be sent).
 */
function PendingDeclarationMark({
  count,
  audits = 0,
  overdueAudits = 0,
  canSign,
}: {
  count: number;
  audits?: number;
  overdueAudits?: number;
  canSign: boolean;
}) {
  if (count + audits === 0) return null;
  return (
    <PendingDeclarationTooltip
      auditPending={audits > 0}
      label={pendingAssetActionsLabel(count, audits, canSign, overdueAudits)}
    />
  );
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

// The card's tint (owner, 2026-10-15): light red while its audit is overdue, light yellow while the
// declaration or the audit is pending.
const CARD_TONE_CLASS: Record<NonNullable<AssetCardTone>, string> = {
  overdue: "bg-red-50 border-red-200",
  pending: "bg-amber-50 border-amber-200",
};

// Asset Card Component
function AssetCard({
  assignment,
  asset,
  isAdmin,
  canSign,
  hasPage = true,
  audit = null,
  canAudit = false,
  onUnassign,
  onSign,
  onAudit,
}: {
  assignment: AssetManagementRecord;
  asset: AssetMasterRecord | undefined;
  isAdmin: boolean;
  /** False when the viewer can't open the asset's page: the name is shown without a link. */
  hasPage?: boolean;
  /** The viewer is the assignee and the declaration is still pending. Everyone signs their own, Admin too:
   * there is no scanned-declaration upload (owner, 2026-10-15). */
  canSign: boolean;
  /** The audit line, or null when there is nothing to show (a category that isn't audited). */
  audit?: AuditBadge | null;
  /** The viewer holds it and its audit is open: show Submit audit. */
  canAudit?: boolean;
  onUnassign: () => void;
  onSign: () => void;
  onAudit?: () => void;
}) {
  const isPendingDeclaration = !assignment.asset_declaration_attachment;
  const tone = assetCardTone(isPendingDeclaration, audit);

  return (
    <Card
      className={cn(
        "group relative overflow-hidden transition-all duration-300 hover:shadow-md",
        tone ? CARD_TONE_CLASS[tone] : "hover:border-primary/20"
      )}
    >
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

        {/* Asset Details: serial and assigned date on the left, Received on the right */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
            {asset?.asset_serial_number && (
              <div className="flex min-w-0 items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{asset.asset_serial_number}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5" title="Assigned on">
              <Calendar className="h-3.5 w-3.5" />
              <span>{formatDate(assignment.asset_assigned_on)}</span>
            </div>
          </div>
          {!!assignment.received && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 whitespace-nowrap">
              <CheckCircle2 className="h-3 w-3" />
              Received {assignment.received_on ? formatDate(assignment.received_on) : ""}
            </span>
          )}
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

        {/* Monthly audit (owner, 2026-10-14): pending with Submit audit for the holder, or done with the photo
            and the answers (owner, 2026-10-15) */}
        {audit && (
          <AuditStatusRow
            badge={audit}
            proofUrl={assignment.audit_proof}
            canSubmit={canAudit}
            onSubmit={onAudit}
            answers={parseAuditAnswers(assignment.audit_answers)}
            answersTitle={`${asset?.asset_name || assignment.asset} · audit for ${assignment.audit_month ?? ""}`}
          />
        )}
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
  // One request: the reason is checked, the assignment removed and the reason kept on the asset's
  // "Unassigned" history row (api/assets/assign.py).
  const { call: unassignAsset } = useFrappePostCall("nirmaan_stack.api.assets.assign.unassign_asset");

  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<AssetManagementRecord | null>(null);
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [unassignReason, setUnassignReason] = useState("");
  const [unassignDetails, setUnassignDetails] = useState("");
  const [subTab, setSubTab] = useState<AssetSubTab>("Project");
  // The dialog holds the row's name; the live row is read from the refetched list.
  const [signingAssignmentName, setSigningAssignmentName] = useState<string | null>(null);
  // Monthly audit (owner, 2026-10-14): the dialog holds the row's name; the live row comes from the list.
  const [auditingAssignmentName, setAuditingAssignmentName] = useState<string | null>(null);

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

  // Categories whose assigned assets get the monthly audit.
  const auditedCategories = useMemo(
    () => new Set((categoryList ?? []).filter((c) => !!c.audit_required).map((c) => c.name)),
    [categoryList]
  );

  // The card's audit line: shown while an audit is open or once one was sent; nothing for a category
  // that isn't audited or an asset with no audit yet, so those cards look as they did.
  const getAuditBadge = useCallback(
    (assignment: AssetManagementRecord): AuditBadge | null => {
      const category = getAssetDetails(assignment.asset)?.asset_category;
      const badge = auditBadge(assignment, !!category && auditedCategories.has(category), category);
      return badge.tone === "off" || badge.tone === "none" ? null : badge;
    },
    [getAssetDetails, auditedCategories]
  );

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
    // An assignment whose category type can't be read (its asset or category didn't load) goes under Project: the
    // app access gate counts its declaration and audit, so its card -- with Sign / Submit audit -- must show
    // somewhere, never in neither tab (code review #3).
    (assetManagementList ?? []).forEach((a) => {
      if (getAssignmentType(a) === "IT") it.push(a);
      else project.push(a);
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
  // Monthly audits still open, in total and per tab.
  const pendingAuditCount = (assetManagementList ?? []).filter((a) => a.audit_status === AUDIT_PENDING).length;
  const projectAudits = projectAssignments.filter((a) => a.audit_status === AUDIT_PENDING).length;
  const itAudits = itAssignments.filter((a) => a.audit_status === AUDIT_PENDING).length;
  const projectOverdueAudits = projectAssignments.filter((a) => isAuditOverdue(a)).length;
  const itOverdueAudits = itAssignments.filter((a) => isAuditOverdue(a)).length;

  // Open on the tab that needs attention: when the assignments first load, and again on every
  // navigation here -- the app access gate's "Open my assets" navigates even when this profile is
  // already open, so it switches tabs too. A tab the user picks stays until the next navigation.
  const location = useLocation();
  const subTabDecidedFor = useRef<string | null>(null);
  useEffect(() => {
    if (subTabDecidedFor.current === location.key || projectAssignments.length + itAssignments.length === 0) return;
    subTabDecidedFor.current = location.key;
    setSubTab(
      assetTabToOpen(
        { total: projectAssignments.length, pending: projectPending + projectAudits },
        { total: itAssignments.length, pending: itPending + itAudits }
      )
    );
  }, [location.key, projectAssignments.length, itAssignments.length, projectPending, itPending, projectAudits, itAudits]);

  const visibleAssignments = subTab === "Project" ? projectAssignments : itAssignments;

  const signingAssignment = useMemo(
    () => (assetManagementList ?? []).find((a) => a.name === signingAssignmentName),
    [assetManagementList, signingAssignmentName]
  );
  const auditingAssignment = useMemo(
    () => (assetManagementList ?? []).find((a) => a.name === auditingAssignmentName),
    [assetManagementList, auditingAssignmentName]
  );

  // All unassigned assets — the dialog filters internally by its Asset Type
  // dropdown (defaults to the currently active sub-tab).
  const unassignedAssets = useMemo(
    () => (assetMasterList ?? []).filter((a) => !a.current_assignee && !a.lost_damaged),
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
          {pendingAuditCount > 0 && (
            <span className="inline-flex items-center gap-1 text-red-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="tabular-nums">{pendingAuditCount}</span> Audit Pending
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
              <PendingDeclarationMark
                count={projectPending}
                audits={projectAudits}
                overdueAudits={projectOverdueAudits}
                canSign={isOwnProfile}
              />
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
              <PendingDeclarationMark
                count={itPending}
                audits={itAudits}
                overdueAudits={itOverdueAudits}
                canSign={isOwnProfile}
              />
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
                onSign={() => setSigningAssignmentName(assignment.name)}
                audit={getAuditBadge(assignment)}
                canAudit={
                  isOwnProfile &&
                  canSubmitAudit({
                    viewerId: userData?.user_id,
                    assignedTo: assignment.asset_assigned_to,
                    currentAssignee: asset?.current_assignee,
                    auditStatus: assignment.audit_status,
                  })
                }
                onAudit={() => setAuditingAssignmentName(assignment.name)}
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

      {/* Submit Audit Dialog (the holder, own profile) */}
      {auditingAssignment && (
        <SubmitAuditDialog
          key={auditingAssignment.name}
          isOpen={!!auditingAssignment}
          onOpenChange={(open) => {
            if (!open) setAuditingAssignmentName(null);
          }}
          assignmentId={auditingAssignment.name}
          assetName={getAssetDetails(auditingAssignment.asset)?.asset_name || auditingAssignment.asset}
          auditMonth={auditingAssignment.audit_month}
          onSubmitted={onMutate}
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
    </div>
  );
}
