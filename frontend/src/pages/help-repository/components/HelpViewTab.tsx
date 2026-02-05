import React from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoIcon } from "lucide-react";
import { HelpRepository } from "@/types/NirmaanStack/HelpRepository";
import { getLoomEmbedUrl } from "../utils/loom-embed";

export const HelpViewTab: React.FC = () => {
    const { data, isLoading } = useFrappeGetDocList<HelpRepository>("Help Repository", {
        fields: ["name", "title", "description", "video_link", "creation"],
        orderBy: { field: "creation", order: "desc" },
        limit: 100,
    });

    // Loading skeleton state
    if (isLoading) {
        return (
            <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="border rounded-lg p-4">
                        <Skeleton className="h-5 w-3/4 mb-2" />
                        <Skeleton className="h-3 w-1/2" />
                    </div>
                ))}
            </div>
        );
    }

    // Empty state
    if (!data || data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <VideoIcon className="h-12 w-12 mb-3 stroke-[1.5]" />
                <p className="text-sm font-medium">No help articles available yet</p>
            </div>
        );
    }

    return (
        <Accordion type="single" collapsible className="space-y-2">
            {data.map((item) => (
                <AccordionItem
                    key={item.name}
                    value={item.name}
                    className="border rounded-lg px-4 data-[state=open]:bg-gray-50/50"
                >
                    <AccordionTrigger className="hover:no-underline py-3">
                        <div className="flex items-center gap-3 text-left">
                            <VideoIcon className="h-4 w-4 text-red-500 shrink-0" />
                            <span className="font-medium text-sm">{item.title}</span>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-1 pb-4">
                        {item.description && (
                            <p className="text-xs text-gray-500 mb-3">{item.description}</p>
                        )}
                        <div className="aspect-video rounded-lg overflow-hidden bg-black/5">
                            <iframe
                                src={getLoomEmbedUrl(item.video_link)}
                                className="w-full h-full border-0"
                                allowFullScreen
                                allow="autoplay; fullscreen"
                            />
                        </div>
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    );
};
