import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ArrowLeft, Download, Loader2, Plus } from 'lucide-react';
import { useNirmaanUserNames, useTdsHistoryItems, useProjectDoc } from '../data/tds/useTdsQueries';
import { format } from 'date-fns';
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { isAdminProfile, isDeveloperProfile } from "@/constants/roles";
import { SetupTDSRepositoryDialog, TDSRepositoryData, ViewCard, TdsCreateForm, TdsHistoryTable, TdsExportDialog, TdsPdfReadyDialog, type TdsExportItem, type TdsExportOptions } from './components';
import { HISTORY_TABS, clientStatusMarkedBy, formatTdsStamp, historyStatusLabel, projectHistoryTabFilters, type HistoryTab } from '@/utils/tdsRequestRules';
import { PDF_DEFAULT_STATUSES } from '@/utils/tdsRequestRules';
import { useCounts } from '@/hooks/useCounts';
import { useBackgroundOperation } from '@/hooks/useBackgroundOperation';
import { deliverTdsExport } from '@/utils/tds/deliverTdsExport';
import { tdsExportFallbackName, type TdsExportContext } from '@/utils/tds/tdsExport';
import { saveUrlAs } from '@/utils/saveUrlAs';
import type { OpView } from '@/utils/backgroundOps/operationFollower';

const ROW_DOCTYPE = "Project TDS Item List";

interface TDSRepositoryViewProps {
    data: TDSRepositoryData;
    projectId: string;
    onUpdate: (data: TDSRepositoryData) => Promise<void>;
}

export const TDSRepositoryView: React.FC<TDSRepositoryViewProps> = ({ data, projectId, onUpdate }) => {
    const { role } = useUserData();
    const canEditTDS = isAdminProfile(role) || isDeveloperProfile(role) || role === "Administrator" || role === "Nirmaan PMO Executive Profile";
    // Only Admins can save a PDF holding Pending sheets; everyone else previews it (`isPdfPreviewOnly`).
    const isAdmin = isAdminProfile(role) || isDeveloperProfile(role);

    const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    // Bumped on each open: the PDF dialog remounts and starts from its defaults.
    const [exportDialogKey, setExportDialogKey] = useState(0);
    const [isUpdating, setIsUpdating] = useState(false);
    const [activeTab, setActiveTab] = useState<HistoryTab>("history");
    // The request form replaces the tab row and tables while open; both stay mounted.
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [isExportingHistory, setIsExportingHistory] = useState(false);
    // The finished PDF is being fetched; the export's own state is the operation's (`exportOp.view`).
    const [isDelivering, setIsDelivering] = useState(false);
    const [pdfReadyBlobUrl, setPdfReadyBlobUrl] = useState<string | null>(null);
    const [pdfReadyFilename, setPdfReadyFilename] = useState<string>("");
    const [pdfReadySizeBytes, setPdfReadySizeBytes] = useState<number>(0);
    const [isPdfReadyOpen, setIsPdfReadyOpen] = useState(false);

    // Fetch TDS history data directly for export
    const { data: historyData, mutate: mutateHistoryItems } = useTdsHistoryItems(projectId);
    // Full names by user id, for the CSV's Marked By.
    const userNames = useNirmaanUserNames();

    const { data: projectData } = useProjectDoc(projectId);

    // One count per tab, with the same server filter its table uses, so a badge always matches its rows.
    const tabCountSpecs = React.useMemo(
        () => HISTORY_TABS.map(tab => ({
            key: tab.value,
            doctype: ROW_DOCTYPE,
            filters: projectHistoryTabFilters(projectId, tab.value),
        })),
        [projectId]
    );
    const { data: tabCounts, mutate: mutateTabCounts } = useCounts(
        tabCountSpecs,
        `tds_tab_counts_${projectId}_${refreshKey}`
    );

    /* Rows were marked: refresh the badges, and the rows the CSV and PDF exports read. */
    const handleClientStatusChange = () => {
        mutateTabCounts();
        mutateHistoryItems();
    };
    const projectName = projectData?.project_name || projectId;

    /* `useTdsHistoryItems` is mounted by THIS PAGE, not by the dialog, so opening
       the dialog does not remount it and SWR has no reason to revalidate — the
       list is served from cache. Anything that changed since the page loaded (a
       row approved, a make swapped, a request rejected) would be exported from a
       stale snapshot, and closing and reopening would not help.

       So the refetch hangs off the OPEN ACTION, not an effect on the dialog's
       `isOpen` — a user-action side effect belongs in the handler. Not awaited:
       the dialog opens on the cached list immediately and re-renders when the
       fresh one lands, which beats blocking the open on a round trip. */
    const handleOpenExportDialog = () => {
        mutateHistoryItems();
        setExportDialogKey(key => key + 1);
        setIsExportDialogOpen(true);
    };

    // Export History to CSV
    const handleExportHistory = () => {
        if (!historyData || historyData.length === 0) {
            toast({ 
                title: "No Data", 
                description: "No TDS history to export.", 
                variant: "destructive" 
            });
            return;
        }

        setIsExportingHistory(true);

        // Allow React to render loading state before heavy lifting
        setTimeout(() => {
            try {
                // Define CSV headers
                const headers = [
                    "TDS ID",
                    "Work Package",
                    "Category",
                    "Item ID",
                    "Item Name",
                    "Description",
                    "Make",
                    "BOQ Ref",
                    "Status",
                    "Rejection Reason",
                    "Client Status",
                    "Marked By",
                    "Marked On",
                    "Client's Reason",
                    "Doc",
                    "Created On"
                ];

                // Map data to CSV rows
                const rows = historyData.map(item => [
                    item.tds_request_id || "",
                    item.tds_work_package || "",
                    item.tds_category || "",
                    item.tds_item_id || "",
                    item.tds_item_name || "",
                    (item.tds_description || "").replace(/,/g, ";"), // Escape commas
                    item.tds_make || "",
                    item.tds_boq_line_item || "",
                    historyStatusLabel(item.tds_status),
                    (item.tds_rejection_reason || "").replace(/,/g, ";"),
                    item.client_status || "",
                    clientStatusMarkedBy(item, userNames),
                    formatTdsStamp(item.client_status_on),
                    (item.client_rejection_reason || "").replace(/,/g, ";"),
                    item.tds_attachment || "",
                    formatTdsStamp(item.creation)
                ]);

                // Create CSV content
                const csvContent = [
                    headers.join(","),
                    ...rows.map(row => row.map((cell: string) => `"${cell}"`).join(","))
                ].join("\n");

                // Download file
                const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                const dateStr = format(new Date(), "dd-MMM-yyyy");
                const cleanProjectName = (projectName || projectId).replace(/[^a-zA-Z0-9-_]/g, "_");
                link.setAttribute("download", `TDS_History_${cleanProjectName}_${dateStr}.csv`);
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.URL.revokeObjectURL(url);

                toast({ 
                    title: "Success", 
                    description: "TDS History exported successfully." 
                });
            } catch (error) {
                console.error("Export history failed", error);
                toast({ 
                    title: "Error", 
                    description: "Failed to export history.", 
                    variant: "destructive" 
                });
            } finally {
                setIsExportingHistory(false);
            }
        }, 100);
    };


    const handleUpdateConfirm = async (updatedData: TDSRepositoryData) => {
        setIsUpdating(true);
        try {
            await onUpdate(updatedData);
            setIsSetupDialogOpen(false);
        } catch (error) {
            console.error("Update failed", error);
        } finally {
            setIsUpdating(false);
        }
    };

    const handlePdfReadyClose = () => {
        setIsPdfReadyOpen(false);
        if (pdfReadyBlobUrl) {
            window.URL.revokeObjectURL(pdfReadyBlobUrl);
            setPdfReadyBlobUrl(null);
        }
        setPdfReadyFilename("");
        setPdfReadySizeBytes(0);
    };

    const handlePdfReadyDownload = () => {
        if (!pdfReadyBlobUrl) return;
        saveUrlAs(pdfReadyBlobUrl, pdfReadyFilename);
        toast({ title: "Success", description: "Report downloaded successfully." });
        handlePdfReadyClose();
    };

    /* The export is a background operation (ADR 0047): this tab follows its own operation's status record, so
       two tabs never swap PDFs, a dropped socket still ends in the download, and a reload picks it up again. */
    const deliverPdf = async (result: unknown, context: unknown, opId: string) => {
        setIsDelivering(true);
        try {
            const { preview: pdf, failedItems } = await deliverTdsExport(opId, result, context);
            setIsExportDialogOpen(false);
            const warning = failedItems.length ? `Some attachments failed: ${failedItems.join(", ")}` : null;
            if (pdf) {
                // Revoke any previous preview blob before replacing it, so back-to-back exports don't leak it.
                setPdfReadyBlobUrl((prev) => {
                    if (prev) window.URL.revokeObjectURL(prev);
                    return pdf.blobUrl;
                });
                setPdfReadyFilename(pdf.filename);
                setPdfReadySizeBytes(pdf.sizeBytes);
                setIsPdfReadyOpen(true);
                toast(warning
                    ? { title: "Ready with warnings", description: warning }
                    : { title: "PDF ready", description: "Preview or download your TDS report." });
            } else {
                toast(warning
                    ? { title: "Exported with warnings", description: warning }
                    : { title: "Success", description: "Report downloaded successfully." });
            }
        } catch (error) {
            console.error("Download failed", error);
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to download report.",
                variant: "destructive",
            });
        } finally {
            setIsDelivering(false);
        }
    };

    const exportOp = useBackgroundOperation({
        storageKey: `tds_export:${projectId}`,
        onFinished: deliverPdf,
        onFailed: (ended) => toast({
            title: ended.phase === "lost" ? "Export stopped" : "Export failed",
            description: ended.error,
            variant: "destructive",
        }),
    });
    const isExporting = isDelivering || ["starting", "queued", "running"].includes(exportOp.view.phase);
    const { percent: exportProgress, message: exportProgressMessage } = exportProgressOf(exportOp.view, isDelivering);

    const handleExportWithItems = async (selectedItems: TdsExportItem[], { previewOnly }: TdsExportOptions) => {
        if (!selectedItems || selectedItems.length === 0) {
            toast({
                title: "No Items Selected",
                description: "Please select at least one item to export.",
                variant: "destructive"
            });
            return;
        }
        const settings = {
            client: { name: data.client.name, logo: typeof data.client.logo === 'string' ? data.client.logo : null, enabled: data.client.enabled },
            projectManager: { name: data.projectManager.name, logo: typeof data.projectManager.logo === 'string' ? data.projectManager.logo : null, enabled: data.projectManager.enabled },
            architect: { name: data.architect.name, logo: typeof data.architect.logo === 'string' ? data.architect.logo : null, enabled: data.architect.enabled },
            consultant: { name: data.consultant.name, logo: typeof data.consultant.logo === 'string' ? data.consultant.logo : null, enabled: data.consultant.enabled },
            gcContractor: { name: data.gcContractor.name, logo: typeof data.gcContractor.logo === 'string' ? data.gcContractor.logo : null, enabled: data.gcContractor.enabled },
            mepContractor: { name: data.mepContractor.name, logo: typeof data.mepContractor.logo === 'string' ? data.mepContractor.logo : null, enabled: data.mepContractor.enabled },
        };
        await exportOp.start(
            "nirmaan_stack.api.tds.tds_report.start_tds_export",
            {
                settings_json: JSON.stringify(settings),
                items_json: JSON.stringify(selectedItems),
                project_name: projectName,
            },
            {
                previewOnly: !!previewOnly,
                fallbackName: tdsExportFallbackName(["TDS_Report", projectName || projectId], new Date()),
            } satisfies TdsExportContext,
        );
    };

    return (
        <div className="p-8 bg-white min-h-full">
            <Card className="mb-8">
                <CardContent className="p-4">
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-8">
                         <div>
                            <h2 className="text-xl font-semibold text-gray-900">Set up TDS Repository</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                These details will appear for all TDS submissions for this project
                            </p>
                         </div>
                         <div className="flex flex-col sm:flex-row gap-2">
                            <Button 
                                onClick={handleExportHistory}
                                variant="outline"
                                disabled={isExportingHistory || !historyData || historyData.length === 0}
                               className="bg-white border-red-500 text-red-700 hover:bg-red-50 font-medium px-4 shadow-sm"
                            >
                                {isExportingHistory ? (
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                    <Download className="w-4 h-4 mr-2" />
                                )}
                                {isExportingHistory ? 'Exporting...' : 'Download TDS CSV'}
                            </Button>
                            <Button 
                                onClick={handleOpenExportDialog}
                                variant="outline"
                                disabled={isExporting || !historyData || historyData.length === 0}
                                className="bg-white border-red-500 text-red-700 hover:bg-red-50 font-medium px-4 shadow-sm"
                            >
                                {isExporting ? (
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                    <Download className="w-4 h-4 mr-2" />
                                )}
                                {isExporting ? 'Exporting...' : 'Download TDS PDF'}
                            </Button>
                            {canEditTDS && (
                                <Button 
                                    onClick={() => setIsSetupDialogOpen(true)} 
                                    variant="outline"
                                    className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50 font-medium px-4 shadow-sm"
                                >
                                    Edit Details
                                </Button>
                            )}
                         </div>
                    </div>

                    {/* Read-Only Summary Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        <ViewCard label="Client" name={data.client.name} logo={data.client.logo} enabled={data.client.enabled} />
                        <ViewCard label="Project Manager" name={data.projectManager.name} logo={data.projectManager.logo} enabled={data.projectManager.enabled} />
                        <ViewCard label="Architect" name={data.architect.name} logo={data.architect.logo} enabled={data.architect.enabled} />
                        <ViewCard label="Consultant" name={data.consultant.name} logo={data.consultant.logo} enabled={data.consultant.enabled} />
                        <ViewCard label="GC Contractor" name={data.gcContractor.name} logo={data.gcContractor.logo} enabled={data.gcContractor.enabled} />
                        <ViewCard label="MEP Contractor" name={data.mepContractor.name} logo={data.mepContractor.logo} enabled={data.mepContractor.enabled} />
                    </div>
                </CardContent>
            </Card>

            {/* TDS Item Management: the table tabs, or the request form in their place */}
            <div className="mt-12">
                <div className={isFormOpen ? 'hidden' : 'block'}>
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as HistoryTab)} className="w-full">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
                            <TabsList className="inline-flex p-0 bg-white border border-gray-200 rounded-md overflow-hidden">
                                {HISTORY_TABS.map(tab => (
                                    <TabsTrigger
                                        key={tab.value}
                                        value={tab.value}
                                        className="group rounded-none px-6 py-2 text-sm font-medium data-[state=active]:bg-red-600 data-[state=active]:text-white bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900 shadow-none border-r border-gray-100 last:border-r-0 transition-colors"
                                    >
                                        {tab.label}
                                        <span
                                            data-testid={`tds-tab-count-${tab.value}`}
                                            className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 group-data-[state=active]:bg-white/20 group-data-[state=active]:text-white"
                                        >
                                            {(tabCounts?.message?.[tab.value] as number | undefined) ?? 0}
                                        </span>
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                            <Button
                                onClick={() => setIsFormOpen(true)}
                                className="bg-red-600 hover:bg-red-700 text-white font-medium px-4 shadow-sm"
                            >
                                <Plus className="w-4 h-4 mr-2" />
                                Create New Request
                            </Button>
                        </div>
                        {HISTORY_TABS.map(tab => (
                            <TabsContent key={tab.value} value={tab.value} className="mt-0">
                                <TdsHistoryTable
                                    projectId={projectId}
                                    tab={tab.value}
                                    refreshTrigger={refreshKey}
                                    onDataChange={() => setRefreshKey(prev => prev + 1)}
                                    onClientStatusChange={handleClientStatusChange}
                                />
                            </TabsContent>
                        ))}
                    </Tabs>
                </div>

                {/* The form stays mounted while hidden: its saved-draft prompt opens on mount, so it
                    can be answered from TDS History, and resuming must bring the form into view. */}
                <div className={isFormOpen ? 'block' : 'hidden'}>
                    <Button
                        variant="ghost"
                        onClick={() => setIsFormOpen(false)}
                        className="mb-4 px-2 text-gray-600 hover:text-gray-900"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to TDS History
                    </Button>
                    <TdsCreateForm
                        key={refreshKey}
                        projectId={projectId}
                        onSuccess={() => {
                            setIsFormOpen(false);
                            setActiveTab('history');
                            setRefreshKey(prev => prev + 1);
                        }}
                        onDraftResumed={() => setIsFormOpen(true)}
                        onOpenRejectedByClient={() => {
                            setIsFormOpen(false);
                            setActiveTab('rejectedByClient');
                        }}
                    />
                </div>
            </div>

            {/* Edit Dialog */}
            <SetupTDSRepositoryDialog
                isOpen={isSetupDialogOpen}
                onClose={() => setIsSetupDialogOpen(false)}
                onConfirm={handleUpdateConfirm}
                initialData={data} 
                isLoading={isUpdating}
            />

            {/* Export Dialog */}
            <TdsExportDialog
                key={exportDialogKey}
                isOpen={isExportDialogOpen}
                onClose={() => setIsExportDialogOpen(false)}
                onExport={handleExportWithItems}
                settings={data}
                historyData={historyData ?? []}
                isExporting={isExporting}
                defaultStatuses={PDF_DEFAULT_STATUSES.tdsPage}
            />

            {/* PDF Ready Dialog (preview-only exports) */}
            <TdsPdfReadyDialog
                isOpen={isPdfReadyOpen}
                onClose={handlePdfReadyClose}
                onDownload={handlePdfReadyDownload}
                blobUrl={pdfReadyBlobUrl}
                filename={pdfReadyFilename}
                sizeBytes={pdfReadySizeBytes}
                canDownload={isAdmin}
            />

            {/* Progress Dialog */}
            <Dialog open={isExporting}>
                <DialogContent
                    className="sm:max-w-md w-[28rem] max-w-[28rem] [&>button]:hidden"
                    onPointerDownOutside={(e) => e.preventDefault()}
                    onEscapeKeyDown={(e) => e.preventDefault()}
                >
                    <DialogHeader>
                        <DialogTitle>Generating TDS PDF Report</DialogTitle>
                        <DialogDescription>
                            Please wait while we gather and merge your documents.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col items-stretch space-y-4 py-4">
                        <div className="w-full bg-secondary h-4 rounded-full overflow-hidden">
                            <div
                                className="bg-primary h-full transition-all duration-300 ease-in-out"
                                style={{ width: `${exportProgress}%` }}
                            />
                        </div>
                        {/* Reserve two lines of space + clamp long item names so the dialog
                            doesn't grow/shrink between updates. */}
                        <p
                            className="text-sm text-muted-foreground break-words line-clamp-2 min-h-[2.5rem]"
                            title={`${exportProgress}% - ${exportProgressMessage}`}
                        >
                            {exportProgress}% - {exportProgressMessage}
                        </p>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

/** What the progress dialog says for the export's state: queued apart from running, then the record's progress. */
function exportProgressOf(view: OpView, isDelivering: boolean): { percent: number; message: string } {
    if (isDelivering) return { percent: 100, message: "Downloading the PDF..." };
    switch (view.phase) {
        case "starting": return { percent: 0, message: "Starting export..." };
        case "queued": return { percent: 0, message: "Waiting in the queue for a free worker..." };
        case "running": return { percent: view.progress?.percent ?? 0, message: view.progress?.message ?? "Running..." };
        default: return { percent: 0, message: "" };
    }
}
