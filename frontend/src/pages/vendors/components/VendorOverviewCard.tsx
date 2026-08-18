import React, { useMemo, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDownIcon, ChevronRightIcon, CheckCircleIcon } from "lucide-react";
import { Vendors } from '@/types/NirmaanStack/Vendors'; // Adjust path
import { Address } from '@/types/NirmaanStack/Address';   // Adjust path
import { Category } from '@/types/NirmaanStack/Category'; // Assuming you fetch this for names
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface VendorOverviewCardProps {
    vendor?: Vendors;
    vendorAddress?: Address;
    allCategories?: Category[]; // Pass the full list of categories
}

type ExpandedPackagesState = Record<string, boolean>;

export const VendorOverviewCard: React.FC<VendorOverviewCardProps> = ({
    vendor,
    vendorAddress,
    allCategories,
}) => {
    const [expandedPackages, setExpandedPackages] = useState<ExpandedPackagesState>({});

    const toggleExpand = useCallback((packageName: string) => {
        setExpandedPackages((prev) => ({ ...prev, [packageName]: !prev[packageName] }));
    }, []);

    const vendorCategoriesFromDoc = useMemo(() =>
        (vendor?.vendor_category && typeof vendor.vendor_category === 'string'
            ? JSON.parse(vendor.vendor_category)?.categories
            : vendor?.vendor_category?.categories) || [],
    [vendor?.vendor_category]);

    const groupedCategories = useMemo(() => {
        if (!allCategories || !vendorCategoriesFromDoc.length) return {};
        const filteredCategories = allCategories.filter((category) =>
            vendorCategoriesFromDoc.includes(category.name)
        );
        const grouped = filteredCategories.reduce((acc, category) => {
            const workPackageName = category.work_package || "Uncategorized"; // Fallback
            if (!acc[workPackageName]) acc[workPackageName] = [];
            acc[workPackageName].push(category.name);
            return acc;
        }, {} as Record<string, string[]>);
        // Initialize expanded state
        const initialExpanded: ExpandedPackagesState = {};
        Object.keys(grouped).forEach(wp => initialExpanded[wp] = true);
        setExpandedPackages(initialExpanded);
        return grouped;
    }, [allCategories, vendorCategoriesFromDoc]);


    if (!vendor) {
        return <Card><CardContent>Vendor data not available.</CardContent></Card>;
    }

    return (
        <>
             <Card>
               <CardHeader>
                 <CardTitle className="text-primary">Vendor Details</CardTitle>
               </CardHeader>
               <CardContent className="flex flex-col gap-10 w-full">
                 {/* ONE grid, not two side-by-side stacks. Real grid rows are what
                     put each right-hand value on the card's RIGHT EDGE and keep it
                     level with its left-hand pair; a nested grid inside the left
                     stack only spans that stack's content width, which is why the
                     pairs sat hugging the left. Two independent `space-y` stacks
                     also only lined up by luck -- a wrapping Address shifted every
                     row below it out of alignment. */}
                 <div className="grid lg:grid-cols-2 gap-x-10 gap-y-6 max-sm:gap-y-4">
                    <InfoItem label="Vendor ID" value={vendor?.name} />
                    <InfoItem label="Address" value={`${vendorAddress?.address_line1}, ${vendorAddress?.address_line2}, ${vendorAddress?.city}, ${vendorAddress?.state}`} className="lg:text-end" />

                    <InfoItem label="Nickname" value={vendor?.vendor_nickname} />
                    <InfoItem label="City" value={vendorAddress?.city} className="lg:text-end" />

                    <InfoItem label="Contact Person" value={vendor?.vendor_contact_person_name} />
                    <InfoItem label="State" value={vendorAddress?.state} className="lg:text-end" />

                    <InfoItem label="Contact Number" value={vendor?.vendor_mobile} />
                    {/* Optional -- the "--" keeps this cell occupied so the row
                        cannot collapse and unpair the column. */}
                    <InfoItem label="Alternate Contact Number" value={vendor?.vendor_alt_mobile || "--"} className="lg:text-end" />

                    <InfoItem label="GST Number" value={vendor?.vendor_gst} />
                    <InfoItem label="Pincode" value={vendorAddress?.pincode} className="lg:text-end" />
                </div>
              </CardContent>
            </Card>
   

            <Card className="md:col-span-2">
              <CardHeader><CardTitle className="text-primary">Packages-Categories Offered</CardTitle></CardHeader>
              <CardContent>
                {Object.keys(groupedCategories).length > 0 ? (
                    <ul className="space-y-2">
                        {Object.entries(groupedCategories).map(([workPackage, categoryList]) => (
                            <li key={workPackage} className="border p-2 rounded-md bg-muted/30">
                                <div
                                    className="flex items-center justify-between cursor-pointer hover:bg-muted/60 p-1 rounded"
                                    onClick={() => toggleExpand(workPackage)}
                                >
                                    <div className="flex items-center gap-2">
                                        {expandedPackages[workPackage] ? <ChevronDownIcon className="h-5 w-5" /> : <ChevronRightIcon className="h-5 w-5" />}
                                        <span className="font-medium">{workPackage}</span>
                                    </div>
                                    <Badge variant="secondary">{categoryList.length} Categories</Badge>
                                </div>
                                {expandedPackages[workPackage] && (
                                    <ul className="pl-6 mt-1 space-y-1 pt-1 border-t border-border">
                                        {categoryList.map((catName) => (
                                            <li key={catName} className="text-sm text-muted-foreground flex items-center gap-1.5">
                                               <CheckCircleIcon className="h-4 w-4 text-green-500" /> {catName}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : <p className="text-muted-foreground">No specific categories assigned.</p>}
              </CardContent>
            </Card>
        </>
    );
};

const InfoItem: React.FC<{ label: string; value?: string | number | null; className?: string }> = ({ label, value, className }) => (
    <CardDescription className={cn("space-y-1", className)}>
        <p className="text-sm font-medium text-primary">{label}</p>
        <span className="text-sm text-foreground">{value || "N/A"}</span>
    </CardDescription>
);


export default VendorOverviewCard;