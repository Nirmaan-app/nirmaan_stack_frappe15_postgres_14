import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WizardSteps } from '@/components/ui/wizard-steps';
import { WIZARD_STEPS } from './constants';
import { useBOQImportWizard } from './hooks/useBOQImportWizard';
import { UploadStep, HeaderMappingStep, PreviewStep } from './steps';

export function BOQImportWizard() {
  const wizard = useBOQImportWizard();

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-4 md:p-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Import BOQ from Excel</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a Bill of Quantities spreadsheet, map columns, and import into the system.
        </p>
      </div>

      {/* Step indicator */}
      <WizardSteps
        steps={WIZARD_STEPS}
        currentStep={wizard.currentStep}
        onStepClick={wizard.handleStepClick}
      />

      {/* Step content */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">{WIZARD_STEPS[wizard.currentStep]?.title}</CardTitle>
        </CardHeader>
        <CardContent>
          {wizard.currentStep === 0 && (
            <UploadStep
              form={wizard.form}
              selectedFile={wizard.selectedFile}
              onFileSelect={wizard.setSelectedFile}
              onNext={wizard.handleUploadNext}
              isParsing={wizard.isParsing}
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
              selectedSheetIndex={wizard.selectedSheetIndex}
              onBack={wizard.goBack}
              onReset={wizard.handleReset}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default BOQImportWizard;
