import { Sparkles } from "lucide-react";

/** Marks a cheque form field whose value was read off the cheque photo, so the user knows to check it. */
export const FromPhotoTag = () => (
    <span className="ml-2 inline-flex whitespace-nowrap items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-300">
        <Sparkles className="h-3 w-3" aria-hidden />
        From photo
    </span>
);

/** The amber tint on an input that holds a value read off the photo (the receipt-autofill look). */
export const FROM_PHOTO_INPUT = "bg-amber-50 border-amber-300 focus-visible:ring-amber-400";
