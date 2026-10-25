import React, { useContext, useEffect, useRef, useState } from 'react';
import { FrappeConfig, FrappeContext, useFrappeFileUpload, useFrappePostCall } from 'frappe-react-sdk';
import { TailSpin } from 'react-loader-spinner';
import { Camera, Check, ClipboardCheck, ImagePlus, X } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import {
    type AuditQuestion,
    MAX_AUDIT_ANSWER_TEXT,
    type PickedAnswer,
    auditAnswersPayload,
    auditAnswersProblem,
    hasRedPick,
} from '@/utils/assetAudit';
import { AUDIT_QUESTIONS } from '@/utils/assetAuditQuestions';
import { getFrappeError } from '@/utils/frappeErrors';

const SUBMIT_AUDIT_METHOD = 'nirmaan_stack.api.assets.audits.submit_audit';
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** "2.3 MB", "840 KB": the picked image's size under its name. */
const fileSizeLabel = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

interface SubmitAuditDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    /** The Asset Management row with the open audit. */
    assignmentId: string;
    assetName: string;
    /** The month the audit is for (MM/YYYY). */
    auditMonth: string | null | undefined;
    onSubmitted: () => void;
}

/**
 * The holder's monthly audit (owner, 2026-10-21): one question for every asset, "Is it working?"
 * (`utils/assetAuditQuestions.ts`). "Yes" offers optional remarks and nothing else -- no photo. "No" needs a
 * description of the problem and offers one optional image of it, for whoever reads the audit. The audit leaves the
 * asset's condition alone. On a phone "Take photo" opens the camera; the submit bar stays at the bottom.
 *
 * The holder can't write Asset Management, so an image uploads as a private file attached to nothing and
 * `submit_audit` claims it for the assignment. A retry after a failed submit reuses the upload. An upload that is
 * never sent -- the answer changed to "Yes" after a failed "No", the image was swapped, or the form was closed --
 * is deleted (code review #14, owner 2026-10-22), so no stray file is left attached to nothing.
 */
export const SubmitAuditDialog: React.FC<SubmitAuditDialogProps> = ({
    isOpen,
    onOpenChange,
    assignmentId,
    assetName,
    auditMonth,
    onSubmitted,
}) => {
    const { toast } = useToast();
    const { upload } = useFrappeFileUpload();
    const { db } = useContext(FrappeContext) as FrappeConfig;
    const { call: submitAudit } = useFrappePostCall(SUBMIT_AUDIT_METHOD);
    const questions = AUDIT_QUESTIONS;

    // The holder's pick per question id, and the description under a red pick.
    const [picked, setPicked] = useState<Record<string, PickedAnswer>>({});
    const [photo, setPhoto] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [remarks, setRemarks] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // Every image this form uploaded: a retry reuses the one for the same file, and the ones never sent are
    // deleted once the form is done (`discardUploads`).
    const uploads = useRef<{ file: File; url: string; name: string }[]>([]);
    const cameraInput = useRef<HTMLInputElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const content = useRef<HTMLDivElement>(null);

    useEffect(() => () => {
        if (preview) URL.revokeObjectURL(preview);
    }, [preview]);

    const pickPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = ''; // the same file can be picked again after removing it
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast({ title: 'Choose an image', description: 'The file must be a photo.', variant: 'destructive' });
            return;
        }
        if (file.size > MAX_PHOTO_BYTES) {
            toast({ title: 'Image too large', description: 'Use an image under 10 MB.', variant: 'destructive' });
            return;
        }
        setPhoto(file);
        setPreview(URL.createObjectURL(file));
    };

    const removePhoto = () => {
        setPhoto(null);
        setPreview(null);
    };

    const pick = (questionId: string, choiceId: string) =>
        setPicked((prev) => ({
            ...prev,
            // Picking the same choice again keeps what was typed under it.
            [questionId]: { choice: choiceId, text: prev[questionId]?.choice === choiceId ? prev[questionId]?.text : '' },
        }));
    const setAnswerText = (questionId: string, text: string) =>
        setPicked((prev) => ({ ...prev, [questionId]: { choice: prev[questionId]?.choice ?? '', text } }));

    const answered = questions.every((question) => picked[question.id]?.choice);
    // "No": the image field shows and the remarks don't; "Yes": the other way round. Only what shows is sent.
    const notWorking = hasRedPick(questions, picked);
    const problem = auditAnswersProblem(questions, picked);

    /**
     * Forget this form's uploads, deleting each one except `sentUrl` (claimed by the audit now) -- but only while it
     * is still attached to nothing: a submit whose reply was lost may have claimed it after all, and that image is the
     * audit's now. The holder owns these files, so their own delete is allowed; any failure just leaves the file.
     */
    const discardUploads = (sentUrl?: string) => {
        const unsent = uploads.current.filter((u) => u.url !== sentUrl);
        uploads.current = [];
        unsent.forEach(async (u) => {
            try {
                const file = await db.getDoc<{ attached_to_doctype?: string | null }>('File', u.name);
                if (!file.attached_to_doctype) await db.deleteDoc('File', u.name);
            } catch {
                // Already gone, or not readable: nothing to clean up.
            }
        });
    };

    const close = () => {
        discardUploads();
        onOpenChange(false);
    };

    const handleSubmit = async () => {
        if (problem) return;
        setSubmitting(true);
        try {
            const image = notWorking ? photo : null;
            let url: string | undefined;
            if (image) {
                url = uploads.current.find((u) => u.file === image)?.url;
                if (!url) {
                    const file = await upload(image, { isPrivate: true });
                    url = file.file_url;
                    uploads.current.push({ file: image, url, name: file.name });
                }
            }
            await submitAudit({
                assignment: assignmentId,
                photo: url,
                remarks: notWorking ? undefined : remarks.trim() || undefined,
                answers: JSON.stringify(auditAnswersPayload(questions, picked)),
            });
            toast({ title: 'Audit submitted', description: assetName, variant: 'success' });
            discardUploads(url);
            onSubmitted();
            onOpenChange(false);
        } catch (error) {
            toast({ title: "Couldn't submit the audit", description: getFrappeError(error), variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !submitting && (open ? onOpenChange(true) : close())}>
            {/* Phone: nearly full width with a margin; from a tab up a fixed comfortable width (the choices are one per line). */}
            <DialogContent
                ref={content}
                className="flex max-h-[92dvh] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-xl p-0 focus:outline-none sm:max-w-lg"
                // Only the form body scrolls. A phone can still scroll a clipped box to show a focused field;
                // snap it back so the header and the Submit bar never move.
                onScroll={(event) => {
                    if (event.currentTarget.scrollTop) event.currentTarget.scrollTop = 0;
                }}
                // Focus the box, not the first radio: its focus ring reads as an error before anything is picked.
                // Focus must still land inside, or Tab walks the page behind the dialog.
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    content.current?.focus();
                }}
            >
                <div className="border-b px-4 pb-4 pt-5 sm:px-6 sm:pt-6">
                    <div className="flex items-center gap-3 pr-6">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 sm:h-11 sm:w-11">
                            <ClipboardCheck className="h-5 w-5 text-amber-600" />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="text-base sm:text-lg">Submit audit</DialogTitle>
                            <DialogDescription className="truncate">
                                {assetName}
                                {auditMonth ? ` · audit for ${auditMonth}` : ''}
                            </DialogDescription>
                        </div>
                    </div>
                </div>

                <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                    {questions.map((question, index) => (
                        <QuestionBlock
                            key={question.id}
                            number={questions.length > 1 ? index + 1 : undefined}
                            question={question}
                            answer={picked[question.id]}
                            disabled={submitting}
                            onPick={(choiceId) => pick(question.id, choiceId)}
                            onText={(text) => setAnswerText(question.id, text)}
                        />
                    ))}

                    {notWorking && (
                        <div className="space-y-2">
                            <Label>
                                Image of the problem{' '}
                                <span className="font-normal text-muted-foreground">(optional, for reference)</span>
                            </Label>
                            {preview && photo ? (
                                // A small thumbnail with the file's name and size, so the image doesn't push the
                                // Submit bar out of view.
                                <div className="flex items-center gap-3 rounded-lg border bg-gray-50/60 p-2">
                                    <img
                                        src={preview}
                                        alt="Image of the problem"
                                        className="h-16 w-16 flex-shrink-0 rounded-md border bg-white object-cover sm:h-20 sm:w-20"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{photo.name}</p>
                                        <p className="text-xs text-muted-foreground">{fileSizeLabel(photo.size)}</p>
                                    </div>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        onClick={removePhoto}
                                        disabled={submitting}
                                        className="h-9 w-9 flex-shrink-0"
                                        aria-label="Remove image"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2 rounded-lg border-2 border-dashed p-3 sm:flex sm:justify-center sm:py-5">
                                    <Button type="button" variant="outline" className="h-11 gap-1.5 sm:h-9" onClick={() => cameraInput.current?.click()}>
                                        <Camera className="h-4 w-4" />
                                        Take photo
                                    </Button>
                                    <Button type="button" variant="outline" className="h-11 gap-1.5 sm:h-9" onClick={() => fileInput.current?.click()}>
                                        <ImagePlus className="h-4 w-4" />
                                        Choose file
                                    </Button>
                                </div>
                            )}
                            <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickPhoto} />
                            <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
                        </div>
                    )}

                    {answered && !notWorking && (
                        <div className="space-y-2">
                            <Label htmlFor="audit-remarks">
                                Remarks <span className="font-normal text-muted-foreground">(optional)</span>
                            </Label>
                            <Textarea
                                id="audit-remarks"
                                value={remarks}
                                onChange={(event) => setRemarks(event.target.value)}
                                placeholder="Anything else about the asset"
                                rows={2}
                                disabled={submitting}
                            />
                        </div>
                    )}
                </div>

                {/* The buttons sit in one row on every screen: half each on a phone, their own width from a tab up. */}
                <div className="border-t bg-background px-4 py-3 sm:px-6">
                    {problem && <p className="mb-2 text-xs text-amber-700">{problem}</p>}
                    {submitting ? (
                        <div className="flex justify-center sm:justify-end">
                            <TailSpin color="hsl(var(--primary))" height={32} width={32} />
                        </div>
                    ) : (
                        <div className="flex gap-2 sm:justify-end">
                            <Button variant="outline" className="h-11 flex-1 sm:h-10 sm:flex-none" onClick={close}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={!!problem}
                                className="h-11 flex-1 gap-1 bg-amber-600 hover:bg-amber-700 sm:h-10 sm:flex-none"
                            >
                                <ClipboardCheck className="h-4 w-4" />
                                Submit audit
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

interface QuestionBlockProps {
    /** Shown in the badge before a pick when there is more than one question. */
    number?: number;
    question: AuditQuestion;
    answer: PickedAnswer | undefined;
    disabled: boolean;
    onPick: (choiceId: string) => void;
    onText: (text: string) => void;
}

/**
 * One question: a badge that turns green (answered) or red (a red answer), the question and its hint, the choices
 * as a radio list, one per line -- the picked one green, or red for a red answer -- and, under a red pick, the
 * required description.
 */
const QuestionBlock: React.FC<QuestionBlockProps> = ({ number, question, answer, disabled, onPick, onText }) => {
    const chosen = question.choices.find((choice) => choice.id === answer?.choice);
    const name = `audit-question-${question.id}`;
    const badge = chosen && !chosen.flag ? <Check className="h-3.5 w-3.5" /> : chosen?.flag ? '!' : number;
    return (
        <div className="space-y-2.5">
            <div id={`${name}-label`} className="flex items-start gap-2.5">
                {badge !== undefined && (
                    <span
                        aria-hidden
                        className={cn(
                            'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                            !chosen && 'bg-gray-100 text-gray-500',
                            chosen && !chosen.flag && 'bg-green-100 text-green-700',
                            chosen?.flag && 'bg-red-100 text-red-700'
                        )}
                    >
                        {badge}
                    </span>
                )}
                <span className="space-y-0.5">
                    <span className="block text-sm font-medium leading-snug sm:text-[15px]">
                        {question.question} <span className="text-red-500">*</span>
                    </span>
                    {question.hint && <span className="block text-xs text-muted-foreground">{question.hint}</span>}
                </span>
            </div>

            {/* One choice per line on every screen (owner, 2026-10-15): a plain radio list, not a grid of boxes. */}
            <div role="radiogroup" aria-labelledby={`${name}-label`} className="flex flex-col gap-0.5 pl-0 sm:pl-8">
                {question.choices.map((choice) => {
                    const on = answer?.choice === choice.id;
                    return (
                        <label
                            key={choice.id}
                            className={cn(
                                // `relative`: the hidden radio is positioned inside its row, so focusing it scrolls the form
                                // body -- without it the phone scrolls the whole dialog and lifts the Submit bar off the bottom.
                                'relative flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors sm:min-h-[36px]',
                                'focus-within:ring-2 focus-within:ring-ring',
                                !on && 'text-gray-700 hover:bg-gray-50',
                                on && !choice.flag && 'bg-green-50 text-green-800',
                                on && choice.flag && 'bg-red-50 text-red-800',
                                disabled && 'cursor-not-allowed opacity-60'
                            )}
                        >
                            <input
                                type="radio"
                                name={name}
                                value={choice.id}
                                checked={on}
                                onChange={() => onPick(choice.id)}
                                disabled={disabled}
                                className="sr-only"
                            />
                            <span
                                aria-hidden
                                className={cn(
                                    'flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border-2 bg-white',
                                    !on && 'border-gray-300',
                                    on && !choice.flag && 'border-green-600',
                                    on && choice.flag && 'border-red-500'
                                )}
                            >
                                {on && <span className={cn('h-2 w-2 rounded-full', choice.flag ? 'bg-red-500' : 'bg-green-600')} />}
                            </span>
                            <span className={cn('leading-snug', on && 'font-medium')}>{choice.label}</span>
                        </label>
                    );
                })}
            </div>

            {/* Under a red pick, the description is required (owner, 2026-10-21). */}
            {chosen?.flag && (
                <div className="space-y-1.5 sm:pl-8">
                    <Label htmlFor={`${name}-text`}>
                        {question.text_prompt} <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                        id={`${name}-text`}
                        value={answer?.text ?? ''}
                        onChange={(event) => onText(event.target.value)}
                        maxLength={MAX_AUDIT_ANSWER_TEXT}
                        placeholder="What's wrong with it?"
                        rows={3}
                        required
                        aria-required
                        disabled={disabled}
                        className="bg-white"
                    />
                </div>
            )}
        </div>
    );
};
