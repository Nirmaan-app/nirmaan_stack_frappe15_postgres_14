# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bill links on a Cashbook Statement: when they stop working (#1590, ADR-0015 Amendment B).

PURE MODULE -- no `frappe`, no clock. `now` is always handed in, so a test can set it.

A *bill link* (GLOSSARY) is a signed storage URL whose query string says when it stops working, in one of
two shapes. The provider signs Google Cloud Storage V2 links: `Expires` is the Unix second (UTC) the link
dies (every link in the measured sample: 2026-11-07 11:12 UTC). A V4 link is read too: the moment it
was signed (`X-Goog-Date`, `YYYYMMDDTHHMMSSZ`, UTC) plus its lifetime in seconds (`X-Goog-Expires`). The upload
refuses a statement whose earliest link has expired or expires within `LINK_EXPIRY_MARGIN` (decision 2),
because the import job must still be able to fetch every bill.

⚠️ A LINK WHOSE QUERY STRING STATES NEITHER IS REFUSED (spec #1585 code review S4), with
`LINKS_UNREADABLE_MESSAGE`. Nothing can be said about when it dies, so the import cannot promise to fetch
its bill; the provider signs every link it exports. The parser refuses with the same sentence a statement
whose "View Attachment" cells carry no hyperlink at all (`parser._LinksUnder`).
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta, timezone, tzinfo
from urllib.parse import parse_qs, urlsplit

__all__ = [
    "LINK_EXPIRY_MARGIN",
    "LINKS_EXPIRED_MESSAGE",
    "LINKS_UNREADABLE_MESSAGE",
    "link_expires_at",
    "earliest_link_expiry",
    "expired_links_refusal",
]

#: A statement must have at least this long left on its earliest link to be accepted.
LINK_EXPIRY_MARGIN = timedelta(hours=1)

LINKS_EXPIRED_MESSAGE = "Links expired on {date}. Export the statement again."

#: A statement whose bill links were lost (re-saved, copied out as values) or carry no signing date and lifetime.
#: Neither the old-export sentence (the file has the `Attachments` column) nor the expiry one (there is no date to
#: name) would be true of it; what is true is that its links cannot be read, and a fresh export fixes it.
LINKS_UNREADABLE_MESSAGE = "This file's bill links can't be read. Export the statement again and upload it as downloaded."

#: V2 (the provider's exports): the Unix second the link dies.
_V2_EXPIRES = "Expires"
#: V4: the signing moment and the lifetime in seconds.
_V4_SIGNED_AT = "X-Goog-Date"
_V4_LIFETIME = "X-Goog-Expires"


def link_expires_at(url: str) -> datetime | None:
    """When this link stops working (UTC), or `None` when its query string does not say (either shape above)."""
    query = parse_qs(urlsplit(url or "").query)
    try:
        if _V2_EXPIRES in query:
            return datetime.fromtimestamp(int(query[_V2_EXPIRES][0]), tz=timezone.utc)
        signed_at = datetime.strptime(query.get(_V4_SIGNED_AT, [""])[0], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        return signed_at + timedelta(seconds=int(query.get(_V4_LIFETIME, [""])[0]))
    except (ValueError, OverflowError, OSError):
        return None


def earliest_link_expiry(rows: Iterable) -> datetime | None:
    """The first moment any bill link of these statement lines stops working, or `None`."""
    expiries = [
        expiry
        for row in rows
        for link in row.bill_links
        if (expiry := link_expires_at(link)) is not None
    ]
    return min(expiries) if expiries else None


def expired_links_refusal(
    rows: Iterable, now: datetime, tz: tzinfo = timezone.utc
) -> str | None:
    """The refusal sentence for a statement whose links are dead or about to die, or whose links do not say when
    they die (`LINKS_UNREADABLE_MESSAGE`), else `None`.

    `now` is timezone-aware. `tz` is the zone the date is named in (the site's own, from the caller).
    """
    rows = list(rows)
    if any(link_expires_at(link) is None for row in rows for link in row.bill_links):
        return LINKS_UNREADABLE_MESSAGE
    earliest = earliest_link_expiry(rows)
    if earliest is None or earliest - now >= LINK_EXPIRY_MARGIN:
        return None
    return LINKS_EXPIRED_MESSAGE.format(date=_expiry_as_text(earliest, tz))


def expired_link_reason(url: str, now: datetime, tz: tzinfo = timezone.utc) -> str | None:
    """Why one bill link must not be requested any more: it expired at or before `now` (code review R2), as the
    clause a `bill_problem` carries, else `None`. A link that does not say when it dies is tried."""
    expires = link_expires_at(url)
    if expires is None or expires > now:
        return None
    return f"its link expired on {_expiry_as_text(expires, tz)}"


def _expiry_as_text(moment: datetime, tz: tzinfo) -> str:
    """A link's expiry as a person reads it, in the site's zone."""
    return moment.astimezone(tz).strftime("%d-%b-%Y %H:%M")
