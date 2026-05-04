// Single-field control used by HeaderSection, FieldsSection, and ChecklistSection.
// Wires RHF Controller to shadcn primitives, dispatching by Field.type.

import React from 'react';
import { Controller, useFormContext } from 'react-hook-form';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type { Field } from '../types';

interface Props {
    /** RHF field name (e.g., "responses.hdr.vendor"). */
    name: string;
    field: Field;
    /** Optional override of readonly behavior — used for view-mode wrapper. */
    forceReadonly?: boolean;
    /** Hide the label (e.g. inside checklist table cells). */
    hideLabel?: boolean;
    className?: string;
}

export const FieldControl: React.FC<Props> = ({
    name,
    field,
    forceReadonly,
    hideLabel,
    className,
}) => {
    const { control, formState } = useFormContext();
    const isReadonly = !!field.readonly || !!forceReadonly;
    const error = name.split('.').reduce<unknown>((acc, k) => {
        if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k];
        return undefined;
    }, formState.errors) as { message?: string } | undefined;

    const labelEl =
        !hideLabel && (
            <Label htmlFor={name} className="text-xs uppercase tracking-wide text-muted-foreground">
                {field.label}
                {field.required && !isReadonly && <sup className="ml-0.5 text-destructive">*</sup>}
            </Label>
        );

    return (
        <div className={cn('space-y-1', className)}>
            {labelEl}
            <Controller
                control={control}
                name={name}
                render={({ field: rhf }) => {
                    const common = {
                        id: name,
                        name: rhf.name,
                        onBlur: rhf.onBlur,
                        ref: rhf.ref,
                        disabled: isReadonly,
                        className: cn(error && 'border-destructive focus-visible:ring-destructive'),
                    };
                    switch (field.type) {
                        case 'text':
                            return (
                                <Input
                                    {...common}
                                    type="text"
                                    value={(rhf.value as string) ?? ''}
                                    onChange={rhf.onChange}
                                    maxLength={(field as { maxLength?: number }).maxLength}
                                    placeholder={(field as { placeholder?: string }).placeholder}
                                />
                            );
                        case 'textarea':
                            return (
                                <Textarea
                                    {...common}
                                    rows={(field as { rows?: number }).rows ?? 3}
                                    value={(rhf.value as string) ?? ''}
                                    onChange={rhf.onChange}
                                    placeholder={(field as { placeholder?: string }).placeholder}
                                />
                            );
                        case 'date':
                            return (
                                <Input
                                    {...common}
                                    type="date"
                                    value={(rhf.value as string) ?? ''}
                                    onChange={rhf.onChange}
                                />
                            );
                        case 'number': {
                            const f = field as Field & { unit?: string; min?: number; max?: number };
                            const numericInput = (
                                <Input
                                    {...common}
                                    type="number"
                                    value={rhf.value === undefined || rhf.value === null ? '' : String(rhf.value)}
                                    onChange={(e) => rhf.onChange(e.target.value)}
                                    min={f.min}
                                    max={f.max}
                                    inputMode="decimal"
                                />
                            );
                            if (!f.unit) return numericInput;
                            return (
                                <div className="flex items-center gap-2">
                                    <div className="flex-1">{numericInput}</div>
                                    <span className="select-none text-sm font-medium text-muted-foreground">
                                        {f.unit}
                                    </span>
                                </div>
                            );
                        }
                        case 'select': {
                            const f = field as Field & { options: string[] };
                            return (
                                <Select
                                    value={(rhf.value as string) ?? ''}
                                    onValueChange={rhf.onChange}
                                    disabled={isReadonly}
                                >
                                    <SelectTrigger
                                        id={name}
                                        className={cn(error && 'border-destructive focus-visible:ring-destructive')}
                                    >
                                        <SelectValue placeholder="Select…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {f.options.map((opt) => (
                                            <SelectItem key={opt} value={opt}>
                                                {opt}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            );
                        }
                        default:
                            return <span className="text-xs text-destructive">Unsupported field</span>;
                    }
                }}
            />
            {error?.message && (
                <p className="text-xs text-destructive">{String(error.message)}</p>
            )}
        </div>
    );
};
