import * as React from "react";
import { ExternalLink, Image as ImageIcon, MapPin, Navigation } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import SITEURL from "@/constants/siteURL";
import { directionsUrl, locationAddress, parseCoordinates } from "@/utils/snagPhoto";

export interface SnagPhotoCellProps {
  /** `Project Snag.attachment` — the snag's one photo, or null. */
  attachment: string | null;
  location: string | null;
}

/**
 * The Attachment column: a "View" chip (image icon + label) when the snag has a photo. Hover it
 * (long-press on a touch screen) for the photo, and UNDER it where it was taken plus a Location
 * (maps directions) link (owner 2026-10-08); with no location that part is simply left out.
 * Clicking the photo or the chip opens it full size.
 *
 * The photo itself is fetched only when the card opens: a page of rows costs no image loads.
 */
export const SnagPhotoCell: React.FC<SnagPhotoCellProps> = ({ attachment, location }) => {
  if (!attachment) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }

  const src = `${SITEURL}${attachment}`;
  const address = locationAddress(location);
  const coords = parseCoordinates(location);
  const directions = directionsUrl(location);

  return (
    <HoverCard delayDuration={150}>
      <HoverCardTrigger asChild>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          aria-label="View snag photo"
          className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100"
        >
          <ImageIcon className="h-3.5 w-3.5" /> View
        </a>
      </HoverCardTrigger>
      <HoverCardContent className="w-72 p-2" align="end" side="left">
        <a href={src} target="_blank" rel="noreferrer" title="Open full size">
          <img
            src={src}
            alt="Snag photo"
            className="h-48 w-full rounded bg-muted object-cover"
          />
        </a>
        <div className="mt-2 space-y-1.5 px-1 text-xs">
          {location && (
            <>
              <p className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                <span className="break-words">{address || "Location"}</span>
              </p>
              {coords && (
                <p className="pl-5 text-[11px] tabular-nums text-muted-foreground">
                  {coords.lat.toFixed(4)}, {coords.lon.toFixed(4)}
                </p>
              )}
            </>
          )}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            {directions ? (
              <a
                href={directions}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline"
              >
                <Navigation className="h-3.5 w-3.5" /> Location
              </a>
            ) : (
              <span />
            )}
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              Full size <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
