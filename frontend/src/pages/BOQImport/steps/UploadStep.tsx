import { useCallback, useEffect } from 'react';
import { UseFormReturn } from 'react-hook-form';
import ReactSelect from 'react-select';
import { Form, FormField } from '@/components/ui/form';
import { FormFieldRow, FormGrid, FormActions } from '@/components/ui/form-field-row';
import { CustomAttachment, AcceptedFileType } from '@/components/helpers/CustomAttachment';
import ProjectSelect from '@/components/custom-select/project-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSelectStyles } from '@/config/selectTheme';
import { Loader2 } from 'lucide-react';
import { useWorkPackages } from '../hooks/useBOQImportData';
import type { BOQUploadFormValues, SelectOption } from '../schema';

interface UploadStepProps {
  form: UseFormReturn<BOQUploadFormValues>;
  selectedFile: File | null;
  onFileSelect: (file: File | null) => void;
  onNext: () => void;
  isParsing: boolean;
  preSelectedProject?: string;
}

const ACCEPTED_TYPES: AcceptedFileType[] = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];

export function UploadStep({
  form,
  selectedFile,
  onFileSelect,
  onNext,
  isParsing,
  preSelectedProject,
}: UploadStepProps) {
  const projectValue = form.watch('project');
  const { options: wpOptions, isLoading: wpLoading } = useWorkPackages();

  // Pre-fill project if provided
  useEffect(() => {
    if (preSelectedProject && !projectValue) {
      form.setValue('project', preSelectedProject, { shouldValidate: true });
    }
  }, [preSelectedProject]);

  const handleProjectChange = useCallback(
    (option: SelectOption | null) => {
      form.setValue('project', option?.value || '', { shouldValidate: true });
      form.setValue('zone', '');
    },
    [form]
  );

  const handleWPChange = useCallback(
    (option: SelectOption | null) => {
      form.setValue('work_package', option?.value || '', { shouldValidate: true });
    },
    [form]
  );

  const handleNext = useCallback(() => {
    form.trigger().then((isValid) => {
      if (isValid && selectedFile) {
        onNext();
      }
    });
  }, [form, selectedFile, onNext]);

  return (
    <div className="space-y-6">
      <Form {...form}>
        <div className="space-y-6">
          {/* File Upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Excel File <span className="text-destructive">*</span>
            </label>
            <CustomAttachment
              selectedFile={selectedFile}
              onFileSelect={onFileSelect}
              acceptedTypes={ACCEPTED_TYPES}
              maxFileSize={10 * 1024 * 1024}
              label="Upload BOQ Excel (.xlsx, .csv)"
            />
          </div>

          <FormGrid columns={2}>
            {/* Project */}
            {preSelectedProject ? (
              <FormFieldRow label="Project" required variant="sheet">
                <Input value={preSelectedProject} disabled className="bg-muted" />
              </FormFieldRow>
            ) : (
              <FormField
                control={form.control}
                name="project"
                render={() => (
                  <FormFieldRow label="Project" required variant="sheet">
                    <ProjectSelect
                      onChange={handleProjectChange}
                      universal={false}
                    />
                  </FormFieldRow>
                )}
              />
            )}

            {/* Work Package */}
            <FormField
              control={form.control}
              name="work_package"
              render={() => (
                <FormFieldRow label="Work Package" required variant="sheet">
                  <ReactSelect<SelectOption>
                    options={wpOptions}
                    isLoading={wpLoading}
                    value={wpOptions.find(o => o.value === form.watch('work_package')) || null}
                    onChange={handleWPChange}
                    placeholder="Select Work Package"
                    isClearable
                    styles={getSelectStyles<SelectOption>()}
                  />
                </FormFieldRow>
              )}
            />

            {/* Zone */}
            <FormField
              control={form.control}
              name="zone"
              render={({ field }) => (
                <FormFieldRow label="Zone" variant="sheet">
                  <Input
                    placeholder="e.g., Tower A, Block B"
                    value={field.value || ''}
                    onChange={field.onChange}
                  />
                </FormFieldRow>
              )}
            />

          </FormGrid>
        </div>
      </Form>

      <FormActions align="right">
        <Button
          onClick={handleNext}
          disabled={!selectedFile || !form.watch('project') || !form.watch('work_package') || isParsing}
        >
          {isParsing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Parsing...
            </>
          ) : (
            'Next: Headers & Mapping'
          )}
        </Button>
      </FormActions>
    </div>
  );
}
