import React, { useEffect, useRef, useState } from 'react';
import { useFrappeFileUpload, useFrappePostCall } from 'frappe-react-sdk';
import { TailSpin } from 'react-loader-spinner';
import { Camera, Check, ClipboardCheck, ImagePlus, X } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
} from '@/utils/assetAudit';
import { auditQuestionsFor } from '@/utils/assetAuditQuestions';
import { getFrappeError } from '@/utils/frappeErrors';

const SUBMIT_AUDIT_METHOD = 'nirmaan_stack.api.assets.audits.submit_audit';
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** "2.3 MB", "840 KB": the picked photo's size under its name. */
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
    /** The asset's category type, "Project" or "IT": picks the questions. */
    categoryType: string | null | undefined;
    onSubmitted: () => void;
}

/**
 * The holder's monthly audit: the questions for the asset's type (Project / IT, `utils/assetAuditQuestions.ts`;
 * owner 2026-10-15), a photo and optional remarks. The questions replaced the condition picker: the answers show any
 * issue, and the audit leaves the asset's condition alone. Each question's choices are a radio list, one per line;
 * a red answer opens an optional text box. On a phone "Take photo" opens the camera. The submit bar stays at the
 * bottom while the questions scroll.
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
    categoryType,
    onSubmitted,
}) => {
    const { toast } = useToast();
    const { upload } = useFrappeFileUpload();
    const { call: submitAudit } = useFrappePostCall(SUBMIT_AUDIT_METHOD);
    const questions = auditQuestionsFor(categoryType);

    // The holder's pick per question id, and the text under a red pick.
    const [picked, setPicked] = useState<Record<string, PickedAnswer>>({});
    const [photo, setPhoto] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [remarks, setRemarks] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // The photo already uploaded for this form, so a retry doesn't upload it again.
    const uploaded = useRef<{ file: File; url: string } | null>(null);
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

    const pick = (questionId: string, choiceId: string) =>
        setPicked((prev) => ({
            ...prev,
            // Picking the same choice again keeps what was typed under it.
            [questionId]: { choice: choiceId, text: prev[questionId]?.choice === choiceId ? prev[questionId]?.text : '' },
        }));
    const setAnswerText = (questionId: string, text: string) =>
        setPicked((prev) => ({ ...prev, [questionId]: { choice: prev[questionId]?.choice ?? '', text } }));

    // The progress counts every question and the photo as one step each.
    const total = questions.length + 1;
    const done = questions.filter((q) => picked[q.id]?.choice).length + (photo ? 1 : 0);
    const problem = auditAnswersProblem(questions, picked) ?? (photo ? null : 'Add a photo of the asset.');

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
                photo: url,
                remarks: remarks.trim() || undefined,
                answers: JSON.stringify(auditAnswersPayload(questions, picked)),
            });
            toast({ title: 'Audit submitted', description: assetName, variant: 'success' });
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
            {/* Phone: nearly full width with a margin; from a tab up a fixed comfortable width (the choices are one per line). */}
            <DialogContent
                ref={content}
                className="flex max-h-[92dvh] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-xl p-0 focus:outline-none sm:max-w-lg"
                // Only the question list scrolls. A phone can still scroll a clipped box to show a focused field;
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
                <div className="border-b px-4 pb-3 pt-5 sm:px-6 sm:pt-6">
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
                    <div className="mt-3 flex items-center gap-3" aria-live="polite">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div
                                className="h-full rounded-full bg-green-500 transition-[width] duration-300"
                                style={{ width: `${(done / total) * 100}%` }}
                            />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground" title={`${questions.length} questions and the photo`}>
                            {done} of {total} done
                        </span>
                    </div>
                </div>

                <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                    {questions.map((question, index) => (
                        <QuestionBlock
                            key={question.id}
                            number={index + 1}
                            question={question}
                            answer={picked[question.id]}
                            disabled={submitting}
                            onPick={(choiceId) => pick(question.id, choiceId)}
                            onText={(text) => setAnswerText(question.id, text)}
                        />
                    ))}

                    <div className="space-y-2">
                        <Label>
                            Photo of the asset <span className="text-red-500">*</span>
                        </Label>
                        {preview && photo ? (
                            // A small thumbnail with the file's name and size, so the photo doesn't push the
                            // questions and the Submit bar out of view.
                            <div className="flex items-center gap-3 rounded-lg border bg-gray-50/60 p-2">
                                <img
                                    src={preview}
                                    alt="Audit photo"
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
                                    aria-label="Remove photo"
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
                            <Button variant="outline" className="h-11 flex-1 sm:h-10 sm:flex-none" onClick={() => onOpenChange(false)}>
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
    number: number;
    question: AuditQuestion;
    answer: PickedAnswer | undefined;
    disabled: boolean;
    onPick: (choiceId: string) => void;
    onText: (text: string) => void;
}

/**
 * One question: a number that turns green (answered) or red (a red answer), the question and its hint, the
 * choices as a radio list, one per line -- the picked one green, or red for a red answer -- and, under a red pick,
 * the optional text box.
 */
const QuestionBlock: React.FC<QuestionBlockProps> = ({ number, question, answer, disabled, onPick, onText }) => {
    const chosen = question.choices.find((choice) => choice.id === answer?.choice);
    const name = `audit-question-${question.id}`;
    return (
        <div className="space-y-2.5">
            <div id={`${name}-label`} className="flex items-start gap-2.5">
                <span
                    aria-hidden
                    className={cn(
                        'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                        !chosen && 'bg-gray-100 text-gray-500',
                        chosen && !chosen.flag && 'bg-green-100 text-green-700',
                        chosen?.flag && 'bg-red-100 text-red-700'
                    )}
                >
                    {chosen && !chosen.flag ? <Check className="h-3.5 w-3.5" /> : chosen?.flag ? '!' : number}
                </span>
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
                                // `relative`: the hidden radio is positioned inside its row, so focusing it scrolls the question
                                // list -- without it the phone scrolls the whole dialog and lifts the Submit bar off the bottom.
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

            {/* One line under a red pick: the box itself asks the question (owner, 2026-10-15). */}
            {chosen?.flag && (
                <div className="sm:pl-8">
                    <Input
                        id={`${name}-text`}
                        aria-label={`${question.text_prompt} (optional)`}
                        value={answer?.text ?? ''}
                        onChange={(event) => onText(event.target.value)}
                        maxLength={MAX_AUDIT_ANSWER_TEXT}
                        placeholder={`${question.text_prompt} (optional)`}
                        disabled={disabled}
                        className="h-11 bg-white sm:h-10"
                    />
                </div>
            )}
        </div>
    );
};
