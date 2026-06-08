import React, { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList, useFrappeUpdateDoc, useFrappeFileUpload } from 'frappe-react-sdk';

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from '@/utils/FormatDate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { CustomAttachment } from '@/components/helpers/CustomAttachment';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Hash, User, Upload, AlertTriangle, FileText, Download } from 'lucide-react';
import { TailSpin } from 'react-loader-spinner';

import {
    ASSET_MANAGEMENT_DOCTYPE,
    ASSET_MANAGEMENT_FIELDS,
    ASSET_MANAGEMENT_SEARCHABLE_FIELDS,
    ASSET_MANAGEMENT_DATE_COLUMNS,
    ASSET_MASTER_DOCTYPE,
    AssetCategoryType,
} from '../assets.constants';
import { useAssetDataRefresh } from '../hooks/useAssetDataRefresh';
import { useAssetMasterNamesByType } from '../hooks/useAssetMasterNamesByType';

interface AssetManagement {
    name: string;
    asset: string;
    asset_assigned_to: string;
    asset_assigned_on: string;
    asset_declaration_attachment: string;
    creation: string;
}

interface AssetMaster {
    name: string;
    asset_name: string;
    asset_category: string;
}

interface NirmaanUser {
    name: string;
    full_name: string;
}

interface PendingActionsListProps {
    onUploaded?: () => void;
    assetType?: AssetCategoryType;
}

// Outer guard — blocks the table mount until masterNames-by-type is resolved.
// Without this guard useServerDataTable would fire an initial fetch with a
// placeholder filter and the resulting "0 rows" can race past the real fetch.
export const PendingActionsList: React.FC<PendingActionsListProps> = ({ onUploaded, assetType }) => {
    const { masterNames, isLoading: typeMastersLoading } = useAssetMasterNamesByType(assetType);

    if (assetType && typeMastersLoading) {
        return <Skeleton className="h-96 w-full bg-gray-100" />;
    }

    return (
        <PendingActionsListInner
            assetType={assetType}
            masterNames={masterNames}
            onUploaded={onUploaded}
        />
    );
};

interface PendingActionsListInnerProps {
    assetType?: AssetCategoryType;
    masterNames: string[];
    onUploaded?: () => void;
}

const PendingActionsListInner: React.FC<PendingActionsListInnerProps> = ({
    assetType,
    masterNames,
    onUploaded,
}) => {
    const { toast } = useToast();
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [selectedAssignment, setSelectedAssignment] = useState<AssetManagement | null>(null);
    const [declarationFile, setDeclarationFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [downloadingAssetId, setDownloadingAssetId] = useState<string | null>(null);

    const { updateDoc } = useFrappeUpdateDoc();
    const { upload } = useFrappeFileUpload();
    const { refreshSummaryCards } = useAssetDataRefresh();

    // Handle download declaration form PDF
    const handleDownloadDeclaration = async (assetId: string, assetName: string) => {
        setDownloadingAssetId(assetId);
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
            link.setAttribute('download', `${assetName || assetId}_Declaration_Form.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);

            toast({
                title: "Downloaded",
                description: "Declaration form downloaded successfully.",
                variant: "success",
            });
        } catch (error) {
            console.error('Download Error:', error);
            toast({
                title: "Failed",
                description: "Failed to download declaration form.",
                variant: "destructive",
            });
        } finally {
            setDownloadingAssetId(null);
        }
    };

    // Fetch asset details — scope to typed asset names when filtering
    const { data: assetsList } = useFrappeGetDocList<AssetMaster>(
        'Asset Master',
        {
            fields: ['name', 'asset_name', 'asset_category'],
            filters: assetType ? [['name', 'in', masterNames.length ? masterNames : ['__none__']]] : [],
            limit: 0,
        },
        assetType ? `assets_for_pending_list_${assetType}` : 'assets_for_pending_list'
    );

    const assetsMap = useMemo(() => {
        const map: Record<string, AssetMaster> = {};
        assetsList?.forEach((asset) => {
            map[asset.name] = asset;
        });
        return map;
    }, [assetsList]);

    // Fetch user details
    const { data: usersList } = useFrappeGetDocList<NirmaanUser>(
        'Nirmaan Users',
        {
            fields: ['name', 'full_name'],
            limit: 0,
        },
        'users_for_pending_list'
    );

    const usersMap = useMemo(() => {
        const map: Record<string, string> = {};
        usersList?.forEach((user) => {
            map[user.name] = user.full_name;
        });
        return map;
    }, [usersList]);

    // Source for facets — distinct `asset` + `asset_assigned_to` from Asset
    // Management rows that are pending a declaration upload (scoped to the
    // current asset type). `is not set` catches both NULL and '' — `= ''`
    // alone misses NULL-valued rows.
    const facetSourceFilters = useMemo(() => {
        const filters: any[] = [['asset_declaration_attachment', 'is', 'not set']];
        if (assetType) {
            filters.push(['asset', 'in', masterNames.length ? masterNames : ['__none__']]);
        }
        return filters;
    }, [assetType, masterNames]);

    const { data: facetSource } = useFrappeGetDocList<{
        name: string;
        asset: string;
        asset_assigned_to: string;
    }>(
        ASSET_MANAGEMENT_DOCTYPE,
        {
            fields: ['name', 'asset', 'asset_assigned_to'],
            filters: facetSourceFilters,
            limit: 0,
        },
        assetType ? `pending_facet_source_${assetType}` : 'pending_facet_source'
    );

    // Count occurrences for the "(N)" suffix on each facet option.
    const facetCounts = useMemo(() => {
        const counts = {
            asset: new Map<string, number>(),
            asset_assigned_to: new Map<string, number>(),
        };
        (facetSource ?? []).forEach((row) => {
            if (row.asset) counts.asset.set(row.asset, (counts.asset.get(row.asset) ?? 0) + 1);
            if (row.asset_assigned_to) counts.asset_assigned_to.set(row.asset_assigned_to, (counts.asset_assigned_to.get(row.asset_assigned_to) ?? 0) + 1);
        });
        return counts;
    }, [facetSource]);

    const assetNameOptions = useMemo(() => {
        const opts: { label: string; value: string }[] = [];
        facetCounts.asset.forEach((count, id) => {
            const name = assetsMap[id]?.asset_name || id;
            opts.push({ label: `${name} (${count})`, value: id });
        });
        return opts.sort((a, b) => a.label.localeCompare(b.label));
    }, [facetCounts, assetsMap]);

    const assigneeOptions = useMemo(() => {
        const opts: { label: string; value: string }[] = [];
        facetCounts.asset_assigned_to.forEach((count, userId) => {
            const name = usersMap[userId] || userId;
            opts.push({ label: `${name} (${count})`, value: userId });
        });
        return opts.sort((a, b) => a.label.localeCompare(b.label));
    }, [facetCounts, usersMap]);

    const handleUploadClick = (assignment: AssetManagement) => {
        setSelectedAssignment(assignment);
        setDeclarationFile(null);
        setUploadDialogOpen(true);
    };

    const handleUploadSubmit = async () => {
        if (!selectedAssignment || !declarationFile) return;

        setIsUploading(true);

        try {
            // Upload file
            const fileArgs = {
                doctype: ASSET_MANAGEMENT_DOCTYPE,
                docname: selectedAssignment.name,
                fieldname: 'asset_declaration_attachment',
                isPrivate: true,
            };
            const uploadedFile = await upload(declarationFile, fileArgs);

            // Update the Asset Management document with file URL
            await updateDoc(ASSET_MANAGEMENT_DOCTYPE, selectedAssignment.name, {
                asset_declaration_attachment: uploadedFile.file_url,
            });

            toast({
                title: 'Declaration Uploaded',
                description: 'The declaration document has been uploaded successfully.',
                variant: 'success',
            });

            setUploadDialogOpen(false);
            refetchTable();
            refreshSummaryCards(); // Update pending declaration count in summary cards
            onUploaded?.();
        } catch (error: any) {
            console.error('Failed to upload declaration:', error);
            toast({
                title: 'Upload Failed',
                description: error?.message || 'An error occurred while uploading the declaration.',
                variant: 'destructive',
            });
        } finally {
            setIsUploading(false);
        }
    };

    const columns = useMemo<ColumnDef<AssetManagement>[]>(() => [
        {
            id: 'asset_id_display',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Asset ID" />,
            cell: ({ row }) => (
                <Link
                    to={`/asset-management/${row.original.asset}`}
                    className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline font-medium"
                >
                    <Hash className="h-3 w-3" />
                    <span className="tabular-nums">{row.original.asset.slice(-6)}</span>
                </Link>
            ),
            size: 100,
        },
        {
            // `accessorKey: 'asset'` (column id `asset`) lives on the Asset Name
            // column so the facet's funnel icon renders here and filters
            // resolve to ["asset", "in", [...ids]].
            accessorKey: 'asset',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Asset Name" />,
            cell: ({ row }) => {
                const assetData = assetsMap[row.original.asset];
                return (
                    <Link
                        to={`/asset-management/${row.original.asset}`}
                        className="font-medium text-gray-900 hover:text-blue-600 transition-colors"
                    >
                        {assetData?.asset_name || row.original.asset}
                    </Link>
                );
            },
            size: 200,
        },
        {
            id: 'asset_category',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => {
                const assetData = assetsMap[row.original.asset];
                return assetData?.asset_category ? (
                    <Badge variant="outline" className="font-normal">
                        {assetData.asset_category}
                    </Badge>
                ) : (
                    <span className="text-gray-400">—</span>
                );
            },
            size: 140,
        },
        {
            accessorKey: 'asset_assigned_to',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned To" />,
            cell: ({ row }) => {
                const userId = row.getValue<string>('asset_assigned_to');
                const userName = usersMap[userId] || userId;
                return (
                    <span className="inline-flex items-center gap-1.5 text-gray-700 text-sm">
                        <User className="h-3.5 w-3.5 text-emerald-500" />
                        {userName}
                    </span>
                );
            },
            size: 180,
        },
        {
            accessorKey: 'asset_assigned_on',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned On" />,
            cell: ({ row }) => (
                <span className="text-sm text-gray-500 tabular-nums">
                    {formatDate(row.getValue('asset_assigned_on'))}
                </span>
            ),
            size: 120,
        },
        {
            id: 'status',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: () => (
                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Pending Declaration
                </Badge>
            ),
            size: 110,
        },
        {
            id: 'actions',
            header: () => <span className="sr-only">Actions</span>,
            cell: ({ row }) => {
                const assetId = row.original.asset;
                const assetData = assetsMap[assetId];
                const isDownloading = downloadingAssetId === assetId;

                return (
                    <div className="flex items-center gap-1.5">
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700"
                            onClick={() => handleDownloadDeclaration(assetId, assetData?.asset_name || assetId)}
                            disabled={isDownloading}
                        >
                            {isDownloading ? (
                                <TailSpin height={14} width={14} color="#d97706" />
                            ) : (
                                <Download className="h-3.5 w-3.5" />
                            )}
                            <span className="hidden lg:inline">Download</span>
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5"
                            onClick={() => handleUploadClick(row.original)}
                        >
                            <Upload className="h-3.5 w-3.5" />
                            <span className="hidden lg:inline">Upload</span>
                        </Button>
                    </div>
                );
            },
            size: 180,
        },
    ], [assetsMap, usersMap, downloadingAssetId, handleDownloadDeclaration]);

    const additionalFilters = useMemo(() => {
        const filters: any[] = [['asset_declaration_attachment', 'is', 'not set']];
        if (assetType) {
            if (masterNames.length === 0) {
                filters.push(['asset', 'in', ['__none__']]);
            } else {
                filters.push(['asset', 'in', masterNames]);
            }
        }
        return filters;
    }, [assetType, masterNames]);

    const {
        table,
        totalCount,
        isLoading,
        error,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        refetch: refetchTable,
    } = useServerDataTable<AssetManagement>({
        doctype: ASSET_MANAGEMENT_DOCTYPE,
        columns,
        fetchFields: ASSET_MANAGEMENT_FIELDS as unknown as string[],
        searchableFields: ASSET_MANAGEMENT_SEARCHABLE_FIELDS,
        defaultSort: 'asset_assigned_on desc',
        urlSyncKey: assetType ? `pending_actions_${assetType.toLowerCase()}` : 'pending_actions',
        enableRowSelection: false,
        additionalFilters,
    });

    const facetFilterOptions = useMemo(() => ({
        asset: {
            title: 'Asset Name',
            options: assetNameOptions,
        },
        asset_assigned_to: {
            title: 'Assignee',
            options: assigneeOptions,
        },
    }), [assetNameOptions, assigneeOptions]);

    return (
        <>
            <DataTable<AssetManagement>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error as Error}
                totalCount={totalCount}
                searchFieldOptions={ASSET_MANAGEMENT_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={ASSET_MANAGEMENT_DATE_COLUMNS}
                showExportButton={false}
                showRowSelection={false}
            />

            {/* Upload Declaration Dialog */}
            <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
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
                            <span className="font-medium text-gray-700">
                                {selectedAssignment ? assetsMap[selectedAssignment.asset]?.asset_name || selectedAssignment.asset : ''}
                            </span>
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
                            onClick={() => setUploadDialogOpen(false)}
                            disabled={isUploading}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleUploadSubmit}
                            disabled={isUploading || !declarationFile}
                            className="gap-2"
                        >
                            {isUploading ? 'Uploading...' : 'Upload Declaration'}
                            <Upload className="h-4 w-4" />
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};
