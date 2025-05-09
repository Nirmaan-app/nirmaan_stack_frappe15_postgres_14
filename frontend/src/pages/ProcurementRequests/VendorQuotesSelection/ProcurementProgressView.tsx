// src/features/procurement/progress/ProcurementProgressView.tsx
import React from 'react';
import { TailSpin } from 'react-loader-spinner';
import { Button } from '@/components/ui/button'; // Adjust path
import { ProcurementHeaderCard } from '@/components/helpers/ProcurementHeaderCard'; // Adjust path
import { CirclePlus, Info, Undo2 } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"; // Adjust path
import { useProcurementProgressLogic } from './hooks/useProcurementProgressLogic'; // Import hook return type
import { ModeSwitcher } from './components/ModeSwitcher';
import GenerateRFQDialog from './components/GenerateRFQDialog';
import { SelectVendorQuotesTable } from './SelectVendorQuotesTable';
import { AddVendorsDialog } from './components/AddVendorsDialog';
import { RevertPRDialog } from './components/RevertPRDialog';
import { VendorSheet } from './components/VendorSheet';

// Define Props based on the return type of the logic hook
type ProcurementProgressViewProps = ReturnType<typeof useProcurementProgressLogic>;

export const ProcurementProgressView: React.FC<ProcurementProgressViewProps> = ({
    mode,
    orderData,
    formData,
    selectedVendorQuotes,
    isRedirecting,
    isLoading, // This is now primarily the update/action loading state
    isAddVendorsDialogOpen,
    isRevertDialogOpen,
    isVendorSheetOpen,
    selectedVendorsForDialog,
    vendorOptionsForDialog,
    handleModeChange,
    handleAddVendors, // Renamed from handleVendorSelection in hook return
    handleConfirmAddVendors,
    handleDeleteVendor,
    handleQuoteChange,
    handleMakeChange,
    handleVendorQuoteSelection,
    handleReviewChanges,
    handleRevertPR,
    toggleAddVendorsDialog,
    toggleRevertDialog,
    toggleVendorSheet,
    getFullName, // Pass down if needed by sub-components (like header)
    canContinueToReview,
    targetRatesDataMap // <-- Destructure the new map passed from logic hook
}) => {

    // Main loading overlay for actions like saving, reverting
    const showLoadingOverlay = isLoading || isRedirecting;
    const loadingText = isRedirecting === "view_save" ? "Saving Changes..." :
        isRedirecting === "revert" ? "Reverting Changes..." :
            isRedirecting === "review_save" ? "Saving Selections..." :
                isLoading ? "Processing..." : // General loading
                    ""; // Should not happen if showLoadingOverlay is true

    return (
        <>
            <div className="flex-1 space-y-4 p-4 md:p-6 relative">
                {/* Render Header only when orderData is available */}
                {orderData && <ProcurementHeaderCard orderData={orderData} />}

                <div className="flex max-sm:flex-col max-sm:items-start items-center justify-between max-sm:gap-4 pt-2">
                    {/* Left Side: Title and Mode Switcher */}
                    <div className="flex items-center gap-4 max-sm:w-full">
                        <h2 className="text-lg font-semibold tracking-tight max-sm:text-base">
                            RFQ & Quote Selection
                        </h2>
                        {orderData && ( // Show switcher only if data loaded
                            <div className="flex items-center gap-1">
                                <ModeSwitcher currentMode={mode} onModeChange={handleModeChange} />
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
                                                    <li>Add vendors via the button below.</li>
                                                    <li>Enter quotes/makes in the table.</li>
                                                    <li>Switch to <b>View</b> mode to select the final quotes for each item.</li>
                                                </ul>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="font-semibold mb-2 tracking-tight">View Mode:</p>
                                                <ul className="list-disc list-inside space-y-1 text-xs">
                                                    <li>Select the desired vendor quote for each item by clicking the corresponding radio button.</li>
                                                    <li>Click <b>Continue</b> (enabled when at least one quote is selected) to proceed to the final review.</li>
                                                </ul>
                                            </div>
                                        )}
                                    </HoverCardContent>
                                </HoverCard>
                            </div>
                        )}
                    </div>

                    {/* Right Side: Action Buttons */}
                    <div className="flex gap-2 items-center max-sm:justify-end max-sm:w-full">
                        {mode === "edit" && orderData && ( // Show only in edit mode and if data loaded
                            <Button
                                onClick={toggleAddVendorsDialog}
                                variant={"outline"}
                                size="sm"
                                className="text-primary border-primary flex gap-1 items-center"
                            >
                                <CirclePlus className="w-4 h-4" />
                                Add {formData?.selectedVendors?.length > 0 ? "More" : ""} Vendors
                            </Button>
                        )}
                        {/* Ensure orderData exists before rendering GenerateRFQDialog */}
                        {orderData && <GenerateRFQDialog orderData={orderData} />}
                    </div>
                </div>

                {/* Render Table only when orderData is available */}
                {orderData ? (
                    <SelectVendorQuotesTable
                        orderData={orderData}
                        formData={formData}
                        // Pass handlers down directly if needed by table, or handle within logic hook
                        // setFormData={setFormData} - Prefer passing specific handlers like handleQuoteChange
                        selectedVendorQuotes={selectedVendorQuotes}
                        // setSelectedVendorQuotes={setSelectedVendorQuotes} - Prefer handleVendorQuoteSelection
                        mode={mode}
                        // setOrderData={setOrderData} - Avoid passing setState down directly
                        targetRatesData={targetRatesDataMap} // <-- Pass the map down
                        onQuoteChange={handleQuoteChange}
                        onMakeChange={handleMakeChange}
                        onVendorSelect={handleVendorQuoteSelection}
                        onDeleteVendor={handleDeleteVendor} // Pass delete handler
                    />
                ) : (
                    // Optional: Placeholder or different loading state while orderData initializes
                    <div className="text-center p-10 text-muted-foreground">Loading item details...</div>
                )}

                {/* Footer Actions */}
                <div className="flex justify-between items-end mt-6 pt-4 border-t">
                    {/* Show Revert Button only if PR is 'Approved' or potentially 'In Progress' and not in view mode */}
                    {(orderData?.workflow_state === "Approved" || orderData?.workflow_state === "In Progress") && mode !== 'review' ? (
                        <Button
                            variant="outline"
                            onClick={toggleRevertDialog}
                            disabled={isLoading || isRedirecting !== ""} // Disable during any action
                            size="sm"
                            className='flex items-center gap-1'
                        >
                            <Undo2 className="w-4 h-4" />
                            Revert Selections
                        </Button>
                    ) : (
                        <div /> // Placeholder to keep layout
                    )}

                    {/* Show Continue button only in view mode */}
                    {mode === 'view' && (
                        <Button
                            onClick={handleReviewChanges}
                            disabled={!canContinueToReview || isLoading || isRedirecting !== ""} // Use derived state
                            size="sm"
                        >
                            Continue to Review
                        </Button>
                    )}
                </div>
            </div>

            {/* Dialogs and Sheets */}
            {orderData && ( // Ensure orderData is available before rendering dialogs needing it
                <>
                    <AddVendorsDialog
                        isOpen={isAddVendorsDialogOpen}
                        onClose={toggleAddVendorsDialog}
                        vendorOptions={vendorOptionsForDialog}
                        selectedVendors={selectedVendorsForDialog} // Pass temp state
                        onVendorSelect={handleAddVendors} // Update temp state
                        onConfirm={handleConfirmAddVendors}
                        onOpenVendorSheet={toggleVendorSheet} // Handler to open the sheet
                    />

                    <RevertPRDialog
                        isOpen={isRevertDialogOpen}
                        onClose={toggleRevertDialog}
                        onConfirm={handleRevertPR}
                        isLoading={isLoading || isRedirecting === "revert"} // Show loading specific to revert
                    />

                    <VendorSheet
                        isOpen={isVendorSheetOpen}
                        onClose={toggleVendorSheet}
                    // Pass any necessary props like navigation=false or callbacks on vendor creation
                    />
                </>
            )}

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