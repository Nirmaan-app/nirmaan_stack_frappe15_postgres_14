// frontend/src/pages/ProjectDesignTracker/components/TaskEditModal.tsx

import React, { useCallback, useMemo, useState } from 'react';
import { useFrappeFileUpload } from 'frappe-react-sdk';
import { DesignTrackerTask, User, AssignedDesignerDetail } from '../types';
import { parseDesignersFromField } from '../utils';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CustomAttachment, AcceptedFileType } from '@/components/helpers/CustomAttachment';
import ReactSelect from 'react-select';
import SITEURL from '@/constants/siteURL';
import {
    Save,
    FileText,
    ExternalLink,
    Trash2,
    Loader2,
    AlertTriangle,
    X as XIcon,
    Paperclip,
} from 'lucide-react';
import { SUB_STATUS_MAP } from '../hooks/useDesignMasters';

interface DesignerOption {
    value: string;
    label: string;
    email: string;
}

interface StatusOption {
    label: string;
    value: string;
}

interface TaskEditModalProps {
    task: DesignTrackerTask;
    onSave: (updatedTask: { [key: string]: any }) => Promise<void>;
    usersList: User[];
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    statusOptions: StatusOption[];
    subStatusOptions: StatusOption[];
    existingTaskNames: string[];
    disableTaskNameEdit?: boolean;
    isRestrictedMode?: boolean;
}

type ApprovalAction = 'keep' | 'replace' | 'remove';
const APPROVAL_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf"];

export const TaskEditModal: React.FC<TaskEditModalProps> = ({
    task,
    onSave,
    usersList,
    isOpen,
    onOpenChange,
    statusOptions,
    subStatusOptions,
    existingTaskNames,
    disableTaskNameEdit = false,
    isRestrictedMode = false
}) => {

    const [selectedDesigners, setSelectedDesigners] = useState<DesignerOption[]>([]);
    const [editState, setEditState] = useState<Partial<DesignTrackerTask>>({});
    const [isSaving, setIsSaving] = useState(false);

    // Approval proof state
    const [approvalFile, setApprovalFile] = useState<File | null>(null);
    const [existingApprovalUrl, setExistingApprovalUrl] = useState<string | undefined>(undefined);
    const [approvalAction, setApprovalAction] = useState<ApprovalAction>('keep');
    const [isUploading, setIsUploading] = useState(false);
    const { upload } = useFrappeFileUpload();

    const designerOptions: DesignerOption[] = useMemo(() =>
        usersList.map(u => ({ label: u.full_name || u.name, value: u.name, email: u.email || '' }))
    , [usersList]);

    // Check if current status requires custom text input for substatus
    const requiresCustomSubStatus = useMemo(() => {
        const currentStatus = editState.task_status;
        const allowedValues = SUB_STATUS_MAP[currentStatus as keyof typeof SUB_STATUS_MAP];
        return allowedValues === "__CUSTOM_TEXT__";
    }, [editState.task_status]);

     const allowedSubStatuses = useMemo(() => {
        const currentStatus = editState.task_status;
        const allowedValues = SUB_STATUS_MAP[currentStatus as keyof typeof SUB_STATUS_MAP];

        if (allowedValues === "__CUSTOM_TEXT__") {
            return [];
        }

        if (!allowedValues || allowedValues.length === 0) {
            return subStatusOptions.filter(opt => opt.value === "");
        }
        return subStatusOptions.filter(opt =>
            opt.value === "" || allowedValues.includes(opt.value)
        );
    }, [editState.task_status, subStatusOptions]);

    // Initialize state when dialog opens
    React.useEffect(() => {
        if (isOpen) {
            const designerDetails = parseDesignersFromField(task.assigned_designers);
            const initialDesigners = designerDetails.map(stored =>
                designerOptions.find(opt => opt.value === stored.userId) ||
                { label: stored.userName, value: stored.userId, email: stored.userEmail || '' }
            ).filter((d): d is DesignerOption => !!d);
            setSelectedDesigners(initialDesigners);

            setEditState({
                task_name: task.task_name,
                deadline: task.deadline,
                task_status: task.task_status,
                task_sub_status: task.task_sub_status,
                file_link: task.file_link,
                comments: task.comments,
            });

            setExistingApprovalUrl(task.approval_proof || undefined);
            setApprovalAction(task.approval_proof ? 'keep' : 'keep');
            setApprovalFile(null);
        }
    }, [isOpen, task.name, designerOptions]);

    // Helper: get filename from URL
    const getFileName = (url: string, maxLength: number = 30) => {
        const parts = url.split('/');
        const filename = parts[parts.length - 1] || 'attachment';
        if (filename.length <= maxLength) return filename;
        const ext = filename.lastIndexOf('.') > 0 ? filename.slice(filename.lastIndexOf('.')) : '';
        const nameWithoutExt = filename.slice(0, filename.lastIndexOf('.') > 0 ? filename.lastIndexOf('.') : filename.length);
        return nameWithoutExt.slice(0, maxLength - ext.length - 3) + '...' + ext;
    };

    // Approval proof handlers
    const handleApprovalFileSelected = (file: File | null) => {
        setApprovalFile(file);
        setApprovalAction(file ? 'replace' : (existingApprovalUrl ? 'keep' : 'keep'));
    };

    const handleRemoveExistingApproval = () => {
        setApprovalFile(null);
        setApprovalAction('remove');
    };

    const handleApprovalAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive" });
    }, []);


    const handleSave = async () => {
        const newTaskName = editState.task_name?.trim();

        if (!newTaskName) {
            toast({ title: "Validation Error", description: "Task Name is required.", variant: "destructive" });
            return;
        }

        // Only check duplicates if name editing is allowed
        if (!disableTaskNameEdit && !isRestrictedMode) {
            const normalizedNewName = newTaskName.toLowerCase();
            const normalizedCurrentName = task.task_name.toLowerCase();

            const isDuplicate = existingTaskNames.some(existingName => {
                const normalizedExisting = existingName.toLowerCase();
                const namesMatch = normalizedExisting === normalizedNewName;
                const isNotSelf = normalizedExisting !== normalizedCurrentName;
                return namesMatch && isNotSelf;
            });

            if (isDuplicate) {
                toast({
                    title: "Duplicate Task Name",
                    description: `The task name "${newTaskName}" is already used by another task in this project.`,
                    variant: "destructive"
                });
                return;
            }
        }

        // --- New Validations ---

        // 1. File link required for "Submitted"
        if (editState.task_status === "Submitted" && !editState.file_link?.trim()) {
            toast({
                title: "File Link Required",
                description: "A design file link is required before setting status to Submitted.",
                variant: "destructive"
            });
            return;
        }

        // 2. Approval proof required for "Approved"
        if (editState.task_status === "Approved") {
            const hasExistingProof = existingApprovalUrl && approvalAction !== 'remove';
            const hasNewProof = !!approvalFile;
            if (!hasExistingProof && !hasNewProof) {
                toast({
                    title: "Approval Proof Required",
                    description: "Please upload approval proof (email/WhatsApp screenshot) before setting status to Approved.",
                    variant: "destructive"
                });
                return;
            }
        }

        setIsSaving(true);

        try {
            // --- Upload approval proof if needed ---
            let approvalProofUrl: string | undefined = undefined;

            if (editState.task_status === "Approved" || existingApprovalUrl) {
                if (approvalAction === 'replace' && approvalFile) {
                    setIsUploading(true);
                    try {
                        const uploadedFile = await upload(approvalFile, {
                            doctype: 'Design Tracker Task Child Table',
                            docname: task.name,
                            fieldname: 'approval_proof',
                            isPrivate: true,
                        });
                        approvalProofUrl = uploadedFile.file_url;
                    } catch (uploadError) {
                        toast({ title: "Upload Failed", description: "Could not upload approval proof.", variant: "destructive" });
                        setIsSaving(false);
                        setIsUploading(false);
                        return;
                    } finally {
                        setIsUploading(false);
                    }
                } else if (approvalAction === 'remove') {
                    approvalProofUrl = '';
                }
                // If 'keep', we don't include approval_proof in the payload (no change)
            }

            const assignedDesignerDetails: AssignedDesignerDetail[] = selectedDesigners.map(d => ({
                userId: d.value,
                userName: d.label,
                userEmail: d.email,
            }));

            let finalEditState = { ...editState };
            const statusSubStatusConfig = SUB_STATUS_MAP[editState.task_status as keyof typeof SUB_STATUS_MAP];
            if (editState.task_status && !statusSubStatusConfig) {
                 finalEditState.task_sub_status = "";
            }

            const payloadForServer: { [key: string]: any } = {
                ...finalEditState,
                task_name: newTaskName,
                assigned_designers: assignedDesignerDetails,
            };

            // Include approval_proof in payload only when changed
            if (approvalProofUrl !== undefined) {
                payloadForServer.approval_proof = approvalProofUrl;
            }

            await onSave(payloadForServer);
            onOpenChange(false);
        } catch (error) {
            toast({ title: "Save Failed", description: "Could not save task details.", variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };

    const isStatusSubmitted = editState.task_status === "Submitted";
    const isStatusApproved = editState.task_status === "Approved";

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl overflow-visible">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="text-base font-semibold">Edit Task</DialogTitle>
                    {/* Task Context Header */}
                    <div className="flex flex-col gap-1.5 pt-1 pb-2 border-b border-gray-200">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            {task.task_zone && (
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] uppercase tracking-wider text-gray-400">Zone:</span>
                                    <span className="font-medium text-gray-700">{task.task_zone}</span>
                                </div>
                            )}
                            <div className="flex items-center gap-1">
                                <span className="text-[10px] uppercase tracking-wider text-gray-400">Category:</span>
                                <span className="font-medium text-gray-700">{task.design_category}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] uppercase tracking-wider text-gray-400">Task:</span>
                            <span className="text-sm font-medium text-gray-900 truncate">
                                {task.task_name}
                            </span>
                        </div>
                    </div>
                </DialogHeader>
                <div className="grid gap-3 py-3 max-h-[70vh] overflow-y-auto pr-1">

                    {/* Task Name */}
                    <div className="space-y-1">
                        <Label htmlFor="task_name">Task Name</Label>
                        <Input
                            id="task_name"
                            value={editState.task_name || ''}
                            onChange={(e) => setEditState(prev => ({ ...prev, task_name: e.target.value }))}
                            disabled={disableTaskNameEdit || isRestrictedMode}
                            className={(disableTaskNameEdit || isRestrictedMode) ? "bg-gray-100 text-gray-500 cursor-not-allowed" : ""}
                        />
                    </div>

                    {/* Assigned Designer (Multi-Select) */}
                    <div className="space-y-1">
                        <Label htmlFor="designer">Assign Designer(s)</Label>
                        <ReactSelect
                            isMulti
                            value={selectedDesigners}
                            options={designerOptions}
                            onChange={(newValue) => setSelectedDesigners(newValue as DesignerOption[])}
                            placeholder="Select designers..."
                            classNamePrefix="react-select"
                            isDisabled={isRestrictedMode}
                        />
                    </div>


                    {/* Status */}
                    <div className="space-y-1">
                        <Label htmlFor="status">Status</Label>
                        <ReactSelect
                            options={statusOptions}
                            value={statusOptions.find((c: any) => c.value === editState.task_status) || null}
                            onChange={(option: any) => {
                                const newStatus = option?.value || '';
                                setEditState(prev => {
                                    const updated = { ...prev, task_status: newStatus };
                                    if (newStatus === "Not Applicable") {
                                        updated.deadline = undefined;
                                    }
                                    const isStatusMapped = !!SUB_STATUS_MAP[newStatus as keyof typeof SUB_STATUS_MAP];
                                    if (!isStatusMapped && updated.task_sub_status) {
                                        updated.task_sub_status = "";
                                    }
                                    return updated;
                                });
                            }}
                            classNamePrefix="react-select"

                        />
                    </div>

                    {/* Sub Status - Conditional Rendering */}
                    {requiresCustomSubStatus ? (
                        // Custom text input for statuses like "Revision Pending"
                        <div className="space-y-1">
                            <Label htmlFor="sub_status_custom">Sub Status (Custom)</Label>
                            <Input
                                id="sub_status_custom"
                                type="text"
                                value={editState.task_sub_status || ''}
                                onChange={(e) => setEditState(prev => ({ ...prev, task_sub_status: e.target.value }))}
                                placeholder="Enter custom sub-status..."
                                className="w-full"
                            />
                        </div>
                    ) : (
                        // Predefined dropdown for statuses with fixed options
                        (allowedSubStatuses.length > 1) && (
                            <div className="space-y-1">
                                <Label htmlFor="sub_status">Sub Status</Label>
                                <ReactSelect
                                    options={allowedSubStatuses}
                                    value={allowedSubStatuses.find((c: any) => c.value === editState.task_sub_status) || null}
                                    onChange={(option: any) => setEditState(prev => ({ ...prev, task_sub_status: option ? option.value : '' }))}
                                    classNamePrefix="react-select"
                                />
                            </div>
                        )
                    )}

                    {/* Deadline */}
                    <div className="space-y-1">
                        <Label htmlFor="deadline">Deadline</Label>
                        <Input
                            id="deadline"
                            type="date"
                            value={editState.deadline || ''}
                            onChange={(e) => setEditState(prev => ({ ...prev, deadline: e.target.value }))}
                            disabled={isRestrictedMode}
                        />
                    </div>

                    {/* File Link */}
                    <div className="space-y-1.5">
                        <Label htmlFor="file_link">
                            Design File Link
                            {isStatusSubmitted && <span className="text-red-500 ml-1">*</span>}
                        </Label>
                        <Input
                            id="file_link"
                            type="url"
                            value={editState.file_link || ''}
                            onChange={(e) => {
                                setEditState(prev => ({ ...prev, file_link: e.target.value }));
                            }}
                            placeholder="https://figma.com/..."
                        />
                    </div>

                    {/* Comments */}
                    <div className="space-y-1">
                        <Label htmlFor="comments">Comments</Label>
                        <textarea
                            id="comments"
                            rows={3}
                            value={editState.comments || ''}
                            onChange={(e) => setEditState(prev => ({ ...prev, comments: e.target.value }))}
                            className="w-full p-2 border rounded"
                        />
                    </div>

                    {/* Approval Proof Section - shown when status is "Approved" */}
                    {isStatusApproved && (
                        <div className="space-y-2 pt-1 border-t border-gray-200">
                            <Label className="text-sm font-medium flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 text-gray-400" />
                                Approval Proof
                                <span className="text-red-500">*</span>
                                <span className="text-xs font-normal text-gray-400">(Email/WhatsApp screenshot)</span>
                            </Label>

                            {/* New file selected */}
                            {approvalFile && (
                                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-blue-100">
                                            <Paperclip className="h-4 w-4 text-blue-600" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-blue-900 truncate">
                                                {approvalFile.name.length > 25
                                                    ? approvalFile.name.slice(0, 22) + '...'
                                                    : approvalFile.name}
                                            </p>
                                            <p className="text-xs text-blue-600">New file selected</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                            setApprovalFile(null);
                                            setApprovalAction(existingApprovalUrl ? 'keep' : 'keep');
                                        }}
                                        className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-100"
                                    >
                                        <XIcon className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}

                            {/* Existing proof */}
                            {!approvalFile && existingApprovalUrl && approvalAction === 'keep' && (
                                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-gray-100">
                                            <FileText className="h-4 w-4 text-gray-600" />
                                        </div>
                                        <div className="min-w-0">
                                            <a
                                                href={SITEURL + existingApprovalUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-sm font-medium text-gray-900 hover:text-blue-600 truncate flex items-center gap-1"
                                            >
                                                {getFileName(existingApprovalUrl)}
                                                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                            </a>
                                            <p className="text-xs text-gray-500">Current approval proof</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleRemoveExistingApproval}
                                        className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}

                            {/* Marked for removal */}
                            {!approvalFile && approvalAction === 'remove' && existingApprovalUrl && (
                                <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                                    <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                                    <p className="text-sm text-amber-700">
                                        Approval proof will be removed on save
                                    </p>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setApprovalAction('keep')}
                                        className="ml-auto h-7 text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-100"
                                    >
                                        Undo
                                    </Button>
                                </div>
                            )}

                            {/* Upload new file */}
                            {!approvalFile && (approvalAction === 'remove' || !existingApprovalUrl) && (
                                <CustomAttachment
                                    selectedFile={approvalFile}
                                    onFileSelect={handleApprovalFileSelected}
                                    onError={handleApprovalAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={APPROVAL_ACCEPTED_TYPES}
                                    label="Upload Approval Proof"
                                    disabled={isSaving || isUploading}
                                />
                            )}

                            {/* Replace option when keeping existing */}
                            {!approvalFile && existingApprovalUrl && approvalAction === 'keep' && (
                                <CustomAttachment
                                    label="Replace with new file"
                                    selectedFile={null}
                                    onFileSelect={handleApprovalFileSelected}
                                    onError={handleApprovalAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={APPROVAL_ACCEPTED_TYPES}
                                    disabled={isSaving || isUploading}
                                />
                            )}
                        </div>
                    )}

                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                    <DialogClose asChild>
                        <Button variant="outline" size="sm" disabled={isSaving || isUploading}>Cancel</Button>
                    </DialogClose>
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving || isUploading || !editState.task_name}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {(isSaving || isUploading) ? (
                            <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                        ) : (
                            <Save className="h-3 w-3 mr-1.5" />
                        )}
                        {isUploading ? 'Uploading...' : isSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
