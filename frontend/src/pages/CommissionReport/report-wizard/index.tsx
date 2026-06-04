// Main wizard orchestrator. Mounted at:
//   /commission-tracker/:id/task/:childRowName/fill?mode=fill|view|edit
//
// Layers:
//   1. Data: parent doc, master template, prefill, existing response, existing attachments
//   2. RHF form with per-step Zod validation
//   3. WizardSteps shell + step navigation + Submit
//   4. Attachment lifecycle (cleanup on cancel/unload)
//   5. Draft autosave (localStorage)
//   6. Optimistic-concurrency conflict UI

import { useFrappeAuth, useFrappeGetDocList } from 'frappe-react-sdk';
import { ArrowLeft, ArrowRight, Loader2, Printer, Save } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { DraftIndicator } from '@/components/ui/draft-indicator';
import { DraftResumeDialog } from '@/components/ui/draft-resume-dialog';
import { FormSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { WizardSteps, type WizardStep } from '@/components/ui/wizard-steps';
import { formatDate } from '@/utils/FormatDate';

import { commissionKeys } from '../commission.constants';
import { useCommissionTrackerDoc } from '../data/useCommissionQueries';
import { useReportPrefill } from './data/useReportPrefill';
import { useReportResponse } from './data/useReportResponse';
import { useReportTemplateForTask } from './data/useReportTemplateForTask';
import { useReportAttachments } from './hooks/useReportAttachments';
import { useReportDraft } from './hooks/useReportDraft';
import { useReportSubmit } from './hooks/useReportSubmit';
import { buildPrefillSnapshot, resolveInitialValues } from './prefill/resolve';
import { SectionRenderer } from './renderer/SectionRenderer';
import { getRhfKeysForStep, validateStep, validateTemplate } from './schema';
import type {
    AttachmentRecord,
    AttachmentSlotValue,
    Field,
    NumberField,
    ReportTemplate,
    ResponseData,
    WizardMode,
    WizardStepDef,
} from './types';

/** Resolve a dot-path inside an object — used to evaluate `visibleIf.field`. */
const getByPath = (obj: unknown, path: string): unknown => {
    if (!obj || !path) return undefined;
    return path.split('.').reduce<unknown>((acc, k) => {
        if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k];
        return undefined;
    }, obj);
};

/** A wizard step is visible when its `visibleIf` (if any) matches the current form values. */
const isStepVisible = (step: WizardStepDef, formValues: unknown): boolean => {
    if (!step.visibleIf) return true;
    const v = getByPath(formValues, step.visibleIf.field);
    if (step.visibleIf.in !== undefined) return step.visibleIf.in.includes(v as string);
    if (step.visibleIf.equals !== undefined) return v === step.visibleIf.equals;
    return true;
};

interface FormShape extends Record<string, unknown> {
    // Per-section responses: object for header/fields/checklist; array for trainees_data_table.
    responses: Record<string, unknown>;
    attachments: Record<string, AttachmentSlotValue[]>;
}

const computeMode = (
    rawMode: string | null,
    isFilled: boolean,
    canEdit: boolean,
): WizardMode => {
    const m = (rawMode || '').toLowerCase();
    if (m === 'view') return 'view';
    if (m === 'edit') return canEdit ? 'edit' : 'view';
    if (m === 'fill') return isFilled ? (canEdit ? 'edit' : 'view') : (canEdit ? 'fill' : 'view');
    // Default: filled+edit, unfilled+fill, otherwise view
    if (isFilled) return canEdit ? 'edit' : 'view';
    return canEdit ? 'fill' : 'view';
};

export const CommissionReportWizard: React.FC = () => {
    const { id: parentName = '', childRowName = '' } = useParams<{
        id: string;
        childRowName: string;
    }>();
    const [searchParams] = useSearchParams();
    const rawMode = searchParams.get('mode');
    const navigate = useNavigate();
    const { toast } = useToast();
    const { currentUser } = useFrappeAuth();
    const { mutate } = useSWRConfig();

    // ─── Data ─────────────────────────────────────────────────────────────
    const { data: parentDoc, isLoading: isParentLoading, error: parentError, mutate: refetchParent } =
        useCommissionTrackerDoc(parentName);
    const { childRow, response: existingResponse, isFilled, parseError } = useReportResponse(
        parentDoc,
        childRowName,
    );

    const {
        template,
        templateErrors,
        hasValidTemplate,
        isInactive,
        isLoading: isTemplateLoading,
        notFound: templateMasterMissing,
    } = useReportTemplateForTask(childRow?.commission_category || '', childRow?.task_name || '');

    const projectId = parentDoc?.project || '';
    const { prefillDict, isLoading: isPrefillLoading } = useReportPrefill(projectId);

    // ─── Permission gate ─────────────────────────────────────────────────
    // Edit access mirrors the existing tracker pattern: full roles always; restricted roles
    // only when assigned. We compute it from already-loaded parent data.
    const canEdit = useMemo(() => {
        if (!currentUser || !childRow) return false;
        if (currentUser === 'Administrator') return true;
        // We can't reach frappe.get_roles synchronously; the backend re-checks anyway.
        // Optimistic UI: allow if not view-only; backend will reject with 403 if needed.
        return true;
    }, [childRow, currentUser]);

    const mode = computeMode(rawMode, isFilled, canEdit);

    // One-time edit-after-submit warning toast.
    const editWarnedRef = useRef(false);
    useEffect(() => {
        if (editWarnedRef.current) return;
        if (mode !== 'edit' || !isFilled) return;
        editWarnedRef.current = true;
        toast({
            title: 'Editing a finalized report',
            description: 'Your changes are tracked in the audit trail. The original fill record is preserved.',
        });
    }, [isFilled, mode, toast]);

    // ─── Wizard step state ────────────────────────────────────────────────
    const [currentStep, setCurrentStep] = useState(0);

    // ─── Form ─────────────────────────────────────────────────────────────
    // Note: per-step Zod is built lazily inside handleNext via getRhfKeysForStep,
    // so we don't attach a static resolver here — it would be wrong as the user
    // moves between steps with different schemas.
    const form = useForm<FormShape>({
        mode: 'onBlur',
        defaultValues: {
            responses: {},
            attachments: {},
        },
    });

    // Reactive subscription to form values — used to filter wizard steps via visibleIf.
    const watched = useWatch({ control: form.control });

    // Filter steps by visibleIf; this drives navigation, validation, and rendering.
    const visibleStepDefs: WizardStepDef[] = useMemo(() => {
        if (!template?.wizardSteps) return [];
        return template.wizardSteps.filter((s) => isStepVisible(s, watched));
    }, [template, watched]);

    const wizardSteps: WizardStep[] = useMemo(
        () => visibleStepDefs.map((s) => ({ key: s.key, title: s.title })),
        [visibleStepDefs],
    );

    // If the user changes a field that hides the step they're on, clamp currentStep.
    useEffect(() => {
        if (visibleStepDefs.length === 0) return;
        if (currentStep > visibleStepDefs.length - 1) {
            setCurrentStep(visibleStepDefs.length - 1);
        }
    }, [visibleStepDefs.length, currentStep]);

    // Initialize form values once template + prefill + (optional) existing response are ready.
    // The response_data is the single source of truth for attachments — each slot value
    // is an array of `AttachmentRecord` (new shape) or string (legacy NA name).
    const initializedRef = useRef(false);
    useEffect(() => {
        if (initializedRef.current) return;
        if (!template || isPrefillLoading || isParentLoading || isTemplateLoading) return;

        const initialResponses = resolveInitialValues({
            template,
            prefillDict,
            existingResponse,
        });

        // Auto-fill `training_topic` from the task name (stripping the word "Report")
        // when the field is empty. Saved values are preserved.
        if (childRow?.task_name) {
            const stripped = childRow.task_name
                .replace(/\breport\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (stripped) {
                for (const section of template.sections) {
                    if (section.type !== 'header' && section.type !== 'fields') continue;
                    if (!section.fields.some((f) => f.key === 'training_topic')) continue;
                    const sec = (initialResponses[section.id] || {}) as Record<string, unknown>;
                    if (!sec.training_topic) {
                        sec.training_topic = stripped;
                        initialResponses[section.id] = sec;
                    }
                }
            }
        }

        const seededAttachments: Record<string, AttachmentSlotValue[]> = {};
        if (existingResponse?.attachments) {
            for (const [k, v] of Object.entries(existingResponse.attachments)) {
                if (Array.isArray(v)) seededAttachments[k] = v as AttachmentSlotValue[];
            }
        }
        form.reset({
            responses: initialResponses,
            attachments: seededAttachments,
        });
        initializedRef.current = true;
    }, [
        childRow,
        existingResponse,
        form,
        isParentLoading,
        isPrefillLoading,
        isTemplateLoading,
        prefillDict,
        template,
    ]);

    // ─── Lifecycle hooks ──────────────────────────────────────────────────
    const [isCommitted, setIsCommitted] = useState(false);
    const keepNamesRef = useRef<string[]>([]);

    const updateKeepNames = useCallback(
        (
            attachments: Record<string, AttachmentSlotValue[]>,
            responses?: Record<string, unknown>,
        ) => {
            const all: string[] = [];
            for (const arr of Object.values(attachments)) {
                if (!Array.isArray(arr)) continue;
                for (const v of arr) {
                    if (v && typeof v === 'object' && (v as AttachmentRecord).file_doc) {
                        all.push((v as AttachmentRecord).file_doc as string);
                    }
                }
            }
            // Also walk `responses` for inline per-row AttachmentRecords (used by
            // trainees_data_table image columns, e.g. Earth Pit per-row photos).
            if (responses) {
                const visit = (node: unknown): void => {
                    if (!node) return;
                    if (Array.isArray(node)) {
                        for (const item of node) visit(item);
                        return;
                    }
                    if (typeof node === 'object') {
                        const obj = node as Record<string, unknown>;
                        if (typeof obj.file_doc === 'string' && obj.file_doc) {
                            all.push(obj.file_doc);
                            return;
                        }
                        for (const v of Object.values(obj)) visit(v);
                    }
                };
                visit(responses);
            }
            keepNamesRef.current = all;
        },
        [],
    );

    const { track } = useReportAttachments({
        parent: parentName,
        childRowName,
        isCommitted,
        keepNamesRef,
    });

    const draft = useReportDraft<FormShape>({
        parent: parentName,
        childRowName,
        form,
        currentStep,
        setCurrentStep,
        isCommitted,
        enabled: mode !== 'view' && initializedRef.current,
    });

    const { submit, isSubmitting, isConflict, clearConflict } = useReportSubmit();

    // ─── Step nav ─────────────────────────────────────────────────────────
    const handleNext = useCallback(async () => {
        if (!template) return;
        const step = visibleStepDefs[currentStep];
        if (!step) return;

        // Clear any prior errors on this step's fields, then re-validate.
        const stepKeys = getRhfKeysForStep(template, step);
        for (const k of stepKeys) {
            form.clearErrors(k as Parameters<typeof form.clearErrors>[0]);
        }
        const stepErrors = validateStep(template, step, form.getValues());
        if (stepErrors.length > 0) {
            for (const err of stepErrors) {
                form.setError(err.path as Parameters<typeof form.setError>[0], {
                    type: 'manual',
                    message: err.message,
                });
            }
            // Surface the first 3 messages so the user sees the actual reason,
            // not just a generic "fix errors" prompt.
            const preview = stepErrors
                .slice(0, 3)
                .map((e) => `• ${e.message}`)
                .join('\n');
            const more = stepErrors.length > 3 ? `\n…and ${stepErrors.length - 3} more` : '';
            toast({
                title: 'Please fix errors before continuing',
                description: preview + more,
                variant: 'destructive',
            });
            return;
        }

        if (currentStep < visibleStepDefs.length - 1) {
            setCurrentStep((n) => n + 1);
        }
    }, [currentStep, form, template, toast, visibleStepDefs]);

    const handleBack = useCallback(() => {
        setCurrentStep((n) => Math.max(0, n - 1));
    }, []);

    // ─── Submit ───────────────────────────────────────────────────────────
    const handleSubmit = useCallback(async () => {
        if (!template || !parentDoc || !childRow) return;

        // Final full-template validation.
        form.clearErrors();
        const fullErrors = validateTemplate(template, form.getValues());
        if (fullErrors.length > 0) {
            for (const err of fullErrors) {
                form.setError(err.path as Parameters<typeof form.setError>[0], {
                    type: 'manual',
                    message: err.message,
                });
            }
            const preview = fullErrors
                .slice(0, 3)
                .map((e) => `• ${e.message}`)
                .join('\n');
            const more = fullErrors.length > 3 ? `\n…and ${fullErrors.length - 3} more` : '';
            toast({
                title: 'Form has errors',
                description: preview + more,
                variant: 'destructive',
            });
            return;
        }

        const values = form.getValues();
        const prefillSnapshot = buildPrefillSnapshot(template, prefillDict);
        const responseData: ResponseData = {
            templateId: template.templateId,
            templateVersion: template.templateVersion,
            snapshotHash: '', // backend computes + returns; we'll set it in cache update if needed
            filledAt: existingResponse?.filledAt || new Date().toISOString(),
            filledBy: existingResponse?.filledBy || currentUser || '',
            lastEditedAt: new Date().toISOString(),
            prefillSnapshot,
            responses: values.responses as ResponseData['responses'],
            attachments: values.attachments,
        };

        try {
            const result = await submit({
                parent: parentName,
                taskRowName: childRowName,
                template,
                responseData,
                expectedModified: parentDoc.modified || '',
            });
            // Refresh keep set so the cleanup-on-unmount knows what's committed.
            updateKeepNames(values.attachments, values.responses);
            setIsCommitted(true);
            draft.clearDraftAfterSubmit();

            // Refresh caches.
            await Promise.all([
                refetchParent(),
                mutate(commissionKeys.trackerDoc(parentName)),
            ]);

            toast({
                title: 'Report saved',
                description: `Snapshot ${result.snapshotId.slice(0, 12)}…`,
                variant: 'success',
            });
            navigate(`/commission-tracker/${parentName}`);
        } catch (e) {
            // useReportSubmit already captures + toasts the conflict path.
            if (!isConflict) {
                toast({
                    title: 'Submit failed',
                    description: (e as Error).message || 'Unknown error',
                    variant: 'destructive',
                });
            }
        }
    }, [
        childRow,
        childRowName,
        currentUser,
        draft,
        existingResponse?.filledAt,
        existingResponse?.filledBy,
        form,
        isConflict,
        mutate,
        navigate,
        parentDoc,
        parentName,
        prefillDict,
        refetchParent,
        submit,
        toast,
        template,
        updateKeepNames,
    ]);

    // ─── Loading & error states ──────────────────────────────────────────
    if (!parentName || !childRowName) {
        return <ErrorShell title="Missing route params" message="Parent or task row identifier missing." />;
    }
    if (parentError) {
        return (
            <ErrorShell
                title="Failed to load commission report"
                message={(parentError as unknown as Error).message || 'Unknown error'}
            />
        );
    }
    if (isParentLoading || isTemplateLoading || isPrefillLoading) {
        return (
            <div className="mx-auto max-w-6xl p-4">
                <FormSkeleton />
            </div>
        );
    }
    if (!childRow) {
        return <ErrorShell title="Task not found" message={`No task with id ${childRowName} on ${parentName}.`} />;
    }
    if (templateMasterMissing) {
        return (
            <ErrorShell
                title="Master task not configured"
                message={`No "Commission Report Tasks" master row matching (${childRow.commission_category}, ${childRow.task_name}). Ask an admin to add one.`}
            />
        );
    }
    if (templateErrors.length > 0) {
        return (
            <ErrorShell
                title="Report template is broken"
                message={
                    <ul className="list-disc space-y-1 pl-5 text-left text-sm">
                        {templateErrors.map((e, i) => (
                            <li key={i}>
                                <span className="font-mono text-xs">{e.code}</span>: {e.message}
                            </li>
                        ))}
                    </ul>
                }
                hint="An admin should fix the source_format JSON in Packages Settings."
            />
        );
    }
    if (!hasValidTemplate || !template) {
        return (
            <ErrorShell
                title="No template configured"
                message={`The "${childRow.task_name}" master has no Source Format set. Ask an admin to add one.`}
            />
        );
    }
    if (parseError) {
        return (
            <ErrorShell
                title="Existing response is malformed"
                message={parseError.message}
                hint="An admin can clear and re-fill via the Admin tools."
            />
        );
    }

    // ─── Render wizard ────────────────────────────────────────────────────
    const step = visibleStepDefs[currentStep];
    const isReviewStep = step && step.sections.length === 0;
    const isFinalStep = step && currentStep === visibleStepDefs.length - 1;
    const sectionsById = new Map(template.sections.map((s) => [s.id, s]));

    return (
        <div className="mx-auto max-w-6xl space-y-4 p-4">
            <FormProvider {...form}>
                <header className="flex flex-col gap-2 border-b pb-3">
                    <div className="flex items-center justify-between gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/commission-tracker/${parentName}`)}
                            className="-ml-2"
                        >
                            <ArrowLeft className="mr-1 h-4 w-4" />
                            Back to tracker
                        </Button>
                        <div className="flex items-center gap-2">
                            {isFilled && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        // Templates declare `printOrientation: "landscape"` in
                                        // their source_format to opt into the LS print format
                                        // (Orientation = Landscape on the Print Format doctype).
                                        // Default is portrait.
                                        const isLandscape =
                                            (template as { printOrientation?: string } | null)
                                                ?.printOrientation === 'landscape';
                                        const printFormat = isLandscape
                                            ? 'LSProject Commission Report - Filled Task'
                                            : 'Project Commission Report - Filled Task';
                                        const url = `/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent('Project Commission Report')}&name=${encodeURIComponent(parentName)}&format=${encodeURIComponent(printFormat)}&task_row=${encodeURIComponent(childRowName)}&letterhead=No+Letterhead`;
                                        window.open(url, '_blank', 'noopener');
                                    }}
                                >
                                    <Printer className="mr-1 h-4 w-4" />
                                    Download PDF
                                </Button>
                            )}
                            {mode !== 'view' && (
                                <DraftIndicator lastSavedText={draft.lastSavedText} isSaving={draft.isSaving} />
                            )}
                        </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <h1 className="text-lg font-semibold">{template.title}</h1>
                        <span className="text-xs uppercase text-muted-foreground">
                            {mode === 'view' ? 'View only' : mode === 'edit' ? 'Editing existing' : 'Filling new'}
                        </span>
                        {isInactive && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                                Template inactive
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Project <span className="font-medium">{parentDoc?.project_name}</span> · Task{' '}
                        <span className="font-medium">{childRow.task_name}</span>
                    </p>
                </header>

                {wizardSteps.length > 1 && (
                    <WizardSteps
                        steps={wizardSteps}
                        currentStep={currentStep}
                        onStepClick={(idx) => {
                            // Allow back-nav freely; forward only if validating each gate would pass — keep simple here.
                            if (idx <= currentStep) setCurrentStep(idx);
                        }}
                        allowForwardNavigation={false}
                    />
                )}

                <main className="min-h-[300px] space-y-6">
                    {step && !isReviewStep ? (
                        step.sections.map((sid) => {
                            const section = sectionsById.get(sid);
                            if (!section) return null;
                            return (
                                <SectionRenderer
                                    key={sid}
                                    section={section}
                                    parentName={parentName}
                                    childRowName={childRowName}
                                    projectId={projectId}
                                    templateId={template.templateId}
                                    forceReadonly={mode === 'view'}
                                    onAttachmentCreated={(fileDoc) => {
                                        track(fileDoc);
                                        updateKeepNames(
                                            form.getValues('attachments'),
                                            form.getValues('responses'),
                                        );
                                    }}
                                />
                            );
                        })
                    ) : (
                        <ReviewSummary
                            template={template}
                            formValues={form.getValues()}
                            projectId={projectId}
                        />
                    )}
                </main>

                <footer className="flex items-center justify-between gap-3 border-t pt-3">
                    <Button variant="outline" onClick={handleBack} disabled={currentStep === 0}>
                        <ArrowLeft className="mr-1 h-4 w-4" />
                        Back
                    </Button>
                    {!isFinalStep ? (
                        <Button onClick={handleNext}>
                            Next
                            <ArrowRight className="ml-1 h-4 w-4" />
                        </Button>
                    ) : (
                        mode !== 'view' && (
                            <Button onClick={handleSubmit} disabled={isSubmitting}>
                                {isSubmitting ? (
                                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                ) : (
                                    <Save className="mr-1 h-4 w-4" />
                                )}
                                {mode === 'edit' ? 'Save changes' : 'Submit report'}
                            </Button>
                        )
                    )}
                </footer>

                {isConflict && (
                    <ConflictBanner
                        onRefresh={() => {
                            clearConflict();
                            void refetchParent();
                        }}
                    />
                )}
            </FormProvider>

            {draft.showResumeDialog && draft.hasDraft && (
                <DraftResumeDialog
                    open={draft.showResumeDialog}
                    onOpenChange={draft.setShowResumeDialog}
                    onResume={draft.resumeDraft}
                    onStartFresh={draft.discardDraft}
                    draftDate={new Date().toISOString()}
                    currentStep={currentStep + 1}
                    totalSteps={visibleStepDefs.length || 1}
                />
            )}
        </div>
    );
};

// ─── Helpers ────────────────────────────────────────────────────────────

interface ErrorShellProps {
    title: string;
    message: React.ReactNode;
    hint?: string;
}

const ErrorShell: React.FC<ErrorShellProps> = ({ title, message, hint }) => {
    const navigate = useNavigate();
    return (
        <div className="mx-auto max-w-3xl space-y-3 p-6">
            <h1 className="text-lg font-semibold text-destructive">{title}</h1>
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
                {message}
            </div>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            <Button variant="outline" onClick={() => navigate(-1)}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Go back
            </Button>
        </div>
    );
};

const ConflictBanner: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">This report was changed by someone else.</p>
        <p className="mt-1 text-xs">Refresh to load the latest state, then re-apply your edits.</p>
        <Button variant="outline" size="sm" onClick={onRefresh} className="mt-2">
            Refresh
        </Button>
    </div>
);

const formatReviewValue = (field: Field, raw: unknown): string => {
    if (raw === undefined || raw === null || raw === '') return '—';
    if (field.type === 'date') {
        try {
            return formatDate(String(raw));
        } catch {
            return String(raw);
        }
    }
    if (field.type === 'number') {
        const unit = (field as NumberField).unit;
        return unit ? `${raw} ${unit}` : String(raw);
    }
    return String(raw);
};

const ResultBadge: React.FC<{ value?: string }> = ({ value }) => {
    if (!value) return <span className="italic text-muted-foreground">—</span>;
    const v = value.toLowerCase();
    let cls = 'bg-slate-100 text-slate-700';
    if (v === 'yes' || v === 'pass') cls = 'bg-emerald-100 text-emerald-800';
    else if (v === 'no' || v === 'fail') cls = 'bg-red-100 text-red-800';
    else if (v === 'n/a' || v === 'na') cls = 'bg-amber-100 text-amber-800';
    return (
        <span className={'inline-block rounded px-1.5 py-0.5 text-xs font-medium ' + cls}>
            {value}
        </span>
    );
};

// Review-mode summary of which signatures will print. Live-derives the project's
// enabled roles from `Project TDS Setting`, then marks each as Included/Omitted
// based on the wizard's saved disabled list. Mirrors the keys+labels in
// SignaturesSection.tsx — keep them in sync with the Jinja `render_signatures` macro.
interface ProjectTDSSettingRow {
    name: string;
    enable_client: 0 | 1;
    enable_manager: 0 | 1;
    enable_consultant: 0 | 1;
    enable_gc_contractor: 0 | 1;
    enable_mep_contractor: 0 | 1;
}
const SignaturesReviewBlock: React.FC<{
    title: string;
    projectId: string;
    templateId: string;
    disabledKeys: string[];
    enabledKeys: string[];
}> = ({ title, projectId, templateId, disabledKeys, enabledKeys }) => {
    const { data, isLoading } = useFrappeGetDocList<ProjectTDSSettingRow>(
        'Project TDS Setting',
        {
            fields: [
                'name',
                'enable_client',
                'enable_manager',
                'enable_consultant',
                'enable_gc_contractor',
                'enable_mep_contractor',
            ],
            filters: projectId ? [['tds_project_id', '=', projectId]] : undefined,
            limit: 1,
        },
        projectId ? ['project-tds-setting', projectId] : null,
    );
    const tds = data?.[0];

    // Build the full role list for the template, each tagged with inTds.
    const roles: { key: string; label: string; inTds: boolean }[] = (() => {
        const flag = (v: 0 | 1 | undefined) => v === 1;
        if (templateId === 'demo-training-certificate') {
            return [
                { key: 'manager', label: 'PROJECT MANAGER', inTds: flag(tds?.enable_manager) },
                { key: 'mep_contractor', label: 'VENDOR', inTds: flag(tds?.enable_mep_contractor) },
                { key: 'client', label: 'CLIENT', inTds: flag(tds?.enable_client) },
                { key: 'gc_contractor', label: 'GC CONTRACTOR', inTds: flag(tds?.enable_gc_contractor) },
            ];
        }
        return [
            { key: 'manager', label: 'PROJECT MANAGER', inTds: flag(tds?.enable_manager) },
            { key: 'consultant', label: 'CONSULTANT', inTds: flag(tds?.enable_consultant) },
            { key: 'client', label: 'CLIENT', inTds: flag(tds?.enable_client) },
            { key: 'gc_contractor', label: 'GC CONTRACTOR', inTds: flag(tds?.enable_gc_contractor) },
            { key: 'mep_contractor', label: 'NIRMAAN', inTds: flag(tds?.enable_mep_contractor) },
        ];
    })();

    // Final per-row state: included (TDS or manual) vs omitted, keeping the
    // "manual" distinction so the pill can render differently.
    const rowState = roles.map((r) => {
        const includedByTds = r.inTds && !disabledKeys.includes(r.key);
        const includedByManual = !r.inTds && enabledKeys.includes(r.key);
        const included = includedByTds || includedByManual;
        return { ...r, included, manualOn: includedByManual };
    });
    const includedRows = rowState.filter((r) => r.included);
    const omittedTdsRows = rowState.filter((r) => !r.included && r.inTds);

    return (
        <div className="rounded-md border p-3">
            <div className="mb-3 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-medium">{title}</h3>
                    <p className="text-[11px] text-muted-foreground">
                        Signatures that will appear on the printed PDF.
                    </p>
                </div>
                {!isLoading && tds && (
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                        {includedRows.length} of {roles.length} included
                    </span>
                )}
            </div>
            {!projectId || !tds ? (
                <p className="text-xs italic text-muted-foreground">
                    Project TDS Setting unavailable — signatures will be resolved at print time.
                </p>
            ) : (
                <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                        {includedRows.length === 0 ? (
                            <span className="text-xs italic text-amber-700">
                                No signatures will be printed.
                            </span>
                        ) : (
                            includedRows.map((r) => (
                                <span
                                    key={r.key}
                                    className={[
                                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                                        r.manualOn
                                            ? 'border-sky-500/40 bg-sky-500/10 text-sky-700'
                                            : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
                                    ].join(' ')}
                                    title={r.manualOn ? 'Manually included (not in project TDS)' : undefined}
                                >
                                    <span
                                        className={[
                                            'h-1.5 w-1.5 rounded-full',
                                            r.manualOn ? 'bg-sky-600' : 'bg-emerald-600',
                                        ].join(' ')}
                                    />
                                    {r.label}
                                    {r.manualOn && (
                                        <span className="ml-1 text-[9px] font-normal opacity-80">
                                            (manual)
                                        </span>
                                    )}
                                </span>
                            ))
                        )}
                    </div>
                    {omittedTdsRows.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Omitted:
                            </span>
                            {omittedTdsRows.map((r) => (
                                <span
                                    key={r.key}
                                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-rose-400/50 bg-rose-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-rose-700 line-through decoration-rose-400/70"
                                >
                                    {r.label}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const ReviewSummary: React.FC<{
    template: ReportTemplate;
    formValues: FormShape;
    projectId: string;
}> = ({ template, formValues, projectId }) => {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-base font-semibold">Review your answers</h2>
                <p className="text-xs text-muted-foreground">
                    Check the values below before submitting. Use Back to make corrections.
                </p>
            </div>

            {template.sections.map((section) => {
                if (section.type === 'process') return null;

                if (section.type === 'signatures') {
                    const sigValue = (formValues.responses?.[section.id] || {}) as {
                        disabled?: string[];
                        enabled?: string[];
                    };
                    return (
                        <SignaturesReviewBlock
                            key={section.id}
                            title={section.title || 'Signatures'}
                            projectId={projectId}
                            templateId={template.templateId}
                            disabledKeys={Array.isArray(sigValue.disabled) ? sigValue.disabled : []}
                            enabledKeys={Array.isArray(sigValue.enabled) ? sigValue.enabled : []}
                        />
                    );
                }

                if (section.type === 'header' || section.type === 'fields') {
                    const sectionValues = (formValues.responses?.[section.id] || {}) as Record<string, unknown>;
                    return (
                        <div key={section.id} className="rounded-md border p-3">
                            <h3 className="mb-3 text-sm font-medium">{section.title || section.id}</h3>
                            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                                {section.fields.map((f) => {
                                    const display = formatReviewValue(f, sectionValues[f.key]);
                                    const isEmpty = display === '—';
                                    return (
                                        <div key={f.key} className="flex flex-col gap-0.5">
                                            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                                {f.label}
                                            </dt>
                                            <dd
                                                className={
                                                    'text-sm ' +
                                                    (isEmpty ? 'italic text-muted-foreground' : 'text-foreground')
                                                }
                                            >
                                                {display}
                                            </dd>
                                        </div>
                                    );
                                })}
                            </dl>
                        </div>
                    );
                }

                if (section.type === 'checklist') {
                    const sectionValues = (formValues.responses?.[section.id] || {}) as Record<
                        string,
                        { result?: string; remarks?: string }
                    >;
                    return (
                        <div key={section.id} className="rounded-md border p-3">
                            <h3 className="mb-3 text-sm font-medium">{section.title || section.id}</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr className="border-b text-xs text-muted-foreground">
                                            <th className="w-12 py-1.5 pr-2 text-left font-medium">Sl No</th>
                                            <th className="py-1.5 pr-2 text-left font-medium">Particulars</th>
                                            <th className="w-24 py-1.5 pr-2 text-left font-medium">Result</th>
                                            <th className="py-1.5 text-left font-medium">Remarks</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {section.items.map((item, idx) => {
                                            const v = sectionValues[item.id] || {};
                                            return (
                                                <tr key={item.id} className="border-b last:border-0 align-top">
                                                    <td className="py-2 pr-2 text-muted-foreground">{idx + 1}</td>
                                                    <td className="py-2 pr-2">{item.particular}</td>
                                                    <td className="py-2 pr-2">
                                                        <ResultBadge value={v.result} />
                                                    </td>
                                                    <td className="py-2 text-muted-foreground">
                                                        {v.remarks?.trim() ? (
                                                            v.remarks
                                                        ) : (
                                                            <span className="italic">—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                }

                if (section.type === 'trainees_data_table') {
                    const rows = (formValues.responses?.[section.id] || []) as unknown as Array<Record<string, unknown>>;
                    // Lux Level Report computes a LUX Average per row in the
                    // print format (mean of lux1/lux2/lux3). Show the same
                    // column in the review for parity. Scoped to the template
                    // + section so other trainees tables stay unchanged.
                    const showLuxAverage =
                        template.templateId === 'lux-level-report' && section.id === 'readings';
                    const luxAverageAfter = 'lux3'; // insert the column after this col.key
                    const luxAvgFor = (row: Record<string, unknown>): string => {
                        const v1 = Number(row?.['lux1']);
                        const v2 = Number(row?.['lux2']);
                        const v3 = Number(row?.['lux3']);
                        if ([v1, v2, v3].some((n) => !Number.isFinite(n))) return '—';
                        return ((v1 + v2 + v3) / 3).toFixed(2);
                    };
                    return (
                        <div key={section.id} className="rounded-md border p-3">
                            <h3 className="mb-3 text-sm font-medium">{section.title || section.id}</h3>
                            {rows.length === 0 ? (
                                <p className="text-xs italic text-muted-foreground">No rows entered.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full border-collapse text-sm">
                                        <thead>
                                            <tr className="border-b text-xs text-muted-foreground">
                                                <th className="w-12 py-1.5 pr-2 text-left font-medium">#</th>
                                                {section.columns.map((c) => (
                                                    <React.Fragment key={c.key}>
                                                        <th className="py-1.5 pr-2 text-left font-medium">
                                                            {c.label}
                                                        </th>
                                                        {showLuxAverage && c.key === luxAverageAfter && (
                                                            <th className="py-1.5 pr-2 text-left font-medium">
                                                                LUX Average
                                                            </th>
                                                        )}
                                                    </React.Fragment>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((row, idx) => (
                                                <tr
                                                    key={idx}
                                                    className="border-b last:border-0 align-top"
                                                >
                                                    <td className="py-2 pr-2 text-muted-foreground">
                                                        {idx + 1}
                                                    </td>
                                                    {section.columns.map((c) => {
                                                        const cellValue = row?.[c.key];
                                                        // Image column: render a thumbnail
                                                        // instead of stringifying the object.
                                                        if (c.type === 'image') {
                                                            const rec = cellValue as
                                                                | AttachmentRecord
                                                                | null
                                                                | undefined;
                                                            return (
                                                                <React.Fragment key={c.key}>
                                                                    <td className="py-2 pr-2">
                                                                        {rec && rec.file_url ? (
                                                                            <a
                                                                                href={rec.file_url}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                title={rec.file_name}
                                                                            >
                                                                                <img
                                                                                    src={rec.file_url}
                                                                                    alt={rec.file_name}
                                                                                    className="h-12 w-12 rounded border object-cover"
                                                                                />
                                                                            </a>
                                                                        ) : (
                                                                            <span className="italic text-muted-foreground">
                                                                                —
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    {showLuxAverage && c.key === luxAverageAfter && (
                                                                        <td className="py-2 pr-2 font-medium">
                                                                            {luxAvgFor(row)}
                                                                        </td>
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        }
                                                        let display = formatReviewValue(
                                                            { ...c, bind: undefined } as Field,
                                                            cellValue,
                                                        );
                                                        // Lux Level Report's `area` always
                                                        // displays uppercase — matches the
                                                        // wizard cell + the printed PDF, even
                                                        // for older saved entries.
                                                        if (
                                                            template.templateId === 'lux-level-report' &&
                                                            section.id === 'readings' &&
                                                            c.key === 'area' &&
                                                            display !== '—'
                                                        ) {
                                                            display = display.toUpperCase();
                                                        }
                                                        const isEmpty = display === '—';
                                                        return (
                                                            <React.Fragment key={c.key}>
                                                                <td
                                                                    className={
                                                                        'py-2 pr-2 ' +
                                                                        (isEmpty
                                                                            ? 'italic text-muted-foreground'
                                                                            : '')
                                                                    }
                                                                >
                                                                    {display}
                                                                </td>
                                                                {showLuxAverage && c.key === luxAverageAfter && (
                                                                    <td className="py-2 pr-2 font-medium">
                                                                        {luxAvgFor(row)}
                                                                    </td>
                                                                )}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    );
                }

                if (section.type === 'measurement_matrix') {
                    const rows = (formValues.responses?.[section.id] || []) as Array<Record<string, unknown>>;
                    return (
                        <div key={section.id} className="rounded-md border p-3">
                            <h3 className="mb-3 text-sm font-medium">{section.title || section.id}</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr className="border-b text-xs text-muted-foreground">
                                            {section.columns.map((c) => (
                                                <React.Fragment key={c.key}>
                                                    <th className="py-1.5 pr-2 text-left font-medium">{c.label}</th>
                                                    <th className="py-1.5 pr-2 text-left font-medium">
                                                        {c.valueLabel
                                                            || (c.type === 'number' && (c as NumberField).unit
                                                                ? `In ${(c as NumberField).unit}`
                                                                : 'Value')}
                                                    </th>
                                                </React.Fragment>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {section.rows.map((rowDef, idx) => {
                                            const row = rows[idx] || {};
                                            return (
                                                <tr key={rowDef.id} className="border-b last:border-0 align-top">
                                                    {section.columns.map((c) => {
                                                        const cellLabel = rowDef.labels[c.key] || '';
                                                        const display = formatReviewValue(
                                                            { ...c, bind: undefined } as Field,
                                                            row[c.key],
                                                        );
                                                        const isEmpty = display === '—';
                                                        return (
                                                            <React.Fragment key={c.key}>
                                                                <td className="py-2 pr-2 font-medium">{cellLabel}</td>
                                                                <td
                                                                    className={
                                                                        'py-2 pr-2 ' +
                                                                        (isEmpty
                                                                            ? 'italic text-muted-foreground'
                                                                            : '')
                                                                    }
                                                                >
                                                                    {display}
                                                                </td>
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                }

                if (section.type === 'image_attachments') {
                    return (
                        <div key={section.id} className="rounded-md border p-3">
                            <h3 className="mb-3 text-sm font-medium">{section.title || section.id}</h3>
                            <div className="space-y-3">
                                {section.slots.map((slot) => {
                                    const items = (formValues.attachments?.[slot.key] || []) as AttachmentSlotValue[];
                                    return (
                                        <div key={slot.key}>
                                            <div className="mb-1.5 flex items-center justify-between">
                                                <span className="text-xs font-medium">{slot.label}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {items.length} file{items.length === 1 ? '' : 's'}
                                                </span>
                                            </div>
                                            {items.length === 0 ? (
                                                <p className="text-xs italic text-muted-foreground">
                                                    No file uploaded
                                                </p>
                                            ) : (
                                                <div className="flex flex-wrap gap-2">
                                                    {items.map((it, i) => {
                                                        const isObj = it && typeof it === 'object';
                                                        const url = isObj ? (it as AttachmentRecord).file_url : '';
                                                        const name = isObj
                                                            ? (it as AttachmentRecord).file_name
                                                            : (it as string);
                                                        const isImage = url && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
                                                        if (url && isImage) {
                                                            return (
                                                                <a
                                                                    key={i}
                                                                    href={url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="block h-16 w-16 overflow-hidden rounded border bg-muted/30"
                                                                    title={name}
                                                                >
                                                                    <img
                                                                        src={url}
                                                                        alt={name}
                                                                        className="h-full w-full object-cover"
                                                                    />
                                                                </a>
                                                            );
                                                        }
                                                        if (url) {
                                                            return (
                                                                <a
                                                                    key={i}
                                                                    href={url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="rounded border bg-muted/30 px-2 py-1 text-xs hover:bg-muted/50"
                                                                >
                                                                    {name}
                                                                </a>
                                                            );
                                                        }
                                                        return (
                                                            <span
                                                                key={i}
                                                                className="rounded border bg-muted/30 px-2 py-1 text-xs"
                                                            >
                                                                {name}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                }

                return null;
            })}
        </div>
    );
};

export default CommissionReportWizard;
