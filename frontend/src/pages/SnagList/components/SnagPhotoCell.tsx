import * as React from "react";
import { ExternalLink, Image as ImageIcon, MapPin, Navigation } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import SITEURL from "@/constants/siteURL";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { directionsUrl, locationAddress, parseCoordinates } from "@/utils/snagPhoto";

export interface SnagPhotoCellProps {
  /** `Project Snag.attachment` — the snag's one photo, or null. */
  attachment: string | null;
  location: string | null;
}

const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100";

/**
 * The Attachment column: a "View" chip (image icon + label) when the snag has a photo. Hover it
 * for the photo, and UNDER it where it was taken plus a Location (maps directions) link (owner
 * 2026-10-08); with no location that part is simply left out. Clicking the photo or the chip
 * opens it full size.
 *
 * ON A TOUCH SCREEN the chip is TAPPED to open the same card instead: Radix's HoverCard ignores
 * touch, so a tap would go straight to the full-size photo and the location would be out of reach.
 * "Full size" inside the card still opens the photo.
 *
 * The photo itself is fetched only when the card opens: a page of rows costs no image loads.
 */
export const SnagPhotoCell: React.FC<SnagPhotoCellProps> = ({ attachment, location }) => {
  const canHover = useMediaQuery("(hover: hover)");

  if (!attachment) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }

  const src = `${SITEURL}${attachment}`;
  const chip = (
    <>
      <ImageIcon className="h-3.5 w-3.5" /> View
    </>
  );
  const card = <SnagPhotoCard src={src} location={location} />;

  if (!canHover) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="View snag photo" className={CHIP_CLASS}>
            {chip}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="end" side="bottom">
          {card}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <HoverCard delayDuration={150}>
      <HoverCardTrigger asChild>
        <a href={src} target="_blank" rel="noreferrer" aria-label="View snag photo" className={CHIP_CLASS}>
          {chip}
        </a>
      </HoverCardTrigger>
      <HoverCardContent className="w-72 p-2" align="end" side="left">
        {card}
      </HoverCardContent>
    </HoverCard>
  );
};

/** The photo, where it was taken, and its Location / Full size links. */
const SnagPhotoCard: React.FC<{ src: string; location: string | null }> = ({ src, location }) => {
  const address = locationAddress(location);
  const coords = parseCoordinates(location);
  const directions = directionsUrl(location);

  return (
    <>
      <a href={src} target="_blank" rel="noreferrer" title="Open full size">
        <img src={src} alt="Snag photo" className="h-48 w-full rounded bg-muted object-cover" />
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
    </>
  );
};
