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
import { useUserData } from '@/hooks/useUserData';
import { ArrowLeft, ArrowRight, Loader2, Plus, Printer, Save } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useWatch } from 'react-hook-form';
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
import { useCommissionEditLock } from '../data/useCommissionLock';
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
import { AddZoneDialog, type AddZoneResult } from './AddZoneDialog';
import { ZoneTabBar, type ZoneTab } from './ZoneTabBar';
import type {
    AttachmentRecord,
    AttachmentSlotValue,
    Field,
    NumberField,
    PrefillSnapshot,
    ReportTemplate,
    ResponseData,
    WizardMode,
    WizardStepDef,
    ZoneEntry,
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
    /** Populated only for zone-wise reports (`zone_wise_enable === "YES"`). Each
     *  zone is a fully isolated report; the flat `responses`/`attachments` stay
     *  empty in that mode. */
    zones?: ZoneEntry[];
}

// ─── Zone helpers (zone-wise reports only) ───────────────────────────────────

let zoneIdCounter = 0;
/** Stable unique id for a zone — `crypto.randomUUID` when available, with a
 *  monotonic counter fallback (avoids `Math.random`/`Date.now` collisions). */
const makeZoneId = (): string => {
    try {
        const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
        if (c?.randomUUID) return `z_${c.randomUUID()}`;
    } catch {
        // ignore — fall through to counter
    }
    zoneIdCounter += 1;
    return `z_${zoneIdCounter}_${performance.now().toString(36).replace('.', '')}`;
};

/** Heuristic "does this zone hold user-entered data" — drives the delete-confirm
 *  prompt. A freshly-seeded zone has only prefill-bound header values + empty
 *  checklist/signature shells; we report data when any checklist result, any
 *  signature override, or any non-bound header value is set. Conservative: false
 *  positives only make us confirm a delete (safe), never silently drop data. */
const zoneHasData = (zone: ZoneEntry): boolean => {
    const responses = zone.responses || {};
    for (const sectionVal of Object.values(responses)) {
        if (!sectionVal || typeof sectionVal !== 'object') continue;
        // Checklist: { item: { result, remarks } }, Signatures: { disabled, enabled }.
        for (const v of Object.values(sectionVal as Record<string, unknown>)) {
            if (v === undefined || v === null || v === '') continue;
            if (Array.isArray(v)) {
                if (v.length > 0) return true;
                continue;
            }
            if (typeof v === 'object') {
                for (const inner of Object.values(v as Record<string, unknown>)) {
                    if (inner !== undefined && inner !== null && inner !== '') {
                        if (Array.isArray(inner) ? inner.length > 0 : true) return true;
                    }
                }
                continue;
            }
            // Scalar header value present.
            return true;
        }
    }
    return false;
};

/** Template-specific auto-seeds that the FLAT (non-zone) init applies to
 *  `initialResponses` but the zone path bypasses (each zone is seeded via
 *  resolveInitialValues, which doesn't know the task name). Mirror that seeding
 *  per zone so zone-wise reports get the same auto-detected values. Mutates the
 *  passed `responses` in place; never overwrites an existing value.
 *  Currently: Duct Pressure/Leak readonly header `test_type` (Smoke/Light/
 *  Pressure) detected from the task name. */
const applyZoneAutoSeed = (
    responses: Record<string, Record<string, unknown>>,
    template: ReportTemplate,
    taskName: string | undefined,
): void => {
    if (template.templateId === 'duct-pressure/smoke/light-testing-report' && taskName) {
        const lower = taskName.toLowerCase();
        const detected = lower.includes('pressure')
            ? 'Pressure'
            : lower.includes('smoke')
              ? 'Smoke'
              : lower.includes('light')
                ? 'Light'
                : '';
        if (detected) {
            const hdr = (responses['hdr'] || {}) as Record<string, unknown>;
            if (!hdr.test_type) hdr.test_type = detected;
            responses['hdr'] = hdr;
        }
    }
};

/** Build a fresh, fully-seeded zone. Reuses `resolveInitialValues` so each
 *  zone's header binds from prefill exactly like the non-zone path does, then
 *  applies the same template auto-seeds the flat path does (e.g. Duct test_type). */
const makeZone = (
    label: string,
    template: ReportTemplate,
    prefillDict: PrefillSnapshot,
    taskName?: string,
): ZoneEntry => {
    const responses = resolveInitialValues({ template, prefillDict, existingResponse: null }) as Record<
        string,
        Record<string, unknown>
    >;
    applyZoneAutoSeed(responses, template, taskName);
    return { id: makeZoneId(), label, responses, attachments: {} };
};

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
    const { role } = useUserData();
    const isProjectManager = role === 'Nirmaan Project Manager Profile';
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

    // Hold a live "editing now" lock while the report is open for editing, so the
    // approval queue can warn (and block) approvers that it is mid-edit. View
    // mode takes no lock; lock-API failures never block editing.
    useCommissionEditLock({ taskName: childRowName, enabled: mode === 'edit' || mode === 'fill' });

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

    // ─── Zone-wise state (zone_wise_enable === "YES") ─────────────────────
    const isZoneWise = template?.zone_wise_enable === 'YES';
    // Which zone's inner steps are showing. `reviewActive` selects the combined
    // All-Zones Review tab instead of a single zone. Both inert for non-zone.
    const [activeZoneIndex, setActiveZoneIndex] = useState(0);
    const [reviewActive, setReviewActive] = useState(false);
    // Controls the "Add Another Zone" dialog (opened from the per-zone Review step).
    const [addZoneOpen, setAddZoneOpen] = useState(false);

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

    // Zone field array — structural zone mutations (add / reorder / delete) MUST
    // go through these methods, never `setValue('zones', wholeArray)`. Replacing
    // the whole array while a nested useFieldArray (the active zone's equipments)
    // is mounted desyncs/wipes that zone's data. append/move/remove preserve
    // every other zone's deeply-nested values.
    // FormShape carries an index signature (`extends Record<string, unknown>`)
    // which defeats RHF's FieldArrayPath inference (name resolves to `never`), so
    // the name is cast and `append` is re-typed to ZoneEntry. `move`/`remove` are
    // index-based and need no cast.
    const zoneArray = useFieldArray({ control: form.control, name: 'zones' as never });
    const appendZone = zoneArray.append as (z: ZoneEntry) => void;
    const moveZoneField = zoneArray.move;
    const removeZoneField = zoneArray.remove;

    // Reactive subscription to form values — used to filter wizard steps via visibleIf.
    const watched = useWatch({ control: form.control });

    // Filter steps by visibleIf; this drives navigation, validation, and rendering.
    const visibleStepDefs: WizardStepDef[] = useMemo(() => {
        if (!template?.wizardSteps) return [];
        const visible = template.wizardSteps.filter((s) => isStepVisible(s, watched));
        if (!template.sections) return visible;

        // ── Zone-wise inner steps ──────────────────────────────────────────
        // The OUTER nav is the zone tab bar (active zone). The INNER step bar is
        // the active zone's content steps + a per-zone Review step. Every zone
        // carries the full section set (header → checklist → signatures → review).
        if (isZoneWise) {
            const zi = activeZoneIndex;
            const sectionsById = new Map(template.sections.map((s) => [s.id, s]));
            const contentSteps = visible.filter((s) => s.sections.length > 0);
            // The active zone's own responses — the count binding + group array
            // for any repeating_groups section live here (NOT the flat root).
            const zoneResponses = (
                watched as { zones?: Array<{ responses?: Record<string, unknown> }> } | undefined
            )?.zones?.[zi]?.responses;

            const zoneSteps: WizardStepDef[] = [];
            for (const step of contentSteps) {
                // Expand a `repeating_groups` content step into N per-group
                // sub-steps, scoped to THIS zone's responses (mirrors the
                // non-zone expansion below). Count = max(declared, current
                // groups) so user-added extras stay navigable.
                if (step.sections.length === 1) {
                    const sec = sectionsById.get(step.sections[0]);
                    if (sec && sec.type === 'repeating_groups' && sec.countBoundTo) {
                        const declaredRaw = sec.countBoundTo
                            .replace(/^responses\./, '')
                            .split('.')
                            .reduce<unknown>((acc, k) => {
                                if (acc && typeof acc === 'object') {
                                    return (acc as Record<string, unknown>)[k];
                                }
                                return undefined;
                            }, zoneResponses);
                        const declared = Number(declaredRaw);
                        const groupsArrRaw = (zoneResponses as Record<string, unknown> | undefined)?.[
                            sec.id
                        ];
                        const actualLen = Array.isArray(groupsArrRaw) ? groupsArrRaw.length : 0;
                        const n = Math.max(
                            Number.isFinite(declared) && declared > 0 ? Math.floor(declared) : 0,
                            actualLen,
                        );
                        if (n > 0) {
                            const prefix = sec.groupTitlePrefix || step.title;
                            for (let i = 0; i < n; i++) {
                                zoneSteps.push({
                                    key: `zone${zi}_${step.key}_${i + 1}`,
                                    title: `${prefix} ${i + 1}`,
                                    sections: step.sections,
                                    zoneSlice: { zoneIndex: zi },
                                    groupSlice: { sectionId: sec.id, groupIndex: i },
                                });
                            }
                            continue;
                        }
                    }
                }
                zoneSteps.push({
                    ...step,
                    key: `zone${zi}_${step.key}`,
                    zoneSlice: { zoneIndex: zi },
                });
            }
            // Per-zone Review step (empty sections = Review).
            zoneSteps.push({
                key: `zone${zi}_review`,
                title: 'Review',
                sections: [],
                zoneSlice: { zoneIndex: zi },
            });
            return zoneSteps;
        }

        const sectionsById = new Map(template.sections.map((s) => [s.id, s]));
        // Expand any step whose single section is a `repeating_groups` with a
        // `countBoundTo` header binding into N synthetic per-group steps.
        // Count = max(declared, currentGroups) — preserves user-added extras so
        // the user can navigate to and remove them.
        const expanded: WizardStepDef[] = [];
        for (const step of visible) {
            if (step.sections.length === 1) {
                const sec = sectionsById.get(step.sections[0]);
                if (sec && sec.type === 'repeating_groups' && sec.countBoundTo) {
                    const declaredRaw = sec.countBoundTo
                        .split('.')
                        .reduce<unknown>((acc, k) => {
                            if (acc && typeof acc === 'object') {
                                return (acc as Record<string, unknown>)[k];
                            }
                            return undefined;
                        }, watched);
                    const declared = Number(declaredRaw);
                    const groupsArrRaw = (watched as { responses?: Record<string, unknown> } | undefined)
                        ?.responses?.[sec.id];
                    const actualLen = Array.isArray(groupsArrRaw) ? groupsArrRaw.length : 0;
                    const n = Math.max(
                        Number.isFinite(declared) && declared > 0 ? Math.floor(declared) : 0,
                        actualLen,
                    );
                    if (n > 0) {
                        const prefix = sec.groupTitlePrefix || step.title;
                        for (let i = 0; i < n; i++) {
                            expanded.push({
                                key: `${step.key}_${i + 1}`,
                                title: `${prefix} ${i + 1}`,
                                sections: step.sections,
                                groupSlice: { sectionId: sec.id, groupIndex: i },
                            });
                        }
                        continue;
                    }
                }
            }
            expanded.push(step);
        }
        return expanded;
    }, [template, watched, isZoneWise, activeZoneIndex]);

    // Derive the zone tab list (label + hasData) for the zone tab bar.
    const zoneTabs: ZoneTab[] = useMemo(() => {
        if (!isZoneWise) return [];
        const zones = (watched.zones as ZoneEntry[] | undefined) || [];
        return zones.map((z) => ({
            id: z.id,
            label: z.label,
            hasData: zoneHasData(z),
        }));
    }, [isZoneWise, watched.zones]);

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

    // In view mode, open straight on the single-page Review summary (the auto step
    // with no sections), instead of paging through every step.
    // IMPORTANT: only when the report is actually FILLED. While the parent doc is
    // still loading, `canEdit` is false → `mode` is transiently "view"; without the
    // isFilled guard a fresh fill would wrongly jump to Review and get stuck there.
    const viewJumpedRef = useRef(false);
    useEffect(() => {
        if (mode !== 'view' || !isFilled || viewJumpedRef.current || visibleStepDefs.length === 0) return;
        const reviewIdx = visibleStepDefs.findIndex((s) => s.sections.length === 0);
        setCurrentStep(reviewIdx >= 0 ? reviewIdx : visibleStepDefs.length - 1);
        viewJumpedRef.current = true;
    }, [mode, isFilled, visibleStepDefs]);

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

        // Duct Pressure / Leak Test: detect Test Type from the task name
        // (Smoke / Light / Pressure) and seed both header.test_type AND
        // general_desc.test_type. Header is readonly (compliance / audit);
        // general_desc.test_type is editable so the user can override if the
        // task name is misleading. `Type of Duct` is a separate user-entered
        // field. Existing saved values are preserved.
        if (template.templateId === 'duct-pressure/smoke/light-testing-report' && childRow?.task_name) {
            const lower = childRow.task_name.toLowerCase();
            const detected = lower.includes('pressure')
                ? 'Pressure'
                : lower.includes('smoke')
                  ? 'Smoke'
                  : lower.includes('light')
                    ? 'Light'
                    : '';
            if (detected) {
                const hdr = (initialResponses['hdr'] || {}) as Record<string, unknown>;
                if (!hdr.test_type) hdr.test_type = detected;
                initialResponses['hdr'] = hdr;
                const gd = (initialResponses['general_desc'] || {}) as Record<string, unknown>;
                if (!gd.test_type) gd.test_type = detected;
                initialResponses['general_desc'] = gd;
            }
        }

        const seededAttachments: Record<string, AttachmentSlotValue[]> = {};
        if (existingResponse?.attachments) {
            for (const [k, v] of Object.entries(existingResponse.attachments)) {
                if (Array.isArray(v)) seededAttachments[k] = v as AttachmentSlotValue[];
            }
        }

        // Zone-wise: seed/reconstruct the zones array, leaving the flat
        // responses/attachments empty. The non-zone path is byte-for-byte unchanged.
        if (isZoneWise) {
            const savedZones = existingResponse?.zoneWise && Array.isArray(existingResponse.zones)
                ? existingResponse.zones
                : null;
            let zones: ZoneEntry[];
            if (savedZones && savedZones.length > 0) {
                // Edit/view: rebuild each saved zone, re-running resolveInitialValues
                // per zone so newly-added template fields get sane defaults while
                // saved values are preserved.
                zones = savedZones.map((z, i) => {
                    const responses = resolveInitialValues({
                        template,
                        prefillDict,
                        existingResponse: {
                            responses: (z.responses || {}) as Record<string, Record<string, unknown>>,
                        } as ResponseData,
                    }) as Record<string, Record<string, unknown>>;
                    applyZoneAutoSeed(responses, template, childRow?.task_name);
                    return {
                        id: typeof z.id === 'string' && z.id ? z.id : makeZoneId(),
                        label: typeof z.label === 'string' && z.label ? z.label : `Zone ${i + 1}`,
                        responses,
                        attachments:
                            z.attachments && typeof z.attachments === 'object'
                                ? (z.attachments as Record<string, AttachmentSlotValue[]>)
                                : {},
                    };
                });
            } else {
                // Fresh fill: one default zone.
                zones = [makeZone('Zone 1', template, prefillDict, childRow?.task_name)];
            }
            form.reset({
                responses: {},
                attachments: {},
                zones,
            });
            initializedRef.current = true;
            return;
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
        isZoneWise,
        prefillDict,
        template,
    ]);

    // Duct Pressure/Leak `test_type` is READONLY and 100% derived from the task
    // name (Smoke / Light / Pressure), so the user can't fill it — it must be
    // auto-set. Enforce it on EVERY zone whenever empty (idempotent: skips zones
    // that already have it). This covers fresh zones, added zones, resumed
    // drafts, and zones created before per-zone seeding existed.
    const detectedDuctTestType = useMemo(() => {
        if (template?.templateId !== 'duct-pressure/smoke/light-testing-report') return '';
        const lower = (childRow?.task_name || '').toLowerCase();
        return lower.includes('pressure')
            ? 'Pressure'
            : lower.includes('smoke')
              ? 'Smoke'
              : lower.includes('light')
                ? 'Light'
                : '';
    }, [template?.templateId, childRow?.task_name]);
    const numZonesForSeed = (watched.zones as ZoneEntry[] | undefined)?.length ?? 0;
    useEffect(() => {
        if (!isZoneWise || !detectedDuctTestType) return;
        const zones = (form.getValues() as FormShape).zones || [];
        zones.forEach((z, i) => {
            const cur = (z.responses?.hdr as Record<string, unknown> | undefined)?.test_type;
            if (!cur) {
                form.setValue(
                    `zones.${i}.responses.hdr.test_type` as `zones.${number}.responses.hdr.test_type`,
                    detectedDuctTestType,
                    { shouldDirty: false },
                );
            }
        });
    }, [isZoneWise, detectedDuctTestType, numZonesForSeed, form]);

    // ─── Lifecycle hooks ──────────────────────────────────────────────────
    const [isCommitted, setIsCommitted] = useState(false);
    const keepNamesRef = useRef<string[]>([]);

    // Collect every File docname currently referenced anywhere in the form so
    // the orphan janitor keeps them. A single recursive walk over the whole
    // form value covers the flat `attachments` map + inline per-row records in
    // `responses` (e.g. trainees_data_table photos) AND, for zone-wise reports,
    // every `zones[i].attachments` map + `zones[i].responses` (per-equipment
    // photos in a repeating_groups section live in the zone's attachments map).
    const updateKeepNames = useCallback((formValues: unknown) => {
        const all: string[] = [];
        const visit = (node: unknown): void => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) {
                for (const item of node) visit(item);
                return;
            }
            const obj = node as Record<string, unknown>;
            if (typeof obj.file_doc === 'string' && obj.file_doc) {
                all.push(obj.file_doc);
                return;
            }
            for (const v of Object.values(obj)) visit(v);
        };
        visit(formValues);
        keepNamesRef.current = all;
    }, []);

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

        // Zone steps validate the EXISTING validateStep against a per-zone VIEW
        // ({ responses: zones[i].responses }) and re-root the result paths onto
        // the real `zones.<i>.responses…` form keys. Non-zone uses form values
        // directly (unchanged).
        const zoneIdx = step.zoneSlice?.zoneIndex;
        const reroot = (path: string, i: number): string =>
            path.startsWith('responses') ? `zones.${i}.${path}` : path;

        // Clear any prior errors on this step's fields, then re-validate.
        const stepKeys = getRhfKeysForStep(template, step).map((k) =>
            zoneIdx !== undefined ? reroot(k, zoneIdx) : k,
        );
        for (const k of stepKeys) {
            form.clearErrors(k as Parameters<typeof form.clearErrors>[0]);
        }
        const valuesForStep =
            zoneIdx !== undefined
                ? {
                      responses:
                          ((form.getValues() as FormShape).zones?.[zoneIdx]?.responses as Record<
                              string,
                              unknown
                          >) || {},
                  }
                : form.getValues();
        const rawStepErrors = validateStep(template, step, valuesForStep);
        const stepErrors =
            zoneIdx !== undefined
                ? rawStepErrors.map((e) => ({ ...e, path: reroot(e.path, zoneIdx) }))
                : rawStepErrors;
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
    // (isZoneWise/activeZoneIndex flow through `visibleStepDefs` + step.zoneSlice.)

    const handleBack = useCallback(() => {
        setCurrentStep((n) => Math.max(0, n - 1));
    }, []);

    // ─── Submit ───────────────────────────────────────────────────────────
    const handleSubmit = useCallback(async () => {
        if (!template || !parentDoc || !childRow) return;

        // Final full-template validation. Zone-wise validates EVERY zone against
        // the existing validateTemplate using a per-zone view, re-rooting each
        // error path onto `zones.<i>.responses…`. Non-zone is unchanged.
        form.clearErrors();
        const allValues = form.getValues() as FormShape;
        let fullErrors: { path: string; message: string }[];
        if (isZoneWise) {
            const zones = allValues.zones || [];
            fullErrors = [];
            zones.forEach((zone, i) => {
                const zoneErrors = validateTemplate(template, {
                    responses: (zone.responses as Record<string, unknown>) || {},
                });
                for (const e of zoneErrors) {
                    fullErrors.push({
                        ...e,
                        path: e.path.startsWith('responses') ? `zones.${i}.${e.path}` : e.path,
                        message: `${zone.label}: ${e.message}`,
                    });
                }
            });
        } else {
            fullErrors = validateTemplate(template, allValues);
        }
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

        const values = form.getValues() as FormShape;
        const prefillSnapshot = buildPrefillSnapshot(template, prefillDict);
        const responseData: ResponseData = {
            templateId: template.templateId,
            templateVersion: template.templateVersion,
            snapshotHash: '', // backend computes + returns; we'll set it in cache update if needed
            filledAt: existingResponse?.filledAt || new Date().toISOString(),
            filledBy: existingResponse?.filledBy || currentUser || '',
            lastEditedAt: new Date().toISOString(),
            prefillSnapshot,
            // Zone-wise: data lives in `zones[]`; the flat shape stays empty.
            // Non-zone: the reverse (unchanged).
            ...(isZoneWise
                ? {
                      zoneWise: true as const,
                      zones: (values.zones || []) as ZoneEntry[],
                      responses: {},
                      attachments: {},
                  }
                : {
                      responses: values.responses as ResponseData['responses'],
                      attachments: values.attachments,
                  }),
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
            updateKeepNames(values);
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
        isZoneWise,
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
    // The combined All-Zones Review is its own final surface (only when >1 zone).
    const showCombinedReview = isZoneWise && reviewActive;
    const isFinalStep = step && currentStep === visibleStepDefs.length - 1;
    // Project Managers get a locked single-page Review preview (no back/step nav).
    const lockNav = isProjectManager && mode === 'view';
    const sectionsById = new Map(template.sections.map((s) => [s.id, s]));

    // Zone count (live) — drives "≥ 1 zone" guards + the All-Zones Review tab.
    const zoneCount = zoneTabs.length;
    // Submit lives on the final surface: the combined review when >1 zone, else
    // the (single) zone's own per-zone review step.
    const showSubmit = isZoneWise
        ? showCombinedReview || (zoneCount <= 1 && isReviewStep)
        : isFinalStep;

    // Zone tab handlers — mutate the RHF `zones` field array directly.
    const goToZone = (i: number) => {
        setReviewActive(false);
        setActiveZoneIndex(i);
        setCurrentStep(0);
    };
    // Confirm from the Add-Another-Zone dialog: (a) optionally rename the current
    // zone, (b) append one new zone per name via makeZone, (c) navigate to the
    // FIRST newly created zone (Header step, no review).
    const handleConfirmAddZone = (result: AddZoneResult) => {
        const zones = (form.getValues() as FormShape).zones || [];
        const firstNewIndex = zones.length;
        // (a) Rename the current zone if requested + changed. Leaf-set the label
        // ONLY — never rebuild the zone object (that would drop its nested data).
        if (
            result.renameCurrentTo &&
            zones[activeZoneIndex] &&
            zones[activeZoneIndex].label !== result.renameCurrentTo
        ) {
            form.setValue(
                `zones.${activeZoneIndex}.label` as `zones.${number}.label`,
                result.renameCurrentTo,
                { shouldDirty: true },
            );
        }
        // (b) Append one new zone per name (append preserves existing zones' data).
        for (const name of result.newNames) {
            appendZone(makeZone(name, template, prefillDict, childRow?.task_name));
        }
        setAddZoneOpen(false);
        // (c) Navigate to the first new zone, full workflow from Header.
        goToZone(firstNewIndex);
    };
    const handleRenameZone = (i: number, label: string) => {
        const zones = (form.getValues() as FormShape).zones || [];
        if (!zones[i]) return;
        // Leaf-set the label only — the zone's nested data is untouched.
        form.setValue(`zones.${i}.label` as `zones.${number}.label`, label, { shouldDirty: true });
    };
    const handleReorderZone = (from: number, to: number) => {
        const zones = (form.getValues() as FormShape).zones || [];
        if (from === to || from < 0 || to < 0 || from >= zones.length || to >= zones.length) return;
        moveZoneField(from, to);
        // Keep the same zone selected as it moves (its data travels inside the
        // zone object, so we only re-anchor the active index).
        if (!reviewActive) {
            if (activeZoneIndex === from) setActiveZoneIndex(to);
            else if (from < activeZoneIndex && activeZoneIndex <= to) setActiveZoneIndex(activeZoneIndex - 1);
            else if (to <= activeZoneIndex && activeZoneIndex < from) setActiveZoneIndex(activeZoneIndex + 1);
        }
    };
    const handleDeleteZone = (i: number) => {
        const zones = (form.getValues() as FormShape).zones || [];
        if (zones.length <= 1) return; // always ≥ 1 zone
        removeZoneField(i);
        // Re-anchor against the POST-removal length: a zone after the active one
        // is gone → active unchanged; deleting before/at the active one shifts it
        // down; clamp to the new last index.
        const newLen = zones.length - 1;
        let nextActive = activeZoneIndex > i ? activeZoneIndex - 1 : activeZoneIndex;
        nextActive = Math.max(0, Math.min(nextActive, newLen - 1));
        setActiveZoneIndex(nextActive);
        if (reviewActive && newLen <= 1) {
            setReviewActive(false);
            setCurrentStep(0);
        } else if (!reviewActive && activeZoneIndex >= i) {
            setCurrentStep(0);
        }
    };

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
                            {isFilled && !isProjectManager && (
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
                        <h1 className="text-lg font-semibold">
                            {/* The Duct template's `title` is the combined
                                "Pressure / Smoke / Light" string shared by 3 tasks —
                                show the specific task name instead. */}
                            {template.templateId === 'duct-pressure/smoke/light-testing-report'
                                ? childRow.task_name
                                : template.title}
                        </h1>
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

                {/* Zone tab bar — the OUTER nav, shown only once there is MORE
                    than one zone. A single-zone report looks like an ordinary
                    report (no switcher, no add button); adding happens via the
                    [Add Another Zone] dialog on the per-zone Review step. */}
                {isZoneWise && zoneCount > 1 && (
                    <ZoneTabBar
                        zones={zoneTabs}
                        activeZoneIndex={activeZoneIndex}
                        reviewActive={reviewActive}
                        readonly={mode === 'view' || lockNav}
                        onSelectZone={goToZone}
                        onSelectReview={() => {
                            setReviewActive(true);
                        }}
                        onRenameZone={handleRenameZone}
                        onReorderZone={handleReorderZone}
                        onDeleteZone={handleDeleteZone}
                    />
                )}

                {/* Inner step bar — hidden while the combined review is showing. */}
                {!showCombinedReview && wizardSteps.length > 1 && (
                    <WizardSteps
                        steps={wizardSteps}
                        currentStep={currentStep}
                        onStepClick={(idx) => {
                            // Project Managers preview is locked to the single Review page.
                            if (lockNav) return;
                            // Allow back-nav freely; forward only if validating each gate would pass — keep simple here.
                            if (idx <= currentStep) setCurrentStep(idx);
                        }}
                        allowForwardNavigation={false}
                    />
                )}

                <main className="min-h-[300px] space-y-6">
                    {showCombinedReview ? (
                        // ── All-Zones combined review (only when zones.length > 1) ──
                        <div className="space-y-8">
                            <div>
                                <h2 className="text-base font-semibold">All-Zones Review</h2>
                                <p className="text-xs text-muted-foreground">
                                    Every zone's answers, one after another. Use a zone tab above to
                                    make corrections, then submit.
                                </p>
                            </div>
                            {((form.getValues() as FormShape).zones || []).map((zone) => (
                                <div key={zone.id} className="space-y-4 rounded-md border p-4">
                                    <h3 className="text-sm font-semibold text-primary">{zone.label}</h3>
                                    <ReviewSummary
                                        template={template}
                                        formValues={{
                                            responses: (zone.responses as Record<string, unknown>) || {},
                                            attachments:
                                                (zone.attachments as Record<
                                                    string,
                                                    AttachmentSlotValue[]
                                                >) || {},
                                        }}
                                        projectId={projectId}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : step && !isReviewStep ? (
                        step.sections.map((sid) => {
                            const section = sectionsById.get(sid);
                            if (!section) return null;
                            // For synthetic per-group steps generated from a
                            // `repeating_groups` section, pass the target group
                            // index so the renderer shows only that group.
                            const groupIndexFilter =
                                step.groupSlice && step.groupSlice.sectionId === sid
                                    ? step.groupSlice.groupIndex
                                    : undefined;
                            // Zone steps scope every input to this zone's own
                            // responses + attachments maps.
                            const responsesRoot =
                                step.zoneSlice !== undefined
                                    ? `zones.${step.zoneSlice.zoneIndex}.responses`
                                    : undefined;
                            const attachmentsRoot =
                                step.zoneSlice !== undefined
                                    ? `zones.${step.zoneSlice.zoneIndex}.attachments`
                                    : undefined;
                            return (
                                <SectionRenderer
                                    // Zone steps MUST remount on zone switch: a
                                    // bare `sid` key is identical across zones, so
                                    // React reuses the (uncontrolled) inputs and
                                    // they display the previous zone's typed text
                                    // while each zone's RHF state stays separate.
                                    // step.key is zone-qualified (zone0_header …).
                                    key={step.zoneSlice !== undefined ? `${step.key}-${sid}` : sid}
                                    section={section}
                                    parentName={parentName}
                                    childRowName={childRowName}
                                    projectId={projectId}
                                    templateId={template.templateId}
                                    forceReadonly={mode === 'view'}
                                    onAttachmentCreated={(fileDoc) => {
                                        track(fileDoc);
                                        updateKeepNames(form.getValues());
                                    }}
                                    groupIndexFilter={groupIndexFilter}
                                    responsesRoot={responsesRoot}
                                    attachmentsRoot={attachmentsRoot}
                                />
                            );
                        })
                    ) : step && step.zoneSlice !== undefined ? (
                        // ── Per-zone review (each zone ends with its own review) ──
                        <div className="space-y-4">
                            <div>
                                <h2 className="text-base font-semibold">
                                    Review — {zoneTabs[step.zoneSlice.zoneIndex]?.label || 'Zone'}
                                </h2>
                                <p className="text-xs text-muted-foreground">
                                    Check this zone's answers below. Use Back to make corrections.
                                </p>
                            </div>
                            <ReviewSummary
                                template={template}
                                formValues={{
                                    responses:
                                        (((form.getValues() as FormShape).zones?.[
                                            step.zoneSlice.zoneIndex
                                        ]?.responses as Record<string, unknown>) || {}),
                                    attachments:
                                        (((form.getValues() as FormShape).zones?.[
                                            step.zoneSlice.zoneIndex
                                        ]?.attachments as Record<string, AttachmentSlotValue[]>) || {}),
                                }}
                                projectId={projectId}
                            />
                        </div>
                    ) : (
                        <ReviewSummary
                            template={template}
                            formValues={form.getValues()}
                            projectId={projectId}
                        />
                    )}
                </main>

                {!lockNav && (
                <footer className="flex items-center justify-between gap-3 border-t pt-3">
                    {showCombinedReview ? (
                        <Button
                            variant="outline"
                            onClick={() => {
                                // Back from the combined review → the last zone's review step.
                                setReviewActive(false);
                                setActiveZoneIndex(zoneCount - 1);
                                setCurrentStep(Math.max(0, visibleStepDefs.length - 1));
                            }}
                        >
                            <ArrowLeft className="mr-1 h-4 w-4" />
                            Back
                        </Button>
                    ) : (
                        <Button variant="outline" onClick={handleBack} disabled={currentStep === 0}>
                            <ArrowLeft className="mr-1 h-4 w-4" />
                            Back
                        </Button>
                    )}
                    {showSubmit ? (
                        // Per-zone Review (or the combined review): Submit, plus an
                        // [Add Another Zone] action on a per-zone Review step (not
                        // on the combined All-Zones Review).
                        mode !== 'view' && (
                            <div className="flex items-center gap-2">
                                {isZoneWise && !showCombinedReview && isReviewStep && (
                                    <Button
                                        variant="outline"
                                        onClick={() => setAddZoneOpen(true)}
                                        disabled={isSubmitting}
                                    >
                                        <Plus className="mr-1 h-4 w-4" />
                                        Add Another Zone
                                    </Button>
                                )}
                                <Button onClick={handleSubmit} disabled={isSubmitting}>
                                    {isSubmitting ? (
                                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                    ) : (
                                        <Save className="mr-1 h-4 w-4" />
                                    )}
                                    {mode === 'edit' ? 'Save changes' : 'Submit report'}
                                </Button>
                            </div>
                        )
                    ) : isZoneWise && isReviewStep && !reviewActive && zoneCount > 1 ? (
                        // End of a zone (>1 zone): advance to the All-Zones Review,
                        // plus [Add Another Zone] from this zone's Review.
                        <div className="flex items-center gap-2">
                            {mode !== 'view' && (
                                <Button
                                    variant="outline"
                                    onClick={() => setAddZoneOpen(true)}
                                >
                                    <Plus className="mr-1 h-4 w-4" />
                                    Add Another Zone
                                </Button>
                            )}
                            <Button
                                onClick={() => {
                                    setReviewActive(true);
                                }}
                            >
                                Next: All-Zones Review
                                <ArrowRight className="ml-1 h-4 w-4" />
                            </Button>
                        </div>
                    ) : (
                        <Button onClick={handleNext}>
                            Next
                            <ArrowRight className="ml-1 h-4 w-4" />
                        </Button>
                    )}
                </footer>
                )}

                {isConflict && (
                    <ConflictBanner
                        onRefresh={() => {
                            clearConflict();
                            void refetchParent();
                        }}
                    />
                )}
            </FormProvider>

            {isZoneWise && (
                <AddZoneDialog
                    open={addZoneOpen}
                    onOpenChange={setAddZoneOpen}
                    currentLabel={zoneTabs[activeZoneIndex]?.label || `Zone ${activeZoneIndex + 1}`}
                    existingLabels={zoneTabs.map((z) => z.label)}
                    onConfirm={handleConfirmAddZone}
                />
            )}

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

                if (section.type === 'repeating_groups') {
                    const groups = (formValues.responses?.[section.id] || []) as Array<
                        Record<string, unknown>
                    >;
                    const titlePrefix = section.groupTitlePrefix || 'Group';
                    return (
                        <div key={section.id} className="rounded-md border p-3">
                            <h3 className="mb-3 text-sm font-medium">
                                {section.title || section.id}
                            </h3>
                            {groups.length === 0 ? (
                                <p className="text-xs italic text-muted-foreground">
                                    No groups entered.
                                </p>
                            ) : (
                                <div className="space-y-4">
                                    {groups.map((group, gIdx) => {
                                        const rows = (Array.isArray(group?.rows)
                                            ? (group.rows as Array<Record<string, unknown>>)
                                            : []);
                                        return (
                                            <div
                                                key={gIdx}
                                                className="rounded-md border bg-muted/10"
                                            >
                                                <div className="border-b bg-muted/20 px-3 py-1.5 text-xs font-semibold text-foreground">
                                                    {titlePrefix} {gIdx + 1}
                                                </div>
                                                <div className="space-y-3 p-3">
                                                    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                                                        {section.groupFields.map((f) => {
                                                            const display = formatReviewValue(
                                                                f,
                                                                group?.[f.key],
                                                            );
                                                            const isEmpty = display === '—';
                                                            return (
                                                                <div
                                                                    key={f.key}
                                                                    className="flex flex-col gap-0.5"
                                                                >
                                                                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                                                        {f.label}
                                                                    </dt>
                                                                    <dd
                                                                        className={
                                                                            'text-sm ' +
                                                                            (isEmpty
                                                                                ? 'italic text-muted-foreground'
                                                                                : 'text-foreground')
                                                                        }
                                                                    >
                                                                        {display}
                                                                    </dd>
                                                                </div>
                                                            );
                                                        })}
                                                    </dl>
                                                    {section.rowsTable && rows.length > 0 && (
                                                        <div className="overflow-x-auto">
                                                            <table className="w-full border-collapse text-sm">
                                                                <thead>
                                                                    <tr className="border-b text-xs text-muted-foreground">
                                                                        <th className="w-12 py-1.5 pr-2 text-left font-medium">
                                                                            #
                                                                        </th>
                                                                        {section.rowsTable!.columns.map(
                                                                            (c) => (
                                                                                <th
                                                                                    key={c.key}
                                                                                    className="py-1.5 pr-2 text-left font-medium"
                                                                                >
                                                                                    {c.label}
                                                                                </th>
                                                                            ),
                                                                        )}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {rows.map((row, rIdx) => (
                                                                        <tr
                                                                            key={rIdx}
                                                                            className="border-b last:border-0 align-top"
                                                                        >
                                                                            <td className="py-2 pr-2 text-muted-foreground">
                                                                                {rIdx + 1}
                                                                            </td>
                                                                            {section.rowsTable!.columns.map(
                                                                                (c) => {
                                                                                    const display = formatReviewValue(
                                                                                        { ...c, bind: undefined } as Field,
                                                                                        row?.[c.key],
                                                                                    );
                                                                                    const isEmpty =
                                                                                        display === '—';
                                                                                    return (
                                                                                        <td
                                                                                            key={c.key}
                                                                                            className={
                                                                                                'py-2 pr-2 ' +
                                                                                                (isEmpty
                                                                                                    ? 'italic text-muted-foreground'
                                                                                                    : '')
                                                                                            }
                                                                                        >
                                                                                            {display}
                                                                                        </td>
                                                                                    );
                                                                                },
                                                                            )}
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                                    {/* Per-group nested sections (e.g. Physical
                                                        Test checklist + Timer note for DX/VRF). */}
                                                    {section.nestedSections &&
                                                        section.nestedSections.length > 0 && (
                                                            <div className="space-y-3 pt-2">
                                                                {section.nestedSections.map((nested) => {
                                                                    const nestedVals =
                                                                        (group?.[nested.id] as
                                                                            | Record<string, unknown>
                                                                            | undefined) || {};
                                                                    // Per-group visibleIf: skip a nested section whose gate doesn't match this
                                                                    // group's values (e.g. show only the IR matrix for the selected Phase).
                                                                    const vIf = (nested as { visibleIf?: { field: string; equals?: unknown; in?: unknown[] } }).visibleIf;
                                                                    if (vIf) {
                                                                        const gvN = (group as Record<string, unknown> | undefined)?.[vIf.field];
                                                                        const okN = Array.isArray(vIf.in) ? vIf.in.includes(gvN) : vIf.equals !== undefined ? gvN === vIf.equals : true;
                                                                        if (!okN) return null;
                                                                    }
                                                                    if (nested.type === 'checklist') {
                                                                        return (
                                                                            <div key={nested.id} className="rounded-md border bg-background">
                                                                                {nested.title && (
                                                                                    <div className="border-b bg-muted/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                                                        {nested.title}
                                                                                    </div>
                                                                                )}
                                                                                <div className="overflow-x-auto">
                                                                                    <table className="w-full border-collapse text-sm">
                                                                                        <thead>
                                                                                            <tr className="border-b text-xs text-muted-foreground">
                                                                                                <th className="w-12 py-1.5 pl-3 pr-2 text-left font-medium">
                                                                                                    #
                                                                                                </th>
                                                                                                <th className="py-1.5 pr-2 text-left font-medium">
                                                                                                    Particulars
                                                                                                </th>
                                                                                                <th className="w-24 py-1.5 pr-2 text-left font-medium">
                                                                                                    Result
                                                                                                </th>
                                                                                                <th className="py-1.5 pr-3 text-left font-medium">
                                                                                                    Remarks
                                                                                                </th>
                                                                                            </tr>
                                                                                        </thead>
                                                                                        <tbody>
                                                                                            {nested.items.map(
                                                                                                (item, iIdx) => {
                                                                                                    const iv =
                                                                                                        (nestedVals[item.id] as
                                                                                                            | {
                                                                                                                  result?: string;
                                                                                                                  remarks?: string;
                                                                                                              }
                                                                                                            | undefined) || {};
                                                                                                    return (
                                                                                                        <tr key={item.id} className="border-b last:border-0 align-top">
                                                                                                            <td className="py-2 pl-3 pr-2 text-muted-foreground">
                                                                                                                {iIdx + 1}
                                                                                                            </td>
                                                                                                            <td className="py-2 pr-2">
                                                                                                                {item.particular}
                                                                                                            </td>
                                                                                                            <td className="py-2 pr-2">
                                                                                                                <ResultBadge value={iv.result} />
                                                                                                            </td>
                                                                                                            <td className="py-2 pr-3 text-muted-foreground">
                                                                                                                {iv.remarks?.trim() ? (
                                                                                                                    iv.remarks
                                                                                                                ) : (
                                                                                                                    <span className="italic">—</span>
                                                                                                                )}
                                                                                                            </td>
                                                                                                        </tr>
                                                                                                    );
                                                                                                },
                                                                                            )}
                                                                                        </tbody>
                                                                                    </table>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    }
                                                                    if (nested.type === 'measurement_matrix') {
                                                                        const mrows = (group?.[nested.id] as Array<Record<string, unknown>> | undefined) || [];
                                                                        return (
                                                                            <div key={nested.id} className="rounded-md border bg-background">
                                                                                {nested.title && (
                                                                                    <div className="border-b bg-muted/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                                                        {nested.title}
                                                                                    </div>
                                                                                )}
                                                                                <div className="overflow-x-auto">
                                                                                    <table className="w-full border-collapse text-sm">
                                                                                        <thead>
                                                                                            <tr className="border-b text-xs text-muted-foreground">
                                                                                                {nested.columns.map((c) => (
                                                                                                    <React.Fragment key={c.key}>
                                                                                                        <th className="py-1.5 pl-3 pr-2 text-left font-medium">{c.label}</th>
                                                                                                        <th className="py-1.5 pr-2 text-left font-medium">{c.valueLabel || (c.type === 'number' && (c as NumberField).unit ? `In ${(c as NumberField).unit}` : 'Value')}</th>
                                                                                                    </React.Fragment>
                                                                                                ))}
                                                                                            </tr>
                                                                                        </thead>
                                                                                        <tbody>
                                                                                            {nested.rows.map((rowDef, rIdx) => {
                                                                                                const rr = mrows[rIdx] || {};
                                                                                                return (
                                                                                                    <tr key={rowDef.id} className="border-b last:border-0 align-top">
                                                                                                        {nested.columns.map((c) => {
                                                                                                            const cellLabel = rowDef.labels[c.key] || '';
                                                                                                            const display = formatReviewValue({ ...c, bind: undefined } as Field, rr[c.key]);
                                                                                                            const isEmpty = display === '—';
                                                                                                            return (
                                                                                                                <React.Fragment key={c.key}>
                                                                                                                    <td className="py-2 pl-3 pr-2 font-medium">{cellLabel}</td>
                                                                                                                    <td className={'py-2 pr-2 ' + (isEmpty ? 'italic text-muted-foreground' : '')}>{display}</td>
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
                                                                    if (nested.type === 'process') {
                                                                        // Process sections have no input — show the
                                                                        // declared note text so the operator can
                                                                        // confirm what was tested.
                                                                        return (
                                                                            <div key={nested.id} className="rounded-md border bg-background">
                                                                                {nested.title && (
                                                                                    <div className="border-b bg-muted/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                                                        {nested.title}
                                                                                    </div>
                                                                                )}
                                                                                <div className="space-y-2 p-3 text-sm">
                                                                                    {nested.blocks.map(
                                                                                        (block, bIdx) => (
                                                                                            <div key={bIdx} className="space-y-1">
                                                                                                {block.subtitle && (
                                                                                                    <div className="text-xs font-medium">
                                                                                                        {block.subtitle}
                                                                                                    </div>
                                                                                                )}
                                                                                                {block.items.map(
                                                                                                    (line, lIdx) => (
                                                                                                        <div key={lIdx} className="text-muted-foreground">
                                                                                                            {line}
                                                                                                        </div>
                                                                                                    ),
                                                                                                )}
                                                                                            </div>
                                                                                        ),
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    }
                                                                    if (
                                                                        nested.type === 'header' ||
                                                                        nested.type === 'fields'
                                                                    ) {
                                                                        return (
                                                                            <div key={nested.id} className="rounded-md border bg-background">
                                                                                {nested.title && (
                                                                                    <div className="border-b bg-muted/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                                                        {nested.title}
                                                                                    </div>
                                                                                )}
                                                                                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 p-3 sm:grid-cols-2">
                                                                                    {nested.fields.map(
                                                                                        (f) => {
                                                                                            const display = formatReviewValue(
                                                                                                f,
                                                                                                (nestedVals as Record<string, unknown>)[f.key],
                                                                                            );
                                                                                            const isEmpty =
                                                                                                display === '—';
                                                                                            return (
                                                                                                <div key={f.key} className="flex flex-col gap-0.5">
                                                                                                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                                                                                        {f.label}
                                                                                                    </dt>
                                                                                                    <dd
                                                                                                        className={
                                                                                                            'text-sm ' +
                                                                                                            (isEmpty
                                                                                                                ? 'italic text-muted-foreground'
                                                                                                                : 'text-foreground')
                                                                                                        }
                                                                                                    >
                                                                                                        {display}
                                                                                                    </dd>
                                                                                                </div>
                                                                                            );
                                                                                        },
                                                                                    )}
                                                                                </dl>
                                                                            </div>
                                                                        );
                                                                    }
                                                                    if (nested.type === 'image_attachments') {
                                                                        return (
                                                                            <div key={nested.id} className="rounded-md border bg-background">
                                                                                {nested.title && (
                                                                                    <div className="border-b bg-muted/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                                                        {nested.title}
                                                                                    </div>
                                                                                )}
                                                                                <div className="space-y-3 p-3">
                                                                                    {nested.slots.map((slot) => {
                                                                                        // Per-group photos use the group-scoped flat
                                                                                        // key written by RepeatingGroupsSection
                                                                                        // (`<sectionId>_<groupIdx>_<slot>`); for a
                                                                                        // zone, formValues.attachments IS that zone's map.
                                                                                        const items = (formValues.attachments?.[`${section.id}_${gIdx}_${slot.key}`] || []) as AttachmentSlotValue[];
                                                                                        return (
                                                                                            <div key={slot.key}>
                                                                                                <div className="mb-1.5 flex items-center justify-between">
                                                                                                    <span className="text-xs font-medium">{slot.label}</span>
                                                                                                    <span className="text-xs text-muted-foreground">
                                                                                                        {items.length} file{items.length === 1 ? '' : 's'}
                                                                                                    </span>
                                                                                                </div>
                                                                                                {items.length === 0 ? (
                                                                                                    <p className="text-xs italic text-muted-foreground">No file uploaded</p>
                                                                                                ) : (
                                                                                                    <div className="flex flex-wrap gap-2">
                                                                                                        {items.map((it, i) => {
                                                                                                            const isObj = it && typeof it === 'object';
                                                                                                            const url = isObj ? (it as AttachmentRecord).file_url : '';
                                                                                                            const name = isObj ? (it as AttachmentRecord).file_name : (it as string);
                                                                                                            const isImage = url && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
                                                                                                            if (url && isImage) {
                                                                                                                return (
                                                                                                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block h-16 w-16 overflow-hidden rounded border bg-muted/30" title={name}>
                                                                                                                        <img src={url} alt={name} className="h-full w-full object-cover" />
                                                                                                                    </a>
                                                                                                                );
                                                                                                            }
                                                                                                            if (url) {
                                                                                                                return (
                                                                                                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="rounded border bg-muted/30 px-2 py-1 text-xs hover:bg-muted/50">{name}</a>
                                                                                                                );
                                                                                                            }
                                                                                                            return <span key={i} className="rounded border bg-muted/30 px-2 py-1 text-xs">{name}</span>;
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
                                                        )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                }

                return null;
            })}
        </div>
    );
};

export default CommissionReportWizard;
