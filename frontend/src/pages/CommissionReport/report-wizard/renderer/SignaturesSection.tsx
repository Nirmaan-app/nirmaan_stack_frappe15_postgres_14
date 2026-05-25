// Per-report signature picker. Defaults to "all project-TDS-enabled roles on";
// user can untick to exclude a role from this specific report. The unticked
// keys are persisted under `responses[section.id].disabled` and the print
// format's `render_signatures` macro skips them. Mirrors that macro's
// templateId branching exactly — keep them in sync.

import React, { useMemo } from 'react';

import { useFrappeGetDocList } from 'frappe-react-sdk';
import { AlertCircle, Info, Loader2 } from 'lucide-react';
import { Controller, useFormContext } from 'react-hook-form';

import { Checkbox } from '@/components/ui/checkbox';

import type { SignaturesSection as SignaturesSectionT } from '../types';

interface ProjectTDSSettingRow {
    name: string;
    enable_client: 0 | 1;
    enable_manager: 0 | 1;
    enable_architect: 0 | 1;
    enable_consultant: 0 | 1;
    enable_gc_contractor: 0 | 1;
    enable_mep_contractor: 0 | 1;
}

interface RoleRow {
    /** Key persisted to `responses[sigSectionId].disabled`. Matches the keys the
     *  Jinja `render_signatures` macro checks. */
    key: 'manager' | 'consultant' | 'client' | 'gc_contractor' | 'mep_contractor';
    label: string;
}

interface Props {
    section: SignaturesSectionT;
    projectId?: string;
    templateId?: string;
    forceReadonly?: boolean;
}

const computeRoles = (tds: ProjectTDSSettingRow, templateId?: string): RoleRow[] => {
    const out: RoleRow[] = [];
    if (templateId === 'demo-training-certificate') {
        if (tds.enable_manager) out.push({ key: 'manager', label: 'PROJECT MANAGER' });
        if (tds.enable_mep_contractor) out.push({ key: 'mep_contractor', label: 'VENDOR' });
        if (tds.enable_client) out.push({ key: 'client', label: 'CLIENT' });
        if (tds.enable_gc_contractor) out.push({ key: 'gc_contractor', label: 'GC CONTRACTOR' });
        return out;
    }
    if (tds.enable_manager) out.push({ key: 'manager', label: 'PROJECT MANAGER' });
    if (tds.enable_consultant) out.push({ key: 'consultant', label: 'CONSULTANT' });
    if (tds.enable_client) out.push({ key: 'client', label: 'CLIENT' });
    if (tds.enable_gc_contractor) out.push({ key: 'gc_contractor', label: 'GC CONTRACTOR' });
    if (tds.enable_mep_contractor) out.push({ key: 'mep_contractor', label: 'NIRMAAN' });
    return out;
};

export const SignaturesSection: React.FC<Props> = ({
    section,
    projectId,
    templateId,
    forceReadonly,
}) => {
    const { data, isLoading } = useFrappeGetDocList<ProjectTDSSettingRow>(
        'Project TDS Setting',
        {
            fields: [
                'name',
                'enable_client',
                'enable_manager',
                'enable_architect',
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
    const roles = useMemo(() => (tds ? computeRoles(tds, templateId) : []), [tds, templateId]);

    return (
        <section className="space-y-3">
            {section.title && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}

            {!projectId ? (
                <FallbackNotice />
            ) : isLoading ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading TDS Setting…
                </div>
            ) : !tds ? (
                <NoTdsBanner />
            ) : roles.length === 0 ? (
                <NoEnabledRolesBanner />
            ) : (
                <SignaturesPicker
                    sectionId={section.id}
                    roles={roles}
                    forceReadonly={forceReadonly}
                />
            )}
        </section>
    );
};

const SignaturesPicker: React.FC<{
    sectionId: string;
    roles: RoleRow[];
    forceReadonly?: boolean;
}> = ({ sectionId, roles, forceReadonly }) => {
    const { control } = useFormContext();
    const fieldName = `responses.${sectionId}.disabled`;

    return (
        <Controller
            control={control}
            name={fieldName}
            defaultValue={[]}
            render={({ field }) => {
                const disabled: string[] = Array.isArray(field.value) ? field.value : [];
                const enabledCount = roles.length - disabled.filter((k) => roles.some((r) => r.key === k)).length;

                const toggle = (key: string, checked: boolean) => {
                    const next = checked
                        ? disabled.filter((k) => k !== key)
                        : [...new Set([...disabled, key])];
                    field.onChange(next);
                };

                return (
                    <div className="space-y-4">
                        <div className="rounded-md border bg-muted/30 p-3">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h4 className="text-sm font-semibold text-foreground">
                                        Signatures on the printed report
                                    </h4>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                        Selected signatures will appear on the printed PDF. Click a
                                        card to toggle. All project-enabled roles are on by default.
                                    </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                                    {enabledCount} of {roles.length} included
                                </span>
                            </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {roles.map((r) => {
                                const checked = !disabled.includes(r.key);
                                const id = `${fieldName}.${r.key}`;
                                return (
                                    <div
                                        key={r.key}
                                        role="checkbox"
                                        aria-checked={checked}
                                        aria-disabled={forceReadonly}
                                        tabIndex={forceReadonly ? -1 : 0}
                                        onClick={() => !forceReadonly && toggle(r.key, !checked)}
                                        onKeyDown={(e) => {
                                            if (forceReadonly) return;
                                            if (e.key === ' ' || e.key === 'Enter') {
                                                e.preventDefault();
                                                toggle(r.key, !checked);
                                            }
                                        }}
                                        className={[
                                            'group relative flex h-32 cursor-pointer flex-col items-center justify-end rounded-lg border-2 p-3 text-left transition select-none',
                                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                            checked
                                                ? 'border-emerald-500 bg-emerald-50/70 shadow-sm hover:bg-emerald-50'
                                                : 'border-dashed border-rose-300 bg-rose-50/60 hover:border-rose-400 hover:bg-rose-50',
                                            forceReadonly && 'cursor-not-allowed opacity-60',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    >
                                        {/* Real checkbox in top-left as the primary affordance */}
                                        <Checkbox
                                            id={id}
                                            checked={checked}
                                            disabled={forceReadonly}
                                            onCheckedChange={(v) => toggle(r.key, v === true)}
                                            onClick={(e) => e.stopPropagation()}
                                            className={[
                                                'absolute left-2 top-2 h-5 w-5',
                                                checked
                                                    ? 'border-emerald-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white'
                                                    : 'border-rose-400',
                                            ].join(' ')}
                                            aria-label={`${checked ? 'Disable' : 'Enable'} ${r.label} signature`}
                                        />

                                        {/* Status badge in top-right */}
                                        {checked ? (
                                            <span className="absolute right-2 top-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                                Included
                                            </span>
                                        ) : (
                                            <span className="absolute right-2 top-2 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                                                Omitted
                                            </span>
                                        )}

                                        {/* Signature placeholder */}
                                        <div
                                            className={[
                                                'mb-1 w-full border-t',
                                                checked ? 'border-emerald-700/60' : 'border-rose-400/50',
                                            ].join(' ')}
                                        />
                                        <span
                                            className={[
                                                'text-xs font-semibold uppercase tracking-wide',
                                                checked
                                                    ? 'text-foreground'
                                                    : 'text-rose-700/70 line-through decoration-rose-400/70',
                                            ].join(' ')}
                                        >
                                            {r.label}
                                        </span>
                                        <span
                                            className={[
                                                'text-[10px]',
                                                checked ? 'text-muted-foreground' : 'text-rose-700/60',
                                            ].join(' ')}
                                        >
                                            (Signature &amp; Stamp)
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        {enabledCount === 0 && (
                            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                                <span className="text-xs text-amber-700">
                                    No signatures are enabled — the printed report will have no
                                    signature row.
                                </span>
                            </div>
                        )}
                    </div>
                );
            }}
        />
    );
};

const FallbackNotice: React.FC = () => (
    <div className="flex items-start gap-3 rounded-md border border-dashed bg-muted/20 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">
                Signatures are sourced from the project's TDS Setting.
            </p>
            <p className="text-xs text-muted-foreground">
                Project context is missing — toggles unavailable. The printed PDF will pull enabled
                roles from <span className="font-medium">Projects → TDS Repository</span>.
            </p>
        </div>
    </div>
);

const NoTdsBanner: React.FC = () => (
    <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="space-y-1 text-sm">
            <p className="font-medium text-destructive">
                Project TDS Setting is not configured.
            </p>
            <p className="text-xs text-muted-foreground">
                Set up signatories under <span className="font-medium">Projects → TDS Repository</span>{' '}
                before printing — the PDF will refuse to render the signature row otherwise.
            </p>
        </div>
    </div>
);

const NoEnabledRolesBanner: React.FC = () => (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="space-y-1 text-sm">
            <p className="font-medium text-amber-700">
                No signatory roles are enabled for this template.
            </p>
            <p className="text-xs text-muted-foreground">
                Enable at least one role under{' '}
                <span className="font-medium">Projects → TDS Repository</span>. The PDF will print
                with no signature row until then.
            </p>
        </div>
    </div>
);
