/**
 * A toast's list of items on one line: the first `max` joined by " · ", then "+N more" for the rest,
 * e.g. "PO/001: Vendor has no bank account. · PO/002: It is on hold. · +3 more". A toast has room for
 * a few; the count says the list is longer than it shows.
 */
export const toastList = (items: readonly string[], max = 3): string =>
    (items.length > max ? [...items.slice(0, max), `+${items.length - max} more`] : items).join(" · ");
