import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useUserData } from '@/hooks/useUserData';
import { Plus, Boxes, Package, Users, UserX, AlertTriangle, List } from 'lucide-react';

import { AssetsSummaryCards } from './components/AssetsSummaryCard';
import { AssetCategoriesList } from './components/AssetCategoriesList';
import { AssetMasterList } from './components/AssetMasterList';
import { AssignedAssetsList } from './components/AssignedAssetsList';
import { UnassignedAssetsList } from './components/UnassignedAssetsList';
import { PendingActionsList } from './components/PendingActionsList';
import { AddAssetCategoryDialog } from './components/AddAssetCategoryDialog';
import { AddAssetDialog } from './components/AddAssetDialog';

const AssetsPage: React.FC = () => {
    const userData = useUserData();
    const [activeTab, setActiveTab] = useState('assets');
    const [assetSubTab, setAssetSubTab] = useState('all');
    const [addCategoryDialogOpen, setAddCategoryDialogOpen] = useState(false);
    const [addAssetDialogOpen, setAddAssetDialogOpen] = useState(false);
    // Refresh keys to trigger data refetch after adding items
    const [categoryRefreshKey, setCategoryRefreshKey] = useState(0);
    const [assetRefreshKey, setAssetRefreshKey] = useState(0);

    const canManageAssets = userData?.user_id === 'Administrator' ||
        ['Nirmaan Admin Profile', 'Nirmaan PMO Executive Profile', 'Nirmaan HR Executive Profile'].includes(userData?.role || '');

    const handleAssetChange = () => {
        setAssetRefreshKey(k => k + 1);
    };

    const assetSubTabs = [
        { id: 'all', label: 'All', icon: List },
        { id: 'assigned', label: 'Assigned', icon: Users },
        { id: 'unassigned', label: 'Unassigned', icon: UserX },
        { id: 'pending', label: 'Pending Declaration', icon: AlertTriangle },
    ];

    return (
        <div className="flex flex-col gap-3 sm:gap-4 h-[calc(100vh-80px)] overflow-hidden">
            {/* Header - compact on mobile */}
            <div>
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-gray-900">
                    Asset Management
                </h1>
                <p className="hidden sm:block text-sm text-gray-500 mt-0.5">
                    Manage your organization's assets and categories
                </p>
            </div>

            {/* Summary Cards */}
            <AssetsSummaryCards />

            {/* Main Tabs */}
            <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex-1 flex flex-col min-h-0"
            >
                <div className="flex items-center justify-between gap-4">
                    <TabsList className="w-fit bg-gray-100/80 p-1">
                        <TabsTrigger
                            value="assets"
                            className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm"
                        >
                            <Package className="h-4 w-4" />
                            Assets
                        </TabsTrigger>
                        <TabsTrigger
                            value="categories"
                            className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm"
                        >
                            <Boxes className="h-4 w-4" />
                            Categories
                        </TabsTrigger>
                    </TabsList>

                    {canManageAssets && (
                        <div>
                            {activeTab === 'assets' ? (
                                <Button
                                    size="sm"
                                    onClick={() => setAddAssetDialogOpen(true)}
                                    className="gap-2"
                                >
                                    <Plus className="h-4 w-4" />
                                    <span className="hidden sm:inline">Add New Asset</span>
                                    <span className="sm:hidden">Add</span>
                                </Button>
                            ) : (
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
                    )}
                </div>

                {/* Assets Tab Content with Sub-tabs */}
                <TabsContent
                    value="assets"
                    className="flex-1 mt-3 sm:mt-4 min-h-0 data-[state=inactive]:hidden flex flex-col"
                >
                    {/* Asset Sub-tabs - Compact pill navigation */}
                    <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1 scrollbar-hide">
                        {assetSubTabs.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = assetSubTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setAssetSubTab(tab.id)}
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
                                    <span className="sm:hidden">
                                        {tab.id === 'all' ? 'All' :
                                         tab.id === 'assigned' ? 'Asgn' :
                                         tab.id === 'unassigned' ? 'Free' : 'Decl'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Sub-tab Content */}
                    <div className="flex-1 min-h-0">
                        {assetSubTab === 'all' && (
                            <AssetMasterList key={`all-assets-${assetRefreshKey}`} />
                        )}
                        {assetSubTab === 'assigned' && (
                            <AssignedAssetsList key={`assigned-assets-${assetRefreshKey}`} />
                        )}
                        {assetSubTab === 'unassigned' && (
                            <UnassignedAssetsList
                                key={`unassigned-assets-${assetRefreshKey}`}
                                onAssigned={handleAssetChange}
                            />
                        )}
                        {assetSubTab === 'pending' && (
                            <PendingActionsList
                                key={`pending-assets-${assetRefreshKey}`}
                                onUploaded={handleAssetChange}
                            />
                        )}
                    </div>
                </TabsContent>

                {/* Categories Tab Content */}
                <TabsContent
                    value="categories"
                    className="flex-1 mt-3 sm:mt-4 min-h-0 data-[state=inactive]:hidden"
                >
                    <AssetCategoriesList key={`categories-${categoryRefreshKey}`} />
                </TabsContent>
            </Tabs>

            {/* Dialogs */}
            <AddAssetCategoryDialog
                isOpen={addCategoryDialogOpen}
                onOpenChange={setAddCategoryDialogOpen}
                onCategoryAdded={() => setCategoryRefreshKey(k => k + 1)}
            />
            <AddAssetDialog
                isOpen={addAssetDialogOpen}
                onOpenChange={setAddAssetDialogOpen}
                onAssetAdded={() => setAssetRefreshKey(k => k + 1)}
            />
        </div>
    );
};

export default AssetsPage;
