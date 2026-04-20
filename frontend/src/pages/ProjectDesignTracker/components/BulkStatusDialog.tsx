// frontend/src/pages/ProjectDesignTracker/components/BulkStatusDialog.tsx

import React, { useMemo, useState } from 'react';
import { DesignTrackerTask } from '../types';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ReactSelect from 'react-select';
import { TailSpin } from 'react-loader-spinner';
import { Tag, AlertTriangle } from 'lucide-react';
import { TASK_STATUS_OPTIONS, SUB_STATUS_MAP, SUB_STATUS_OPTIONS } from '../hooks/useDesignMasters';

interface StatusOption {
    label: string;
    value: string;
}

interface BulkStatusDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    selectedTasks: DesignTrackerTask[];
    onBulkStatus: (payload: {
        taskNames: string[];
        taskStatus: string;
        taskSubStatus?: string;
    }) => Promise<void>;
}

export const BulkStatusDialog: React.FC<BulkStatusDialogProps> = ({
    isOpen,
    onOpenChange,
    selectedTasks,
    onBulkStatus,
}) => {
    const [selectedStatus, setSelectedStatus] = useState<StatusOption | null>(null);
    const [subStatusDropdown, setSubStatusDropdown] = useState<StatusOption | null>(null);
    const [subStatusText, setSubStatusText] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setSelectedStatus(null);
            setSubStatusDropdown(null);
            setSubStatusText('');
        }
        onOpenChange(open);
    };

    const statusValue = selectedStatus?.value;

    const isClarification = statusValue === 'Clarification Awaiting';
    const isRevision = statusValue === 'Revision Pending';
    const isSubmitted = statusValue === 'Submitted';
    const isApproved = statusValue === 'Approved';
    const isNotApplicable = statusValue === 'Not Applicable';

    // Sub-status dropdown options for Clarification Awaiting
    const clarificationSubStatusOptions = useMemo(() => {
        const allowed = SUB_STATUS_MAP['Clarification Awaiting'];
        if (!Array.isArray(allowed)) return [];
        return SUB_STATUS_OPTIONS.filter(opt => allowed.includes(opt.value));
    }, []);

    // Validity
    const isValid = useMemo(() => {
        if (!statusValue) return false;
        if (isClarification && !subStatusDropdown) return false;
        if (isRevision && !subStatusText.trim()) return false;
        return true;
    }, [statusValue, isClarification, isRevision, subStatusDropdown, subStatusText]);

    const handleApply = async () => {
        if (!isValid || !statusValue) return;
        setIsSaving(true);
        try {
            let subStatus: string | undefined;
            if (isClarification) subStatus = subStatusDropdown?.value;
            else if (isRevision) subStatus = subStatusText.trim();

            await onBulkStatus({
                taskNames: selectedTasks.map(t => t.name),
                taskStatus: statusValue,
                taskSubStatus: subStatus,
            });
            handleOpenChange(false);
        } catch {
            // Error handled by parent
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg overflow-visible">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                        <Tag className="h-4 w-4" />
                        Bulk Update Status
                    </DialogTitle>
                    <p className="text-xs text-gray-500 mt-1">
                        Applying status to <span className="font-semibold">{selectedTasks.length}</span> task(s).
                    </p>
                </DialogHeader>

                <div className="grid gap-3 py-3">
                    {/* Status */}
                    <div className="space-y-1">
                        <Label htmlFor="bulk_status">Status</Label>
                        <ReactSelect
                            inputId="bulk_status"
                            options={TASK_STATUS_OPTIONS}
                            value={selectedStatus}
                            onChange={(opt) => {
                                setSelectedStatus(opt as StatusOption | null);
                                setSubStatusDropdown(null);
                                setSubStatusText('');
                            }}
                            placeholder="Select status..."
                            classNamePrefix="react-select"
                        />
                    </div>

                    {/* Sub Status */}
                    {isClarification && (
                        <div className="space-y-1">
                            <Label htmlFor="bulk_sub_status">Sub Status <span className="text-red-500">*</span></Label>
                            <ReactSelect
                                inputId="bulk_sub_status"
                                options={clarificationSubStatusOptions}
                                value={subStatusDropdown}
                                onChange={(opt) => setSubStatusDropdown(opt as StatusOption | null)}
                                placeholder="Select sub-status..."
                                classNamePrefix="react-select"
                            />
                        </div>
                    )}

                    {isRevision && (
                        <div className="space-y-1">
                            <Label htmlFor="bulk_sub_status_text">Sub Status (Custom) <span className="text-red-500">*</span></Label>
                            <Input
                                id="bulk_sub_status_text"
                                type="text"
                                value={subStatusText}
                                onChange={(e) => setSubStatusText(e.target.value)}
                                placeholder="Enter custom sub-status..."
                            />
                        </div>
                    )}

                    {/* Warning for Submitted / Approved — evidence skipped in bulk */}
                    {(isSubmitted || isApproved) && (
                        <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 border border-red-200">
                            <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                            <div className="text-xs text-red-700 leading-snug">
                                <p className="font-semibold mb-1">Evidence check will be skipped</p>
                                <p>
                                    {isSubmitted
                                        ? 'Design file link will NOT be required for these tasks.'
                                        : 'Approval proof will NOT be required for these tasks.'}{' '}
                                    Please add evidence per task afterwards.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Info for Not Applicable — deadline clears */}
                    {isNotApplicable && (
                        <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200">
                            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-700 leading-snug">
                                Deadlines will be cleared for these tasks.
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <DialogClose asChild>
                        <Button variant="outline" size="sm" disabled={isSaving}>Cancel</Button>
                    </DialogClose>
                    <Button
                        size="sm"
                        onClick={handleApply}
                        disabled={!isValid || isSaving}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {isSaving ? (
                            <TailSpin width={14} height={14} color="white" />
                        ) : (
                            <>Apply to {selectedTasks.length} Task{selectedTasks.length === 1 ? '' : 's'}</>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
