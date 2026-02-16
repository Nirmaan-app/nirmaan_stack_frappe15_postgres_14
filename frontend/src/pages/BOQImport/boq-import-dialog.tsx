import { useCallback } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { WizardSteps } from '@/components/ui/wizard-steps';
import { WIZARD_STEPS } from './constants';
import { useBOQImportWizard } from './hooks/useBOQImportWizard';
import { UploadStep, HeaderMappingStep, PreviewStep } from './steps';

interface BOQImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preSelectedProject?: string;
}

export function BOQImportDialog({ isOpen, onClose, onSuccess, preSelectedProject }: BOQImportDialogProps) {
  const wizard = useBOQImportWizard({ preSelectedProject });

  const handleClose = useCallback(() => {
    wizard.handleReset();
    onClose();
  }, [wizard.handleReset, onClose]);

  const handleImportSuccess = useCallback(() => {
    wizard.handleReset();
    onSuccess();
    onClose();
  }, [wizard.handleReset, onSuccess, onClose]);

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <AlertDialogContent className="sm:max-w-5xl h-[85vh] p-0 flex flex-col overflow-hidden">
        {/* Fixed header: title + wizard steps */}
        <div className="shrink-0 px-6 pt-6 pb-2">
          <AlertDialogHeader>
            <AlertDialogTitle>Import BOQ from Excel</AlertDialogTitle>
            <AlertDialogDescription>
              Upload a spreadsheet, map columns, and import into the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mt-3">
            <WizardSteps steps={WIZARD_STEPS} currentStep={wizard.currentStep} onStepClick={wizard.handleStepClick} />
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 min-h-0 px-6 pb-6 overflow-y-auto">
          {wizard.currentStep === 0 && (
            <UploadStep
              form={wizard.form}
              selectedFile={wizard.selectedFile}
              onFileSelect={wizard.setSelectedFile}
              onNext={wizard.handleUploadNext}
              isParsing={wizard.isParsing}
              preSelectedProject={preSelectedProject}
            />
          )}

          {wizard.currentStep === 1 && wizard.parsedData && (
            <HeaderMappingStep
              rawRows={wizard.parsedData.rawRows}
              allRows={wizard.parsedData.allRows}
              detectedHeaderRow={wizard.parsedData.detectedHeaderRow}
              selectedHeaders={wizard.selectedHeaders}
              fieldMapping={wizard.fieldMapping}
              dataStartRow={wizard.dataStartRow}
              onCellClick={wizard.handleCellClick}
              onFieldMappingChange={wizard.setFieldMapping}
              onNext={wizard.handleMappingNext}
              onBack={wizard.goBack}
              sheetNames={wizard.sheetNames}
              selectedSheetIndex={wizard.selectedSheetIndex}
              onSheetChange={wizard.handleSheetChange}
            />
          )}

          {wizard.currentStep === 2 && wizard.parsedData && (
            <PreviewStep
              fieldMapping={wizard.fieldMapping}
              dataStartRow={wizard.dataStartRow}
              previewRows={wizard.previewRows}
              totalRows={wizard.totalRows}
              formValues={wizard.form.getValues()}
              fileUrl={wizard.fileUrl}
              onBack={wizard.goBack}
              onReset={wizard.handleReset}
              onSuccess={handleImportSuccess}
            />
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
