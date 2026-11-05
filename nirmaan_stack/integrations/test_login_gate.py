"""Only Nirmaan users get in: a login, and every request, from anyone with no Nirmaan Users record is refused.

All people here are made up (`*@example.com`).
"""

import frappe
from frappe.auth import CookieManager, LoginManager, validate_auth
from frappe.sessions import clear_sessions
from frappe.tests.utils import FrappeTestCase
from frappe.utils import set_request
from frappe.utils.password import update_password

from nirmaan_stack.integrations.controllers.test_nirmaan_users import left_the_old_way, make_user, remove_user

PM_PROFILE = "Nirmaan Project Manager Profile"
CURRENT = "gate-current@example.com"
EXITED = "gate-exited@example.com"
PASSWORD = "Gate-test-pw-4821!"
REFUSED = "no longer active"


def give_api_key(email: str) -> tuple[str, str]:
    user = frappe.get_doc("User", email)
    user.api_key = frappe.generate_hash(length=15)
    secret = frappe.generate_hash(length=15)
    user.api_secret = secret
    user.save(ignore_permissions=True)
    return user.api_key, secret


def start_request(path: str, form: dict | None = None, headers: dict | None = None) -> None:
    """What `frappe.app.init_request` sets up before it authenticates a request."""
    frappe.set_user("Guest")
    set_request(path=path, method="POST", headers=headers or {})
    frappe.local.request_ip = "127.0.0.1"
    frappe.local.form_dict = frappe._dict(form or {})
    frappe.local.cookie_manager = CookieManager()
    frappe.local.login_manager = LoginManager()


def log_in_with_password(email: str) -> None:
    """The login request the login page sends."""
    start_request("/api/method/login", form={"cmd": "login", "usr": email, "pwd": PASSWORD})


def request_with_api_key(api_key: str, api_secret: str) -> str:
    """A request signed with an API key; returns the user it ran as."""
    start_request("/api/method/frappe.auth.get_logged_user", headers={"Authorization": f"token {api_key}:{api_secret}"})
    validate_auth()
    return frappe.session.user


def request_with_session(user: str) -> None:
    """A request whose cookie session already says who it is."""
    start_request("/api/method/frappe.auth.get_logged_user")
    frappe.set_user(user)
    validate_auth()


class TestLoginGate(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        for email in (CURRENT, EXITED):
            make_user(email, PM_PROFILE)
            update_password(email, PASSWORD)
        cls.current_key = give_api_key(CURRENT)
        cls.exited_key = give_api_key(EXITED)
        # One who left before exits switched logins off: no Nirmaan Users record, login still on.
        left_the_old_way(EXITED)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        for email in (CURRENT, EXITED):
            clear_sessions(email, force=True)
            frappe.db.delete("Activity Log", {"user": email})
            frappe.db.commit()
            remove_user(email)
        super().tearDownClass()

    def tearDown(self):
        frappe.local.form_dict = frappe._dict()
        frappe.local.request = None
        frappe.set_user("Administrator")

    def test_exited_person_cannot_log_in_with_a_password(self):
        with self.assertRaisesRegex(frappe.AuthenticationError, REFUSED):
            log_in_with_password(EXITED)

    def test_exited_person_cannot_use_an_api_key(self):
        with self.assertRaisesRegex(frappe.AuthenticationError, REFUSED):
            request_with_api_key(*self.exited_key)

    def test_current_nirmaan_user_gets_in(self):
        log_in_with_password(CURRENT)
        self.assertEqual(frappe.session.user, CURRENT)
        self.assertEqual(request_with_api_key(*self.current_key), CURRENT)

    def test_administrator_and_guest_always_get_in(self):
        for user in ("Administrator", "Guest"):
            with self.subTest(user):
                request_with_session(user)
                self.assertEqual(frappe.session.user, user)

    def test_removing_the_record_blocks_the_person_at_once(self):
        leaver = "gate-leaver@example.com"
        self.addCleanup(remove_user, leaver)
        make_user(leaver, PM_PROFILE)
        frappe.db.commit()
        request_with_session(leaver)  # they get in, and the gate has now read who is a Nirmaan user

        frappe.set_user("Administrator")
        frappe.delete_doc("Nirmaan Users", leaver, ignore_permissions=True)
        frappe.db.commit()

        with self.assertRaisesRegex(frappe.AuthenticationError, REFUSED):
            request_with_session(leaver)
