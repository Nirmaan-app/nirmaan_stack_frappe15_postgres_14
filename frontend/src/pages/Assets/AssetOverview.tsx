import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
    useFrappeGetDoc,
    useFrappeGetDocList,
    useFrappeUpdateDoc,
    useFrappeFileUpload,
    useFrappeDocumentEventListener,
} from 'frappe-react-sdk';
import { useSWRConfig } from 'swr';
import ReactSelect from 'react-select';
import { TailSpin } from 'react-loader-spinner';

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
    Download,
} from 'lucide-react';

import { AssignAssetDialog } from './components/AssignAssetDialog';
import { UnassignAssetDialog } from './components/UnassignAssetDialog';

import {
    ASSET_MASTER_DOCTYPE,
    ASSET_CATEGORY_DOCTYPE,
    ASSET_MANAGEMENT_DOCTYPE,
    ASSET_CONDITION_OPTIONS,
    ASSET_CACHE_KEYS,
} from './assets.constants';

interface AssetMaster {
    name: string;
    asset_name: string;
    asset_description: string;
    asset_category: string;
    asset_condition: string;
    asset_serial_number: string;
    asset_value: number;
    asset_email: string;
    asset_email_password: string;
    asset_pin: string;
    current_assignee: string;
    creation: string;
    modified: string;
}

interface AssetAssignment {
    name: string;
    asset: string;
    asset_assigned_to: string;
    asset_assigned_on: string;
    asset_declaration_attachment: string;
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
    const { mutate: globalMutate } = useSWRConfig();

    // Dialog states
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);
    const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
    const [uploadDeclarationDialogOpen, setUploadDeclarationDialogOpen] = useState(false);

    // Upload declaration state
    const [declarationFile, setDeclarationFile] = useState<File | null>(null);
    const [isUploadingDeclaration, setIsUploadingDeclaration] = useState(false);

    // Print state
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    const handleDownloadPrint = useCallback(async () => {
        if (!assetId) return;

        setIsGeneratingPdf(true);
        try {
            const params = new URLSearchParams({
                doctype: ASSET_MASTER_DOCTYPE,
                name: assetId,
                format: 'Asset Master Form',
                no_letterhead: '0',
                _lang: 'en'
            });

            const response = await fetch(`/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`);
            if (!response.ok) throw new Error('PDF generation failed');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${assetId}_Form.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);

            toast({
                title: "Success",
                description: "Print format downloaded successfully.",
                variant: "success",
            });
        } catch (error) {
            console.error('Print Error:', error);
            toast({
                title: "Failed",
                description: "Failed to generate print format.",
                variant: "destructive",
            });
        } finally {
            setIsGeneratingPdf(false);
        }
    }, [assetId, toast]);

    // Edit form state
    const [editForm, setEditForm] = useState({
        asset_name: '',
        asset_description: '',
        asset_category: '',
        asset_condition: '',
        asset_serial_number: '',
        asset_value: '',
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

    // Fetch current assignment - uses shared cache key for cross-component invalidation
    const { data: assignments, mutate: mutateAssignments } = useFrappeGetDocList<AssetAssignment>(
        ASSET_MANAGEMENT_DOCTYPE,
        {
            fields: ['name', 'asset', 'asset_assigned_to', 'asset_assigned_on', 'asset_declaration_attachment'],
            filters: [['asset', '=', assetId]],
            orderBy: { field: 'asset_assigned_on', order: 'desc' },
            limit: 1,
        },
        asset?.current_assignee ? ASSET_CACHE_KEYS.assetManagement(assetId) : null
    );

    const currentAssignment = assignments?.[0];

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
            fields: ['name', 'asset_category'],
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

    const { updateDoc, loading: isUpdating } = useFrappeUpdateDoc();
    const { upload } = useFrappeFileUpload();

    const canManageAssets = userData?.user_id === 'Administrator' ||
        ['Nirmaan Admin Profile', 'Nirmaan PMO Executive Profile', 'Nirmaan HR Executive Profile'].includes(userData?.role || '');

    // Check if current user can view credentials (admin roles OR assigned to the asset)
    const canViewCredentials = useMemo(() => {
        if (!userData) return false;
        if (userData.user_id === 'Administrator') return true;
        if (['Nirmaan Admin Profile', 'Nirmaan PMO Executive Profile', 'Nirmaan HR Executive Profile'].includes(userData.role || '')) return true;
        if (asset?.current_assignee && asset.current_assignee === userData.user_id) return true;
        return false;
    }, [userData, asset?.current_assignee]);

    // Check if declaration is pending
    const isDeclarationPending = useMemo(() => {
        return asset?.current_assignee && currentAssignment && !currentAssignment.asset_declaration_attachment;
    }, [asset?.current_assignee, currentAssignment]);

    // Real-time updates
    useFrappeDocumentEventListener(ASSET_MASTER_DOCTYPE, assetId, () => {
        mutate();
    });

    // Initialize edit form when asset data loads
    useEffect(() => {
        if (asset) {
            setEditForm({
                asset_name: asset.asset_name || '',
                asset_description: asset.asset_description || '',
                asset_category: asset.asset_category || '',
                asset_condition: asset.asset_condition || '',
                asset_serial_number: asset.asset_serial_number || '',
                asset_value: asset.asset_value ? String(asset.asset_value) : '',
                asset_email: asset.asset_email || '',
                asset_email_password: '',
                asset_pin: '',
            });
        }
    }, [asset]);

    const handleEditSubmit = async () => {
        try {
            const updateData: Record<string, any> = {
                asset_name: editForm.asset_name.trim(),
                asset_description: editForm.asset_description.trim() || null,
                asset_category: editForm.asset_category,
                asset_condition: editForm.asset_condition || null,
                asset_serial_number: editForm.asset_serial_number.trim() || null,
                asset_value: editForm.asset_value ? parseFloat(editForm.asset_value) : null,
                asset_email: editForm.asset_email.trim() || null,
            };

            // Only update password/pin if provided
            if (editForm.asset_email_password) {
                updateData.asset_email_password = editForm.asset_email_password;
            }
            if (editForm.asset_pin) {
                updateData.asset_pin = editForm.asset_pin;
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

    // Handle assignment refresh
    const handleAssignmentChange = () => {
        mutate();
    };

    // Handle declaration upload
    const handleUploadDeclaration = async () => {
        if (!declarationFile || !currentAssignment) return;

        setIsUploadingDeclaration(true);

        try {
            // Upload file
            const fileArgs = {
                doctype: ASSET_MANAGEMENT_DOCTYPE,
                docname: currentAssignment.name,
                fieldname: 'asset_declaration_attachment',
                isPrivate: true,
            };
            const uploadedFile = await upload(declarationFile, fileArgs);

            // Update the Asset Management document with file URL
            await updateDoc(ASSET_MANAGEMENT_DOCTYPE, currentAssignment.name, {
                asset_declaration_attachment: uploadedFile.file_url,
            });

            toast({
                title: 'Declaration Uploaded',
                description: 'The declaration document has been uploaded successfully.',
                variant: 'success',
            });

            setUploadDeclarationDialogOpen(false);
            setDeclarationFile(null);
            // Refresh Asset Master data
            mutate();
            // Refresh assignment data using hook's mutate function
            mutateAssignments();
            // Also refresh via global mutate for cross-component updates
            globalMutate(ASSET_CACHE_KEYS.assetManagement(assetId), undefined, { revalidate: true });
            // Refresh summary counts (pending declaration count)
            globalMutate(ASSET_CACHE_KEYS.PENDING_DECLARATION_COUNT, undefined, { revalidate: true });
        } catch (err: any) {
            console.error('Failed to upload declaration:', err);
            toast({
                title: 'Upload Failed',
                description: err?.message || 'An error occurred while uploading the declaration.',
                variant: 'destructive',
            });
        } finally {
            setIsUploadingDeclaration(false);
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
                            Asset declaration document has not been uploaded for this assignment.
                        </p>
                    </div>
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
                        {/* Download New Declaration - only show when declaration is pending */}
                        {isDeclarationPending && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleDownloadPrint}
                                disabled={isGeneratingPdf}
                                className="gap-2 text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700"
                            >
                                {isGeneratingPdf ? (
                                    <TailSpin height={16} width={16} color="#d97706" />
                                ) : (
                                    <Download className="h-4 w-4" />
                                )}
                                <span className="hidden sm:inline">
                                    {isGeneratingPdf ? 'Generating...' : 'Download New Declaration'}
                                </span>
                                <span className="sm:hidden">
                                    {isGeneratingPdf ? '...' : 'Form'}
                                </span>
                            </Button>
                        )}

                        {/* Assignment Actions */}
                        {asset?.current_assignee ? (
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
                                    <Badge variant="outline">{asset?.asset_category}</Badge>
                                }
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

                    {/* IT Details Card */}
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
                                    {/* Declaration: View or Upload */}
                                    {currentAssignment?.asset_declaration_attachment ? (
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
                                    ) : canManageAssets && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="gap-2 text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700"
                                            onClick={() => {
                                                setDeclarationFile(null);
                                                setUploadDeclarationDialogOpen(true);
                                            }}
                                        >
                                            <Upload className="h-4 w-4" />
                                            Upload Declaration
                                        </Button>
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
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Edit Dialog */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit Asset</DialogTitle>
                        <DialogDescription>
                            Update asset information. Leave password/PIN blank to keep unchanged.
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

                        {/* Description */}
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">Description</Label>
                            <Textarea
                                value={editForm.asset_description}
                                onChange={(e) => setEditForm({ ...editForm, asset_description: e.target.value })}
                                rows={2}
                            />
                        </div>

                        {/* IT Details Section */}
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

            {/* Upload Declaration Dialog */}
            <Dialog open={uploadDeclarationDialogOpen} onOpenChange={setUploadDeclarationDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
                            <FileText className="h-6 w-6 text-amber-600" />
                        </div>
                        <DialogTitle className="text-center text-lg font-semibold">
                            Upload Declaration
                        </DialogTitle>
                        <DialogDescription className="text-center text-sm text-gray-500">
                            Upload the declaration document for{' '}
                            <span className="font-medium text-gray-700">{asset?.asset_name}</span>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-4">
                        <CustomAttachment
                            selectedFile={declarationFile}
                            onFileSelect={setDeclarationFile}
                            acceptedTypes={["image/*", "application/pdf"]}
                            label="Select Declaration File"
                            maxFileSize={10 * 1024 * 1024}
                            onError={(err) => toast({
                                title: 'File Error',
                                description: err.message,
                                variant: 'destructive',
                            })}
                        />
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={() => setUploadDeclarationDialogOpen(false)}
                            disabled={isUploadingDeclaration}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleUploadDeclaration}
                            disabled={isUploadingDeclaration || !declarationFile}
                            className="gap-2"
                        >
                            {isUploadingDeclaration ? 'Uploading...' : 'Upload Declaration'}
                            <Upload className="h-4 w-4" />
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

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
