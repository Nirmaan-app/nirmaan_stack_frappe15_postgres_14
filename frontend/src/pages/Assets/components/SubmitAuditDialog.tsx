import React, { useEffect, useRef, useState } from 'react';
import { useFrappeFileUpload, useFrappePostCall } from 'frappe-react-sdk';
import { TailSpin } from 'react-loader-spinner';
import { Camera, ClipboardCheck, ImagePlus, X } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { AUDIT_CONDITIONS, auditFormProblem, remarksRequired } from '@/utils/assetAudit';
import { getFrappeError } from '@/utils/frappeErrors';

const SUBMIT_AUDIT_METHOD = 'nirmaan_stack.api.assets.audits.submit_audit';
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const CONDITION_STYLE: Record<string, string> = {
    Good: 'data-[on=true]:border-blue-500 data-[on=true]:bg-blue-50 data-[on=true]:text-blue-700',
    Fair: 'data-[on=true]:border-amber-500 data-[on=true]:bg-amber-50 data-[on=true]:text-amber-700',
    Poor: 'data-[on=true]:border-orange-500 data-[on=true]:bg-orange-50 data-[on=true]:text-orange-700',
    Damaged: 'data-[on=true]:border-red-500 data-[on=true]:bg-red-50 data-[on=true]:text-red-700',
};

interface SubmitAuditDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    /** The Asset Management row with the open audit. */
    assignmentId: string;
    assetName: string;
    /** The month the audit is for (MM/YYYY). */
    auditMonth: string | null | undefined;
    /** The asset's condition now: the form starts on it, so the holder only changes what changed. */
    currentCondition: string | null | undefined;
    onSubmitted: () => void;
}

/**
 * The holder's monthly audit (owner, 2026-10-14): the asset's condition, a photo and, for Poor or
 * Damaged, what is wrong. On a phone "Take photo" opens the camera.
 *
 * The holder can't write Asset Management, so the photo uploads as a private file attached to nothing
 * and `submit_audit` claims it for the assignment. A retry after a failed submit reuses the upload.
 */
export const SubmitAuditDialog: React.FC<SubmitAuditDialogProps> = ({
    isOpen,
    onOpenChange,
    assignmentId,
    assetName,
    auditMonth,
    currentCondition,
    onSubmitted,
}) => {
    const { toast } = useToast();
    const { upload } = useFrappeFileUpload();
    const { call: submitAudit } = useFrappePostCall(SUBMIT_AUDIT_METHOD);

    const [condition, setCondition] = useState<string>(
        AUDIT_CONDITIONS.includes(currentCondition as (typeof AUDIT_CONDITIONS)[number]) ? (currentCondition as string) : ''
    );
    const [photo, setPhoto] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [remarks, setRemarks] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // The photo already uploaded for this form, so a retry doesn't upload it again.
    const uploaded = useRef<{ file: File; url: string } | null>(null);
    const cameraInput = useRef<HTMLInputElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => () => {
        if (preview) URL.revokeObjectURL(preview);
    }, [preview]);

    const pickPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = ''; // the same file can be picked again after removing it
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast({ title: 'Choose a photo', description: 'The proof must be an image.', variant: 'destructive' });
            return;
        }
        if (file.size > MAX_PHOTO_BYTES) {
            toast({ title: 'Photo too large', description: 'Use a photo under 10 MB.', variant: 'destructive' });
            return;
        }
        setPhoto(file);
        setPreview(URL.createObjectURL(file));
    };

    const removePhoto = () => {
        setPhoto(null);
        setPreview(null);
    };

    const problem = auditFormProblem(condition, !!photo, remarks);

    const handleSubmit = async () => {
        if (problem || !photo) return;
        setSubmitting(true);
        try {
            let url = uploaded.current?.file === photo ? uploaded.current.url : null;
            if (!url) {
                const file = await upload(photo, { isPrivate: true });
                url = file.file_url;
                uploaded.current = { file: photo, url };
            }
            await submitAudit({
                assignment: assignmentId,
                condition,
                photo: url,
                remarks: remarks.trim() || undefined,
            });
            toast({ title: 'Audit submitted', description: `${assetName}: ${condition}.`, variant: 'success' });
            onSubmitted();
            onOpenChange(false);
        } catch (error) {
            toast({ title: "Couldn't submit the audit", description: getFrappeError(error), variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !submitting && onOpenChange(open)}>
            <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
                        <ClipboardCheck className="h-6 w-6 text-amber-600" />
                    </div>
                    <DialogTitle className="text-center">Submit audit</DialogTitle>
                    <DialogDescription className="text-center">
                        {assetName}
                        {auditMonth ? ` · audit for ${auditMonth}` : ''}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Condition</Label>
                        <div role="radiogroup" aria-label="Condition" className="grid grid-cols-4 gap-2">
                            {AUDIT_CONDITIONS.map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    role="radio"
                                    aria-checked={condition === option}
                                    data-on={condition === option}
                                    disabled={submitting}
                                    onClick={() => setCondition(option)}
                                    className={cn(
                                        'rounded-md border px-2 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                        CONDITION_STYLE[option]
                                    )}
                                >
                                    {option}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Photo of the asset</Label>
                        {preview ? (
                            <div className="relative overflow-hidden rounded-md border">
                                <img src={preview} alt="Audit photo" className="max-h-64 w-full object-contain bg-gray-50" />
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="secondary"
                                    onClick={removePhoto}
                                    disabled={submitting}
                                    className="absolute right-2 top-2 h-7 w-7"
                                    aria-label="Remove photo"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center justify-center gap-2 rounded-md border-2 border-dashed px-3 py-5">
                                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => cameraInput.current?.click()}>
                                    <Camera className="h-4 w-4" />
                                    Take photo
                                </Button>
                                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileInput.current?.click()}>
                                    <ImagePlus className="h-4 w-4" />
                                    Choose file
                                </Button>
                            </div>
                        )}
                        <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickPhoto} />
                        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="audit-remarks">
                            Remarks{' '}
                            <span className="font-normal text-muted-foreground">
                                {remarksRequired(condition) ? '(required: what is wrong?)' : '(optional)'}
                            </span>
                        </Label>
                        <Textarea
                            id="audit-remarks"
                            value={remarks}
                            onChange={(event) => setRemarks(event.target.value)}
                            placeholder={remarksRequired(condition) ? 'e.g. Screen cracked at the left corner' : ''}
                            rows={3}
                            disabled={submitting}
                        />
                    </div>

                    {problem && (photo || condition) && <p className="text-xs text-amber-700">{problem}</p>}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    {submitting ? (
                        <TailSpin color="hsl(var(--primary))" height={36} width={36} />
                    ) : (
                        <>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleSubmit} disabled={!!problem} className="gap-1 bg-amber-600 hover:bg-amber-700">
                                <ClipboardCheck className="h-4 w-4" />
                                Submit audit
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
