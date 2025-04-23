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
import { LinkIcon } from 'lucide-react'; // Use a link icon

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


    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead className="w-[60px] text-gray-700 font-semibold">S.No.</TableHead>
                    <TableHead className="text-gray-700 font-semibold">Date Added</TableHead>
                    <TableHead className="text-gray-700 font-semibold">Delivery Challan</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {attachments.length > 0 ? (
                    attachments.map((att, index) => (
                        <TableRow key={att.name}>
                            <TableCell>{index + 1}</TableCell>
                            <TableCell>{formatDate(new Date(att.creation), "dd-MMM-yyyy")}</TableCell> {/* Use consistent date format */}
                            <TableCell>
                                <Button
                                    variant="link"
                                    className="p-0 h-auto text-blue-600 hover:underline" // Allow more width
                                    asChild // Use asChild to make the whole button the link
                                    title={`View Delivery Challan added on ${formatDate(new Date(att.creation), "dd-MMM-yyyy")}`}
                                >
                                    <a href={`${SITEURL}${att.attachment}`} target="_blank" rel="noreferrer noopener">
                                        <LinkIcon className="h-4 w-4 mr-1 inline-block" />
                                        <p className='truncate max-w-[150px]'>{getFileName(att.attachment)}</p>
                                    </a>
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))
                ) : (
                    <TableRow>
                        <TableCell colSpan={3} className="text-center py-4 text-gray-500">
                            No Delivery Challans Found
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );
};