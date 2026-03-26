// frontend/src/pages/ProjectCommissionReportType/components/TaskEditModal.tsx

import React, { useCallback, useMemo, useState } from 'react';
import { useFrappeFileUpload } from 'frappe-react-sdk';
import { CommissionReportTask, User, AssignedDesignerDetail } from '../types';
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

interface DesignerOption {
    value: string;
    label: string;
    userName: string;
    email: string;
    roleLabel: string;
    searchableLabel: string;
}

interface StatusOption {
    label: string;
    value: string;
}

interface TaskEditModalProps {
    task: CommissionReportTask;
    onSave: (updatedTask: { [key: string]: any }) => Promise<void>;
    usersList: User[];
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    statusOptions: StatusOption[];
    existingTaskNames: string[];
    disableTaskNameEdit?: boolean;
    isRestrictedMode?: boolean;
}

type ApprovalAction = 'keep' | 'replace' | 'remove';
type LinkAttachmentChoice = "link" | "attachment";
const APPROVAL_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf"];

export const TaskEditModal: React.FC<TaskEditModalProps> = ({
    task,
    onSave,
    usersList,
    isOpen,
    onOpenChange,
    statusOptions,
    existingTaskNames,
    disableTaskNameEdit = false,
    isRestrictedMode = false
}) => {

    const [selectedDesigners, setSelectedDesigners] = useState<DesignerOption[]>([]);
    const [editState, setEditState] = useState<Partial<CommissionReportTask>>({});
    const [linkOrAttachmentChoice, setLinkOrAttachmentChoice] = useState<LinkAttachmentChoice>("link");
    const [isSaving, setIsSaving] = useState(false);

    // Approval proof state
    const [approvalFile, setApprovalFile] = useState<File | null>(null);
    const [existingApprovalUrl, setExistingApprovalUrl] = useState<string | undefined>(undefined);
    const [approvalAction, setApprovalAction] = useState<ApprovalAction>('keep');
    const [isUploading, setIsUploading] = useState(false);
    const { upload } = useFrappeFileUpload();

    const designerOptions: DesignerOption[] = useMemo(() =>
        usersList.map(u => {
            const userName = u.full_name || u.name;
            const roleLabel = u.role_profile?.split(" ").slice(1, 3).join(" ") || "";
            return {
                label: userName,
                userName,
                value: u.name,
                email: u.email || '',
                roleLabel,
                searchableLabel: roleLabel ? `${userName} (${roleLabel})` : userName
            };
        })
    , [usersList]);

    // Initialize state when dialog opens
    React.useEffect(() => {
        if (isOpen) {
            const designerDetails = parseDesignersFromField(task.assigned_designers);
            const initialDesigners = designerDetails.map(stored =>
                designerOptions.find(opt => opt.value === stored.userId) ||
                {
                    label: stored.userName,
                    userName: stored.userName,
                    value: stored.userId,
                    email: stored.userEmail || '',
                    roleLabel: "",
                    searchableLabel: stored.userName
                }
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
            setLinkOrAttachmentChoice(task.approval_proof ? "attachment" : "link");
        }
    }, [isOpen, task.name, designerOptions, task.approval_proof]);

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

        // Validations for "Completed"
        if (editState.task_status === "Completed") {
            if (linkOrAttachmentChoice === "link") {
                if (!editState.file_link?.trim()) {
                    toast({
                        title: "Report Link Required",
                        description: "Please provide a report link before setting status to Completed.",
                        variant: "destructive"
                    });
                    return;
                }
            } else {
                // attachment choice
                const hasExistingProof = existingApprovalUrl && approvalAction !== 'remove';
                const hasNewProof = !!approvalFile;
                if (!hasExistingProof && !hasNewProof) {
                    toast({
                        title: "Report Attachment Required",
                        description: "Please upload the report file before setting status to Completed.",
                        variant: "destructive"
                    });
                    return;
                }
            }
        }

        setIsSaving(true);

        try {
            // --- Upload approval proof if needed ---
            let approvalProofUrl: string | undefined = undefined;

            if (editState.task_status === "Completed") {
                if (approvalAction === 'replace' && approvalFile) {
                    setIsUploading(true);
                    try {
                        const uploadedFile = await upload(approvalFile, {
                            doctype: 'Commission Report Task Child Table',
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
                userName: d.userName,
                userEmail: d.email,
            }));

            const payloadForServer: { [key: string]: any } = {
                ...editState,
                task_name: newTaskName,
                assigned_designers: assignedDesignerDetails,
            };

            // Show/use report source only for Completed status
            if (editState.task_status === "Completed") {
                if (linkOrAttachmentChoice === "link") {
                    payloadForServer.approval_proof = ''; // Clear attachment if link is chosen
                } else {
                    payloadForServer.file_link = '';      // Clear link if attachment is chosen
                }
            } else {
                // For all non-completed statuses, do not keep stale file/link data
                payloadForServer.file_link = '';
                payloadForServer.approval_proof = '';
            }

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

    const isStatusCompleted = editState.task_status === "Completed";

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
                                <span className="font-medium text-gray-700">{task.commission_category}</span>
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
                        <Label htmlFor="task_name">Report Name</Label>
                        <Input
                            id="task_name"
                            value={editState.task_name || ''}
                            onChange={(e) => setEditState(prev => ({ ...prev, task_name: e.target.value }))}
                            disabled={disableTaskNameEdit || isRestrictedMode}
                            className={(disableTaskNameEdit || isRestrictedMode) ? "bg-gray-100 text-gray-500 cursor-not-allowed" : ""}
                        />
                    </div>

                    {/* Assign (Multi-Select) */}
                    <div className="space-y-1">
                        <Label htmlFor="designer">Assign</Label>
                        <ReactSelect
                            isMulti
                            value={selectedDesigners}
                            options={designerOptions}
                            onChange={(newValue) => setSelectedDesigners(newValue as DesignerOption[])}
                            placeholder="Select assignees..."
                            classNamePrefix="react-select"
                            formatOptionLabel={(option) => (
                                <div>
                                    {option.userName}
                                    {option.roleLabel && (
                                        <span className="text-red-700 font-light">
                                            {" "}({option.roleLabel})
                                        </span>
                                    )}
                                </div>
                            )}
                            getOptionLabel={(option) => option.searchableLabel || option.userName}
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
                                    return updated;
                                });
                            }}
                            classNamePrefix="react-select"

                        />
                    </div>

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

                    {/* Report Source Selector (Shown only when Completed) */}
                    {isStatusCompleted && (
                        <div className="space-y-2 border p-3 rounded-md bg-gray-50/50">
                            <Label className="font-medium text-[10px] text-gray-400 uppercase tracking-wider">Report Source</Label>
                            <div className="flex gap-6 mt-1">
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="radio"
                                        id="choiceLink"
                                        name="reportSource"
                                        checked={linkOrAttachmentChoice === "link"}
                                        onChange={() => setLinkOrAttachmentChoice("link")}
                                        className="h-4 w-4 accent-red-600 cursor-pointer"
                                    />
                                    <Label htmlFor="choiceLink" className="text-sm font-normal cursor-pointer">Link</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="radio"
                                        id="choiceAttachment"
                                        name="reportSource"
                                        checked={linkOrAttachmentChoice === "attachment"}
                                        onChange={() => setLinkOrAttachmentChoice("attachment")}
                                        className="h-4 w-4 accent-red-600 cursor-pointer"
                                    />
                                    <Label htmlFor="choiceAttachment" className="text-sm font-normal cursor-pointer">Attachment</Label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Conditional Input: Link or Attachment (Completed only) */}
                    {isStatusCompleted && (
                        linkOrAttachmentChoice === "link" ? (
                            <div className="space-y-1.5">
                                <Label htmlFor="file_link">
                                    Report File Link
                                    <span className="text-red-500 ml-1">*</span>
                                </Label>
                                <Input
                                    id="file_link"
                                    type="url"
                                    value={editState.file_link || ''}
                                    onChange={(e) => {
                                        setEditState(prev => ({ ...prev, file_link: e.target.value }));
                                    }}
                                    placeholder="https://..."
                                />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5 text-gray-400" />
                                    Report Attachment
                                    <span className="text-red-500">*</span>
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
                                            <p className="text-xs text-gray-500">Current report attachment</p>
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
                                        Attachment will be removed on save
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
                                    label="Upload Report File"
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
                        )
                    )}

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
