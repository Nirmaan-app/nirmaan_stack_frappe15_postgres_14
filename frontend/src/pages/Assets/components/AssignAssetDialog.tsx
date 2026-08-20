import React, { useState, useEffect, useMemo } from 'react';
import { useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeGetDocList } from 'frappe-react-sdk';
import ReactSelect from 'react-select';
import { format } from 'date-fns';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { UserPlus, Calendar, CheckCircle2, Download, FileText } from 'lucide-react';

import {
    ASSET_MASTER_DOCTYPE,
    ASSET_MANAGEMENT_DOCTYPE,
    ASSET_CATEGORY_DOCTYPE,
} from '../assets.constants';
import { useAssetDataRefresh } from '../hooks/useAssetDataRefresh';
import { useAssetProjectOptions } from '../hooks/useAssetProjectOptions';
import { getRoleLabel } from '../utils/permissions';

interface AssignAssetDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    assetId: string;
    assetName: string;
    onAssigned?: () => void;
}

interface NirmaanUser {
    name: string;
    full_name: string;
    role_profile: string | null;
}

interface AssetProjectRef {
    name: string;
    project: string;
    asset_category: string;
}

interface AssetCategoryTypeRow {
    name: string;
    category_type: string;
}

export const AssignAssetDialog: React.FC<AssignAssetDialogProps> = ({
    isOpen,
    onOpenChange,
    assetId,
    assetName,
    onAssigned,
}) => {
    const [selectedUser, setSelectedUser] = useState<string>('');
    const [selectedProject, setSelectedProject] = useState<string>('');
    const [assignedDate, setAssignedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccessDialog, setShowSuccessDialog] = useState(false);
    const [assignedUserName, setAssignedUserName] = useState<string>('');

    const { toast } = useToast();
    const { createDoc } = useFrappeCreateDoc();
    const { updateDoc } = useFrappeUpdateDoc();
    const { refreshSummaryCards } = useAssetDataRefresh();

    // Fetch Nirmaan Users with role information
    const { data: usersList } = useFrappeGetDocList<NirmaanUser>(
        'Nirmaan Users',
        {
            fields: ['name', 'full_name', 'role_profile'],
            orderBy: { field: 'full_name', order: 'asc' },
            limit: 0,
        },
        isOpen ? 'nirmaan_users_for_assignment' : null
    );

    // Format user options with role display (e.g., "John Doe (Procurement Executive)")
    const userOptions = useMemo(() =>
        usersList?.map((user) => {
            const displayName = user.full_name || user.name;
            const roleLabel = getRoleLabel(user.role_profile);
            return {
                value: user.name,
                label: roleLabel ? `${displayName} (${roleLabel})` : displayName,
            };
        }) || [],
        [usersList]
    );

    // The dialog is opened from three different surfaces, none of which carry the
    // asset's project or category — resolve them here so every entry point behaves
    // identically instead of threading the same two values through three call sites.
    const { data: assetRows } = useFrappeGetDocList<AssetProjectRef>(
        ASSET_MASTER_DOCTYPE,
        {
            fields: ['name', 'project', 'asset_category'],
            filters: [['name', '=', assetId]],
            limit: 1,
        },
        isOpen && assetId ? `asset_assign_context_${assetId}` : null
    );

    const assetRow = assetRows?.[0];
    const assetCategory = assetRow?.asset_category || '';

    const { data: categoryRows } = useFrappeGetDocList<AssetCategoryTypeRow>(
        ASSET_CATEGORY_DOCTYPE,
        {
            fields: ['name', 'category_type'],
            filters: [['name', '=', assetCategory]],
            limit: 1,
        },
        assetCategory ? `asset_category_type_${assetCategory}` : null
    );

    // Project/City/State are Project-asset concepts — IT assets have no project.
    const isProjectAsset = categoryRows?.[0]?.category_type === 'Project';

    const { projectOptions, projectsById, isLoading: projectsLoading } = useAssetProjectOptions(isProjectAsset);

    // Only Won tenders are offered. If the asset already carries a project that is
    // no longer Won, merge it in so the pre-filled value is visible instead of the
    // picker rendering blank against a required field.
    const pickerProjectOptions = useMemo(() => {
        if (!selectedProject || projectOptions.some((opt) => opt.value === selectedProject)) {
            return projectOptions;
        }
        const row = projectsById[selectedProject];
        return [
            ...projectOptions,
            {
                value: selectedProject,
                label: row?.project_name || selectedProject,
                city: row?.project_city || '',
                state: row?.project_state || '',
            },
        ];
    }, [projectOptions, projectsById, selectedProject]);

    const selectedProjectOption = useMemo(
        () => pickerProjectOptions.find((opt) => opt.value === selectedProject) || null,
        [pickerProjectOptions, selectedProject]
    );

    // Pre-fill with whatever the asset already carries; the assigner can change it.
    useEffect(() => {
        if (!isOpen) return;
        setSelectedProject(assetRow?.project || '');
    }, [isOpen, assetRow?.project]);

    // NOTE: selectedProject is deliberately NOT reset here. resetForm runs from an
    // effect declared *after* the pre-fill effect, so clearing it here would wipe
    // the asset's existing project on open — and with the asset row already in the
    // SWR cache the pre-fill effect would never re-run to restore it.
    const resetForm = () => {
        setSelectedUser('');
        setAssignedDate(format(new Date(), 'yyyy-MM-dd'));
        setShowSuccessDialog(false);
        setAssignedUserName('');
    };

    useEffect(() => {
        if (isOpen) {
            resetForm();
        }
    }, [isOpen]);

    const handleSubmit = async () => {
        if (!selectedUser) {
            toast({
                title: 'User Required',
                description: 'Please select a user to assign the asset to.',
                variant: 'destructive',
            });
            return;
        }

        if (isProjectAsset && !selectedProject) {
            toast({
                title: 'Project Required',
                description: 'Please select the project this asset is being assigned to.',
                variant: 'destructive',
            });
            return;
        }

        setIsSubmitting(true);

        try {
            // Create Asset Management entry
            await createDoc(ASSET_MANAGEMENT_DOCTYPE, {
                asset: assetId,
                asset_assigned_to: selectedUser,
                asset_assigned_on: assignedDate,
            });

            // Update Asset Master with current assignee, and — for Project assets —
            // the project this assignment is for. City/State are read-only fetch
            // fields, so the server derives them from the project's address.
            await updateDoc(ASSET_MASTER_DOCTYPE, assetId, {
                current_assignee: selectedUser,
                ...(isProjectAsset ? { project: selectedProject } : {}),
            });

            // Get the assigned user's display name
            const userName = userOptions.find(u => u.value === selectedUser)?.label || selectedUser;
            setAssignedUserName(userName);

            refreshSummaryCards(); // Update assigned/unassigned counts

            // Show success dialog instead of closing immediately
            setShowSuccessDialog(true);
        } catch (error: any) {
            console.error('Failed to assign asset:', error);
            toast({
                title: 'Assignment Failed',
                description: error?.message || 'An error occurred while assigning the asset.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDownloadDeclaration = async () => {
        try {
            const params = new URLSearchParams({
                doctype: 'Asset Master',
                name: assetId,
                format: 'Asset Master Form',
                no_letterhead: '0',
                _lang: 'en'
            });

            const response = await fetch(`/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`);

            if (!response.ok) {
                throw new Error('Failed to generate PDF');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${assetName}_Declaration_Form.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            toast({
                title: 'Download Started',
                description: 'Declaration form is being downloaded.',
                variant: 'success',
            });
        } catch (error: any) {
            console.error('Failed to download declaration:', error);
            toast({
                title: 'Download Failed',
                description: 'Could not download the declaration form. Please try again from the asset overview.',
                variant: 'destructive',
            });
        }
    };

    const handleCloseSuccessDialog = () => {
        onOpenChange(false);
        onAssigned?.();
    };

    // Render success dialog view
    if (showSuccessDialog) {
        return (
            <Dialog open={isOpen} onOpenChange={handleCloseSuccessDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                        </div>
                        <DialogTitle className="text-center text-lg font-semibold">
                            Asset Assigned Successfully
                        </DialogTitle>
                        <DialogDescription className="text-center text-sm text-gray-500">
                            <span className="font-medium text-gray-700">{assetName}</span> has been assigned to{' '}
                            <span className="font-medium text-gray-700">{assignedUserName}</span>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-4">
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                            <div className="flex items-start gap-3">
                                <FileText className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                                <div className="text-sm text-amber-800">
                                    <p className="font-medium mb-1">Declaration Required</p>
                                    <p className="text-amber-700">
                                        Please download the declaration form, get it signed by the user,
                                        and upload it later from the asset overview.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={handleCloseSuccessDialog}
                        >
                            Close
                        </Button>
                        <Button
                            onClick={handleDownloadDeclaration}
                            className="gap-2 bg-amber-600 hover:bg-amber-700"
                        >
                            <Download className="h-4 w-4" />
                            Download Declaration Form
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }

    // Render assignment form view
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                        <UserPlus className="h-6 w-6 text-emerald-600" />
                    </div>
                    <DialogTitle className="text-center text-lg font-semibold">
                        Assign Asset
                    </DialogTitle>
                    <DialogDescription className="text-center text-sm text-gray-500">
                        Assign <span className="font-medium text-gray-700">{assetName}</span> to a user
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* User Selection */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-gray-700">
                            Assign To <span className="text-red-500">*</span>
                        </Label>
                        <ReactSelect
                            options={userOptions}
                            value={userOptions.find(opt => opt.value === selectedUser) || null}
                            onChange={(val) => setSelectedUser(val?.value || '')}
                            placeholder="Select user..."
                            isClearable
                            classNames={{
                                control: () => 'border-gray-200 hover:border-gray-300',
                            }}
                        />
                    </div>

                    {/* Project + auto-filled location - Project-type assets only */}
                    {isProjectAsset && (
                        <>
                            <div className="space-y-1.5">
                                <Label className="text-sm font-medium text-gray-700">
                                    Project <span className="text-red-500">*</span>
                                </Label>
                                <ReactSelect
                                    options={pickerProjectOptions}
                                    value={selectedProjectOption}
                                    onChange={(val) => setSelectedProject(val?.value || '')}
                                    placeholder={projectsLoading ? 'Loading...' : 'Select project...'}
                                    isClearable
                                    isDisabled={projectsLoading}
                                    classNames={{
                                        control: () => 'border-gray-200 hover:border-gray-300',
                                    }}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label className="text-sm font-medium text-gray-700">
                                        City
                                        <span className="ml-1 text-xs text-gray-400">(auto)</span>
                                    </Label>
                                    <Input
                                        value={selectedProjectOption?.city || ''}
                                        readOnly
                                        disabled
                                        placeholder="From project address"
                                        className="bg-gray-50"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-sm font-medium text-gray-700">
                                        State
                                        <span className="ml-1 text-xs text-gray-400">(auto)</span>
                                    </Label>
                                    <Input
                                        value={selectedProjectOption?.state || ''}
                                        readOnly
                                        disabled
                                        placeholder="From project address"
                                        className="bg-gray-50"
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {/* Assignment Date */}
                    <div className="space-y-1.5">
                        <Label htmlFor="assignedDate" className="text-sm font-medium text-gray-700">
                            Assignment Date
                        </Label>
                        <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                id="assignedDate"
                                type="date"
                                value={assignedDate}
                                onChange={(e) => setAssignedDate(e.target.value)}
                                className="w-full rounded-md border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !selectedUser || (isProjectAsset && !selectedProject)}
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                    >
                        {isSubmitting ? 'Assigning...' : 'Assign Asset'}
                        <UserPlus className="h-4 w-4" />
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
