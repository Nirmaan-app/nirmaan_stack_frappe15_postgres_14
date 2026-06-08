// Admin-only editor for the `source_format` JSON template + `is_active` flag
// on a Commission Report Tasks master row. Mounted as a per-row dialog inside
// CommissionPackagesMaster.

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileCode2, Loader2, Sparkles, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

import { useTaskMasterMutations } from '../data/useCommissionMutations';
import { parseTemplate } from '../report-wizard/template-parser';
import type { TemplateValidationError } from '../report-wizard/types';
import type { CommissionTaskMaster } from '../types';

interface Props {
    task: CommissionTaskMaster;
    mutate: () => Promise<unknown>;
}

interface ValidationState {
    status: 'unchecked' | 'valid' | 'invalid' | 'empty';
    errors: TemplateValidationError[];
    warnings: string[];
}

const placeholderTemplate = `{
  "templateId": "my-report-id",
  "templateVersion": 1,
  "title": "My Report",
  "sections": [
    {
      "id": "intro",
      "type": "process",
      "blocks": [
        { "subtitle": "Procedure", "items": ["Step 1...", "Step 2..."] }
      ]
    }
  ]
}`;

export const SourceFormatDialog: React.FC<Props> = ({ task, mutate }) => {
    const [open, setOpen] = useState(false);
    const [sourceText, setSourceText] = useState(task.source_format || '');
    const [isActive, setIsActive] = useState(task.is_active !== 0);
    const [validation, setValidation] = useState<ValidationState>({
        status: 'unchecked',
        errors: [],
        warnings: [],
    });
    const [saving, setSaving] = useState(false);

    const { updateTaskMaster } = useTaskMasterMutations();
    const { toast } = useToast();

    // Reset on open with the latest server state.
    useEffect(() => {
        if (open) {
            setSourceText(task.source_format || '');
            setIsActive(task.is_active !== 0);
            setValidation({ status: 'unchecked', errors: [], warnings: [] });
        }
    }, [open, task.source_format, task.is_active]);

    const isDirty = useMemo(() => {
        const initialActive = task.is_active !== 0;
        return (sourceText || '') !== (task.source_format || '') || isActive !== initialActive;
    }, [isActive, sourceText, task.is_active, task.source_format]);

    const runValidate = (text: string): ValidationState => {
        const trimmed = text.trim();
        if (!trimmed) return { status: 'empty', errors: [], warnings: [] };
        const result = parseTemplate(trimmed);
        if (result.ok) return { status: 'valid', errors: [], warnings: result.warnings };
        return { status: 'invalid', errors: result.errors, warnings: [] };
    };

    const handleValidate = () => {
        setValidation(runValidate(sourceText));
    };

    const handleFormat = () => {
        try {
            const obj = JSON.parse(sourceText);
            setSourceText(JSON.stringify(obj, null, 2));
            setValidation(runValidate(JSON.stringify(obj, null, 2)));
        } catch (e) {
            toast({
                title: 'Cannot format',
                description: `Source isn't valid JSON: ${(e as Error).message}`,
                variant: 'destructive',
            });
        }
    };

    const handleSave = async () => {
        // Validate before save (don't allow saving broken templates).
        const v = runValidate(sourceText);
        setValidation(v);
        if (v.status === 'invalid') {
            toast({
                title: 'Fix errors before saving',
                description: `${v.errors.length} validation error(s)`,
                variant: 'destructive',
            });
            return;
        }
        setSaving(true);
        try {
            await updateTaskMaster(task.name, {
                source_format: sourceText.trim() || null,
                is_active: isActive ? 1 : 0,
            });
            await mutate();
            toast({
                title: 'Template saved',
                description: v.status === 'empty' ? 'Source cleared.' : 'Template validated and saved.',
                variant: 'success',
            });
            setOpen(false);
        } catch (e) {
            toast({
                title: 'Save failed',
                description: (e as Error).message || 'Unknown error',
                variant: 'destructive',
            });
        } finally {
            setSaving(false);
        }
    };

    const hasTemplate = !!task.source_format?.trim();
    const inactive = task.is_active === 0;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                    title={hasTemplate ? 'Edit Source Format' : 'Add Source Format'}
                >
                    <FileCode2 className="h-3.5 w-3.5" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
                        <FileCode2 className="h-4 w-4" />
                        Source Format — {task.task_name}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Paste the JSON template for this report task. See{' '}
                        <code className="rounded bg-muted px-1 text-[11px]">
                            frontend/.claude/context/domain/commissioning-report-templates.md
                        </code>{' '}
                        for the grammar.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                        <div className="flex items-center gap-3">
                            <Switch
                                id={`active-${task.name}`}
                                checked={isActive}
                                onCheckedChange={setIsActive}
                            />
                            <Label htmlFor={`active-${task.name}`} className="cursor-pointer text-sm">
                                Active
                            </Label>
                            <span className="text-xs text-muted-foreground">
                                When off, the Fill button is hidden on new task rows. Existing filled
                                reports keep rendering.
                            </span>
                        </div>
                        <div className="flex gap-1.5">
                            {hasTemplate && (
                                <Badge variant="outline" className="text-[10px]">
                                    Has template
                                </Badge>
                            )}
                            {inactive && (
                                <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100 text-[10px]">
                                    Inactive
                                </Badge>
                            )}
                        </div>
                    </div>

                    <Textarea
                        value={sourceText}
                        onChange={(e) => {
                            setSourceText(e.target.value);
                            setValidation({ status: 'unchecked', errors: [], warnings: [] });
                        }}
                        placeholder={placeholderTemplate}
                        rows={20}
                        className="font-mono text-xs leading-snug"
                        spellCheck={false}
                    />

                    <div className="flex items-center justify-between gap-3">
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={handleValidate}>
                                Validate JSON
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={handleFormat}>
                                <Sparkles className="mr-1 h-3 w-3" />
                                Format
                            </Button>
                        </div>
                        <ValidationBadge state={validation} />
                    </div>

                    {validation.status === 'invalid' && (
                        <ul className="max-h-32 list-disc space-y-1 overflow-y-auto rounded border border-destructive/30 bg-destructive/5 p-3 pl-7 text-xs">
                            {validation.errors.map((e, i) => (
                                <li key={i}>
                                    <code className="text-[10px]">{e.code}</code> · {e.message}
                                </li>
                            ))}
                        </ul>
                    )}
                    {validation.status === 'valid' && validation.warnings.length > 0 && (
                        <ul className="list-disc space-y-1 rounded border border-amber-300 bg-amber-50 p-3 pl-7 text-xs text-amber-900">
                            {validation.warnings.map((w, i) => (
                                <li key={i}>{w}</li>
                            ))}
                        </ul>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving || !isDirty}>
                        {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ValidationBadge: React.FC<{ state: ValidationState }> = ({ state }) => {
    if (state.status === 'unchecked') {
        return <span className="text-[11px] text-muted-foreground">Not validated</span>;
    }
    if (state.status === 'empty') {
        return (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <XCircle className="h-3 w-3" />
                Empty (no template)
            </span>
        );
    }
    if (state.status === 'invalid') {
        return (
            <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
                <XCircle className="h-3 w-3" />
                {state.errors.length} error(s)
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            Valid template
        </span>
    );
};
