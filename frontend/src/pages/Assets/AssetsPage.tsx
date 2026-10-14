import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useUserData } from '@/hooks/useUserData';
import { urlStateManager } from '@/utils/urlStateManager';
import { Plus, Boxes, Briefcase, Laptop, Users, UserX, AlertTriangle, List, History, Building2, Undo2, ClipboardCheck } from 'lucide-react';
import { canEditDepartments } from '@/constants/departments';

import { AssetsSummaryCards } from './components/AssetsSummaryCard';
import { AssetCategoriesList } from './components/AssetCategoriesList';
import { AssetMasterList } from './components/AssetMasterList';
import { AssignedAssetsList } from './components/AssignedAssetsList';
import { UnassignedAssetsList } from './components/UnassignedAssetsList';
import { PendingActionsList } from './components/PendingActionsList';
import { ReturnRequestsList } from './components/ReturnRequestsList';
import { useReturnRequests } from './hooks/useReturnRequests';
import { AssetAuditList } from './components/AssetAuditList';
import { useAuditPendingCounts } from './hooks/useAuditPending';
import { AddAssetCategoryDialog } from './components/AddAssetCategoryDialog';
import { AddAssetDialog } from './components/AddAssetDialog';
import { AssetHistoryList } from './components/AssetHistoryList';
import { DepartmentsList } from './components/DepartmentsList';
import { useAssetDataRefresh } from './hooks/useAssetDataRefresh';
import { getAssetPermissions } from './utils/permissions';
import { AssetCategoryType } from './assets.constants';

type AssetTopTab = 'project' | 'it' | 'categories' | 'departments' | 'history';
type AssetSubTab = 'all' | 'assigned' | 'unassigned' | 'pending' | 'returns' | 'audit';

const TOP_TABS: readonly AssetTopTab[] = ['project', 'it', 'categories', 'departments', 'history'];
const SUB_TABS: readonly AssetSubTab[] = ['all', 'assigned', 'unassigned', 'pending', 'returns', 'audit'];

// Keeps a tab in the URL (?tab= / ?view=) so Back from an asset's page lands on the
// same tab instead of the default. replaceState via urlStateManager, like the tables'
// own params, so switching tabs adds no history entries. The default is left out of the URL.
function useUrlTab<T extends string>(key: string, values: readonly T[], fallback: T) {
    const parse = (raw: string | null): T => (values.includes(raw as T) ? (raw as T) : fallback);
    const [value, setValue] = useState<T>(() => parse(urlStateManager.getParam(key)));

    React.useEffect(
        () => urlStateManager.subscribe(key, (_, raw) => setValue(parse(raw))),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [key]
    );

    const update = (next: T) => {
        setValue(next);
        urlStateManager.updateParam(key, next === fallback ? null : next);
    };

    return [value, update] as const;
}

const assetSubTabs: { id: AssetSubTab; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'all', label: 'All', shortLabel: 'All', icon: List },
    { id: 'assigned', label: 'Assigned', shortLabel: 'Asgn', icon: Users },
    { id: 'unassigned', label: 'Unassigned', shortLabel: 'Free', icon: UserX },
    { id: 'pending', label: 'Pending Declaration', shortLabel: 'Decl', icon: AlertTriangle },
    // Returns waiting for approval (owner, 2026-10-13); the tab carries their count.
    { id: 'returns', label: 'Return Request', shortLabel: 'Return', icon: Undo2 },
    // Monthly asset audit (owner, 2026-10-14): open audits and the ones sent; the tab carries the open count.
    { id: 'audit', label: 'Asset Audit', shortLabel: 'Audit', icon: ClipboardCheck },
];

interface AssetSubTabsViewProps {
    assetType: AssetCategoryType;
    refreshKey: number;
    onAssetChange: () => void;
}

const AssetSubTabsView: React.FC<AssetSubTabsViewProps> = ({ assetType, refreshKey, onAssetChange }) => {
    const [subTab, setSubTab] = useUrlTab<AssetSubTab>('view', SUB_TABS, 'all');
    const returnCount = useReturnRequests().byType[assetType];
    const auditCount = useAuditPendingCounts()[assetType];

    return (
        <>
            <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1 scrollbar-hide">
                {assetSubTabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = subTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setSubTab(tab.id)}
                            className={`
                                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium
                                transition-all duration-200 whitespace-nowrap
                                ${isActive
                                    ? 'bg-gray-900 text-white shadow-sm'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800'
                                }
                            `}
                        >
                            <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-white' : tab.id === 'pending' ? 'text-amber-500' : ''}`} />
                            <span className="hidden sm:inline">{tab.label}</span>
                            <span className="sm:hidden">{tab.shortLabel}</span>
                            {tab.id === 'returns' && returnCount > 0 && (
                                <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 text-white tabular-nums">
                                    {returnCount}
                                </span>
                            )}
                            {tab.id === 'audit' && auditCount > 0 && (
                                <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 text-white tabular-nums">
                                    {auditCount}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            <div>
                {subTab === 'all' && (
                    <AssetMasterList key={`${assetType}-all-${refreshKey}`} assetType={assetType} />
                )}
                {subTab === 'assigned' && (
                    <AssignedAssetsList key={`${assetType}-assigned-${refreshKey}`} assetType={assetType} />
                )}
                {subTab === 'unassigned' && (
                    <UnassignedAssetsList
                        key={`${assetType}-unassigned-${refreshKey}`}
                        assetType={assetType}
                        onAssigned={onAssetChange}
                    />
                )}
                {subTab === 'pending' && (
                    <PendingActionsList
                        key={`${assetType}-pending-${refreshKey}`}
                        assetType={assetType}
                        onUploaded={onAssetChange}
                    />
                )}
                {subTab === 'returns' && (
                    <ReturnRequestsList key={`${assetType}-returns-${refreshKey}`} assetType={assetType} onChanged={onAssetChange} />
                )}
                {subTab === 'audit' && (
                    <AssetAuditList key={`${assetType}-audit-${refreshKey}`} assetType={assetType} />
                )}
            </div>
        </>
    );
};

const AssetsPage: React.FC = () => {
    const userData = useUserData();
    const [activeTab, setActiveTab] = useUrlTab<AssetTopTab>('tab', TOP_TABS, 'project');
    const [addCategoryDialogOpen, setAddCategoryDialogOpen] = useState(false);
    const [addAssetDialogOpen, setAddAssetDialogOpen] = useState(false);
    const [categoryRefreshKey, setCategoryRefreshKey] = useState(0);
    const [assetRefreshKey, setAssetRefreshKey] = useState(0);

    const { refreshSummaryCards, refreshCategoryDropdowns } = useAssetDataRefresh();
    const { canAddAsset, canAddCategory, canViewHistory } = getAssetPermissions(userData?.user_id, userData?.role);
    const canManageDepartments = canEditDepartments(userData?.role, userData?.user_id);

    const handleAssetChange = () => {
        setAssetRefreshKey(k => k + 1);
        refreshSummaryCards();
    };

    const handleCategoryAdded = () => {
        setCategoryRefreshKey(k => k + 1);
        refreshSummaryCards();
        refreshCategoryDropdowns();
    };

    const handleAssetAdded = () => {
        setAssetRefreshKey(k => k + 1);
        refreshSummaryCards();
    };

    const isAssetsTab = activeTab === 'project' || activeTab === 'it';
    const addAssetType: AssetCategoryType = activeTab === 'it' ? 'IT' : 'Project';
    const addAssetLabel = `Add New ${activeTab === 'it' ? 'IT' : 'Project'} Asset`;

    // Auto-close the Add dialog if the user switches asset tabs while it's open —
    // avoids the dialog showing the wrong type after a tab switch.
    React.useEffect(() => {
        if (addAssetDialogOpen) setAddAssetDialogOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    // Refetch summary counts on every tab switch — explicit user preference for
    // freshness over instant display. SWR dedup window protects against double-fire.
    React.useEffect(() => {
        refreshSummaryCards();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    return (
        <div className="flex flex-col gap-3 sm:gap-4">
            <div>
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-gray-900">
                    Asset Management
                </h1>
                <p className="hidden sm:block text-sm text-gray-500 mt-0.5">
                    Manage your organization's assets and categories
                </p>
            </div>

            {/* The History tab shows the overall totals, like Categories. */}
            <AssetsSummaryCards activeTab={activeTab === 'history' || activeTab === 'departments' ? 'categories' : activeTab} />

            <Tabs
                value={activeTab}
                onValueChange={(v) => {
                    // A new top tab starts on "All", as before the tabs lived in the URL.
                    urlStateManager.updateParam('view', null);
                    setActiveTab(v as AssetTopTab);
                }}
                className="flex flex-col"
            >
                <div className="flex items-center justify-between gap-4">
                    <TabsList className="w-fit bg-gray-100/80 p-1">
                        <TabsTrigger
                            value="project"
                            className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-700"
                        >
                            <Briefcase className="h-4 w-4" />
                            <span className="hidden sm:inline">Project Assets</span>
                            <span className="sm:hidden">Project</span>
                        </TabsTrigger>
                        <TabsTrigger
                            value="it"
                            className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-purple-700"
                        >
                            <Laptop className="h-4 w-4" />
                            <span className="hidden sm:inline">IT Assets</span>
                            <span className="sm:hidden">IT</span>
                        </TabsTrigger>
                        <TabsTrigger
                            value="categories"
                            className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm"
                        >
                            <Boxes className="h-4 w-4" />
                            Categories
                        </TabsTrigger>
                        {/* Admin and HR only (the server refuses everyone else too) */}
                        {canManageDepartments && (
                            <TabsTrigger
                                value="departments"
                                className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-indigo-700"
                            >
                                <Building2 className="h-4 w-4" />
                                Departments
                            </TabsTrigger>
                        )}
                        {canViewHistory && (
                            <TabsTrigger
                                value="history"
                                className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-indigo-700"
                            >
                                <History className="h-4 w-4" />
                                History
                            </TabsTrigger>
                        )}
                    </TabsList>

                    <div>
                        {isAssetsTab && canAddAsset && (
                            <Button
                                size="sm"
                                onClick={() => setAddAssetDialogOpen(true)}
                                className="gap-2"
                            >
                                <Plus className="h-4 w-4" />
                                <span className="hidden sm:inline">{addAssetLabel}</span>
                                <span className="sm:hidden">Add</span>
                            </Button>
                        )}
                        {activeTab === 'categories' && canAddCategory && (
                            <Button
                                size="sm"
                                onClick={() => setAddCategoryDialogOpen(true)}
                                className="gap-2"
                            >
                                <Plus className="h-4 w-4" />
                                <span className="hidden sm:inline">Add New Category</span>
                                <span className="sm:hidden">Add</span>
                            </Button>
                        )}
                    </div>
                </div>

                <TabsContent
                    value="project"
                    className="mt-3 sm:mt-4 data-[state=inactive]:hidden"
                >
                    <AssetSubTabsView
                        assetType="Project"
                        refreshKey={assetRefreshKey}
                        onAssetChange={handleAssetChange}
                    />
                </TabsContent>

                <TabsContent
                    value="it"
                    className="mt-3 sm:mt-4 data-[state=inactive]:hidden"
                >
                    <AssetSubTabsView
                        assetType="IT"
                        refreshKey={assetRefreshKey}
                        onAssetChange={handleAssetChange}
                    />
                </TabsContent>

                <TabsContent
                    value="categories"
                    className="mt-3 sm:mt-4 data-[state=inactive]:hidden"
                >
                    <AssetCategoriesList key={`categories-${categoryRefreshKey}`} />
                </TabsContent>

                {canManageDepartments && (
                    <TabsContent
                        value="departments"
                        className="mt-3 sm:mt-4 data-[state=inactive]:hidden"
                    >
                        {activeTab === 'departments' && <DepartmentsList />}
                    </TabsContent>
                )}

                {canViewHistory && (
                    <TabsContent
                        value="history"
                        className="mt-3 sm:mt-4 data-[state=inactive]:hidden"
                    >
                        {activeTab === 'history' && <AssetHistoryList />}
                    </TabsContent>
                )}
            </Tabs>

            <AddAssetCategoryDialog
                isOpen={addCategoryDialogOpen}
                onOpenChange={setAddCategoryDialogOpen}
                onCategoryAdded={handleCategoryAdded}
            />
            <AddAssetDialog
                isOpen={addAssetDialogOpen}
                onOpenChange={setAddAssetDialogOpen}
                onAssetAdded={handleAssetAdded}
                assetType={addAssetType}
            />
        </div>
    );
};

export default AssetsPage;
