import React, { useState, useEffect } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Search, FileText, ArrowUpRight, FileImage, FileCode, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";

type SearchResult = {
    file?: string;
    file_name?: string;
    file_url?: string | null;
    attached_to_doctype?: string | null;
    attached_to_name?: string | null;
    snippet?: string;
};

// Standardizing file icons based on extension
const getFileIcon = (fileUrl?: string | null) => {
    if (!fileUrl) {
        return <FileCode className="w-6 h-6 text-gray-500" />;
    }

    const ext = fileUrl.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'pdf': return <FileText className="w-6 h-6 text-red-500" />;
        case 'png':
        case 'jpg':
        case 'jpeg': return <FileImage className="w-6 h-6 text-blue-500" />;

        default: return <FileCode className="w-6 h-6 text-gray-500" />;
    }
};

const getUIPathForDocType = (doctype: string, docname: string) => {
    // Generate the correct UI route depending on where it's attached
    switch (doctype) {
        case "Procurement Orders": return `/purchase-orders/${docname}`;
        case "Procurement Requests": return `/prs&milestones/procurement-requests/${docname}`;
        case "Delivery Notes": return `/delivery-notes/${docname}`;
        case "Service Requests": return `/service-requests/${docname}`;
        case "Project Invoices": return `/project-invoices`; 
        default: return null;
    }
};

export default function DocumentSearch() {
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");

    // Debounce to prevent massive API spam on every keystroke
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(searchTerm);
        }, 500);
        return () => clearTimeout(handler);
    }, [searchTerm]);

    // Fetch matching file data from our newly created Frappe Python API
    const { data, isLoading } = useFrappeGetCall(
        "nirmaan_stack.services.file_extractor.search_document_text",
        { keyword: debouncedSearch.length >= 3 ? debouncedSearch : "" },
        // Only run call if debounced search is at least 3 chars long
        debouncedSearch.length >= 3 ? `search-files-${debouncedSearch}` : null,
        {
            revalidateOnFocus: false,
        }
    );

    const searchResults: SearchResult[] = data?.message || [];

    return (
        <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Global Document Search</h2>
                    <p className="text-muted-foreground mt-1">
                        Instantly search for any keyword inside uploaded PDFs and Images (OCR).
                    </p>
                </div>
            </div>

            <div className="flex w-full max-w-2xl items-center space-x-2 mt-6">
                <div className="relative w-full">
                    <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                    <Input
                        type="text"
                        placeholder="Search inside file contents (min 3 characters)..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 h-12 text-md shadow-sm border-gray-300 rounded-lg"
                    />
                </div>
            </div>

            <div className="mt-8 space-y-4">
                {isLoading && (
                    <div className="flex items-center space-x-2 text-gray-500 animate-pulse">
                        <Loader2 className="w-5 h-5 animate-spin"/>
                        <span>Searching thousands of documents...</span>
                    </div>
                )}

                {debouncedSearch.length >= 3 && !isLoading && searchResults.length === 0 && (
                    <div className="text-gray-500 py-8 text-center bg-gray-50 rounded-lg border border-dashed">
                        No text matches found for <span className="font-semibold">"{debouncedSearch}"</span> in any indexed files.
                    </div>
                )}

                {!isLoading && searchResults.length > 0 && (
                    <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
                        {searchResults.map((result: SearchResult, index: number) => {
                            const contextPath = (
                                result.attached_to_doctype && result.attached_to_name
                                    ? getUIPathForDocType(result.attached_to_doctype, result.attached_to_name)
                                    : null
                            );
                            const snippet = result.snippet || "Match found.";
                            const hasFileUrl = Boolean(result.file_url);

                            return (
                            <Card key={`${result.file || "result"}-${index}`} className="hover:shadow-md transition-shadow">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <div className="flex items-center space-x-3">
                                        {getFileIcon(result.file_url)}
                                        <div>
                                            <CardTitle className="text-sm font-medium line-clamp-1">
                                                {result.file_name || "Untitled File"}
                                            </CardTitle>
                                            <CardDescription className="text-xs mt-1">
                                                Attached to <Badge variant="secondary" className="font-mono text-[10px]">{result.attached_to_doctype}</Badge>
                                            </CardDescription>
                                        </div>
                                    </div>
                                    
                                    {/* Action button linking to file or parent record */}
                                    {contextPath ? (
                                        <Link 
                                            to={contextPath}
                                            className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center bg-blue-50 px-2 py-1 rounded-md"
                                        >
                                            View Context <ArrowUpRight className="ml-1 w-3 h-3"/>
                                        </Link>
                                    ) : hasFileUrl ? (
                                        <a
                                            href={result.file_url || undefined}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center bg-blue-50 px-2 py-1 rounded-md"
                                        >
                                            Open File <ArrowUpRight className="ml-1 w-3 h-3"/>
                                        </a>
                                    ) : null}
                                </CardHeader>
                                <CardContent>
                                    <div className="mt-2 p-3 bg-gray-50/80 rounded-md text-sm text-gray-700 font-serif leading-relaxed border border-gray-100">
                                        {/* Highlight the matched keyword visually in the snippet */}
                                        {snippet.split(new RegExp(`(${debouncedSearch})`, 'gi')).map((part: string, i: number) => 
                                            part.toLowerCase() === debouncedSearch.toLowerCase() ? 
                                                <mark key={i} className="bg-yellow-200 text-yellow-900 px-1 rounded font-medium">{part}</mark> 
                                                : part
                                        )}
                                    </div>
                                    {hasFileUrl && (
                                        <div className="mt-3 flex justify-end">
                                        <a 
                                            href={result.file_url || undefined} 
                                            download={result.file_name} 
                                            target="_blank" 
                                            rel="noreferrer" 
                                            className="text-xs text-gray-500 hover:underline inline-flex items-center"
                                        >
                                            Download Original File
                                        </a>
                                        </div>
                                    )}

                                </CardContent>
                            </Card>
                        )})}
                    </div>
                )}
            </div>
        </div>
    );
}
