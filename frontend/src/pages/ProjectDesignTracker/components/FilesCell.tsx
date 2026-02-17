import React from 'react';
import { Link as LinkIcon, ShieldCheck } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import SITEURL from '@/constants/siteURL';

interface FilesCellProps {
    file_link?: string;
    approval_proof?: string;
    size?: 'sm' | 'md';
}

export const FilesCell: React.FC<FilesCellProps> = ({ file_link, approval_proof, size = 'sm' }) => {
    const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
    const containerPadding = size === 'sm' ? 'p-0.5' : 'p-1';

    const truncateUrl = (url: string, max: number = 40) =>
        url.length > max ? url.substring(0, max) + '...' : url;

    return (
        <div className="flex items-center justify-center gap-1.5">
            {/* Design file link */}
            <TooltipProvider>
                <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                        {file_link ? (
                            <a
                                href={file_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:scale-110 transition-transform"
                            >
                                <LinkIcon
                                    className={`${iconSize} ${containerPadding} bg-gray-100 rounded cursor-pointer text-blue-500`}
                                />
                            </a>
                        ) : (
                            <span>
                                <LinkIcon
                                    className={`${iconSize} ${containerPadding} bg-gray-100 rounded text-gray-300 cursor-default`}
                                />
                            </span>
                        )}
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs p-2 bg-gray-900 text-white shadow-lg">
                        <span className="text-xs">
                            {file_link ? truncateUrl(file_link) : 'No design file'}
                        </span>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            {/* Approval proof */}
            <TooltipProvider>
                <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                        {approval_proof ? (
                            <a
                                href={SITEURL + approval_proof}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:scale-110 transition-transform"
                            >
                                <ShieldCheck
                                    className={`${iconSize} ${containerPadding} bg-gray-100 rounded cursor-pointer text-green-600`}
                                />
                            </a>
                        ) : (
                            <span>
                                <ShieldCheck
                                    className={`${iconSize} ${containerPadding} bg-gray-100 rounded text-gray-300 cursor-default`}
                                />
                            </span>
                        )}
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs p-2 bg-gray-900 text-white shadow-lg">
                        <span className="text-xs">
                            {approval_proof ? 'Approval proof (click to view)' : 'No approval proof'}
                        </span>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
    );
};
