// Multi-image upload section. Each slot can hold many images. Files upload
// IMMEDIATELY on selection so previews work; the form value is the array of
// `{file_url, file_name, file_doc}` records (never base64).
//
// Upload pattern mirrors `pages/inflow-payments/components/NewInflowPayment.tsx`:
// `useFrappeFileUpload` → standard Frappe File doctype attached to the child
// row. The `file_doc` is what the orphan janitor uses to clean up cancelled
// sessions.

import React, { useCallback, useId } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { useFrappeFileUpload, useFrappePostCall } from 'frappe-react-sdk';
import { Loader2, Paperclip, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

import {
    COMMISSION_REPORT_CHILD_DOCTYPE,
    COMMISSION_REPORT_FILE_FIELDNAME,
    COMMISSION_REPORT_IMAGE_MAX_MB_DEFAULT,
} from '../../commission.constants';
import type {
    AttachmentRecord,
    ImageAttachmentsSection as ImageAttachmentsSectionT,
    ImageSlot,
} from '../types';

interface Props {
    section: ImageAttachmentsSectionT;
    /** Project Commission Report parent docname — kept for parity with other section types. */
    parentName: string;
    /** Child row name — files attach to this docname. */
    childRowName: string;
    /** Project id — kept for parity with other section types (unused here now). */
    projectId: string;
    /** When true, the slot input is disabled (view mode). */
    forceReadonly?: boolean;
    /** Notify parent that a new File doc was created (for cleanup tracking). */
    onAttachmentCreated?: (fileDoc: string) => void;
}

const stripLegacyShape = (
    items: unknown[] | undefined,
): AttachmentRecord[] =>
    (items || []).filter((it): it is AttachmentRecord => !!it && typeof it === 'object' && 'file_url' in it);

export const ImageAttachmentSection: React.FC<Props> = ({
    section,
    parentName,
    childRowName,
    projectId,
    forceReadonly,
    onAttachmentCreated,
}) => {
    const cols = section.columns ?? 2;

    return (
        <section className="space-y-3">
            {section.title && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}
            <div
                className={cn(
                    'grid gap-3',
                    cols === 1 && 'grid-cols-1',
                    cols === 2 && 'sm:grid-cols-2',
                    cols === 3 && 'sm:grid-cols-3',
                    cols >= 4 && 'sm:grid-cols-4',
                )}
            >
                {section.slots.map((slot) => (
                    <ImageSlotControl
                        key={slot.key}
                        slot={slot}
                        parentName={parentName}
                        childRowName={childRowName}
                        projectId={projectId}
                        forceReadonly={forceReadonly}
                        onAttachmentCreated={onAttachmentCreated}
                    />
                ))}
            </div>
        </section>
    );
};

interface SlotProps {
    slot: ImageSlot;
    parentName: string;
    childRowName: string;
    projectId: string;
    forceReadonly?: boolean;
    onAttachmentCreated?: (fileDoc: string) => void;
}

const ImageSlotControl: React.FC<SlotProps> = ({
    slot,
    childRowName,
    forceReadonly,
    onAttachmentCreated,
}) => {
    const { control, formState, setValue, getValues } = useFormContext();
    const inputId = useId();
    const { toast } = useToast();
    const { upload, isCompleted, progress } = useFrappeFileUpload();
    const { call: deleteDoc } = useFrappePostCall('frappe.client.delete');

    const fieldName = `attachments.${slot.key}`;
    const max = slot.maxSizeMb ?? COMMISSION_REPORT_IMAGE_MAX_MB_DEFAULT;
    const accept = slot.accept ?? 'image/*';

    const records: AttachmentRecord[] = stripLegacyShape(getValues(fieldName) as unknown[]);

    const handleFiles = useCallback(
        async (files: File[]) => {
            if (!files.length || !childRowName) return;
            for (const file of files) {
                if (file.size > max * 1024 * 1024) {
                    toast({
                        title: 'File too large',
                        description: `${file.name}: exceeds ${max} MB limit`,
                        variant: 'destructive',
                    });
                    continue;
                }
                try {
                    const uploaded = await upload(file, {
                        doctype: COMMISSION_REPORT_CHILD_DOCTYPE,
                        docname: childRowName,
                        fieldname: COMMISSION_REPORT_FILE_FIELDNAME,
                        isPrivate: true,
                    });
                    if (!uploaded?.file_url) {
                        toast({
                            title: 'Upload failed',
                            description: `Upload failed for ${file.name}`,
                            variant: 'destructive',
                        });
                        continue;
                    }
                    const newRecord: AttachmentRecord = {
                        file_url: uploaded.file_url,
                        file_name: uploaded.file_name || file.name,
                        file_doc: uploaded.name,
                    };
                    if (newRecord.file_doc) onAttachmentCreated?.(newRecord.file_doc);

                    const current = stripLegacyShape(getValues(fieldName) as unknown[]);

                    // Single-slot replace: delete the prior file record so we don't leak.
                    if (!slot.multi && current.length > 0) {
                        for (const old of current) {
                            if (!old.file_doc) continue;
                            try {
                                await deleteDoc({ doctype: 'File', name: old.file_doc });
                            } catch {
                                /* best-effort */
                            }
                        }
                    }

                    const next = slot.multi ? [...current, newRecord] : [newRecord];
                    setValue(fieldName, next, { shouldDirty: true, shouldValidate: true });
                } catch (e) {
                    toast({
                        title: 'Upload failed',
                        description: (e as Error).message || 'unknown',
                        variant: 'destructive',
                    });
                }
            }
        },
        [childRowName, deleteDoc, fieldName, getValues, max, onAttachmentCreated, slot.multi, setValue, toast, upload],
    );

    const handleRemove = useCallback(
        async (rec: AttachmentRecord) => {
            if (rec.file_doc) {
                try {
                    await deleteDoc({ doctype: 'File', name: rec.file_doc });
                } catch {
                    /* best-effort */
                }
            }
            const current = stripLegacyShape(getValues(fieldName) as unknown[]);
            setValue(
                fieldName,
                current.filter((r) => (rec.file_doc ? r.file_doc !== rec.file_doc : r.file_url !== rec.file_url)),
                { shouldDirty: true, shouldValidate: true },
            );
        },
        [deleteDoc, fieldName, getValues, setValue],
    );

    const error = (formState.errors?.attachments as Record<string, { message?: string }> | undefined)?.[slot.key];

    return (
        <Controller
            control={control}
            name={fieldName}
            render={() => (
                <div className="space-y-2 rounded-md border bg-muted/10 p-3">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                            {slot.label}
                            {slot.required && <sup className="ml-0.5 text-destructive">*</sup>}
                        </Label>
                        {!isCompleted && progress > 0 && progress < 100 && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                    </div>

                    {records.length > 0 && (
                        <ul className="space-y-1">
                            {records.map((rec, i) => (
                                <li
                                    key={rec.file_doc || `${rec.file_url}-${i}`}
                                    className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1 text-xs"
                                >
                                    <a
                                        href={rec.file_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex flex-1 items-center gap-1.5 truncate text-foreground hover:underline"
                                        title={rec.file_name}
                                    >
                                        <Paperclip className="h-3 w-3 shrink-0" />
                                        <span className="truncate">{rec.file_name}</span>
                                    </a>
                                    {!forceReadonly && (
                                        <button
                                            type="button"
                                            onClick={() => handleRemove(rec)}
                                            className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                            aria-label={`Remove ${rec.file_name}`}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {!forceReadonly && (slot.multi || records.length === 0) && (
                        <>
                            <input
                                id={inputId}
                                type="file"
                                accept={accept}
                                multiple={!!slot.multi}
                                className="hidden"
                                onChange={(e) => {
                                    const files = Array.from(e.target.files ?? []);
                                    if (files.length) void handleFiles(files);
                                    e.target.value = '';
                                }}
                            />
                            <Button asChild variant="outline" size="sm" className="w-full">
                                <label htmlFor={inputId} className="cursor-pointer">
                                    <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                                    {records.length > 0 ? 'Add another' : 'Choose image…'}
                                </label>
                            </Button>
                            <p className="text-[10px] text-muted-foreground">
                                {accept} · max {max} MB
                                {slot.multi && ' · multiple allowed'}
                            </p>
                        </>
                    )}

                    {error?.message && (
                        <p className="text-xs text-destructive">{String(error.message)}</p>
                    )}
                </div>
            )}
        />
    );
};
