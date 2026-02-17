import React, { useState, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Ban, FileDown, ExternalLink, Loader2 } from 'lucide-react';
import { TDSRepositoryData } from './SetupTDSRepositoryDialog';

interface TdsExportItem {
    name: string;
    tds_request_id: string;
    tds_work_package: string;
    tds_category: string;
    tds_item_name: string;
    tds_description: string;
    tds_make: string;
    tds_attachment?: string;
    tds_status: string;
}

interface TdsExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onExport: (selectedItems: TdsExportItem[]) => void;
    settings: TDSRepositoryData;
    historyData: TdsExportItem[];
    isExporting: boolean;
}

// Mini stakeholder card for the dialog
const MiniStakeholderCard: React.FC<{ label: string; name: string; logo?: string | File | null }> = ({ label, name, logo }) => {
    const logoUrl = typeof logo === 'string' ? logo : null;
    
    return (
        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <div className="w-10 h-10 bg-white rounded-md border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoUrl ? (
                    <img src={logoUrl} alt={name} className="w-full h-full object-contain" />
                ) : (
                    <div className="w-full h-full bg-gray-100" />
                )}
            </div>
            <div className="min-w-0">
                <p className="text-[10px] text-gray-500 uppercase font-medium">{label}</p>
                <p className="text-sm font-semibold text-gray-900 truncate">{name || '-'}</p>
            </div>
        </div>
    );
};

export const TdsExportDialog: React.FC<TdsExportDialogProps> = ({
    isOpen,
    onClose,
    onExport,
    settings,
    historyData,
    isExporting
}) => {
    // Filter only approved items
    const approvedItems = useMemo(() => {
        return historyData.filter(item => item.tds_status === 'Approved');
    }, [historyData]);

    // Track selected items
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(approvedItems.map(item => item.name)));

    // Reset selection when dialog opens
    React.useEffect(() => {
        if (isOpen) {
            setSelectedIds(new Set(approvedItems.map(item => item.name)));
        }
    }, [isOpen, approvedItems]);

    const handleToggleItem = (itemName: string) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(itemName)) {
                newSet.delete(itemName);
            } else {
                newSet.add(itemName);
            }
            return newSet;
        });
    };

    const handleSelectAll = () => {
        setSelectedIds(new Set(approvedItems.map(item => item.name)));
    };

    const handleDeselectAll = () => {
        setSelectedIds(new Set());
    };

    const handleExport = () => {
        const selectedItems = approvedItems.filter(item => selectedIds.has(item.name));
        onExport(selectedItems);
    };

    const isAllSelected = selectedIds.size === approvedItems.length && approvedItems.length > 0;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader className="flex-shrink-0">
                    <DialogTitle className="text-lg font-semibold">Confirm TDS Export</DialogTitle>
                    <p className="text-sm text-gray-500">Review TDS setup details and select items to include in the export PDF.</p>
                </DialogHeader>



                <div className="flex-1 overflow-y-auto">
                    {/* TDS Setup Section */}
                    <div className="mb-6">
                        {/* <div className="flex items-center justify-between mb-3">
                            <div>
                                <h3 className="text-sm font-semibold text-gray-900">TDS Setup</h3>
                                <p className="text-xs text-gray-500">These details will appear for all TDS submissions for this project</p>
                            </div>
                            <Button variant="outline" size="sm" onClick={onClose}>
                                Edit Details
                            </Button>
                        </div> */}
                        <div className="grid grid-cols-3 gap-3">
                            <MiniStakeholderCard label="Client" name={settings.client.name} logo={settings.client.logo} />
                            <MiniStakeholderCard label="Project Manager" name={settings.projectManager.name} logo={settings.projectManager.logo} />
                            <MiniStakeholderCard label="Consultant" name={settings.consultant.name} logo={settings.consultant.logo} />
                            <MiniStakeholderCard label="Architect" name={settings.architect.name} logo={settings.architect.logo} />
                            <MiniStakeholderCard label="GC Contractor" name={settings.gcContractor.name} logo={settings.gcContractor.logo} />
                            <MiniStakeholderCard label="MEP Contractor" name={settings.mepContractor.name} logo={settings.mepContractor.logo} />
                        </div>
                    </div>

                    {/* Items Selection Section */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-gray-900">Items to export</h3>
                                <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                                    {selectedIds.size}/{approvedItems.length} Selected
                                </span>
                            </div>
                            <Button 
                                variant="outline" 
                                size="sm"
                                onClick={isAllSelected ? handleDeselectAll : handleSelectAll}
                            >
                                {isAllSelected ? 'De-Select All' : 'Select All'}
                            </Button>
                        </div>

                        {approvedItems.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
                                No approved items to export.
                            </div>
                        ) : (
                            <div className="border rounded-lg">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr className="border-b">
                                            <th className="w-10 p-3"></th>
                                            <th className="text-left p-3 font-medium text-gray-600">Work Package</th>
                                            <th className="text-left p-3 font-medium text-gray-600">Category</th>
                                            <th className="text-left p-3 font-medium text-gray-600">Item Name</th>
                                            <th className="text-left p-3 font-medium text-gray-600">Description</th>
                                            <th className="text-left p-3 font-medium text-gray-600">Make</th>
                                            <th className="w-24 text-left p-3 font-medium text-gray-600">Attached Doc.</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {approvedItems.map((item) => (
                                            <tr 
                                                key={item.name} 
                                                className="border-b hover:bg-gray-50 cursor-pointer"
                                                onClick={() => handleToggleItem(item.name)}
                                            >
                                                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                                    <Checkbox 
                                                        checked={selectedIds.has(item.name)}
                                                        onCheckedChange={() => handleToggleItem(item.name)}
                                                        className="data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600"
                                                    />
                                                </td>
                                                <td className="p-3 text-gray-900">{item.tds_work_package || '-'}</td>
                                                <td className="p-3 text-gray-700">{item.tds_category || '-'}</td>
                                                <td className="p-3 text-gray-900">{item.tds_item_name || '-'}</td>
                                                <td className="p-3 text-gray-500 max-w-[150px] truncate">{item.tds_description || '-'}</td>
                                                <td className="p-3 text-gray-700">{item.tds_make || '-'}</td>
                                                <td className="p-3">
                                                    {item.tds_attachment ? (
                                                        <a 
                                                            href={item.tds_attachment} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="text-gray-500 hover:text-red-600"
                                                        >
                                                            <ExternalLink className="w-4 h-4" />
                                                        </a>
                                                    ) : (
                                                        <span className="text-gray-300">-</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter className="flex-shrink-0 flex justify-end gap-3 mt-4 pt-4 border-t">
                    <Button 
                        variant="outline" 
                        onClick={onClose}
                        disabled={isExporting}
                    >
                        <Ban className="w-4 h-4 mr-2" />
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleExport}
                        disabled={selectedIds.size === 0 || isExporting}
                        className="bg-red-600 hover:bg-red-700 text-white"
                    >
                        {isExporting ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Exporting...
                            </>
                        ) : (
                            <>
                                <FileDown className="w-4 h-4 mr-2" />
                                Export PDF
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
