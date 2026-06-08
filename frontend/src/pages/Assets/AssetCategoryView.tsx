import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useFrappeGetDoc, useFrappeGetDocList } from 'frappe-react-sdk';
import { ArrowLeft, Package, Users, UserX, Boxes, Search, X, Briefcase, Laptop } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { useUserData } from '@/hooks/useUserData';

import { AssetCard } from './components/AssetCard';
import { AssignAssetDialog } from './components/AssignAssetDialog';
import { UnassignAssetDialog } from './components/UnassignAssetDialog';
import { getAssetPermissions } from './utils/permissions';
import {
    ASSET_CATEGORY_DOCTYPE,
    ASSET_MASTER_DOCTYPE,
    ASSET_MANAGEMENT_DOCTYPE,
    AssetCategoryType,
} from './assets.constants';

interface AssetCategory {
    name: string;
    asset_category: string;
    category_type: AssetCategoryType | null;
}

const categoryTypeBadgeClass: Record<AssetCategoryType, string> = {
    Project: 'bg-blue-50 text-blue-700 border-blue-200',
    IT: 'bg-purple-50 text-purple-700 border-purple-200',
};

const categoryTypeIconMap: Record<AssetCategoryType, React.ReactNode> = {
    Project: <Briefcase className="h-3 w-3 mr-1" />,
    IT: <Laptop className="h-3 w-3 mr-1" />,
};

interface AssetMaster {
    name: string;
    asset_name: string;
    asset_serial_number: string | null;
    asset_condition: string | null;
    current_assignee: string | null;
}

interface AssetAssignment {
    name: string;
    asset: string;
    asset_assigned_to: string;
    asset_declaration_attachment: string | null;
}

interface NirmaanUser {
    name: string;
    full_name: string;
}

const AssetCategoryView: React.FC = () => {
    const { categoryId } = useParams<{ categoryId: string }>();

    if (!categoryId) {
        return <AlertDestructive error={new Error('Category ID not provided')} />;
    }

    return <AssetCategoryViewContent categoryId={categoryId} />;
};

const AssetCategoryViewContent: React.FC<{ categoryId: string }> = ({ categoryId }) => {
    const userData = useUserData();
    const { canAssignAsset } = getAssetPermissions(userData?.user_id, userData?.role);

    // Dialog states
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);
    const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState<{
        id: string;
        name: string;
        assigneeName?: string;
        assignmentId?: string;
    } | null>(null);

    // Search query for filtering assets by name, serial, or assignee
    const [searchQuery, setSearchQuery] = useState('');
    const normalizedQuery = searchQuery.trim().toLowerCase();

    // Fetch category details
    const { data: category, error: categoryError, isLoading: categoryLoading } = useFrappeGetDoc<AssetCategory>(
        ASSET_CATEGORY_DOCTYPE,
        categoryId,
        `${ASSET_CATEGORY_DOCTYPE}_${categoryId}`
    );

    // Fetch assets in this category
    const {
        data: assets,
        error: assetsError,
        isLoading: assetsLoading,
        mutate: mutateAssets,
    } = useFrappeGetDocList<AssetMaster>(
        ASSET_MASTER_DOCTYPE,
        {
            fields: ['name', 'asset_name', 'asset_serial_number', 'asset_condition', 'current_assignee'],
            filters: [['asset_category', '=', categoryId]],
            orderBy: { field: 'asset_name', order: 'asc' },
            limit: 0,
        },
        category ? `assets_in_category_${categoryId}` : null
    );

    // Fetch all user details for assigned assets
    const assigneeIds = useMemo(() => {
        const ids = new Set<string>();
        assets?.forEach((asset) => {
            if (asset.current_assignee) {
                ids.add(asset.current_assignee);
            }
        });
        return Array.from(ids);
    }, [assets]);

    const { data: assignees } = useFrappeGetDocList<NirmaanUser>(
        'Nirmaan Users',
        {
            fields: ['name', 'full_name'],
            filters: assigneeIds.length > 0 ? [['name', 'in', assigneeIds]] : undefined,
            limit: 0,
        },
        assigneeIds.length > 0 ? `assignees_for_category_${categoryId}` : null
    );

    // Fetch assignment records for unassign functionality
    const assetsWithAssignee = useMemo(() => {
        return assets?.filter((a) => a.current_assignee) || [];
    }, [assets]);

    const { data: assignments } = useFrappeGetDocList<AssetAssignment>(
        ASSET_MANAGEMENT_DOCTYPE,
        {
            fields: ['name', 'asset', 'asset_assigned_to', 'asset_declaration_attachment'],
            filters: assetsWithAssignee.length > 0
                ? [['asset', 'in', assetsWithAssignee.map(a => a.name)]]
                : undefined,
            orderBy: { field: 'creation', order: 'desc' },
            limit: 0,
        },
        assetsWithAssignee.length > 0 ? `assignments_for_category_${categoryId}` : null
    );

    const assigneeMap = useMemo(() => {
        const map: Record<string, string> = {};
        assignees?.forEach((user) => {
            map[user.name] = user.full_name || user.name;
        });
        return map;
    }, [assignees]);

    // Map asset to its latest assignment record and track declaration status
    const { assignmentMap, declarationPendingMap } = useMemo(() => {
        const assignMap: Record<string, string> = {};
        const pendingMap: Record<string, boolean> = {};
        // Group by asset and take the first (most recent due to ordering)
        assignments?.forEach((assignment) => {
            if (!assignMap[assignment.asset]) {
                assignMap[assignment.asset] = assignment.name;
                // Declaration is pending if asset is assigned but has no declaration attachment
                pendingMap[assignment.asset] = !assignment.asset_declaration_attachment;
            }
        });
        return { assignmentMap: assignMap, declarationPendingMap: pendingMap };
    }, [assignments]);

    // Apply search filter first so both section badges and rendered cards stay in
    // sync from one source of truth. Matches asset name, serial number, or the
    // assigned user's resolved full name (falls back to user id if name missing).
    const filteredAssets = useMemo(() => {
        if (!assets) return [];
        if (!normalizedQuery) return assets;
        return assets.filter((asset) => {
            const name = (asset.asset_name || '').toLowerCase();
            const serial = (asset.asset_serial_number || '').toLowerCase();
            const assigneeId = asset.current_assignee || '';
            const assigneeName = (assigneeMap[assigneeId] || assigneeId).toLowerCase();
            return (
                name.includes(normalizedQuery) ||
                serial.includes(normalizedQuery) ||
                assigneeName.includes(normalizedQuery)
            );
        });
    }, [assets, assigneeMap, normalizedQuery]);

    // Separate assigned and unassigned assets (post-filter)
    const { assignedAssets, unassignedAssets } = useMemo(() => {
        const assigned: AssetMaster[] = [];
        const unassigned: AssetMaster[] = [];

        filteredAssets.forEach((asset) => {
            if (asset.current_assignee) {
                assigned.push(asset);
            } else {
                unassigned.push(asset);
            }
        });

        return { assignedAssets: assigned, unassignedAssets: unassigned };
    }, [filteredAssets]);

    const hasActiveSearch = normalizedQuery.length > 0;
    const totalAssetsInCategory = assets?.length ?? 0;
    const visibleAssetsCount = filteredAssets.length;

    const handleAssignClick = (asset: AssetMaster) => {
        setSelectedAsset({
            id: asset.name,
            name: asset.asset_name,
        });
        setAssignDialogOpen(true);
    };

    const handleUnassignClick = (asset: AssetMaster) => {
        setSelectedAsset({
            id: asset.name,
            name: asset.asset_name,
            assigneeName: asset.current_assignee ? assigneeMap[asset.current_assignee] : undefined,
            assignmentId: assignmentMap[asset.name],
        });
        setUnassignDialogOpen(true);
    };

    const handleAssetChange = () => {
        mutateAssets();
    };

    const isLoading = categoryLoading || assetsLoading;
    const error = categoryError || assetsError;

    if (error) return <AlertDestructive error={error as unknown as Error} />;

    const categoryType = category?.category_type;
    const isKnownCategoryType = categoryType === 'Project' || categoryType === 'IT';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                    <Link to="/asset-management">
                        <Button variant="ghost" size="icon" className="h-9 w-9">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                            <Boxes className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            {isLoading ? (
                                <Skeleton className="h-7 w-48 bg-gray-200" />
                            ) : (
                                <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">
                                    {category?.asset_category}
                                </h1>
                            )}
                            <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                <Badge variant="outline" className="text-xs">
                                    <Package className="h-3 w-3 mr-1" />
                                    {hasActiveSearch
                                        ? `${visibleAssetsCount} of ${totalAssetsInCategory} assets`
                                        : `${totalAssetsInCategory} assets`}
                                </Badge>
                                {isKnownCategoryType && (
                                    <Badge
                                        variant="outline"
                                        className={`text-xs font-medium ${categoryTypeBadgeClass[categoryType as AssetCategoryType]}`}
                                    >
                                        {categoryTypeIconMap[categoryType as AssetCategoryType]}
                                        {categoryType}
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Search */}
                <div className="relative w-full sm:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by asset name, serial, or assignee"
                        className="pl-9 pr-9"
                    />
                    {hasActiveSearch && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 hover:bg-transparent"
                            onClick={() => setSearchQuery('')}
                            aria-label="Clear search"
                        >
                            <X className="h-4 w-4 text-gray-400" />
                        </Button>
                    )}
                </div>
            </div>

            {isLoading ? (
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {[...Array(4)].map((_, i) => (
                        <Skeleton key={i} className="h-48 bg-gray-200 rounded-lg" />
                    ))}
                </div>
            ) : (
                <div className="space-y-8">
                    {/* Assigned Assets Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
                                <Users className="h-4 w-4 text-emerald-600" />
                            </div>
                            <h2 className="text-lg font-medium text-gray-900">Assigned Assets</h2>
                            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                {assignedAssets.length}
                            </Badge>
                        </div>

                        {assignedAssets.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 px-4 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/30">
                                <Users className="h-10 w-10 text-emerald-300 mb-3" />
                                <p className="text-sm text-emerald-600 font-medium">
                                    {hasActiveSearch ? 'No matching assigned assets' : 'No assigned assets'}
                                </p>
                                <p className="text-xs text-emerald-500 mt-1">
                                    {hasActiveSearch
                                        ? 'Try a different search term'
                                        : 'Assets assigned to users will appear here'}
                                </p>
                            </div>
                        ) : (
                            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {assignedAssets.map((asset) => (
                                    <AssetCard
                                        key={asset.name}
                                        assetId={asset.name}
                                        assetName={asset.asset_name}
                                        serialNumber={asset.asset_serial_number}
                                        condition={asset.asset_condition}
                                        assigneeName={asset.current_assignee ? assigneeMap[asset.current_assignee] : null}
                                        isAssigned={true}
                                        isDeclarationPending={declarationPendingMap[asset.name] ?? false}
                                        showUnassignAction={canAssignAsset}
                                        onUnassignClick={() => handleUnassignClick(asset)}
                                    />
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Unassigned Assets Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                                <UserX className="h-4 w-4 text-slate-500" />
                            </div>
                            <h2 className="text-lg font-medium text-gray-900">Unassigned Assets</h2>
                            <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-slate-200">
                                {unassignedAssets.length}
                            </Badge>
                        </div>

                        {unassignedAssets.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 px-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/30">
                                <UserX className="h-10 w-10 text-slate-300 mb-3" />
                                <p className="text-sm text-slate-600 font-medium">
                                    {hasActiveSearch ? 'No matching unassigned assets' : 'No unassigned assets'}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                    {hasActiveSearch
                                        ? 'Try a different search term'
                                        : 'All assets in this category are currently assigned'}
                                </p>
                            </div>
                        ) : (
                            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {unassignedAssets.map((asset) => (
                                    <AssetCard
                                        key={asset.name}
                                        assetId={asset.name}
                                        assetName={asset.asset_name}
                                        serialNumber={asset.asset_serial_number}
                                        condition={asset.asset_condition}
                                        isAssigned={false}
                                        showAssignAction={canAssignAsset}
                                        onAssignClick={() => handleAssignClick(asset)}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            )}

            {/* Dialogs */}
            {selectedAsset && (
                <>
                    <AssignAssetDialog
                        isOpen={assignDialogOpen}
                        onOpenChange={setAssignDialogOpen}
                        assetId={selectedAsset.id}
                        assetName={selectedAsset.name}
                        onAssigned={handleAssetChange}
                    />
                    <UnassignAssetDialog
                        isOpen={unassignDialogOpen}
                        onOpenChange={setUnassignDialogOpen}
                        assetId={selectedAsset.id}
                        assetName={selectedAsset.name}
                        assigneeName={selectedAsset.assigneeName || ''}
                        assetManagementId={selectedAsset.assignmentId}
                        onUnassigned={handleAssetChange}
                    />
                </>
            )}
        </div>
    );
};

export default AssetCategoryView;
export const Component = AssetCategoryView;
