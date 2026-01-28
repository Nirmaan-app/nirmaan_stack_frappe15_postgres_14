import React from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button"; // Import Button
import { NirmaanAttachment } from '@/types/NirmaanStack/NirmaanAttachment'; // Adjust import path
import SITEURL from '@/constants/siteURL'; // Adjust import path
import { formatDate } from 'date-fns';
import { Eye } from 'lucide-react'; // Use Eye icon for view

interface DeliveryChallanTableProps {
    attachments: NirmaanAttachment[];
}

export const DeliveryChallanTable: React.FC<DeliveryChallanTableProps> = ({ attachments }) => {

    // Helper to safely extract filename
    const getFileName = (url: string | undefined): string => {
        if (!url) return 'N/A';
        try {
            // Try URL parsing first
            const urlObj = new URL(url, SITEURL); // Provide base URL for relative paths
            const pathSegments = urlObj.pathname.split('/');
            const potentialFilename = pathSegments[pathSegments.length - 1];
             // Basic check if it looks like a file
             if(potentialFilename.includes('.')) return decodeURIComponent(potentialFilename);
        } catch (e) {
            // Fallback for simple string splitting if URL parsing fails
             const parts = url.split('/');
             if (parts.length > 0) return decodeURIComponent(parts[parts.length - 1]);
        }
        return 'View File'; // Default fallback
    };

    // Helper to convert attachment_type to camel case
    const toCamelCase = (str: string | undefined): string => {
        if (!str) return 'N/A';
        return str
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    };


    return (
        <Table>
            <TableHeader className="bg-red-100">
                <TableRow>
                    <TableHead className="w-[80px] text-black font-bold">S.No.</TableHead>
                    <TableHead className="text-black font-bold">Type</TableHead>
                    <TableHead className="text-black font-bold">Ref No.</TableHead>
                    <TableHead className="w-[150px] text-black font-bold">Date Added</TableHead>
                    <TableHead className="w-[120px] text-center text-black font-bold">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {attachments.length > 0 ? (
                    attachments.map((att, index) => (
                        <TableRow key={att.name}>
                            <TableCell className="text-center">{index + 1}</TableCell>
                            <TableCell className="font-medium">{toCamelCase(att.attachment_type)}</TableCell>
                            <TableCell>{att.attachment_ref || "-"}</TableCell>
                            <TableCell>{formatDate(new Date(att.creation), "dd-MMM-yyyy")}</TableCell>
                            <TableCell className="text-center">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-blue-600 hover:text-blue-800"
                                    asChild
                                    title={`View ${toCamelCase(att.attachment_type)}`}
                                >
                                    <a href={`${SITEURL}${att.attachment}`} target="_blank" rel="noreferrer noopener">
                                        <Eye className="h-4 w-4 mr-1" />
                                        View
                                    </a>
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))
                ) : (
                    <TableRow>
                        <TableCell colSpan={5} className="text-center py-4 text-gray-500">
                            No Delivery Challans or MIRs Found
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );
};