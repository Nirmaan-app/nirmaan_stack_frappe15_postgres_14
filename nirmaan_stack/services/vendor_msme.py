# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A vendor's MSME (Udyam) details (owner, 2026-11-19).

`Vendors.msme_id` is the Udyam Registration Number, `UDYAM-<state>-<district>-<7 digits>`, e.g.
`UDYAM-UP-28-0012345`. Document AI reads it off the certificate (`api/vendor/msme_autofill.py`)
and the user may correct it. Pure rules, mirrored in `frontend/src/pages/vendors/utils/msme.ts`:
change both together.
"""

import re

UDYAM_PATTERN = re.compile(r"^UDYAM-[A-Z]{2}-\d{2}-\d{7}$")
UDYAM_EXAMPLE = "UDYAM-UP-28-0012345"

# Dash look-alikes a certificate scan or a paste can carry.
_DASHES = re.compile("[‐-―−]")

# Words that say nothing about WHICH enterprise a name is (compared without them).
_NAME_STOPWORDS = {
	"m", "s", "ms", "the", "and", "pvt", "private", "ltd", "limited", "llp", "co", "company",
	"enterprise", "enterprises", "india", "industries", "traders", "trading",
}


def normalize_udyam(value) -> str:
	"""Upper case, no spaces, plain dashes: `udyam - up-28 – 0012345` -> `UDYAM-UP-28-0012345`."""
	if not value:
		return ""
	return re.sub(r"\s+", "", _DASHES.sub("-", str(value))).upper()


def is_valid_udyam(value) -> bool:
	return bool(UDYAM_PATTERN.match(value or ""))


def _name_tokens(value) -> set[str]:
	words = re.findall(r"[a-z0-9]+", (value or "").lower())
	return {w for w in words if w not in _NAME_STOPWORDS and len(w) > 1}


def names_match(vendor_name, certificate_name) -> bool | None:
	"""Does the certificate's enterprise name look like the vendor's? None when either is missing.

	Lenient on purpose (a warning, never a block): one shared distinctive word is enough, so
	"S. V. Metals & Extrusions Pvt. Ltd." matches "SV METALS AND EXTRUSIONS PRIVATE LIMITED".
	"""
	a, b = _name_tokens(vendor_name), _name_tokens(certificate_name)
	if not a or not b:
		# Every word was generic or missing: compare the joined letters instead.
		left = re.sub(r"[^a-z0-9]", "", (vendor_name or "").lower())
		right = re.sub(r"[^a-z0-9]", "", (certificate_name or "").lower())
		return (left in right or right in left) if left and right else None
	return bool(a & b)
