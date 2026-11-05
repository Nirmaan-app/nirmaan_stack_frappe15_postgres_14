"""Read-only check, run on production after the login and role hotfix is deployed:

    bench --site <site> execute nirmaan_stack.services.login_check.run

It prints (a) people whose role profile copy on Nirmaan Users differs from the one on their login, and (b)
people with no Nirmaan Users record whose login is not fully switched off. Both lists should be empty. It
writes nothing.
"""

import frappe

from nirmaan_stack.services.exited_employees import SYSTEM_USERS, logins_still_on


def role_copy_drift() -> list[frappe._dict]:
	"""Nirmaan users whose `Nirmaan Users.role_profile` differs from `User.role_profile_name`. Administrator's
	copy is written at install and its User holds no profile, so it is left out."""
	return frappe.db.sql(
		"""
		SELECT nu.name, nu.role_profile AS copy_on_nirmaan_users, u.role_profile_name AS on_user
		FROM "tabNirmaan Users" nu
		JOIN "tabUser" u ON LOWER(u.name) = LOWER(nu.name)
		WHERE nu.name NOT IN %(system)s
			AND COALESCE(nu.role_profile, '') <> COALESCE(u.role_profile_name, '')
		ORDER BY nu.name
		""",
		{"system": SYSTEM_USERS},
		as_dict=True,
	)


def run() -> None:
	"""Print both lists."""
	drift = role_copy_drift()
	print(f"(a) Role profile copy differs from the login's: {len(drift)}")
	for row in drift:
		print(f"    {row.name}: Nirmaan Users says {row.copy_on_nirmaan_users!r}, login says {row.on_user!r}")

	still_on = logins_still_on()
	print(f"(b) No Nirmaan Users record, login not switched off: {len(still_on)}")
	for row in still_on:
		reasons = [
			"enabled" if row.enabled else None,
			f"roles: {row.roles}" if row.roles else None,
			f"role profile: {row.role_profile_name}" if row.role_profile_name else None,
			"API key" if row.api_key else None,
		]
		print(f"    {row.name}: {'; '.join(r for r in reasons if r)}")
