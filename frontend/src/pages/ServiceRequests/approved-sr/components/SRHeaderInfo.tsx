import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { Projects } from '@/types/NirmaanStack/Projects';
import { formatDate } from '@/utils/FormatDate';
import { VendorHoverCard } from '@/components/helpers/vendor-hover-card'; // Assuming this works for Vendors
import { Link } from 'react-router-dom';
import { ServiceRequestsExtended } from '../hooks/useApprovedSRData';
import { Label } from '@/components/ui/label';

interface SRHeaderInfoProps {
    serviceRequest?: ServiceRequestsExtended; // Use the parsed version from useApprovedSRData
    vendor?: Vendors;
    project?: Projects;
}

export const SRHeaderInfo: React.FC<SRHeaderInfoProps> = ({ serviceRequest, vendor, project }) => {
    if (!serviceRequest) {
        return ( // Or a more specific skeleton
            <Card className="animate-pulse">
                <CardHeader><CardTitle><div className="h-6 bg-muted rounded w-3/4"></div></CardTitle></CardHeader>
                <CardContent><div className="h-20 bg-muted rounded w-full"></div></CardContent>
            </Card>
        );
    }

    return (
        <Card className="shadow-sm">
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="text-xl md:text-2xl text-primary mb-1">
                            Service Request: {serviceRequest.name}
                        </CardTitle>
                        <CardDescription>
                            Status: <Badge variant={serviceRequest.status === "Approved" ? "green" : "outline"}>{serviceRequest.status}</Badge>
                        </CardDescription>
                    </div>
                    <div className="text-xs text-muted-foreground text-right">
                        Created: {formatDate(serviceRequest.creation)}<br />
                        Last Modified: {formatDate(serviceRequest.modified)}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                    <Label className="font-semibold text-muted-foreground">Project</Label>
                    {project ? (
                        <Link to={`/projects/${project.name}`} className="block text-primary hover:underline truncate" title={project.project_name}>
                            {project.project_name} ({project.name})
                        </Link>
                    ) : (
                        <p>{serviceRequest.project || "N/A"}</p>
                    )}
                </div>
                <div>
                    <Label className="font-semibold text-muted-foreground">Vendor</Label>
                    {vendor ? (
                        // Assuming VendorHoverCard can take vendor object or just ID
                        <VendorHoverCard vendor_id={vendor.name} />
                    ) : (
                        <p>{serviceRequest.vendor || "N/A"}</p>
                    )}
                </div>
                <div>
                    <Label className="font-semibold text-muted-foreground">Owner</Label>
                    <p className="truncate" title={serviceRequest.owner}>{serviceRequest.owner}</p>
                </div>
                 {/* Add other relevant header fields if needed */}
            </CardContent>
        </Card>
    );
};