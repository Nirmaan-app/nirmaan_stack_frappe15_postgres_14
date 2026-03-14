import React from 'react';
import { Link as LinkIcon, ShieldCheck } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import SITEURL from '@/constants/siteURL';

interface FilesCellProps {
    file_link?: string;
    approval_proof?: string;
    task_status?: string;
    size?: 'sm' | 'md';
}

export const FilesCell: React.FC<FilesCellProps> = ({ file_link, approval_proof, task_status, size = 'sm' }) => {
    const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
    const containerPadding = size === 'sm' ? 'p-0.5' : 'p-1';

    const truncateUrl = (url: string, max: number = 40) =>
        url.length > max ? url.substring(0, max) + '...' : url;

    // Show exactly one source in table:
    // 1) Uploaded attachment (approval_proof) has priority
    // 2) Otherwise show external link
    const isCompleted = task_status === 'Completed';
    const activeFile = isCompleted
        ? (approval_proof
            ? {
                href: approval_proof.startsWith('http') ? approval_proof : SITEURL + approval_proof,
                label: 'Report attachment (click to view)',
                icon: 'attachment' as const,
            }
            : file_link
                ? {
                    href: file_link,
                    label: truncateUrl(file_link),
                    icon: 'link' as const,
                }
                : null)
        : null;

    return (
        <div className="flex items-center justify-center">
            <TooltipProvider>
                <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                        {activeFile ? (
                            <a
                                href={activeFile.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:scale-110 transition-transform"
                            >
                                {activeFile.icon === 'attachment' ? (
                                    <ShieldCheck
                                        className={`${iconSize} ${containerPadding} bg-gray-100 rounded cursor-pointer text-green-600`}
                                    />
                                ) : (
                                    <LinkIcon
                                        className={`${iconSize} ${containerPadding} bg-gray-100 rounded cursor-pointer text-blue-500`}
                                    />
                                )}
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
                            {activeFile ? activeFile.label : 'No report file'}
                        </span>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
    );
};
