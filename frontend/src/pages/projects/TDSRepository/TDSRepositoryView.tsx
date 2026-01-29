import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from 'lucide-react';
import { useFrappeGetDocList, useFrappeGetDoc } from 'frappe-react-sdk';
import { format } from 'date-fns';
import { toast } from "@/components/ui/use-toast";
import { SetupTDSRepositoryDialog, TDSRepositoryData, ViewCard, TdsCreateForm, TdsHistoryTable, TdsExportDialog } from './components';

interface TDSRepositoryViewProps {
    data: TDSRepositoryData;
    projectId: string;
    onUpdate: (data: TDSRepositoryData) => Promise<void>;
}

export const TDSRepositoryView: React.FC<TDSRepositoryViewProps> = ({ data, projectId, onUpdate }) => {
    const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [activeTab, setActiveTab] = useState("new");
    const [refreshKey, setRefreshKey] = useState(0);
    const [isExporting, setIsExporting] = useState(false);
    const [isExportingHistory, setIsExportingHistory] = useState(false);

    // Fetch TDS history data directly for export
    const { data: historyData } = useFrappeGetDocList("Project TDS Item List", {
        fields: ["*"],
        filters: [["tdsi_project_id", "=", projectId]],
        limit: 0  // Fetch all records
    });

    const { data: projectData } = useFrappeGetDoc("Projects", projectId);
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

    // Export handler - processes selected items from export dialog
    const handleExportWithItems = async (selectedItems: any[]) => {
        if (!selectedItems || selectedItems.length === 0) {
            toast({ 
                title: "No Items Selected", 
                description: "Please select at least one item to export.", 
                variant: "destructive" 
            });
            return;
        }

        setIsExporting(true);
        try {
            toast({ 
                title: "Generating PDF...", 
                description: "Please wait while we prepare your report." 
            });

            // Prepare settings object
            const settings = {
                client: { name: data.client.name, logo: typeof data.client.logo === 'string' ? data.client.logo : null },
                projectManager: { name: data.projectManager.name, logo: typeof data.projectManager.logo === 'string' ? data.projectManager.logo : null },
                architect: { name: data.architect.name, logo: typeof data.architect.logo === 'string' ? data.architect.logo : null },
                consultant: { name: data.consultant.name, logo: typeof data.consultant.logo === 'string' ? data.consultant.logo : null },
                gcContractor: { name: data.gcContractor.name, logo: typeof data.gcContractor.logo === 'string' ? data.gcContractor.logo : null },
                mepContractor: { name: data.mepContractor.name, logo: typeof data.mepContractor.logo === 'string' ? data.mepContractor.logo : null },
            };

            // Call custom API that merges attachments interleaved
            const response = await fetch('/api/method/nirmaan_stack.api.tds.tds_report.export_tds_report', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Frappe-CSRF-Token': (window as any).csrf_token || ''
                },
                body: JSON.stringify({
                    settings_json: JSON.stringify(settings),
                    items_json: JSON.stringify(selectedItems),
                    project_name: projectName
                })
            });

            if (!response.ok) throw new Error("Failed to generate PDF");
            const blob = await response.blob();

            // Generate filename with project Name and date
            const dateStr = format(new Date(), "dd-MMM-yyyy");
            const cleanProjectName = (projectName || projectId).replace(/[^a-zA-Z0-9-_]/g, '_');
            const fileName = `TDS_Report_${cleanProjectName}_${dateStr}.pdf`;

            // Download the file
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', fileName);
            document.body.appendChild(link);
            link.click();

            link.remove();
            window.URL.revokeObjectURL(url);

            setIsExportDialogOpen(false);
            toast({ 
                title: "Success", 
                description: "Report downloaded successfully." 
            });
        } catch (error) {
            console.error("Export failed", error);
            toast({ 
                title: "Error", 
                description: "Failed to download report.", 
                variant: "destructive" 
            });
        } finally {
            setIsExporting(false);
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
                                <Download className="w-4 h-4 mr-2" />
                                {isExportingHistory ? 'Exporting...' : 'Export TDS History'}
                            </Button>
                            <Button 
                                onClick={() => setIsExportDialogOpen(true)}
                                variant="outline"
                                disabled={isExporting || !historyData || historyData.length === 0}
                                className="bg-white border-red-500 text-red-700 hover:bg-red-50 font-medium px-4 shadow-sm"
                            >
                                <Download className="w-4 h-4 mr-2" />
                                {isExporting ? 'Exporting...' : 'Export TDS'}
                            </Button>
                            <Button 
                                onClick={() => setIsSetupDialogOpen(true)} 
                                variant="outline"
                                className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50 font-medium px-4 shadow-sm"
                            >
                                Edit Details
                            </Button>
                         </div>
                    </div>

                    {/* Read-Only Summary Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        <ViewCard label="Client" name={data.client.name} logo={data.client.logo} />
                        <ViewCard label="Project Manager" name={data.projectManager.name} logo={data.projectManager.logo} />
                        <ViewCard label="Architect" name={data.architect.name} logo={data.architect.logo} />
                        <ViewCard label="Consultant" name={data.consultant.name} logo={data.consultant.logo} />
                        <ViewCard label="GC Contractor" name={data.gcContractor.name} logo={data.gcContractor.logo} />
                        <ViewCard label="MEP Contractor" name={data.mepContractor.name} logo={data.mepContractor.logo} />
                    </div>
                </CardContent>
            </Card>

            {/* TDS Item Management Tabs */}
            <div className="mt-12">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="inline-flex p-0 bg-white border border-gray-200 rounded-md overflow-hidden mb-6">
                        <TabsTrigger 
                            value="new"
                            className="rounded-none px-6 py-2 text-sm font-medium data-[state=active]:bg-red-600 data-[state=active]:text-white bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900 shadow-none border-r border-gray-100 last:border-r-0 transition-colors"
                        >
                            New Request
                        </TabsTrigger>
                        <TabsTrigger 
                            value="history"
                            className="rounded-none px-6 py-2 text-sm font-medium data-[state=active]:bg-red-600 data-[state=active]:text-white bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900 shadow-none border-r border-gray-100 last:border-r-0 transition-colors"
                        >
                            TDS History
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
        </div>
    );
};
