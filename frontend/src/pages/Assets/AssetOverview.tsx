import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
    useFrappeGetDoc,
    useFrappeGetDocList,
    useFrappeUpdateDoc,
    useFrappeFileUpload,
    useFrappeDocumentEventListener,
} from 'frappe-react-sdk';
import ReactSelect from 'react-select';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { useToast } from '@/components/ui/use-toast';
import { useUserData } from '@/hooks/useUserData';
import { useRefreshUserAssignments } from '@/hooks/useUserAssignments';
import { CustomAttachment } from '@/components/helpers/CustomAttachment';
import { formatDate } from '@/utils/FormatDate';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';

import {
    Package,
    Pencil,
    Boxes,
    Hash,
    Calendar,
    User,
    Mail,
    Key,
    Lock,
    Eye,
    EyeOff,
    FileText,
    ExternalLink,
    IndianRupee,
    UserPlus,
    UserMinus,
    AlertTriangle,
    Upload,
    Briefcase,
    Laptop,
    MapPin,
    PenLine,
} from 'lucide-react';

import { canSignDeclaration } from '@/utils/assetDeclaration';
import { canEditAssetDepartment, normalizeDepartment } from '@/utils/assetDepartment';
import { AssetHistoryRow } from '@/utils/assetHistory';
import { DepartmentSelect } from '@/components/common/DepartmentSelect';
import { useDepartmentOptions } from '@/hooks/useDepartmentOptions';
import { AssetHistoryCard } from './components/AssetHistoryCard';
import { AuditStatusRow } from './components/AuditStatusRow';
import { useAuditedCategories } from './hooks/useAuditPending';
import { auditBadge, parseAuditAnswers } from '@/utils/assetAudit';
import { DepartmentBadge } from './utils/departmentColumn';
import { AssignAssetDialog } from './components/AssignAssetDialog';
import { UnassignAssetDialog } from './components/UnassignAssetDialog';
import { SignDeclarationDialog } from './components/SignDeclarationDialog';
import { useAssetDataRefresh } from './hooks/useAssetDataRefresh';

import {
    ASSET_MASTER_DOCTYPE,
    ASSET_CATEGORY_DOCTYPE,
    ASSET_MANAGEMENT_DOCTYPE,
    ASSET_CONDITION_OPTIONS,
    ASSET_CACHE_KEYS,
    AssetCategoryType,
} from './assets.constants';
import { useAssetProjectOptions } from './hooks/useAssetProjectOptions';
import { getAssetPermissions } from './utils/permissions';
import { AssetsAccessDenied } from './AssetsRoute';

interface AssetMaster {
    name: string;
    asset_name: string;
    asset_description: string;
    asset_category: string;
    department?: string | null;
    asset_condition: string;
    asset_serial_number: string;
    asset_value: number;
    project: string;
    asset_city: string;
    asset_state: string;
    asset_history?: AssetHistoryRow[];
    asset_email: string;
    asset_email_password: string;
    asset_pin: string;
    asset_invoice_attachment: string;
    asset_certificate_attachment: string;
    current_assignee: string;
    creation: string;
    modified: string;
}

type ProjectAttachmentField = 'asset_invoice_attachment' | 'asset_certificate_attachment';

interface AssetAssignment {
    name: string;
    asset: string;
    asset_assigned_to: string;
    asset_assigned_on: string;
    asset_declaration_attachment: string;
    received_on?: string | null;
    /** Monthly asset audit (owner, 2026-10-14). */
    audit_status?: string | null;
    audit_month?: string | null;
    last_audit_on?: string | null;
    audit_overdue_since?: string | null;
    audit_proof?: string | null;
    /** The latest audit's questions and answers (owner, 2026-10-15); read through parseAuditAnswers. */
    audit_answers?: unknown;
}

interface NirmaanUser {
    name: string;
    full_name: string;
    email: string;
}

const conditionColorMap: Record<string, string> = {
    'New': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Good': 'bg-blue-50 text-blue-700 border-blue-200',
    'Fair': 'bg-amber-50 text-amber-700 border-amber-200',
    'Poor': 'bg-orange-50 text-orange-700 border-orange-200',
    'Damaged': 'bg-red-50 text-red-700 border-red-200',
};

const categoryTypeBadgeClass: Record<AssetCategoryType, string> = {
    Project: 'bg-blue-50 text-blue-700 border-blue-200',
    IT: 'bg-purple-50 text-purple-700 border-purple-200',
};

const categoryTypeIconMap: Record<AssetCategoryType, React.ReactNode> = {
    Project: <Briefcase className="h-3 w-3 mr-1" />,
    IT: <Laptop className="h-3 w-3 mr-1" />,
};

const AssetOverview: React.FC = () => {
    const { assetId } = useParams<{ assetId: string }>();

    if (!assetId) {
        return <AlertDestructive error={new Error('Asset ID not provided')} />;
    }

    return <AssetOverviewContent assetId={assetId} />;
};

const AssetOverviewContent: React.FC<{ assetId: string }> = ({ assetId }) => {
    const { toast } = useToast();
    const userData = useUserData();
    const refreshUserAssignments = useRefreshUserAssignments();

    // Dialog states
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);
    const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
    const [signDeclarationDialogOpen, setSignDeclarationDialogOpen] = useState(false);
    const { refreshSummaryCards } = useAssetDataRefresh();

    // Project-asset attachment upload state
    const [projectAttachmentField, setProjectAttachmentField] = useState<ProjectAttachmentField | null>(null);
    const [projectAttachmentFile, setProjectAttachmentFile] = useState<File | null>(null);
    const [isUploadingProjectAttachment, setIsUploadingProjectAttachment] = useState(false);

    // Edit form state
    const [editForm, setEditForm] = useState({
        asset_name: '',
        asset_description: '',
        asset_category: '',
        department: '',
        asset_condition: '',
        asset_serial_number: '',
        asset_value: '',
        project: '',
        asset_email: '',
        asset_email_password: '',
        asset_pin: '',
    });

    // Credential visibility state
    const [showPassword, setShowPassword] = useState(false);
    const [showPin, setShowPin] = useState(false);
    const [revealedPassword, setRevealedPassword] = useState(false);
    const [revealedPin, setRevealedPin] = useState(false);

    // Fetch asset data
    const { data: asset, error, isLoading, mutate } = useFrappeGetDoc<AssetMaster>(
        ASSET_MASTER_DOCTYPE,
        assetId,
        `${ASSET_MASTER_DOCTYPE}_${assetId}`
    );

    // Fetch the asset's assignment rows - uses shared cache key for cross-component invalidation.
    // Normally one; an old leftover row can sit beside it (ASSET-LAP-029 had one).
    const { data: assignments, mutate: mutateAssignments } = useFrappeGetDocList<AssetAssignment>(
        ASSET_MANAGEMENT_DOCTYPE,
        {
            fields: [
                'name', 'asset', 'asset_assigned_to', 'asset_assigned_on', 'asset_declaration_attachment',
                'received_on', 'audit_status', 'audit_month', 'last_audit_on', 'audit_proof', 'audit_overdue_since',
                'audit_answers',
            ],
            filters: [['asset', '=', assetId]],
            orderBy: { field: 'asset_assigned_on', order: 'desc' },
            limit: 0,
        },
        asset?.current_assignee ? ASSET_CACHE_KEYS.assetManagement(assetId) : null
    );

    // The holder's row, never the newest-dated one: with a leftover row, "newest" can be someone else's,
    // and the declaration status, Sign and Unassign would then act on that person's row.
    const currentAssignment = assignments?.find((row) => row.asset_assigned_to === asset?.current_assignee);

    // The monthly audit line under the holder (owner, 2026-10-14).
    const auditedCategories = useAuditedCategories();

    // Fetch assignee user details
    const { data: assigneeUser } = useFrappeGetDoc<NirmaanUser>(
        'Nirmaan Users',
        asset?.current_assignee || '',
        asset?.current_assignee ? `NirmaanUsers_${asset.current_assignee}` : null
    );

    // Fetch categories for edit dialog - uses shared cache key for cross-component invalidation
    const { data: categoryList } = useFrappeGetDocList(
        ASSET_CATEGORY_DOCTYPE,
        {
            fields: ['name', 'asset_category', 'category_type'],
            orderBy: { field: 'asset_category', order: 'asc' },
            limit: 0,
        },
        ASSET_CACHE_KEYS.CATEGORIES_DROPDOWN
    );

    const categoryOptions = useMemo(() =>
        categoryList?.map((cat: any) => ({
            value: cat.name,
            label: cat.asset_category,
        })) || [],
        [categoryList]
    );

    const currentCategoryType: AssetCategoryType | null = useMemo(() => {
        if (!asset?.asset_category || !categoryList) return null;
        const match = (categoryList as any[]).find((c) => c.name === asset.asset_category);
        const t = match?.category_type;
        return t === 'Project' || t === 'IT' ? t : null;
    }, [asset?.asset_category, categoryList]);

    // For the Edit dialog: derive type from the *currently selected* category in
    // the form (not the saved asset) so switching Project ↔ IT in the dropdown
    // shows/hides the IT Credentials section live.
    const editingCategoryType: AssetCategoryType | null = useMemo(() => {
        if (!editForm.asset_category || !categoryList) return null;
        const match = (categoryList as any[]).find((c) => c.name === editForm.asset_category);
        const t = match?.category_type;
        return t === 'Project' || t === 'IT' ? t : null;
    }, [editForm.asset_category, categoryList]);

    // Hide IT Credentials only when we're *certain* the category is Project. During
    // the brief categoryList fetch (currentCategoryType === null) we keep the card
    // visible to avoid a false-hide flash on IT assets.
    const showITCredentialsCard = currentCategoryType !== 'Project';
    const showITCredentialsInEditDialog = editingCategoryType !== 'Project';
    const editDialogTitle =
        editingCategoryType === 'Project'
            ? 'Edit Project Asset'
            : editingCategoryType === 'IT'
                ? 'Edit IT Asset'
                : 'Edit Asset';

    // Projects only matter to Project-type assets — skip the fetch for IT ones.
    const { projectOptions, projectsById, isLoading: projectsLoading } = useAssetProjectOptions(
        currentCategoryType === 'Project' || editingCategoryType === 'Project'
    );

    // `projectOptions` is Won-only. An asset already linked to a project that has
    // since left "Won" must still render (and stay selected on save), so the
    // current value is merged in rather than silently dropping out of the picker.
    const editProjectOptions = useMemo(() => {
        const current = editForm.project;
        if (!current || projectOptions.some((opt) => opt.value === current)) {
            return projectOptions;
        }
        const row = projectsById[current];
        return [
            ...projectOptions,
            {
                value: current,
                label: row?.project_name || current,
                city: row?.project_city || '',
                state: row?.project_state || '',
            },
        ];
    }, [projectOptions, projectsById, editForm.project]);

    const editProjectOption = useMemo(
        () => editProjectOptions.find((opt) => opt.value === editForm.project) || null,
        [editProjectOptions, editForm.project]
    );

    // Display-side resolution reads the FULL map, never the Won-filtered options.
    const assetProjectLabel = useMemo(
        () => (asset?.project ? projectsById[asset.project]?.project_name || asset.project : ''),
        [projectsById, asset?.project]
    );

    const { updateDoc, loading: isUpdating } = useFrappeUpdateDoc();
    const { upload } = useFrappeFileUpload();

    // Get granular permissions for current user
    const { canViewAssets, canEditAsset, canAssignAsset, canAssignAssetType, canViewHistory } = getAssetPermissions(
        userData?.user_id,
        userData?.role
    );
    // The action row (Assign/Unassign, Edit) and the attachment uploads.
    // Procurement manages Project assets only, as with Assign (owner, 2026-10-13): on an IT asset --
    // or before the kind is known -- they see none of it.
    const canManageAssets = canEditAsset || (canAssignAsset && canAssignAssetType(currentCategoryType));

    // Check if current user can view credentials (admin roles OR assigned to the asset)
    const canViewCredentials = useMemo(() => {
        if (!userData) return false;
        if (userData.user_id === 'Administrator') return true;
        if (['Nirmaan Admin Profile', 'Nirmaan PMO Executive Profile', 'Nirmaan HR Executive Profile', 'Nirmaan HR Lead Profile'].includes(userData.role || '')) return true;
        if (asset?.current_assignee && asset.current_assignee === userData.user_id) return true;
        return false;
    }, [userData, asset?.current_assignee]);

    // Check if declaration is pending
    const isDeclarationPending = useMemo(() => {
        return asset?.current_assignee && currentAssignment && !currentAssignment.asset_declaration_attachment;
    }, [asset?.current_assignee, currentAssignment]);

    // The assignee signs their own declaration here; the server re-checks.
    const canSign = canSignDeclaration({
        viewerId: userData?.user_id,
        assignedTo: currentAssignment?.asset_assigned_to,
        currentAssignee: asset?.current_assignee,
        declaration: currentAssignment?.asset_declaration_attachment,
    });

    const handleDeclarationSigned = () => {
        mutate();
        mutateAssignments();
        refreshSummaryCards();
        refreshUserAssignments(userData.user_id); // the app access gate's count
    };

    // Real-time updates
    useFrappeDocumentEventListener(ASSET_MASTER_DOCTYPE, assetId, () => {
        mutate();
        mutateAssignments();
    });

    // Initialize edit form when asset data loads
    useEffect(() => {
        if (asset) {
            setEditForm({
                asset_name: asset.asset_name || '',
                asset_description: asset.asset_description || '',
                asset_category: asset.asset_category || '',
                department: asset.department || '',
                asset_condition: asset.asset_condition || '',
                asset_serial_number: asset.asset_serial_number || '',
                asset_value: asset.asset_value ? String(asset.asset_value) : '',
                project: asset.project || '',
                asset_email: asset.asset_email || '',
                asset_email_password: '',
                asset_pin: '',
            });
        }
    }, [asset]);

    // Edit may fill an empty department or fix one on a never-assigned asset; after that it
    // moves only through an assignment with a reason (the server enforces the same rule).
    const hasBeenAssigned =
        !!asset?.current_assignee || (asset?.asset_history ?? []).some((row) => row.event === 'Assigned');
    const departmentEditable = canEditAssetDepartment(asset?.department, hasBeenAssigned);
    const { departments, isLoading: departmentsLoading } = useDepartmentOptions(editDialogOpen && departmentEditable);

    const handleEditSubmit = async () => {
        try {
            const updateData: Record<string, any> = {
                asset_name: editForm.asset_name.trim(),
                asset_description: editForm.asset_description.trim() || null,
                asset_category: editForm.asset_category,
                asset_condition: editForm.asset_condition || null,
                asset_serial_number: editForm.asset_serial_number.trim() || null,
                asset_value: editForm.asset_value ? parseFloat(editForm.asset_value) : null,
            };

            // Project is Project-asset only; City/State are read-only fetch fields
            // that the server refreshes from the project's address on save.
            if (editingCategoryType === 'Project') {
                updateData.project = editForm.project || null;
            }

            // IT credential fields only persist when the (selected) category is IT —
            // matches the visible form. For a Project asset, email/password/pin are
            // never sent so we don't accidentally clear stored values nor leak state.
            if (showITCredentialsInEditDialog) {
                updateData.asset_email = editForm.asset_email.trim() || null;
                if (editForm.asset_email_password) {
                    updateData.asset_email_password = editForm.asset_email_password;
                }
                if (editForm.asset_pin) {
                    updateData.asset_pin = editForm.asset_pin;
                }
            }

            const newDepartment = normalizeDepartment(editForm.department);
            if (departmentEditable && newDepartment !== normalizeDepartment(asset?.department)) {
                updateData.department = newDepartment;
            }

            await updateDoc(ASSET_MASTER_DOCTYPE, assetId, updateData);

            toast({
                title: 'Asset Updated',
                description: 'Changes saved successfully.',
                variant: 'success',
            });

            setEditDialogOpen(false);
            mutate();
        } catch (err: any) {
            toast({
                title: 'Error',
                description: err?.message || 'Failed to update asset',
                variant: 'destructive',
            });
        }
    };

    if (error) return <AlertDestructive error={error} />;

    // Route guard for one asset: asset roles see any asset; anyone else only the asset they hold now,
    // which they open from their profile to sign the declaration. Decided once the role and the asset
    // have loaded, so a typed URL doesn't flash "Access Denied".
    if (userData?.role !== 'Loading' && asset && !canViewAssets && asset.current_assignee !== userData?.user_id) {
        return <AssetsAccessDenied />;
    }

    // Handle assignment refresh
    const handleAssignmentChange = () => {
        mutate();
        mutateAssignments();
    };

    const projectAttachmentLabel: Record<ProjectAttachmentField, string> = {
        asset_invoice_attachment: 'Invoice',
        asset_certificate_attachment: 'Certificate',
    };

    const handleUploadProjectAttachment = async () => {
        if (!projectAttachmentField || !projectAttachmentFile) return;

        setIsUploadingProjectAttachment(true);
        try {
            const uploaded = await upload(projectAttachmentFile, {
                doctype: ASSET_MASTER_DOCTYPE,
                docname: assetId,
                fieldname: projectAttachmentField,
                isPrivate: true,
            });
            await updateDoc(ASSET_MASTER_DOCTYPE, assetId, {
                [projectAttachmentField]: uploaded.file_url,
            });
            toast({
                title: `${projectAttachmentLabel[projectAttachmentField]} Uploaded`,
                description: 'The attachment has been saved.',
                variant: 'success',
            });
            setProjectAttachmentField(null);
            setProjectAttachmentFile(null);
            mutate();
        } catch (err: any) {
            toast({
                title: 'Upload Failed',
                description: err?.message || 'Failed to upload attachment.',
                variant: 'destructive',
            });
        } finally {
            setIsUploadingProjectAttachment(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Pending Declaration Alert */}
            {isDeclarationPending && (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                        <AlertTriangle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="flex-1">
                        <p className="font-medium text-amber-800">Declaration Pending</p>
                        <p className="text-sm text-amber-600">
                            {canSign
                                ? 'Sign the declaration to confirm you received this asset.'
                                : `${assigneeUser?.full_name || asset?.current_assignee} has to sign and submit the declaration for this asset.`}
                        </p>
                    </div>
                    {canSign && (
                        <Button
                            size="sm"
                            onClick={() => setSignDeclarationDialogOpen(true)}
                            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                        >
                            <PenLine className="h-4 w-4" />
                            <span className="hidden sm:inline">Sign Declaration</span>
                            <span className="sm:hidden">Sign</span>
                        </Button>
                    )}
                </div>
            )}

            {/* Header with Actions */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50">
                        <Package className="h-6 w-6 text-emerald-600" />
                    </div>
                    <div>
                        {isLoading ? (
                            <Skeleton className="h-8 w-64 bg-gray-200" />
                        ) : (
                            <h1 className="text-2xl font-semibold text-gray-900">
                                {asset?.asset_name}
                            </h1>
                        )}
                        <p className="text-sm text-gray-500 mt-0.5">
                            Asset ID: {assetId}
                        </p>
                    </div>
                </div>

                {canManageAssets && !isLoading && (
                    <div className="flex items-center gap-2">
                        {/* Assignment Actions -- procurement: Project assets only */}
                        {!canAssignAssetType(currentCategoryType) ? null : asset?.current_assignee ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setUnassignDialogOpen(true)}
                                className="gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                            >
                                <UserMinus className="h-4 w-4" />
                                <span className="hidden sm:inline">Unassign</span>
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                onClick={() => setAssignDialogOpen(true)}
                                className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                            >
                                <UserPlus className="h-4 w-4" />
                                <span className="hidden sm:inline">Assign</span>
                            </Button>
                        )}
                        {/* Edit Button */}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditDialogOpen(true)}
                            className="gap-2"
                        >
                            <Pencil className="h-4 w-4" />
                            <span className="hidden sm:inline">Edit</span>
                        </Button>
                    </div>
                )}
            </div>

            {isLoading ? (
                <div className="grid gap-6 md:grid-cols-2">
                    <Skeleton className="h-64 bg-gray-200" />
                    <Skeleton className="h-64 bg-gray-200" />
                </div>
            ) : (
                <div className="grid gap-6 md:grid-cols-2">
                    {/* Asset Details Card */}
                    <Card>
                        <CardHeader className="pb-4">
                            <CardTitle className="text-base font-medium">Asset Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <DetailRow
                                icon={<Boxes className="h-4 w-4" />}
                                label="Category"
                                value={
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline">{asset?.asset_category}</Badge>
                                        {currentCategoryType && (
                                            <Badge
                                                variant="outline"
                                                className={`font-medium ${categoryTypeBadgeClass[currentCategoryType]}`}
                                            >
                                                {categoryTypeIconMap[currentCategoryType]}
                                                {currentCategoryType}
                                            </Badge>
                                        )}
                                    </div>
                                }
                            />
                            <DetailRow
                                icon={<Briefcase className="h-4 w-4" />}
                                label="Department"
                                value={<DepartmentBadge department={asset?.department} />}
                            />
                            <DetailRow
                                icon={<Hash className="h-4 w-4" />}
                                label="Serial Number"
                                value={
                                    asset?.asset_serial_number ? (
                                        <code className="rounded bg-gray-100 px-2 py-1 text-sm font-mono">
                                            {asset.asset_serial_number}
                                        </code>
                                    ) : (
                                        <span className="text-gray-400">Not specified</span>
                                    )
                                }
                            />
                            <DetailRow
                                icon={<Package className="h-4 w-4" />}
                                label="Condition"
                                value={
                                    asset?.asset_condition ? (
                                        <Badge
                                            variant="outline"
                                            className={conditionColorMap[asset.asset_condition] || ''}
                                        >
                                            {asset.asset_condition}
                                        </Badge>
                                    ) : (
                                        <span className="text-gray-400">Not specified</span>
                                    )
                                }
                            />
                            <DetailRow
                                icon={<IndianRupee className="h-4 w-4" />}
                                label="Purchase Value"
                                value={
                                    asset?.asset_value ? (
                                        <span className="font-medium tabular-nums">
                                            {formatToRoundedIndianRupee(asset.asset_value)}
                                        </span>
                                    ) : (
                                        <span className="text-gray-400">Not specified</span>
                                    )
                                }
                            />
                            {currentCategoryType === 'Project' && (
                                <>
                                    <DetailRow
                                        icon={<Briefcase className="h-4 w-4" />}
                                        label="Project"
                                        value={
                                            asset?.project ? (
                                                <span className="font-medium text-gray-700">
                                                    {assetProjectLabel}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">Not specified</span>
                                            )
                                        }
                                    />
                                    <DetailRow
                                        icon={<MapPin className="h-4 w-4" />}
                                        label="City"
                                        value={
                                            asset?.asset_city || (
                                                <span className="text-gray-400">Not specified</span>
                                            )
                                        }
                                    />
                                    <DetailRow
                                        icon={<MapPin className="h-4 w-4" />}
                                        label="State"
                                        value={
                                            asset?.asset_state || (
                                                <span className="text-gray-400">Not specified</span>
                                            )
                                        }
                                    />
                                </>
                            )}
                            <DetailRow
                                icon={<Calendar className="h-4 w-4" />}
                                label="Created"
                                value={formatDate(asset?.creation || '')}
                            />
                            {asset?.asset_description && (
                                <div className="pt-2 border-t">
                                    <p className="text-sm text-gray-500 mb-1">Description</p>
                                    <p className="text-sm text-gray-700">{asset.asset_description}</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* IT Details Card - hidden for Project-type assets */}
                    {showITCredentialsCard && (
                    <Card>
                        <CardHeader className="pb-4">
                            <CardTitle className="text-base font-medium">IT Credentials</CardTitle>
                            <CardDescription>
                                {canViewCredentials
                                    ? 'Sensitive information for IT assets'
                                    : 'Only assigned users and administrators can view credentials'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <DetailRow
                                icon={<Mail className="h-4 w-4" />}
                                label="Email"
                                value={asset?.asset_email || <span className="text-gray-400">Not set</span>}
                            />
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 text-gray-400">
                                    <Key className="h-4 w-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-500 mb-0.5">Password</p>
                                    <div className="flex items-center gap-2">
                                        {asset?.asset_email_password ? (
                                            <>
                                                <span className="text-sm text-gray-900 font-mono">
                                                    {canViewCredentials && revealedPassword
                                                        ? asset.asset_email_password
                                                        : '••••••••'}
                                                </span>
                                                {canViewCredentials && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 w-6 p-0"
                                                        onClick={() => setRevealedPassword(!revealedPassword)}
                                                    >
                                                        {revealedPassword ? (
                                                            <EyeOff className="h-3.5 w-3.5 text-gray-400" />
                                                        ) : (
                                                            <Eye className="h-3.5 w-3.5 text-gray-400" />
                                                        )}
                                                    </Button>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-sm text-gray-400">Not set</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 text-gray-400">
                                    <Lock className="h-4 w-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-500 mb-0.5">PIN</p>
                                    <div className="flex items-center gap-2">
                                        {asset?.asset_pin ? (
                                            <>
                                                <span className="text-sm text-gray-900 font-mono">
                                                    {canViewCredentials && revealedPin
                                                        ? asset.asset_pin
                                                        : '••••'}
                                                </span>
                                                {canViewCredentials && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 w-6 p-0"
                                                        onClick={() => setRevealedPin(!revealedPin)}
                                                    >
                                                        {revealedPin ? (
                                                            <EyeOff className="h-3.5 w-3.5 text-gray-400" />
                                                        ) : (
                                                            <Eye className="h-3.5 w-3.5 text-gray-400" />
                                                        )}
                                                    </Button>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-sm text-gray-400">Not set</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    )}

                    {/* Project Attachments Card - Project-type only (sits in the slot
                        where IT Credentials would be for IT assets) */}
                    {currentCategoryType === 'Project' && (
                        <Card>
                            <CardHeader className="pb-4">
                                <CardTitle className="text-base font-medium">Project Attachments</CardTitle>
                                <CardDescription>
                                    Invoice and certificate documents for this asset
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <ProjectAttachmentRow
                                    label="Invoice"
                                    fileUrl={asset?.asset_invoice_attachment}
                                    canManage={canManageAssets}
                                    onUploadClick={() => {
                                        setProjectAttachmentFile(null);
                                        setProjectAttachmentField('asset_invoice_attachment');
                                    }}
                                />
                                <ProjectAttachmentRow
                                    label="Certificate"
                                    fileUrl={asset?.asset_certificate_attachment}
                                    canManage={canManageAssets}
                                    onUploadClick={() => {
                                        setProjectAttachmentFile(null);
                                        setProjectAttachmentField('asset_certificate_attachment');
                                    }}
                                />
                            </CardContent>
                        </Card>
                    )}

                    {/* Assignment Card - Full Width */}
                    <Card className="md:col-span-2">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-base font-medium">Current Assignment</CardTitle>
                            <CardDescription>
                                Asset allocation status and assignment details
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {asset?.current_assignee ? (
                                <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-lg bg-emerald-50/50 border border-emerald-100">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                                        <User className="h-6 w-6 text-emerald-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-gray-900">
                                            {assigneeUser?.full_name || asset.current_assignee}
                                        </p>
                                        {assigneeUser?.email && (
                                            <p className="text-sm text-gray-500">{assigneeUser.email}</p>
                                        )}
                                        {currentAssignment?.asset_assigned_on && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                Assigned on {formatDate(currentAssignment.asset_assigned_on)}
                                            </p>
                                        )}
                                    </div>
                                    {/* Declaration: view it once signed; the holder signs from their profile (no upload) */}
                                    {currentAssignment?.asset_declaration_attachment && (
                                        <a
                                            href={currentAssignment.asset_declaration_attachment}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 text-sm text-emerald-600 hover:text-emerald-700"
                                        >
                                            <FileText className="h-4 w-4" />
                                            Declaration
                                            <ExternalLink className="h-3 w-3" />
                                        </a>
                                    )}
                                </div>
                            ) : (
                                <div className="flex items-center gap-4 p-4 rounded-lg bg-gray-50 border border-gray-100">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                                        <User className="h-6 w-6 text-gray-400" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-500">Not Assigned</p>
                                        <p className="text-sm text-gray-400">
                                            This asset is currently unallocated
                                        </p>
                                    </div>
                                </div>
                            )}
                            {asset?.current_assignee && currentAssignment && (
                                <AuditStatusRow
                                    className="mt-3"
                                    badge={auditBadge(
                                        currentAssignment,
                                        auditedCategories.has(asset.asset_category),
                                        asset.asset_category
                                    )}
                                    proofUrl={currentAssignment.audit_proof}
                                    answers={parseAuditAnswers(currentAssignment.audit_answers)}
                                    answersTitle={`${asset.asset_name} · audit for ${currentAssignment.audit_month ?? ''}`}
                                />
                            )}
                        </CardContent>
                    </Card>

                    {/* Asset History - Full Width, Admin and HR only */}
                    {canViewHistory && <AssetHistoryCard rows={asset?.asset_history} />}
                </div>
            )}

            {/* Edit Dialog */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editDialogTitle}</DialogTitle>
                        <DialogDescription>
                            Update asset information.{showITCredentialsInEditDialog ? ' Leave password/PIN blank to keep unchanged.' : ''}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        {/* Asset Name */}
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">
                                Asset Name <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                value={editForm.asset_name}
                                onChange={(e) => setEditForm({ ...editForm, asset_name: e.target.value })}
                            />
                        </div>

                        {/* Category */}
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">
                                Category <span className="text-red-500">*</span>
                            </Label>
                            <ReactSelect
                                options={categoryOptions}
                                value={categoryOptions.find(opt => opt.value === editForm.asset_category) || null}
                                onChange={(val) => setEditForm({ ...editForm, asset_category: val?.value || '' })}
                                placeholder="Select category"
                            />
                        </div>

                        {/* Department */}
                        <div className="space-y-1.5">
                            <Label htmlFor="editAssetDepartment" className="text-sm font-medium">
                                Department
                            </Label>
                            {departmentEditable ? (
                                <DepartmentSelect
                                    inputId="editAssetDepartment"
                                    value={editForm.department}
                                    onChange={(value) => setEditForm({ ...editForm, department: value || '' })}
                                    departments={departments}
                                    isLoading={departmentsLoading}
                                />
                            ) : (
                                <>
                                    <Input id="editAssetDepartment" value={asset?.department || ''} readOnly disabled className="bg-gray-50" />
                                    <p className="text-xs text-gray-500">
                                        This asset has been assigned before, so its department changes only when you
                                        assign it to someone in another department (with a reason).
                                    </p>
                                </>
                            )}
                        </div>

                        {/* Condition */}
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">Condition</Label>
                            <Select
                                value={editForm.asset_condition}
                                onValueChange={(val) => setEditForm({ ...editForm, asset_condition: val })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select condition" />
                                </SelectTrigger>
                                <SelectContent>
                                    {ASSET_CONDITION_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Serial Number */}
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">Serial Number</Label>
                            <Input
                                value={editForm.asset_serial_number}
                                onChange={(e) => setEditForm({ ...editForm, asset_serial_number: e.target.value })}
                                className="font-mono"
                            />
                        </div>

                        {/* Asset Value */}
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">Purchase Value (₹)</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={editForm.asset_value}
                                    onChange={(e) => setEditForm({ ...editForm, asset_value: e.target.value })}
                                    placeholder="0.00"
                                    className="pl-7 tabular-nums"
                                />
                            </div>
                        </div>

                        {/* Project + auto-filled location - Project-type only */}
                        {editingCategoryType === 'Project' && (
                            <>
                                <div className="space-y-1.5">
                                    <Label className="text-sm font-medium">Project</Label>
                                    <ReactSelect
                                        options={editProjectOptions}
                                        value={editProjectOption}
                                        onChange={(val) => setEditForm({ ...editForm, project: val?.value || '' })}
                                        placeholder={projectsLoading ? 'Loading...' : 'Select project'}
                                        isClearable
                                        isDisabled={projectsLoading}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-sm font-medium">
                                            City
                                            <span className="ml-1 text-xs text-gray-400">(auto)</span>
                                        </Label>
                                        <Input
                                            value={editProjectOption?.city || ''}
                                            readOnly
                                            disabled
                                            placeholder="From project address"
                                            className="bg-gray-50"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-sm font-medium">
                                            State
                                            <span className="ml-1 text-xs text-gray-400">(auto)</span>
                                        </Label>
                                        <Input
                                            value={editProjectOption?.state || ''}
                                            readOnly
                                            disabled
                                            placeholder="From project address"
                                            className="bg-gray-50"
                                        />
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Description */}
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">Description</Label>
                            <Textarea
                                value={editForm.asset_description}
                                onChange={(e) => setEditForm({ ...editForm, asset_description: e.target.value })}
                                rows={2}
                            />
                        </div>

                        {/* IT Details Section - hidden when the (selected) category is Project */}
                        {showITCredentialsInEditDialog && (
                        <div className="pt-4 border-t">
                            <p className="text-sm font-medium text-gray-700 mb-3">IT Credentials</p>

                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <Label className="text-sm font-medium">Email</Label>
                                    <Input
                                        type="email"
                                        value={editForm.asset_email}
                                        onChange={(e) => setEditForm({ ...editForm, asset_email: e.target.value })}
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-sm font-medium">
                                        Password <span className="text-xs text-gray-400">(leave blank to keep current)</span>
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            type={showPassword ? 'text' : 'password'}
                                            value={editForm.asset_email_password}
                                            onChange={(e) => setEditForm({ ...editForm, asset_email_password: e.target.value })}
                                            placeholder="••••••••"
                                            className="pr-10"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                                            onClick={() => setShowPassword(!showPassword)}
                                        >
                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-sm font-medium">
                                        PIN <span className="text-xs text-gray-400">(leave blank to keep current)</span>
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            type={showPin ? 'text' : 'password'}
                                            value={editForm.asset_pin}
                                            onChange={(e) => setEditForm({ ...editForm, asset_pin: e.target.value })}
                                            placeholder="••••"
                                            className="pr-10 font-mono"
                                            maxLength={10}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                                            onClick={() => setShowPin(!showPin)}
                                        >
                                            {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={isUpdating}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleEditSubmit}
                            disabled={isUpdating || !editForm.asset_name.trim() || !editForm.asset_category}
                        >
                            {isUpdating ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Assign Asset Dialog */}
            <AssignAssetDialog
                isOpen={assignDialogOpen}
                onOpenChange={setAssignDialogOpen}
                assetId={assetId}
                assetName={asset?.asset_name || ''}
                onAssigned={handleAssignmentChange}
            />

            {/* Sign Declaration Dialog (the assignee only) */}
            {canSign && currentAssignment && (
                <SignDeclarationDialog
                    isOpen={signDeclarationDialogOpen}
                    onOpenChange={setSignDeclarationDialogOpen}
                    assignmentId={currentAssignment.name}
                    assetId={assetId}
                    assetName={asset?.asset_name || ''}
                    serialNumber={asset?.asset_serial_number}
                    condition={asset?.asset_condition}
                    assignedOn={currentAssignment.asset_assigned_on}
                    onSigned={handleDeclarationSigned}
                />
            )}

            {/* Unassign Asset Dialog */}
            <UnassignAssetDialog
                isOpen={unassignDialogOpen}
                onOpenChange={setUnassignDialogOpen}
                assetId={assetId}
                assetName={asset?.asset_name || ''}
                assigneeName={assigneeUser?.full_name || asset?.current_assignee || ''}
                assetManagementId={currentAssignment?.name}
                onUnassigned={handleAssignmentChange}
            />

            {/* Upload / Replace Project Attachment Dialog */}
            <Dialog
                open={projectAttachmentField !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setProjectAttachmentField(null);
                        setProjectAttachmentFile(null);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                            <FileText className="h-6 w-6 text-emerald-600" />
                        </div>
                        <DialogTitle className="text-center text-lg font-semibold">
                            {projectAttachmentField
                                ? `Upload ${projectAttachmentLabel[projectAttachmentField]}`
                                : 'Upload Attachment'}
                        </DialogTitle>
                        <DialogDescription className="text-center text-sm text-gray-500">
                            Attach a document for{' '}
                            <span className="font-medium text-gray-700">{asset?.asset_name}</span>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-4">
                        <CustomAttachment
                            selectedFile={projectAttachmentFile}
                            onFileSelect={setProjectAttachmentFile}
                            acceptedTypes={["image/*", "application/pdf"]}
                            label="Select File"
                            maxFileSize={10 * 1024 * 1024}
                            onError={(err) =>
                                toast({
                                    title: 'File Error',
                                    description: err.message,
                                    variant: 'destructive',
                                })
                            }
                        />
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setProjectAttachmentField(null);
                                setProjectAttachmentFile(null);
                            }}
                            disabled={isUploadingProjectAttachment}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleUploadProjectAttachment}
                            disabled={isUploadingProjectAttachment || !projectAttachmentFile}
                            className="gap-2"
                        >
                            {isUploadingProjectAttachment ? 'Uploading...' : 'Upload'}
                            <Upload className="h-4 w-4" />
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

// Helper component for the Project-asset Invoice/Certificate attachment row
const ProjectAttachmentRow: React.FC<{
    label: string;
    fileUrl?: string;
    canManage: boolean;
    onUploadClick: () => void;
}> = ({ label, fileUrl, canManage, onUploadClick }) => (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50/50 p-3">
        <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 text-gray-400 shrink-0" />
            <div className="min-w-0">
                <p className="text-sm font-medium text-gray-700">{label}</p>
                {fileUrl ? (
                    <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-emerald-600 hover:text-emerald-700 inline-flex items-center gap-1 truncate"
                    >
                        View attachment
                        <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                ) : (
                    <p className="text-xs text-gray-400">Not uploaded</p>
                )}
            </div>
        </div>
        {canManage && (
            <Button
                variant="outline"
                size="sm"
                className="gap-2 shrink-0"
                onClick={onUploadClick}
            >
                <Upload className="h-3.5 w-3.5" />
                {fileUrl ? 'Replace' : 'Upload'}
            </Button>
        )}
    </div>
);

// Helper component for detail rows
const DetailRow: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
}> = ({ icon, label, value }) => (
    <div className="flex items-start gap-3">
        <div className="mt-0.5 text-gray-400">{icon}</div>
        <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 mb-0.5">{label}</p>
            <div className="text-sm text-gray-900">{value}</div>
        </div>
    </div>
);

export default AssetOverview;
export const Component = AssetOverview;
