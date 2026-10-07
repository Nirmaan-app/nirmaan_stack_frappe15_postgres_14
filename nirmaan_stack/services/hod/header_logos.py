# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which stakeholder logos head a project's handover documents. PURE.

Six roles are OFFERED -- the six a project's `Project TDS Setting` already holds. A role can only be
PICKED when that setting carries BOTH a name and a logo for it: a logo with no name has nothing to
caption it, a name with no logo has nothing to print.

The `enable_*` flags on the TDS Setting are deliberately NOT consulted. They belong to the TDS report,
and on this site they say things that are not true of the logos -- every project has
`enable_mep_contractor` switched on while no project has uploaded a Nirmaan logo. Name-and-logo-present
is the honest test, and it is the one the user sees in the picker.

The two LETTERHEAD documents print the company letterhead instead and never show this strip.
"""

from nirmaan_stack.services.hod import index

# role key -> (label, name field, logo field) on `Project TDS Setting`.
# THREE of those field names are misspelled in that doctype -- `mananger_logo`, `data_tjxu` for the
# consultant, `mep_contractorlogo`. They are load-bearing; copy them, do not correct them.
ROLES = {
	"client": ("Client", "client_name", "client_logo"),
	"manager": ("Project Manager", "manager_name", "mananger_logo"),
	"architect": ("Architect", "architect_name", "architect_logo"),
	"consultant": ("Consultant", "data_tjxu", "consultant_logo"),
	"gc_contractor": ("GC Contractor", "gc_contractor_name", "gc_contractor_logo"),
	"mep_contractor": ("MEP Contractor", "mep_contractor_name", "mep_contractorlogo"),
}

# The order a header PRINTS in, whatever order the roles were ticked -- so every project's documents
# look the same. Nirmaan first, then the other side of the table, then the consultants.
ROLE_ORDER = ("mep_contractor", "gc_contractor", "client", "manager", "architect", "consultant")

# These two carry the company letterhead instead of the logo strip (owner 2026-09-24).
LETTERHEAD_DOCUMENTS = ("completion_certificate", "equipment_warranty")

# Nirmaan's own logo, used whenever a project has not uploaded one for the MEP row (owner 2026-09-25) --
# it is the same mark on every job, so it should never wait on an upload.
#
# This is the SAME url the "Project TDS Report" print format already falls back to
# (`company_details.logo_url`, `mep_logo or company_details.logo_url`), reused rather than copied so
# both documents show one mark. That format lives in the DATABASE, so the two cannot share a constant --
# if this ever moves, search the print format for `logo_url` as well.
#
# WARNING: the filename carries a VITE BUILD HASH. A frontend rebuild emits a new hash and this url
# 404s; the TDS report hides the broken image with `onerror` and simply loses the logo, which is how it
# would go unnoticed. Worth replacing with a stable path on both sides.
BUNDLED_LOGO = "https://stack.nirmaan.app/assets/nirmaan_stack/frontend/assets/logo-svg-BptBZTzQ.svg"
BUNDLED_ROLE = "mep_contractor"
BUNDLED_NAME = "Nirmaan"

# What a blank pick means: Nirmaan alone (owner 2026-09-25). A fresh project therefore prints the one
# logo that is always right, and the team adds the client / GC deliberately rather than by default.
DEFAULT_ROLES = (BUNDLED_ROLE,)


def _text(value) -> str:
	return str(value or "").strip()


def parse_roles(text) -> list:
	"""The stored value -> the role keys it names, in PRINT order, without duplicates or unknowns."""
	named = {line.strip() for line in str(text or "").splitlines() if line.strip()}
	return [role for role in ROLE_ORDER if role in named]


def valid_roles(roles) -> list:
	"""A caller's list -> the known role keys in it, in print order. Anything else is dropped."""
	named = {_text(r) for r in (roles or [])}
	return [role for role in ROLE_ORDER if role in named]


def logo_of(setting, role) -> str:
	"""The logo to print for a role: the project's own, else Nirmaan's bundled one for the MEP row."""
	own = _text((setting or {}).get(ROLES[role][2]))
	if own:
		return own
	return BUNDLED_LOGO if role == BUNDLED_ROLE else ""


def name_of(setting, role) -> str:
	"""The caption: the project's own, else "Nirmaan" for the MEP row (it is always us)."""
	own = _text((setting or {}).get(ROLES[role][1]))
	if own:
		return own
	return BUNDLED_NAME if role == BUNDLED_ROLE else ""


def selectable(setting) -> list:
	"""The roles this project MAY pick: both a name and a logo.

	`setting` is the `Project TDS Setting` record as a dict -- None / {} when the project has none.
	MEP (Nirmaan) is ALWAYS selectable: its name and logo ship with the app, so it does not depend on
	anyone uploading anything (owner 2026-09-25)."""
	return [
		role for role in ROLE_ORDER if _text(name_of(setting, role)) and _text(logo_of(setting, role))
	]


def header_logos(setting, stored) -> list:
	"""What actually prints: `[{"role", "label", "name", "logo"}, ...]` in ROLE_ORDER.

	The picked roles, narrowed to the ones still selectable -- a logo removed from the TDS Setting
	after it was picked simply stops printing rather than leaving a gap. NOTHING PICKED falls back to
	DEFAULT_ROLES, i.e. Nirmaan alone (owner 2026-09-25), so a project's documents are headed correctly
	before anyone configures this -- which is also why no backfill is needed for the projects that
	predate the setting.
	"""
	usable = selectable(setting)
	picked = [role for role in parse_roles(stored) if role in usable]
	if not picked:
		picked = [role for role in DEFAULT_ROLES if role in usable]
	return [
		{
			"role": role,
			"label": ROLES[role][0],
			"name": name_of(setting, role),
			"logo": logo_of(setting, role),
		}
		for role in picked
	]


# The order the stakeholder logo PAGE lays its cards out in, two to a row (owner 2026-10-06, the TDS
# export's own page): the client side first, Nirmaan last.
CARD_ORDER = ("client", "manager", "consultant", "architect", "gc_contractor", "mep_contractor")


def stakeholder_cards(setting, stored) -> list:
	"""The cards of the stakeholder logo page that follows the cover: `[{"role", "label", "name", "logo"}]`.

	The logos PICKED for the project's header (owner 2026-10-06: "the logo page is got from the header
	logos we added") -- `header_logos`, so nothing picked means Nirmaan alone, exactly as the header --
	laid out in CARD_ORDER rather than the header's print order."""
	picked = {item["role"]: item for item in header_logos(setting, stored)}
	return [picked[role] for role in CARD_ORDER if role in picked]


def uses_letterhead(document) -> bool:
	"""Does this document print the company letterhead instead of the logo strip?"""
	return _text(document) in LETTERHEAD_DOCUMENTS


def letterhead_documents_are_real() -> bool:
	"""The letterhead list must name real documents -- a typo there would silently give a document the
	logo strip instead, which is the sort of thing nobody notices until a client has the PDF."""
	return all(index.is_valid(key) for key in LETTERHEAD_DOCUMENTS)
