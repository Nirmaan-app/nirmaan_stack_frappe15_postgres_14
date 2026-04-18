import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Download, Loader2 } from 'lucide-react';
import { FrappeContext, FrappeConfig } from 'frappe-react-sdk';
import { useTdsHistoryItems, useProjectDoc } from '../data/tds/useTdsQueries';
import { format } from 'date-fns';
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { SetupTDSRepositoryDialog, TDSRepositoryData, ViewCard, TdsCreateForm, TdsHistoryTable, TdsExportDialog } from './components';

interface TDSRepositoryViewProps {
    data: TDSRepositoryData;
    projectId: string;
    onUpdate: (data: TDSRepositoryData) => Promise<void>;
}

export const TDSRepositoryView: React.FC<TDSRepositoryViewProps> = ({ data, projectId, onUpdate }) => {
    const { role } = useUserData();
    const canEditTDS = role !== "Nirmaan Procurement Executive Profile";

    const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [activeTab, setActiveTab] = useState("history");
    const [refreshKey, setRefreshKey] = useState(0);
    const [isExporting, setIsExporting] = useState(false);
    const [isExportingHistory, setIsExportingHistory] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [exportProgressMessage, setExportProgressMessage] = useState("");
    const [isConvertingToA4, setIsConvertingToA4] = useState(false);
    const { socket } = React.useContext(FrappeContext) as FrappeConfig;

    // Remove the useEffect listener as we'll manage it in the handler like Bulk Download


    // Fetch TDS history data directly for export
    const { data: historyData } = useTdsHistoryItems(projectId);

    const { data: projectData } = useProjectDoc(projectId);
    const projectName = projectData?.project_name || projectId;

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
                    "Doc",
                    "Created On"
                ];

                // Map data to CSV rows
                const rows = historyData.map((item: any) => [
                    item.tds_request_id || "",
                    item.tds_work_package || "",
                    item.tds_category || "",
                    item.tds_item_id || "",
                    item.tds_item_name || "",
                    (item.tds_description || "").replace(/,/g, ";"), // Escape commas
                    item.tds_make || "",
                    item.tds_boq_line_item || "",
                    item.tds_status || "",
                    (item.tds_rejection_reason || "").replace(/,/g, ";"),
                    item.tds_attachment || "",
                    item.creation ? format(new Date(item.creation), "dd-MMM-yyyy HH:mm") : ""
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

    // Export handler — enqueues a backend worker, then awaits Socket.IO events
    // (tds_export_progress / tds_export_ready / tds_export_failed) to drive the
    // progress UI and trigger the final download.
    const handleExportWithItems = async (selectedItems: any[]) => {
        if (!selectedItems || selectedItems.length === 0) {
            toast({
                title: "No Items Selected",
                description: "Please select at least one item to export.",
                variant: "destructive"
            });
            return;
        }

        if (!socket) {
            toast({
                title: "Connection not ready",
                description: "Live connection unavailable. Please retry in a moment.",
                variant: "destructive"
            });
            return;
        }

        setIsExporting(true);
        setExportProgress(0);
        setExportProgressMessage("Queueing export...");

        const cleanup = () => {
            socket.off("tds_export_progress");
            socket.off("tds_export_ready");
            socket.off("tds_export_failed");
        };

        // Progress from the worker (via merge_pdfs_interleaved)
        socket.on("tds_export_progress", (d: any) => {
            if (d.progress !== undefined) setExportProgress(d.progress);
            if (d.message) setExportProgressMessage(d.message);
            if (d.status === "converting") setIsConvertingToA4(true);
            if (d.status === "completed") setIsConvertingToA4(false);
        });

        // Completion — fetch the temp file by token and trigger download
        socket.on("tds_export_ready", async ({ token, filename, failed_items }: any) => {
            try {
                const dateStr = format(new Date(), "dd-MMM-yyyy");
                const cleanProjectName = (projectName || projectId).replace(/[^a-zA-Z0-9-_]/g, "_");
                const fallbackName = `TDS_Report_${cleanProjectName}_${dateStr}.pdf`;
                const finalName = filename || fallbackName;

                const url =
                    `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.fetch_temp_file` +
                    `?token=${encodeURIComponent(token)}&filename=${encodeURIComponent(finalName)}`;

                const resp = await fetch(url, {
                    method: "GET",
                    headers: { "X-Frappe-CSRF-Token": (window as any).csrf_token || "" },
                });
                if (!resp.ok) throw new Error("Failed to fetch generated PDF");
                const blob = await resp.blob();

                const objectUrl = window.URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = objectUrl;
                link.setAttribute("download", finalName);
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.URL.revokeObjectURL(objectUrl);

                setIsExportDialogOpen(false);
                if (failed_items && failed_items.length) {
                    toast({
                        title: "Exported with warnings",
                        description: `Some attachments failed: ${failed_items.join(", ")}`,
                    });
                } else {
                    toast({ title: "Success", description: "Report downloaded successfully." });
                }
            } catch (error: any) {
                console.error("Download failed", error);
                toast({
                    title: "Error",
                    description: error.message || "Failed to download report.",
                    variant: "destructive",
                });
            } finally {
                setIsExporting(false);
                setIsConvertingToA4(false);
                cleanup();
            }
        });

        socket.on("tds_export_failed", ({ message }: any) => {
            toast({
                title: "Export failed",
                description: message || "Please retry.",
                variant: "destructive",
            });
            setIsExporting(false);
            setIsConvertingToA4(false);
            cleanup();
        });

        try {
            // Same settings payload as before
            const settings = {
                client: { name: data.client.name, logo: typeof data.client.logo === 'string' ? data.client.logo : null, enabled: data.client.enabled },
                projectManager: { name: data.projectManager.name, logo: typeof data.projectManager.logo === 'string' ? data.projectManager.logo : null, enabled: data.projectManager.enabled },
                architect: { name: data.architect.name, logo: typeof data.architect.logo === 'string' ? data.architect.logo : null, enabled: data.architect.enabled },
                consultant: { name: data.consultant.name, logo: typeof data.consultant.logo === 'string' ? data.consultant.logo : null, enabled: data.consultant.enabled },
                gcContractor: { name: data.gcContractor.name, logo: typeof data.gcContractor.logo === 'string' ? data.gcContractor.logo : null, enabled: data.gcContractor.enabled },
                mepContractor: { name: data.mepContractor.name, logo: typeof data.mepContractor.logo === 'string' ? data.mepContractor.logo : null, enabled: data.mepContractor.enabled },
            };

            const resp = await fetch('/api/method/nirmaan_stack.api.tds.tds_report.export_tds_report', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Frappe-CSRF-Token': (window as any).csrf_token || ''
                },
                body: JSON.stringify({
                    settings_json: JSON.stringify(settings),
                    items_json: JSON.stringify(selectedItems),
                    project_name: projectName,
                }),
            });

            if (!resp.ok) throw new Error("Failed to queue export");
            toast({
                title: "Export queued",
                description: "We'll download the PDF automatically when it's ready.",
            });
        } catch (error: any) {
            console.error("Enqueue failed", error);
            toast({
                title: "Error",
                description: error.message || "Failed to queue export.",
                variant: "destructive",
            });
            setIsExporting(false);
            setIsConvertingToA4(false);
            cleanup();
        }
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
                                onClick={() => setIsExportDialogOpen(true)}
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

            {/* TDS Item Management Tabs */}
            <div className="mt-12">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="inline-flex p-0 bg-white border border-gray-200 rounded-md overflow-hidden mb-6">
                        <TabsTrigger
                            value="history"
                            className="rounded-none px-6 py-2 text-sm font-medium data-[state=active]:bg-red-600 data-[state=active]:text-white bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900 shadow-none border-r border-gray-100 last:border-r-0 transition-colors"
                        >
                            TDS History
                        </TabsTrigger>
                        <TabsTrigger
                            value="new"
                            className="rounded-none px-6 py-2 text-sm font-medium data-[state=active]:bg-red-600 data-[state=active]:text-white bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900 shadow-none border-r border-gray-100 last:border-r-0 transition-colors"
                        >
                            New Request
                        </TabsTrigger>
                    </TabsList>

                    <div className="mt-6">
                        <div className={activeTab === 'new' ? 'block' : 'hidden'}>
                            <TdsCreateForm 
                                key={refreshKey}
                                projectId={projectId} 
                                onSuccess={() => {
                                    setActiveTab('history');
                                    setRefreshKey(prev => prev + 1);
                                }} 
                            />
                        </div>
                        <div className={activeTab === 'history' ? 'block' : 'hidden'}>
                            <TdsHistoryTable 
                                projectId={projectId} 
                                refreshTrigger={refreshKey}
                                onDataChange={() => setRefreshKey(prev => prev + 1)}
                            />
                        </div>
                    </div>
                </Tabs>
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
                isOpen={isExportDialogOpen}
                onClose={() => setIsExportDialogOpen(false)}
                onExport={handleExportWithItems}
                settings={data}
                historyData={historyData || []}
                isExporting={isExporting}
            />

            {/* Progress Dialog */}
            <Dialog open={isExporting} onOpenChange={(open) => !isExporting && setIsExporting(open)}>
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
                        {/* Reserve a fixed slot for the A4 indicator so the dialog stays the
                            same height whether it's visible or not. */}
                        <div className="h-5 flex items-center justify-center">
                            {isConvertingToA4 && (
                                <div className="flex items-center text-xs text-red-600 font-medium animate-pulse">
                                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                                    Converting attachment to A4...
                                </div>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};
