import React ,{useMemo} from 'react';
import { SelectVendorQuotesTable } from './SelectVendorQuotesTable';
import { AddVendorsDialog } from './components/AddVendorsDialog';
import { RevertPRDialog } from './components/RevertPRDialog';
import { VendorSheet } from './components/VendorSheet';
import { ModeSwitcher } from './components/ModeSwitcher';
import GenerateRFQDialog from './components/GenerateRFQDialog';

import { TailSpin } from 'react-loader-spinner';
import { ProcurementHeaderCard } from '@/components/helpers/ProcurementHeaderCard';
import { Button } from '@/components/ui/button';
import { CirclePlus, Info, Undo2 } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { ProcurementProgressLogicReturn } from './types';

import {VendorChargesTable} from "./components/VendorChargesTable";

// Props are the entire return type of the logic hook
type ProcurementProgressViewProps = ProcurementProgressLogicReturn;

export const ProcurementProgressView: React.FC<ProcurementProgressViewProps> = ({
    mode,
    currentDocument,
    rfqFormData,
    setRfqFormData, // Pass down to SelectVendorQuotesTable
    finalSelectedQuotes,
    isLoading, // This is now the isLoading from useProcurementActions
    isUpdatingDocument, // Can combine this with isLoading if desired
    isRedirecting,
    isAddVendorsDialogOpen,
    isRevertDialogOpen,
    isVendorSheetOpen,
    tempSelectedVendorsInDialog,
    availableVendorOptionsForDialog,
    targetRatesDataMap,
    otherEditors,
    // isDocumentReadOnlyByWorkflow,
    canContinueToReview,
    //--Additional Charges Change
     onAddCharges,
    onUpdateCharge,
    onDeleteCharge,
    //---
    availableChargeTemplates,
    getFullName,
    handleModeChange,
    handleTempVendorSelectionInDialog,
    handleConfirmAddVendorsToRFQ,
    handleDeleteVendorFromRFQ,
    handleQuoteChange,
    handleMakeChange,
    handleTaxChange, // MODIFIED: Destructure the new handler
    handleFinalVendorSelectionForItem,
    handleProceedToReview,
    handleRevertSelections,
    toggleAddVendorsDialog,
    toggleRevertDialog,
    toggleVendorSheet,
    updateCurrentDocumentStateItemList, // For SelectVendorQuotesTable
}) => {


    const effectiveLoading = isLoading || isUpdatingDocument;
    const showLoadingOverlay = effectiveLoading || isRedirecting !== "";
    const loadingText = /* ... your existing loadingText logic ... */ isRedirecting === "view_save" ? "Saving Changes..." : isRedirecting === "revert" ? "Reverting Changes..." : isRedirecting === "review_save" ? "Saving Selections..." : effectiveLoading ? "Processing..." : "";


    // If currentDocument is still undefined (e.g. initial load before logic hook syncs), show loading
    if (!currentDocument) {
        return (
            <div className="flex items-center justify-center h-[80vh]">
                <TailSpin color="#D03B45" height={40} width={40} />
                <p className="ml-3 text-muted-foreground">Loading document details...</p>
            </div>
        );
    }

    // Determine if actions should be disabled (read-only workflow or another editor)
    // For now, let's assume 'otherEditors' implies read-only for simplicity
    // const isEffectivelyReadOnly = isDocumentReadOnlyByWorkflow || otherEditors.length > 0;
 
    return (
        <>
            {/* Other Editors Banner */}
            {otherEditors.length > 0 && (
                <div className="sticky -top-2 z-50 p-2 bg-yellow-100 border-b border-yellow-300 text-yellow-800 text-xs text-center shadow">
                    This Procurement Request is currently being edited by: <strong className="mx-1">{otherEditors.map(getFullName).join(", ")}</strong>.
                </div>
            )}
            <div className={`flex-1 space-y-4 relative 
                `}>
                <ProcurementHeaderCard orderData={currentDocument} />

                <div className="flex max-sm:flex-col max-sm:items-start items-center justify-between max-sm:gap-4 pt-2">
                    <div className="flex items-center gap-4 max-sm:w-full">
                        <h2 className="text-lg font-semibold">RFQ List</h2>
                        <div className="flex items-center gap-1">
                            <ModeSwitcher currentMode={mode} onModeChange={handleModeChange}
                            // disabled={isEffectivelyReadOnly && mode === 'edit'} 
                            />
                            {/* Info Tooltip */}
                            <HoverCard>
                                <HoverCardTrigger aria-label="Mode Information">
                                    <Info className="h-4 w-4 text-blue-500 cursor-help" />
                                </HoverCardTrigger>
                                <HoverCardContent className="w-60 text-sm">
                                    {mode === "edit" ? (
                                        <div>
                                            <p className="font-semibold mb-2 tracking-tight">Edit Mode:</p>
                                            <ul className="list-disc list-inside space-y-1 text-xs">
                                                <li>Add vendors via the <strong>Add Vendors</strong> button.</li>
                                                <li>Enter quotes/makes in the table.</li>
                                                <li>Switch to <b>View</b> mode to select the final quotes for each item.</li>
                                            </ul>
                                        </div>
                                    ) : (
                                        <div>
                                            <p className="font-semibold mb-2 tracking-tight">View Mode:</p>
                                            <ul className="list-disc list-inside space-y-1 text-xs">
                                                <li>Select the desired vendor quote for each item by clicking the corresponding item/vendor quote card.</li>
                                                <li>Click <b>Continue</b> ({currentDocument?.doctype === "Sent Back Category" ? "you must not leave any items vendor quote unselected" : "enabled when at least one quote is selected"}) to proceed to the final review.</li>
                                            </ul>
                                        </div>
                                    )}
                                </HoverCardContent>
                            </HoverCard>
                        </div>
                    </div>
                    <div className="flex gap-2 items-center">
                        {mode === "edit"
                            // && !isEffectivelyReadOnly 
                            && (<>  
                                <Button onClick={toggleAddVendorsDialog} variant="outline" size="sm" className="text-primary border-primary">
                                    <CirclePlus className="mr-2 h-4 w-4" /> Add {rfqFormData.selectedVendors.length > 0 ? "More" : ""} Vendors
                                </Button>
                            </>

                            )}
                        <GenerateRFQDialog orderData={currentDocument} /> {/* Assuming GenerateRFQDialog can handle PR or SBC */}
                    </div>
                </div>

                <SelectVendorQuotesTable
                    currentDocument={currentDocument}
                    formData={rfqFormData}
                    setFormData={setRfqFormData} // Pass down for MakesSelection
                    selectedVendorQuotes={finalSelectedQuotes}
                    // setSelectedVendorQuotes={setSelectedVendorQuotes} // Pass down
                    mode={mode}
                    targetRatesData={targetRatesDataMap}
                    onQuoteChange={handleQuoteChange}
                    onMakeChange={handleMakeChange}
                    onTaxChange={handleTaxChange} // MODIFIED: Pass the handler down
                    onVendorSelectForItem={handleFinalVendorSelectionForItem}
                    onDeleteVendorFromRFQ={handleDeleteVendorFromRFQ}
                    // isReadOnly={isEffectivelyReadOnly && mode === 'edit'} // New prop for table
                    updateCurrentDocumentItemList={updateCurrentDocumentStateItemList} // Pass the updater
                />
                 {/* --- THIS IS THE EXACT PLACE TO ADD THE NEW COMPONENT --- */}
        <VendorChargesTable
             mode={mode}
                // isReadOnly={isReadOnly} // Pass isReadOnly if you have it
                vendors={rfqFormData.selectedVendors}
                rfqData={rfqFormData}
                availableChargeTemplates={availableChargeTemplates}
                    onAddCharges={onAddCharges}
                    onUpdateCharge={onUpdateCharge}
                    onDeleteCharge={onDeleteCharge}
        />

                <div className="flex justify-between items-end mt-6 pt-4 border-t">
                    {(currentDocument.workflow_state === "Approved" || currentDocument.workflow_state === "In Progress") && mode !== 'review' ? (
                        <Button variant="outline" onClick={toggleRevertDialog} disabled={effectiveLoading} size="sm">
                            <Undo2 className="mr-2 h-4 w-4" /> Revert Selections
                        </Button>
                    ) : <div />}
                    {mode === 'view' && (
                        <Button onClick={handleProceedToReview} disabled={!canContinueToReview || effectiveLoading} size="sm">
                            Continue to Review
                        </Button>
                    )}
                </div>
            </div>

            <AddVendorsDialog
                isOpen={isAddVendorsDialogOpen}
                onClose={toggleAddVendorsDialog}
                vendorOptions={availableVendorOptionsForDialog}
                selectedVendors={tempSelectedVendorsInDialog}
                onVendorSelect={handleTempVendorSelectionInDialog}
                onConfirm={handleConfirmAddVendorsToRFQ}
                onOpenVendorSheet={toggleVendorSheet}
            />
            <RevertPRDialog
                isOpen={isRevertDialogOpen}
                onClose={toggleRevertDialog}
                onConfirm={handleRevertSelections}
                isLoading={isUpdatingDocument || isRedirecting === "revert"}
            />
            <VendorSheet isOpen={isVendorSheetOpen} onClose={toggleVendorSheet} />

            {/* Global Loading Overlay */}
            {showLoadingOverlay && (
                <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 z-[999]">
                    <div className="bg-white p-6 rounded-lg shadow-xl text-center flex items-center gap-4">
                        <TailSpin color="red" height={30} width={30} />
                        <p className="text-base font-medium">{loadingText}</p>
                    </div>
                </div>
            )}
        </>
    );
};

