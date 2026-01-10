import React, { useState, useEffect, useMemo } from 'react';
import { useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeGetDocList, useFrappeFileUpload } from 'frappe-react-sdk';
import ReactSelect from 'react-select';
import { format } from 'date-fns';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { CustomAttachment } from '@/components/helpers/CustomAttachment';
import { UserPlus, Calendar, FileText } from 'lucide-react';

import {
    ASSET_MASTER_DOCTYPE,
    ASSET_MANAGEMENT_DOCTYPE,
} from '../assets.constants';

interface AssignAssetDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    assetId: string;
    assetName: string;
    onAssigned?: () => void;
}

interface NirmaanUser {
    name: string;
    full_name: string;
}

export const AssignAssetDialog: React.FC<AssignAssetDialogProps> = ({
    isOpen,
    onOpenChange,
    assetId,
    assetName,
    onAssigned,
}) => {
    const [selectedUser, setSelectedUser] = useState<string>('');
    const [assignedDate, setAssignedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
    const [declarationFile, setDeclarationFile] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { toast } = useToast();
    const { createDoc } = useFrappeCreateDoc();
    const { updateDoc } = useFrappeUpdateDoc();
    const { upload } = useFrappeFileUpload();

    // Fetch Nirmaan Users
    const { data: usersList } = useFrappeGetDocList<NirmaanUser>(
        'Nirmaan Users',
        {
            fields: ['name', 'full_name'],
            orderBy: { field: 'full_name', order: 'asc' },
            limit: 0,
        },
        isOpen ? 'nirmaan_users_for_assignment' : null
    );

    const userOptions = useMemo(() =>
        usersList?.map((user) => ({
            value: user.name,
            label: user.full_name || user.name,
        })) || [],
        [usersList]
    );

    const resetForm = () => {
        setSelectedUser('');
        setAssignedDate(format(new Date(), 'yyyy-MM-dd'));
        setDeclarationFile(null);
    };

    useEffect(() => {
        if (isOpen) {
            resetForm();
        }
    }, [isOpen]);

    const handleSubmit = async () => {
        if (!selectedUser) {
            toast({
                title: 'User Required',
                description: 'Please select a user to assign the asset to.',
                variant: 'destructive',
            });
            return;
        }

        setIsSubmitting(true);

        try {
            let fileUrl: string | undefined;

            // Upload declaration file if provided
            if (declarationFile) {
                const fileArgs = {
                    doctype: ASSET_MANAGEMENT_DOCTYPE,
                    docname: `temp-assignment-${Date.now()}`,
                    fieldname: 'asset_declaration_attachment',
                    isPrivate: true,
                };
                const uploadedFile = await upload(declarationFile, fileArgs);
                fileUrl = uploadedFile.file_url;
            }

            // Create Asset Management entry
            await createDoc(ASSET_MANAGEMENT_DOCTYPE, {
                asset: assetId,
                asset_assigned_to: selectedUser,
                asset_assigned_on: assignedDate,
                asset_declaration_attachment: fileUrl || undefined,
            });

            // Update Asset Master with current assignee
            await updateDoc(ASSET_MASTER_DOCTYPE, assetId, {
                current_assignee: selectedUser,
            });

            toast({
                title: 'Asset Assigned',
                description: `${assetName} has been assigned successfully.`,
                variant: 'success',
            });

            onOpenChange(false);
            onAssigned?.();
        } catch (error: any) {
            console.error('Failed to assign asset:', error);
            toast({
                title: 'Assignment Failed',
                description: error?.message || 'An error occurred while assigning the asset.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                        <UserPlus className="h-6 w-6 text-emerald-600" />
                    </div>
                    <DialogTitle className="text-center text-lg font-semibold">
                        Assign Asset
                    </DialogTitle>
                    <DialogDescription className="text-center text-sm text-gray-500">
                        Assign <span className="font-medium text-gray-700">{assetName}</span> to a user
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* User Selection */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-gray-700">
                            Assign To <span className="text-red-500">*</span>
                        </Label>
                        <ReactSelect
                            options={userOptions}
                            value={userOptions.find(opt => opt.value === selectedUser) || null}
                            onChange={(val) => setSelectedUser(val?.value || '')}
                            placeholder="Select user..."
                            isClearable
                            classNames={{
                                control: () => 'border-gray-200 hover:border-gray-300',
                            }}
                        />
                    </div>

                    {/* Assignment Date */}
                    <div className="space-y-1.5">
                        <Label htmlFor="assignedDate" className="text-sm font-medium text-gray-700">
                            Assignment Date
                        </Label>
                        <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                id="assignedDate"
                                type="date"
                                value={assignedDate}
                                onChange={(e) => setAssignedDate(e.target.value)}
                                className="w-full rounded-md border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                    </div>

                    {/* Declaration Attachment */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-gray-700">
                            Declaration Document
                            <span className="ml-1 text-xs text-gray-400">(optional)</span>
                        </Label>
                        <CustomAttachment
                            selectedFile={declarationFile}
                            onFileSelect={setDeclarationFile}
                            acceptedTypes={["image/*", "application/pdf"]}
                            label="Upload Declaration"
                            maxFileSize={10 * 1024 * 1024}
                            onError={(err) => toast({
                                title: 'File Error',
                                description: err.message,
                                variant: 'destructive',
                            })}
                        />
                        {!declarationFile && (
                            <p className="text-xs text-amber-600 flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                Declaration can be uploaded later from asset overview
                            </p>
                        )}
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !selectedUser}
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                    >
                        {isSubmitting ? 'Assigning...' : 'Assign Asset'}
                        <UserPlus className="h-4 w-4" />
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
