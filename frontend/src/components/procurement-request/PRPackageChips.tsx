import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { uniqueTagPackages } from "@/utils/prPackages";

/**
 * A PR's procurement packages (`pr_tag_list`) as chips, each once and sorted -- rows written before
 * 2026-10 can repeat a package (one per old header). The one renderer for every PR table's
 * Packages column.
 */
export const PRPackageChips: React.FC<{
    tags?: readonly { tag_package?: string | null }[] | null;
    /** Extra classes for the chip container (e.g. `justify-center` in a centred cell). */
    className?: string;
    /** Shown instead of "--" when the PR has no package. */
    empty?: React.ReactNode;
}> = ({ tags, className, empty }) => {
    const packages = uniqueTagPackages(tags);
    return (
        <div className={cn("flex flex-wrap gap-1 items-start justify-start", className)}>
            {packages.length > 0
                ? packages.map((pkg) => (
                    <Badge key={pkg} variant="outline" className="bg-white">
                        {pkg}
                    </Badge>
                ))
                : empty ?? <div className="font-medium text-gray-500 text-xs">--</div>}
        </div>
    );
};
