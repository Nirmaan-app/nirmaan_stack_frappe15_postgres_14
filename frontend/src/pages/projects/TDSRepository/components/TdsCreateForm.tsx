import React, { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import ReactSelect from "react-select"; // Assuming react-select is used based on other files
import { Trash2, FileText } from 'lucide-react';
import { useFrappeGetDocList, useFrappeCreateDoc } from "frappe-react-sdk";
import { toast } from "@/components/ui/use-toast";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

interface TdsCreateFormProps {
    projectId: string;
    onSuccess?: () => void;
}

interface TDSRepositoryDoc {
    name: string;
    tds_item_id: string; // This is the ID of the Item, but label might be tds_item_name
    tds_item_name: string;
    make: string; // This is the ID of the Make
    work_package: string;
    category: string;
    description: string;
    tds_attachment?: string;
}

interface CartItem extends TDSRepositoryDoc {
    // We use the full doc as the cart item
}

export const TdsCreateForm: React.FC<TdsCreateFormProps> = ({ projectId, onSuccess }) => {
    const [cartItems, setCartItems] = useState<CartItem[]>([]);
    const [selectedItemName, setSelectedItemName] = useState<string | null>(null); // Storing Item Name (tds_item_name) for semantic selection
    const [selectedMake, setSelectedMake] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { createDoc } = useFrappeCreateDoc();

    // 1. Fetch Master Data
    const { data: repoItems } = useFrappeGetDocList<TDSRepositoryDoc>("TDS Repository", {
        fields: ["name", "tds_item_id", "tds_item_name", "make", "description", "work_package", "category", "tds_attachment"],
        limit: 1000
    });

    // 2. Fetch Existing Project Items (to prevent duplicates)
    const { data: existingProjectItems } = useFrappeGetDocList("Project TDS Item List", {
        fields: ["tds_item_id", "tds_make", "tds_request_id"], 
        filters: [["tdsi_project_id", "=", projectId]],
        limit: 1000
    });

    // Filter repo items to exclude those already in the project
    const availableRepoItems = useMemo(() => {
        if (!repoItems || !existingProjectItems) return repoItems || [];
        const existingIds = new Set(existingProjectItems.map((i: any) => `${i.tds_item_id}-${i.tds_make}`));
        // Also exclude items currently in the cart
        const cartIds = new Set(cartItems.map(i => `${i.tds_item_id}-${i.make}`));
        
        return repoItems.filter(item => !existingIds.has(`${item.tds_item_id}-${item.make}`) && !cartIds.has(`${item.tds_item_id}-${item.make}`));
    }, [repoItems, existingProjectItems, cartItems]);

    // 3. Compute Options
    // Item Options: Unique tds_item_name from AVAILABLE items
    const itemOptions = useMemo(() => {
        const uniqueItems = new Map();
        availableRepoItems.forEach(item => {
            if (item.tds_item_name && !uniqueItems.has(item.tds_item_name)) {
                uniqueItems.set(item.tds_item_name, {
                    label: item.tds_item_name,
                    value: item.tds_item_name // Identify by name as primary selector
                });
            }
        });
        return Array.from(uniqueItems.values());
    }, [availableRepoItems]);

    // Make Options: Filtered by selected Item Name from AVAILABLE items
    const makeOptions = useMemo(() => {
        if (!selectedItemName) return [];
        return availableRepoItems
            .filter(item => item.tds_item_name === selectedItemName)
            .map(item => ({
                label: item.make, 
                value: item.make
            }));
    }, [availableRepoItems, selectedItemName]);

    // Identify Selected Doc
    const selectedDoc = useMemo(() => {
        if (!selectedItemName || !selectedMake) return null;
        return availableRepoItems.find(item => 
            item.tds_item_name === selectedItemName && 
            item.make === selectedMake
        );
    }, [availableRepoItems, selectedItemName, selectedMake]);

    // Handlers
    const handleItemChange = (val: string | null) => {
        setSelectedItemName(val);
        setSelectedMake(null); // Reset make
    };

    const handleAddItem = () => {
        if (selectedDoc) {
            // Check duplicates in cart
            if (cartItems.some(i => i.tds_item_id === selectedDoc.tds_item_id && i.make === selectedDoc.make)) {
                toast({
                    title: "Duplicate in Cart",
                    description: "This item is already in your current selection.",
                    variant: "destructive"
                });
                return;
            }

            // Check duplicates in Existing Project List
            // We match based on tds_item_id and tds_make
            if (existingProjectItems?.some((i: any) => i.tds_item_id === selectedDoc.tds_item_id && i.tds_make === selectedDoc.make)) {
                toast({
                    title: "Item Previously Added",
                    description: "This item and make combination is already in the project TDS list.",
                    variant: "destructive"
                });
                return;
            }

            setCartItems([...cartItems, selectedDoc]);
            // Reset selection? User might want to add another make of same item.
            // Let's clear Make.
            setSelectedMake(null);
        }
    };

    const handleRemoveItem = (index: number) => {
        const newCart = [...cartItems];
        newCart.splice(index, 1);
        setCartItems(newCart);
    };

    const handleReset = () => {
        setSelectedItemName(null);
        setSelectedMake(null);
    };

    const handleLogSubmit = async () => {
        if (cartItems.length === 0) return;
        setIsSubmitting(true);
        
        let nextSeq = 1;
        if (existingProjectItems) {
            const reqIds = existingProjectItems
                .map((i: any) => i.tds_request_id)
                .filter((id: string) => id && id.startsWith("RQ-"));
            
            if (reqIds.length > 0) {
                 const maxId = Math.max(...reqIds.map((id: string) => {
                    const parts = id.split("-");
                    return parts.length > 1 ? parseInt(parts[1]) : 0;
                 }));
                 if (!isNaN(maxId)) {
                     nextSeq = maxId + 1;
                 }
            }
        }
        const uniqueReqId = `RQ-${nextSeq.toString().padStart(2, '0')}`;

        try {
            // Process sequentially to avoid race conditions or limits, or use Promise.all
            await Promise.all(cartItems.map(item => 
                 createDoc("Project TDS Item List", {
                    tdsi_project_id: projectId,
                    tds_request_id: uniqueReqId,
                    tds_item_id: item.tds_item_id, // Source Doc ID
                    tds_item_name: item.tds_item_name,
                    tds_make: item.make,
                    tds_description: item.description,
                    tds_work_package: item.work_package,
                    tds_category: item.category,
                    tds_status: "Pending",
                    tds_attachment: item.tds_attachment // Snapshot attachment if needed?
                })
            ));

            toast({
                title: "Request Submitted",
                description: `Successfully submitted ${cartItems.length} items for approval.`,
                className: "bg-green-50 border-green-200 text-green-800"
            });
            
            setCartItems([]);
            handleReset();
            if (onSuccess) onSuccess();

        } catch (error) {
            console.error("Submission failed", error);
            toast({
                title: "Submission Failed",
                description: "There was an error submitting your items. Please try again.",
                variant: "destructive"
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-8">
            {/* Form Section */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">Select Items for TDS</h3>
                        <p className="text-sm text-gray-500">Search and choose one or more items from the repository.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleReset} className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200">
                        Reset
                    </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    {/* Item Name */}
                    <div className="space-y-2">
                         <Label className="text-sm font-semibold text-gray-700">Item Name <span className="text-red-500">*</span></Label>
                         <ReactSelect
                            options={itemOptions}
                            value={selectedItemName ? { label: selectedItemName, value: selectedItemName } : null}
                            onChange={(opt) => handleItemChange(opt?.value || null)}
                            placeholder="Enter Item Name"
                            className="react-select-container"
                            classNamePrefix="react-select"
                            isLoading={!repoItems}
                         />
                    </div>

                    {/* Make */}
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold text-gray-700">Make <span className="text-red-500">*</span></Label>
                        <ReactSelect
                            options={makeOptions}
                            value={selectedMake ? { label: selectedMake, value: selectedMake } : null}
                            onChange={(opt) => setSelectedMake(opt?.value || null)}
                            placeholder={selectedItemName ? "Select Make" : "NA"}
                            isDisabled={!selectedItemName}
                            className="react-select-container"
                            classNamePrefix="react-select"
                        />
                    </div>
                </div>

                {/* Description (Hidden per request)
                <div className="space-y-2 mb-6">
                    <Label className="text-sm font-semibold text-gray-700">Description <span className="text-red-500">*</span></Label>
                    <div className="h-10 px-3 py-2 bg-gray-50 rounded-md border border-gray-200 text-sm text-gray-500 truncate">
                        {selectedDoc ? selectedDoc.description : "Select Item Description"}
                    </div>
                </div>
                */}

                <Button 
                    className="w-full bg-gray-50 hover:bg-gray-100 text-gray-900 border border-gray-200 font-medium"
                    onClick={handleAddItem}
                    disabled={!selectedDoc}
                >
                    Add item
                </Button>
            </div>

            {/* Cart Table Section */}
            {cartItems.length > 0 && (
            <div>
                <div className="mb-4">
                     <h3 className="text-lg font-semibold text-gray-900">Selected Items for TDS</h3>
                     <p className="text-sm text-gray-500">Review selected items before sending for approval.</p>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <Table>
                        <TableHeader className="bg-gray-50">
                            <TableRow>
                                <TableHead className="font-semibold text-gray-700">Work Package</TableHead>
                                <TableHead className="font-semibold text-gray-700">Category</TableHead>
                                <TableHead className="font-semibold text-gray-700">Item Name</TableHead>
                                <TableHead className="font-semibold text-gray-700 w-1/3">Description</TableHead>
                                <TableHead className="font-semibold text-gray-700">Make</TableHead>
                                <TableHead className="font-semibold text-gray-700 text-center">Doc.</TableHead>
                                <TableHead className="font-semibold text-gray-700 text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {cartItems.map((item, idx) => (
                                <TableRow key={`${item.name}-${idx}`}>
                                    <TableCell>{item.work_package}</TableCell>
                                    <TableCell>{item.category}</TableCell>
                                    <TableCell className="font-medium">{item.tds_item_name}</TableCell>
                                    <TableCell>
                                        <div className="truncate max-w-[200px]" title={item.description}>
                                            {item.description}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                                            {item.make}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {item.tds_attachment ? (
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={() => window.open(item.tds_attachment, '_blank')}>
                                                <FileText className="h-4 w-4" />
                                            </Button>
                                        ) : (
                                            <span className="text-gray-300">-</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                                            onClick={() => handleRemoveItem(idx)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </div>
            )}

            {/* Sticky Action Bar */}
            {cartItems.length > 0 && (
                <div className="sticky bottom-0 bg-white p-4 border-t border-gray-200 shadow-lg -mx-6 -mb-6 mt-8 flex justify-end">
                    <Button 
                        size="lg" 
                        className="w-full bg-[#dc2626] hover:bg-[#b91c1c] text-white font-semibold text-base py-6 shadow-md shadow-red-100 hover:shadow-red-200 transition-all"
                        onClick={handleLogSubmit}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? "Sending..." : "Send For Approval"}
                    </Button>
                </div>
            )}
        </div>
    );
};
