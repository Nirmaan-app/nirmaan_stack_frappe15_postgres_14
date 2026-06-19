// Per-report signature picker. Shows ALL roles for the template; the ones
// enabled in Project TDS Setting are ticked by default, the rest are unticked
// but selectable so the user can manually override.
//
// Persistence is additive:
//   responses[section.id] = {
//     disabled: [...]   // TDS-enabled roles the user unticked
//     enabled:  [...]   // TDS-disabled roles the user ticked (manual override)
//   }
// Final printed roles = (TDS-enabled MINUS disabled) UNION enabled.
// Keep keys+order in lockstep with the Jinja `render_signatures` macro.

import React from 'react';

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

type RoleKey = 'manager' | 'consultant' | 'client' | 'gc_contractor' | 'mep_contractor';

interface RoleRow {
    key: RoleKey;
    label: string;
    /** Is this role enabled in Project TDS Setting? Drives default-ticked state
     *  and the "Not in project TDS" hint. */
    inTds: boolean;
}

interface Props {
    section: SignaturesSectionT;
    projectId?: string;
    templateId?: string;
    forceReadonly?: boolean;
    /** Override the RHF path root. Defaults to "responses". Used by zone-wise
     *  reports so each zone stores its own `zones.<i>.responses.<id>` override. */
    pathRoot?: string;
}

/** Returns the full ordered role list for the template, regardless of TDS.
 *  Each row carries an `inTds` flag derived from the project's TDS Setting. */
const computeAllRoles = (
    tds: ProjectTDSSettingRow | undefined,
    templateId?: string,
): RoleRow[] => {
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
};

export const SignaturesSection: React.FC<Props> = ({
    section,
    projectId,
    templateId,
    forceReadonly,
    pathRoot,
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
    const roles = computeAllRoles(tds, templateId);

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
            ) : (
                <SignaturesPicker
                    sectionId={section.id}
                    roles={roles}
                    forceReadonly={forceReadonly}
                    pathRoot={pathRoot}
                />
            )}
        </section>
    );
};

const SignaturesPicker: React.FC<{
    sectionId: string;
    roles: RoleRow[];
    forceReadonly?: boolean;
    pathRoot?: string;
}> = ({ sectionId, roles, forceReadonly, pathRoot }) => {
    const { control } = useFormContext();
    const fieldName = `${pathRoot || 'responses'}.${sectionId}`;

    return (
        <Controller
            control={control}
            name={fieldName}
            defaultValue={{ disabled: [], enabled: [] }}
            render={({ field }) => {
                const value = (field.value || {}) as { disabled?: string[]; enabled?: string[] };
                const disabledList: string[] = Array.isArray(value.disabled) ? value.disabled : [];
                const enabledList: string[] = Array.isArray(value.enabled) ? value.enabled : [];

                const isChecked = (r: RoleRow): boolean =>
                    r.inTds ? !disabledList.includes(r.key) : enabledList.includes(r.key);

                const includedCount = roles.filter(isChecked).length;
                const totalCount = roles.length;
                const tdsOnCount = roles.filter((r) => r.inTds).length;
                const manualOnCount = roles.filter((r) => !r.inTds && enabledList.includes(r.key)).length;

                const toggle = (r: RoleRow, nextChecked: boolean) => {
                    let nextDisabled = disabledList.slice();
                    let nextEnabled = enabledList.slice();
                    if (r.inTds) {
                        nextDisabled = nextChecked
                            ? nextDisabled.filter((k) => k !== r.key)
                            : [...new Set([...nextDisabled, r.key])];
                    } else {
                        nextEnabled = nextChecked
                            ? [...new Set([...nextEnabled, r.key])]
                            : nextEnabled.filter((k) => k !== r.key);
                    }
                    field.onChange({ disabled: nextDisabled, enabled: nextEnabled });
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
                                        Roles enabled in <span className="font-medium">Projects → TDS Repository</span>{' '}
                                        are pre-selected. You can untick any to omit, or tick a non-TDS
                                        role to manually include it for this report.
                                    </p>
                                </div>
                                <div className="shrink-0 space-y-1 text-right">
                                    <span className="inline-block rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                                        {includedCount} of {totalCount} included
                                    </span>
                                    {manualOnCount > 0 && (
                                        <span className="ml-1 inline-block rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                                            +{manualOnCount} manual
                                        </span>
                                    )}
                                </div>
                            </div>
                            {tdsOnCount === 0 && (
                                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
                                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                                    <span className="text-[11px] text-amber-700">
                                        No roles are enabled in Project TDS Setting — pick the ones to
                                        print manually below.
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {roles.map((r) => {
                                const checked = isChecked(r);
                                const id = `${fieldName}.${r.key}`;
                                const manualOn = !r.inTds && checked;
                                return (
                                    <div
                                        key={r.key}
                                        role="checkbox"
                                        aria-checked={checked}
                                        aria-disabled={forceReadonly}
                                        tabIndex={forceReadonly ? -1 : 0}
                                        onClick={() => !forceReadonly && toggle(r, !checked)}
                                        onKeyDown={(e) => {
                                            if (forceReadonly) return;
                                            if (e.key === ' ' || e.key === 'Enter') {
                                                e.preventDefault();
                                                toggle(r, !checked);
                                            }
                                        }}
                                        className={[
                                            'group relative flex h-32 cursor-pointer flex-col items-center justify-end rounded-lg border-2 p-3 text-left transition select-none',
                                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                            checked
                                                ? manualOn
                                                    ? 'border-sky-500 bg-sky-50/70 shadow-sm hover:bg-sky-50'
                                                    : 'border-emerald-500 bg-emerald-50/70 shadow-sm hover:bg-emerald-50'
                                                : 'border-dashed border-rose-300 bg-rose-50/60 hover:border-rose-400 hover:bg-rose-50',
                                            forceReadonly && 'cursor-not-allowed opacity-60',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    >
                                        <Checkbox
                                            id={id}
                                            checked={checked}
                                            disabled={forceReadonly}
                                            onCheckedChange={(v) => toggle(r, v === true)}
                                            onClick={(e) => e.stopPropagation()}
                                            className={[
                                                'absolute left-2 top-2 h-5 w-5',
                                                checked
                                                    ? manualOn
                                                        ? 'border-sky-600 data-[state=checked]:bg-sky-600 data-[state=checked]:text-white'
                                                        : 'border-emerald-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white'
                                                    : 'border-rose-400',
                                            ].join(' ')}
                                            aria-label={`${checked ? 'Disable' : 'Enable'} ${r.label} signature`}
                                        />

                                        {/* Top-right status badge */}
                                        {checked ? (
                                            <span
                                                className={[
                                                    'absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                                    manualOn
                                                        ? 'bg-sky-500/15 text-sky-700'
                                                        : 'bg-emerald-500/15 text-emerald-700',
                                                ].join(' ')}
                                            >
                                                {manualOn ? 'Manual' : 'Included'}
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
                                                checked
                                                    ? manualOn
                                                        ? 'border-sky-700/60'
                                                        : 'border-emerald-700/60'
                                                    : 'border-rose-400/50',
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
                                                checked
                                                    ? 'text-muted-foreground'
                                                    : 'text-rose-700/60',
                                            ].join(' ')}
                                        >
                                            (Signature &amp; Stamp)
                                        </span>

                                        {/* "Not in TDS" hint sits below the checkbox so it doesn't
                                            overlap the signature placeholder text. */}
                                        {!r.inTds && (
                                            <span
                                                className="absolute left-2 top-9 rounded-sm border border-sky-300/60 bg-sky-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-700"
                                                title="This role is not enabled in Project TDS Setting"
                                            >
                                                Not in TDS
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {includedCount === 0 && (
                            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                                <span className="text-xs text-amber-700">
                                    No signatures are selected — the printed report will have no
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
