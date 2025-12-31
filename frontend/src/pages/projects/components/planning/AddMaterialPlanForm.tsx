import React, { useState, useEffect, useMemo, useRef } from "react";
import { X, ChevronDown, Check, ChevronsUpDown, PlusCircleIcon, Search } from "lucide-react";
// import ReactSelect from 'react-select'; // Removing unused import
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup"; 
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useFrappePostCall, useFrappeCreateDoc } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";

// Types for Search
interface SearchItem {
    name: string;
    item_name: string;
    [key: string]: any;
}

interface TokenSearchConfig {
  searchFields: string[]; 
  tokenSeparator: RegExp; 
  minSearchLength: number; 
  minTokenLength: number; 
  minTokenMatches: number; 
  caseSensitive: boolean;
  partialMatch: boolean; 
  fieldWeights: Record<string, number>; 
}

interface SearchMatch {
  item: SearchItem;
  score: number;
  matchedFields: string[];
  matchPositions: Record<string, number[]>;
  isFullMatch: boolean;
  matchedTokenCount: number;
}

const ITEM_SEARCH_CONFIG: TokenSearchConfig = {
  searchFields: ["item_name", "name", "parent"], // Search item name, item code, and parent (PO)
  tokenSeparator: /[\s\-_/()]+/, 
  minSearchLength: 2, 
  minTokenLength: 1, 
  minTokenMatches: 1, 
  caseSensitive: false,
  partialMatch: true, 
  fieldWeights: {
    item_name: 2, 
    name: 1, 
    parent: 1.5,
  },
};

// Helper to escape special regex characters
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calculateMatchScore(
  item: SearchItem,
  searchTokens: string[],
  config: TokenSearchConfig
): SearchMatch | null {
  const { searchFields, caseSensitive, partialMatch, fieldWeights, minTokenMatches } = config; 
  
  let totalScore = 0;
  const matchedFields: string[] = [];
  const matchPositions: Record<string, number[]> = {};
  
  const tokenMatchStatus = new Array(searchTokens.length).fill(false);
  let totalTokenMatches = 0;

  for (const field of searchFields) {
    const fieldValue = String(item[field] || ''); 
    const searchableText = caseSensitive ? fieldValue : fieldValue.toLowerCase();
    const fieldWeight = fieldWeights[field] || 1;
    
    let fieldMatchCount = 0;
    const positions: number[] = [];

    searchTokens.forEach((token, tokenIndex) => {
        const searchToken = caseSensitive ? token : token.toLowerCase();
        
        if (partialMatch) {
            const position = searchableText.indexOf(searchToken);
            if (position !== -1) {
                if (!tokenMatchStatus[tokenIndex]) {
                    tokenMatchStatus[tokenIndex] = true;
                    totalTokenMatches++;
                }
                fieldMatchCount++;
                positions.push(position);
            }
        } else {
            const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(searchToken)}\\b`, 'i');
            if (wordBoundaryRegex.test(searchableText)) {
                if (!tokenMatchStatus[tokenIndex]) {
                    tokenMatchStatus[tokenIndex] = true;
                    totalTokenMatches++;
                }
                fieldMatchCount++;
                const match = searchableText.match(wordBoundaryRegex);
                if (match) positions.push(match.index || 0);
            }
        }
    });

    if (fieldMatchCount > 0) {
      matchedFields.push(field);
      matchPositions[field] = positions;
      
      // Score calculation
      const matchRatio = fieldMatchCount / searchTokens.length;
      const avgPosition = positions.length > 0 
          ? positions.reduce((a, b) => a + b, 0) / positions.length 
          : 0;
      const positionScore = positions.length > 0 ? 1 / (avgPosition + 1) : 0;
      
      // Combine ratio and position score, weighted by the field's importance
      totalScore += (matchRatio * 1000 + positionScore * 100) * fieldWeight;
    }
  }

  // Check if minimum token matches requirement is met
  if (totalTokenMatches < minTokenMatches) {
      return null;
  }

  // Calculate if this is a full match (all tokens matched)
  const isFullMatch = tokenMatchStatus.every(status => status);

  // Bonus for full matches
  if (isFullMatch) {
      totalScore *= 1.5; // 50% bonus for full matches
  }

  return {
      item,
      score: totalScore,
      matchedFields,
      matchPositions,
      isFullMatch,
      matchedTokenCount: totalTokenMatches
  };
}

interface AddMaterialPlanFormProps {
    planNumber: number;
    projectId: string;
    projectPackages: string[];
    onClose: () => void;
}

export const AddMaterialPlanForm = ({ planNumber, projectId, projectPackages, onClose }: AddMaterialPlanFormProps) => {
    // State for form
    const [poMode, setPoMode] = useState<"existing" | "new" | undefined>(undefined);
    // Search Mode: 'po' or 'item'
    const [searchMode, setSearchMode] = useState<"po" | "item">("po");
    
    const [selectedPackage, setSelectedPackage] = useState<string>("");
    const [selectedPO, setSelectedPO] = useState<string>("");
    
    // Advanced Search State
    const [itemSearchInput, setItemSearchInput] = useState("");
    const [debouncedSearchInput, setDebouncedSearchInput] = useState("");
    const [filteredSuggestions, setFilteredSuggestions] = useState<SearchItem[]>([]);
    const [isDropdownOpen, setDropdownOpen] = useState(false);
    const searchWrapperRef = useRef<HTMLDivElement>(null);

    // We store the full PO object (with items) here to avoid re-fetching
    const [poDataMap, setPoDataMap] = useState<Record<string, any>>({});
    
    const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
    const [manualItemsText, setManualItemsText] = useState<string>("");
    const [deliveryDate, setDeliveryDate] = useState<string>("");
    
    const { toast } = useToast();

    // 2. Fetch Procurement Orders filtered by package using POST
    const { call: fetchPOs, result: poResult, loading: isLoadingPOs } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_material_plan_data"
    );

    // 3. Fetch Items filtered by package (using same API with search_type='item')
    const { call: fetchItems, result: itemsResult, loading: isLoadingItems } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_material_plan_data"
    );

    // We uses the fetched items from the `fetchItems` call
    const itemsByPackage = itemsResult?.message || [];

    // State for Search Mode Step
    const [formStep, setFormStep] = useState<"selection" | "review">("selection");
    const [planDeliveryDates, setPlanDeliveryDates] = useState<Record<string, string>>({});

    // Debounce Effect
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearchInput(itemSearchInput);
        }, 300);
        return () => clearTimeout(handler);
    }, [itemSearchInput]);

    // Search Logic Effect
    useEffect(() => {
        const trimmedInput = debouncedSearchInput.trim();
        const allOptions = itemsByPackage || [];

        // If input is empty, show ALL available (unselected) items
        if (!trimmedInput) {
            const allAvailable = allOptions.filter(item => !selectedItems[item.name]);
            setFilteredSuggestions(allAvailable);
            return;
        }

        const searchTokens = trimmedInput
            .split(ITEM_SEARCH_CONFIG.tokenSeparator)
            .map(token => token.trim())
            .filter(token => token.length >= ITEM_SEARCH_CONFIG.minTokenLength);

        if (searchTokens.length === 0) {
             const allAvailable = allOptions.filter(item => !selectedItems[item.name]);
             setFilteredSuggestions(allAvailable);
             return;
        }

        const matchResults: SearchMatch[] = [];
        
        for (const option of allOptions) {
            const matchResult = calculateMatchScore(option, searchTokens, ITEM_SEARCH_CONFIG);
            if (matchResult) {
                matchResults.push(matchResult);
            }
        }

        matchResults.sort((a, b) => {
            if (a.isFullMatch !== b.isFullMatch) return a.isFullMatch ? -1 : 1;
            if (a.matchedTokenCount !== b.matchedTokenCount) return b.matchedTokenCount - a.matchedTokenCount;
            return b.score - a.score;
        });

        // Filter out already selected items
        const finalSuggestions = matchResults
            .map(result => result.item)
            .filter(item => !selectedItems[item.name]);
            
        setFilteredSuggestions(finalSuggestions);

    }, [debouncedSearchInput, itemsByPackage, selectedItems]);

    // Click Outside to Close Dropdown
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target as Node)) {
                setDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    // 3. Trigger Fetch & Reset Logic: When Package or Mode Changes
    useEffect(() => {
        console.log("Effect triggered. Pkg:", selectedPackage, "Mode:", poMode);
        if (selectedPackage) {
            setSelectedPO("");
            setSelectedItems({});
            // setSelectedItemSearch(""); 
            setItemSearchInput(""); // Reset search
            setFormStep("selection");
            setPlanDeliveryDates({});
            
            // Only call API if mode is 'existing'
            if (poMode === 'existing') {
                 setPoDataMap({}); // Clear old data
                 // Call API to get POs
                 fetchPOs({ 
                    project: projectId,
                    procurement_package: selectedPackage,
                    mode: "list"
                 });
                 // Call API to get Items (Separate call to same endpoint)
                 fetchItems({
                    project: projectId,
                    procurement_package: selectedPackage,
                    search_type: "item"
                 });
            }
        }
    }, [selectedPackage, poMode]);

    // Update local map when result arrives
    useEffect(() => {
        if (poResult?.message && Array.isArray(poResult.message)) {
            const newMap: Record<string, any> = {};
            poResult.message.forEach((po: any) => {
                newMap[po.name] = po;
            });
            setPoDataMap(newMap);
        }
    }, [poResult]);

    // 4. Reset Logic: When PO Changes (or Mode changes)
    useEffect(() => {
        if (!selectedPO) {
             // Logic specific to single PO mode clearing
             if (searchMode === 'po') {
                 setSelectedItems({});
             }
        }
    }, [selectedPO]);

    // 5. Get Full PO Details from local map (no extra API call needed!)
    const fullPO = selectedPO ? poDataMap[selectedPO] : null;

    const handleItemToggle = (itemName: string) => {
        setSelectedItems(prev => ({
            ...prev,
            [itemName]: !prev[itemName]
        }));
    };

    // Create Material Delivery Plan
    const { createDoc, loading: isCreating } = useFrappeCreateDoc();

    const handleConfirm = async () => {
        await processDelivery();
    };

    const processDelivery = async () => {
        // Handle "Create New PO" Mode
        if (poMode === "new") {
             if (!manualItemsText.trim()) {
                 toast({
                     title: "No Materials",
                     description: "Please enter at least one material.",
                     variant: "destructive"
                 });
                 return false;
             }
             if (!deliveryDate) {
                 toast({
                     title: "Missing Delivery Date",
                     description: "Please select a Delivery Date",
                     variant: "destructive"
                 });
                 return false;
             }

             const lines = manualItemsText.split('\n').map(l => l.trim()).filter(Boolean);
             if (lines.length === 0) {
                 toast({
                     title: "No Valid Materials",
                     description: "Please enter valid material names.",
                     variant: "destructive"
                 });
                 return false;
             }

             const manualItems = lines.map((line, idx) => ({
                 name: `manual-${Date.now()}-${idx}`, // Temp ID not used by backend but needed for type
                 item_name: line,
                 procurement_package: selectedPackage,
                 item_id: `TEMP-${Date.now()}-${idx}`,
                //  unit: "", 
                 category: ""
             }));

             const success = await submitPlan("", manualItems, deliveryDate);
             if (success) {
                 toast({
                    title: "Success",
                    description: "Successfully created Material Plan (New PO).",
                    variant: "default"
                });
                onClose();
                return true;
             }
             return false;
        }

        // Logic split based on searchMode
        if (searchMode === "po") {
             if (!selectedPackage || !selectedPO) {
                toast({
                    title: "Missing Fields",
                    description: "Please select Work Package and PO ID",
                    variant: "destructive"
                });
                return false;
             }
             if (!deliveryDate) {
                 toast({
                    title: "Missing Delivery Date",
                    description: "Please select a Delivery Date",
                    variant: "destructive"
                });
                return false;
             }
             const itemsToPlan = fullPO?.items?.filter((item: any) => selectedItems[item.name]) || [];
             if (itemsToPlan.length === 0) {
                 toast({
                    title: "No Items Selected",
                    description: "Please select at least one item from the PO",
                    variant: "destructive"
                });
                 return false;
             }
             
             const success = await submitPlan(selectedPO, itemsToPlan, deliveryDate);
             if (success) {
                 toast({
                    title: "Success",
                    description: "Successfully created Material Delivery Plan.",
                    variant: "default"
                });
                onClose();
                return true;
             }
             return false;
        } else {
            // Item Search Mode: Review Step Submission
            
            // Re-calculate groups to be safe
            const itemNames = Object.keys(selectedItems);
            if (itemNames.length === 0) {
                toast({
                    title: "No Items Selected",
                    description: "Please select at least one item",
                    variant: "destructive"
                });
                return false;
            }

            const poGroups: Record<string, any[]> = {};
            let missingDate = false;

            itemNames.forEach(name => {
                const item = itemsByPackage.find((i: any) => i.name === name);
                if (item && item.parent) {
                    if (!poGroups[item.parent]) {
                        poGroups[item.parent] = [];
                        // Check date
                        if (!planDeliveryDates[item.parent]) {
                            missingDate = true;
                        }
                    }
                    poGroups[item.parent].push(item);
                }
            });

            if (Object.keys(poGroups).length === 0) {
                 toast({
                    title: "No Valid Items",
                    description: "No valid items selected.",
                    variant: "destructive"
                });
                 return false;
            }

            if (missingDate) {
                toast({
                    title: "Missing Delivery Date",
                    description: "Please select a delivery date for all plans.",
                    variant: "destructive"
                });
                return false;
            }

            // Submit for each PO
            const pos = Object.keys(poGroups);
            let successCount = 0;
            
            for (const po of pos) {
                const groupItems = poGroups[po];
                const date = planDeliveryDates[po];
                const success = await submitPlan(po, groupItems, date);
                if (success) successCount++;
            }

            if (successCount > 0) {
                toast({
                    title: "Success",
                    description: `Successfully created ${successCount} Material Delivery Plans.`,
                    variant: "default"
                });
                onClose();
                return true;
            } else {
                return false;
            }
        }
    }

    const submitPlan = async (poName: string, items: any[], date: string) => {
        try {
            // Filter item fields to save space
            const minimalItems = items.map((item: any) => ({
                name: item.name,
                item_id: item.item_id || item.item_code,
                item_name: item.item_name,
                procurement_package: item.procurement_package || selectedPackage,
                // unit: item.unit || item.uom,
                category: item.category
            }));

            await createDoc("Material Delivery Plan", {
                project: projectId,
                po_link: poName,
                package_name: selectedPackage,
                delivery_date: date,
                po_type: poMode === "new" ? "New PO" : "Existing PO",
                mp_items: JSON.stringify({ list: minimalItems })
            });
            return true;
        } catch (e) {
            console.error(`Failed to create plan for PO ${poName}`, e);
            toast({
                title: "Error",
                description: `Failed to create plan for PO ${poName}`,
                variant: "destructive"
            });
            return false;
        }
    }

    const selectedCount = Object.values(selectedItems).filter(Boolean).length;
    // We uses the fetched items from the `fetchItems` call
    // const itemsByPackage = itemsResult?.message || []; // MOVED UP

    const totalItems = fullPO?.items?.length || 0;
    
    // Derived PO List for Dropdown
    const procurementOrders = (poResult?.message && Array.isArray(poResult.message)) ? poResult.message : [];

    // Helper: Group Selected Items by PO for Review View
    const getPOGroups = () => {
        const groups: Record<string, any[]> = {};
        Object.keys(selectedItems).forEach(name => {
            const item = itemsByPackage.find((i: any) => i.name === name);
            if (item && item.parent) {
                if (!groups[item.parent]) {
                    groups[item.parent] = [];
                }
                groups[item.parent].push(item);
            }
        });
        return groups;
    };
    const poGroups = getPOGroups();
    const poGroupKeys = Object.keys(poGroups);

    return (
        <div className="border border-indigo-100 rounded-lg bg-white shadow-sm mb-4">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-indigo-50/50 border-b border-indigo-100">
                <h3 className="text-sm font-semibold text-gray-800">
                    {formStep === 'review' ? `Review Plans (${Object.keys(poGroups).length})` : `Plan ${planNumber}`}
                </h3>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600" type="button">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-4 space-y-4">
                {formStep === 'review' ? (
                     /* REVIEW STEP VIEW */
                     <div className="space-y-6">
                         <div className="space-y-6">
                             {poGroupKeys.map((poName, index) => (
                                 <div key={poName} className="border border-gray-200 rounded-lg bg-white shadow-sm">
                                     {/* Card Header */}
                                     <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200 rounded-t-lg">
                                         <h4 className="text-sm font-semibold text-gray-900">Plan {index + 1}</h4>
                                         <button 
                                            type="button"
                                            onClick={() => {
                                                const newSel = { ...selectedItems };
                                                poGroups[poName].forEach(i => delete newSel[i.name]);
                                                setSelectedItems(newSel);
                                                const newDates = { ...planDeliveryDates };
                                                delete newDates[poName];
                                                setPlanDeliveryDates(newDates);
                                            }}
                                            className="text-gray-400 hover:text-red-500"
                                         >
                                             <X className="w-4 h-4" />
                                         </button>
                                     </div>
                                     
                                     <div className="p-4 space-y-4">
                                         {/* Work Package Read-only */}
                                         <div className="space-y-1.5">
                                             <Label className="text-xs font-bold text-gray-700">Selected Work Package</Label>
                                             <div className="w-full h-9 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-md">
                                                 {selectedPackage}
                                             </div>
                                         </div>

                                         {/* PO ID Read-only */}
                                         <div className="space-y-1.5">
                                              <Label className="text-xs font-bold text-gray-700">PO ID</Label>
                                              <div className="w-full h-9 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-md">
                                                  {poName}
                                              </div>
                                         </div>

                                         {/* Items List */}
                                         <div className="space-y-2">
                                             <div className="flex items-center gap-2">
                                                 <Label className="text-xs font-bold text-gray-700">Selected Items from PO</Label>
                                                 <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-200 font-normal m-0 h-5 px-2">
                                                     {poGroups[poName].length} Items
                                                 </Badge>
                                             </div>
                                             <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
                                                 {poGroups[poName].map(item => (
                                                     <div key={item.name} className="flex items-center space-x-3 p-2.5 bg-white">
                                                          <div className="flex items-center justify-center w-4 h-4 rounded bg-blue-600 border border-blue-600">
                                                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                          </div>
                                                          <span className="text-sm text-gray-700">{item.item_name}</span>
                                                     </div>
                                                 ))}
                                             </div>
                                         </div>

                                         {/* Delivery Date */}
                                         <div className="space-y-1.5">
                                             <Label className="text-xs font-bold text-gray-700">Delivery Date for this PO <span className="text-red-500">*</span></Label>
                                             <input 
                                                 type="date" 
                                                 required
                                                 value={planDeliveryDates[poName] || ""}
                                                 onChange={(e) => setPlanDeliveryDates(prev => ({ ...prev, [poName]: e.target.value }))}
                                                 className="flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 placeholder:text-gray-400"
                                                 placeholder="Select a Date"
                                             />
                                             <p className="text-[10px] text-gray-400">
                                                 This delivery date will apply to all selected items in this plan
                                             </p>
                                         </div>
                                     </div>
                                 </div>
                             ))}
                             {poGroupKeys.length === 0 && (
                                 <div className="text-center py-8 bg-gray-50 rounded-lg dashed border border-gray-200 text-sm text-gray-500">
                                     No plans selected. Go back to add items.
                                 </div>
                             )}
                         </div>

                         <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 sticky bottom-0 bg-white">
                             <button 
                                 type="button"
                                 onClick={onClose}
                                 className="px-4 py-2 bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 rounded-md text-sm font-medium mr-auto"
                             >
                                 Cancel
                             </button>
                             <button 
                                 type="button"
                                 onClick={() => setFormStep('selection')}
                                 className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                             >
                                 Back to Edit
                             </button>
                             <button 
                                 type="button"
                                 onClick={handleConfirm}
                                 disabled={isCreating || poGroupKeys.length === 0}
                                 className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors disabled:opacity-50"
                             >
                                 {isCreating ? "Submitting..." : "Confirm All Plans"}
                             </button>
                         </div>
                     </div>
                ) : (
                    /* SELECTION STEP VIEW */
                    <>
                        {/* Select Work Package */}
                        <div className="space-y-2">
                            <Label className="text-xs font-bold text-gray-700">Select Work Package</Label>
                            <Select value={selectedPackage} onValueChange={setSelectedPackage}>
                                <SelectTrigger className="w-full bg-white border-gray-200 text-gray-900">
                                    <SelectValue placeholder="Select one package for material plan" />
                                </SelectTrigger>
                                <SelectContent>
                                    {projectPackages.map((pkgName) => (
                                        <SelectItem key={pkgName} value={pkgName}>
                                            {pkgName}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* PO Selection Mode */}
                        <div className={`space-y-2 ${!selectedPackage ? "opacity-50 pointer-events-none" : ""}`}>
                            <Label className="text-xs font-bold text-gray-700">PO Selection Mode</Label>
                            <RadioGroup 
                                value={poMode} 
                                onValueChange={(v) => setPoMode(v as "existing" | "new")}
                                className="flex items-center gap-6"
                                disabled={!selectedPackage}
                            >
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="existing" id={`r1-${planNumber}`} className="text-indigo-600 border-indigo-600" />
                                    <Label htmlFor={`r1-${planNumber}`} className="font-normal text-sm text-gray-700">Use Existing PO</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="new" id={`r2-${planNumber}`} />
                                    <Label htmlFor={`r2-${planNumber}`} className="font-normal text-sm text-gray-700">Create New PO</Label>
                                </div>
                            </RadioGroup>
                        </div>

                        {/* Existing PO Selection */}
                        {poMode === "existing" && (
                            <div className="space-y-4 pt-2">


                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold text-gray-700">Search/ Select Materials and PR ID</Label>
                                        <p className="text-xs text-blue-800">
                                            Materials you list must exist in the PO you link. A PO can only be linked if it contains those materials
                                        </p>
                                        <div className="flex gap-2">
                                            <div className="w-[120px] shrink-0">
                                                 <Select value={searchMode} onValueChange={(val: "po" | "item") => setSearchMode(val)}>
                                                    <SelectTrigger className="w-full bg-white border-gray-200 text-gray-700">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="po">PO ID</SelectItem>
                                                        <SelectItem value="item">Items In POs</SelectItem>
                                                    </SelectContent>
                                                 </Select>
                                            </div>
                                            
                                            <div className="flex-1">
                                                {searchMode === "po" ? (
                                                    <Select 
                                                        value={selectedPO} 
                                                        onValueChange={(val) => {
                                                            setSelectedPO(val);
                                                            // setSelectedItems({}); 
                                                        }}
                                                    >
                                                        <SelectTrigger className="w-full bg-white border-gray-200 text-gray-900">
                                                            <SelectValue placeholder="Select one PO ID" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {isLoadingPOs ? (
                                                                <div className="p-2 text-xs text-gray-500">Loading POs...</div>
                                                            ) : procurementOrders && procurementOrders.length > 0 ? (
                                                                procurementOrders.map((po: any) => (
                                                                    <SelectItem key={po.name} value={po.name}>
                                                                        <span className="truncate">
                                                                            {po.name}
                                                                        </span>
                                                                    </SelectItem>
                                                                ))
                                                            ) : (
                                                                <div className="p-2 text-xs text-gray-500 text-center">No Options Available</div>
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                ) : isLoadingItems ? (
                                                    <Skeleton className="h-10 w-full rounded-md" />
                                                ) : (
                                                    <div className="relative w-full" ref={searchWrapperRef}>
                                                        <div className="relative">
                                                             <input
                                                                type="text"
                                                                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                                                placeholder="Search items (e.g. 'cement 50kg')..."
                                                                value={itemSearchInput}
                                                                onChange={(e) => {
                                                                    setItemSearchInput(e.target.value);
                                                                    setDropdownOpen(true);
                                                                }}
                                                                onFocus={() => {
                                                                    setDropdownOpen(true);
                                                                }}
                                                             />
                                                             <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground opacity-50" />
                                                        </div>

                                                        {isDropdownOpen && (
                                                            <div className="absolute z-50 w-full mt-1 overflow-hidden rounded-md border bg-white shadow-md">
                                                                <div className="max-h-60 overflow-y-auto">
                                                                    {filteredSuggestions.length === 0 ? (
                                                                        <div className="py-6 text-center text-sm text-gray-500">
                                                                            {itemSearchInput ? "No matching items found." : "No items available."}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="py-1">
                                                                            {filteredSuggestions.map((item) => (
                                                                                <div
                                                                                    key={item.name}
                                                                                    className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                                                                                    onClick={() => {
                                                                                        if (!selectedItems[item.name]) {
                                                                                            setSelectedItems(prev => ({...prev, [item.name]: true}));
                                                                                            setItemSearchInput(""); // Optional: clear after select? Or keep? clearing is standard for "add one by one"
                                                                                            // Keep dropdown open? Usually better to modify focus logic or just keep it open.
                                                                                            // For now, let's keep it open to add more?
                                                                                        }
                                                                                    }}
                                                                                >
                                                                                    <div className="flex flex-col flex-1">
                                                                                        <span className="font-medium">{item.item_name}</span>
                                                                                        <span className="text-[10px] text-gray-500">PO: {item.parent}</span>
                                                                                    </div>
                                                                                    <Button
                                                                                        variant="ghost"
                                                                                        size="icon"
                                                                                        className="h-8 w-8 text-muted-foreground hover:text-green-600"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            if (!selectedItems[item.name]) {
                                                                                                 setSelectedItems(prev => ({...prev, [item.name]: true}));
                                                                                            }
                                                                                        }}
                                                                                    >
                                                                                        <PlusCircleIcon className="h-5 w-5" />
                                                                                    </Button>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
    
                                    {/* Items List Selection */}
                                    {selectedPO && fullPO && searchMode === "po" ? (
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <Label className="text-xs font-bold text-gray-700">Select Items from PO</Label>
                                                    <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200 font-normal">
                                                        {selectedCount}/{totalItems} Items
                                                    </Badge>
                                                </div>
                                                {selectedPO && (
                                                    <div className="flex w-full max-w-[200px] h-8 items-center justify-between rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 ml-auto mr-2">
                                                        <span className="truncate flex-1">{selectedPO}</span>
                                                        <button type="button" onClick={() => setSelectedPO("")} className="ml-2 font-medium text-red-600 hover:text-red-800 focus:outline-none">Change</button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-60 overflow-y-auto">
                                                {fullPO.items?.map((item: any) => (
                                                    <div key={item.name} className="flex items-center space-x-3 p-3 hover:bg-gray-50 bg-white">
                                                        <Checkbox 
                                                            id={`item-${item.name}`} 
                                                            checked={selectedItems[item.name] || false}
                                                            onCheckedChange={() => handleItemToggle(item.name)}
                                                        />
                                                        <label htmlFor={`item-${item.name}`} className="text-sm text-gray-700 font-medium cursor-pointer flex-1">
                                                            {item.item_name}
                                                        </label>
                                                    </div>
                                                ))}
                                                {(!fullPO.items || fullPO.items.length === 0) && (
                                                    <div className="p-4 text-center text-gray-500 text-sm">No items found in this PO.</div>
                                                )}
                                            </div>
                                            <div className="flex items-end gap-4 pt-2 border-t border-gray-100 mt-2">
                                                <div className="space-y-1 flex-1">
                                                    <Label className="text-xs font-bold text-gray-700">Delivery Date</Label>
                                                    <input 
                                                        type="date" 
                                                        required
                                                        value={deliveryDate}
                                                        onChange={(e) => setDeliveryDate(e.target.value)}
                                                        className="w-full flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                                                    />
                                                </div>
                                                <button 
                                                    type="button"
                                                    onClick={handleConfirm}
                                                    disabled={isCreating}
                                                    className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium h-9 px-6 rounded transition-colors disabled:opacity-50"
                                                >
                                                    {isCreating ? "Creating..." : "Confirm"}
                                                </button>
                                            </div>
                                        </div>
                                    ) : searchMode === "item" && Object.keys(selectedItems).length > 0 ? (
                                        <div className="space-y-3">
                                             <div className="flex items-center justify-between">
                                                <Label className="text-xs font-bold text-gray-700">Selected Items ({Object.keys(selectedItems).length} / {itemsByPackage.length})</Label>
                                            </div>
                                            <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-60 overflow-y-auto">
                                               {Object.keys(selectedItems).map(itemName => {
                                                   const item = itemsByPackage.find((i: any) => i.name === itemName);
                                                   if (!item) return null;
                                                   return (
                                                        <div key={item.name} className="flex items-center justify-between p-3 bg-white hover:bg-indigo-50/50 transition-colors">
                                                            <div className="flex items-center gap-3">
                                                                 <Checkbox 
                                                                    checked 
                                                                    onCheckedChange={() => {
                                                                        const newSel = { ...selectedItems };
                                                                        delete newSel[itemName];
                                                                        setSelectedItems(newSel);
                                                                    }}
                                                                 />
                                                                 <div className="flex flex-col">
                                                                     <span className="text-sm font-medium text-gray-900">{item.item_name}</span>
                                                                     <div className="flex items-center gap-2 mt-0.5">
                                                                         <span className="text-xs text-gray-500">{item.quantity} {item.uom}</span>
                                                                         <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-normal text-indigo-700 bg-indigo-50 border-indigo-200">
                                                                             {item.parent}
                                                                         </Badge>
                                                                     </div>
                                                                 </div>
                                                            </div>
                                                            <button 
                                                                type="button"
                                                                onClick={() => {
                                                                    const newSel = { ...selectedItems };
                                                                    delete newSel[itemName];
                                                                    setSelectedItems(newSel);
                                                                }} 
                                                                className="text-gray-400 hover:text-red-500 p-1"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                   )
                                               })}
                                            </div>
    
                                            <div className="flex items-end justify-end pt-2 border-t border-gray-100 mt-2">
                                                <button 
                                                    type="button"
                                                    onClick={() => setFormStep('review')}
                                                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium h-9 px-6 rounded transition-colors"
                                                >
                                                    Confirm Plans &rarr;
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}
                                </div> // Close the internal div of existing mode
                            )}
                        {/* Create New PO Mode */}
                        {poMode === "new" && (
                            <div className="space-y-4 pt-2">
                                <div className="space-y-2">
                                    <Label className="text-xs font-bold text-gray-700">List Materials (One per line)</Label>
                                    <Textarea 
                                        placeholder="Enter material names here..."
                                        value={manualItemsText}
                                        onChange={(e) => setManualItemsText(e.target.value)}
                                        className="h-32 text-sm"
                                    />
                                    <p className="text-[10px] text-gray-500">
                                        Each line will be saved as a separate material item.
                                    </p>
                                </div>

                                <div className="flex items-end gap-4 pt-2 border-t border-gray-100 mt-2">
                                    <div className="space-y-1 flex-1">
                                        <Label className="text-xs font-bold text-gray-700">Delivery Date <span className="text-red-500">*</span></Label>
                                        <input 
                                            type="date" 
                                            required
                                            value={deliveryDate}
                                            onChange={(e) => setDeliveryDate(e.target.value)}
                                            className="w-full flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                                        />
                                    </div>
                                    <button 
                                        type="button"
                                        onClick={handleConfirm}
                                        disabled={isCreating || !deliveryDate || !manualItemsText.trim()}
                                        className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium h-9 px-6 rounded transition-colors disabled:opacity-50"
                                    >
                                        {isCreating ? "Creating..." : "Create Plan"}
                                    </button>
                                </div>
                            </div>
                        )}
                        </>
                    )}
            </div>
        </div>
    );
};
