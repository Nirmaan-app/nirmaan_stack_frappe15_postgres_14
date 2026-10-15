"""Tests for the employee e-signing their asset declaration (`api/assets/declaration.py`).

The pure rules (`services/asset_declaration.py`) are tested directly. The endpoint is tested against real
Asset Category / Asset Master / Asset Management rows with the PDF render and the file upload mocked, so no
PDF is printed and nothing reaches cloud storage. The endpoint commits, so every row this suite creates is
removed by `_purge` -- rollback first, one try per scope, failures reported -- per CODING_STANDARDS.md
§ Writing tests.

Run: bench --site localhost run-tests --module nirmaan_stack.api.assets.test_declaration
"""

import base64
import io
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from PIL import Image, ImageDraw

from nirmaan_stack.api.assets import declaration
from nirmaan_stack.services.asset_declaration import (
    ALREADY_SIGNED,
    BLANK_MESSAGE,
    MAX_SIGNATURE_BYTES,
    NOT_ASSIGNEE,
    NOT_PNG_MESSAGE,
    OUT_OF_SYNC,
    PNG_DATA_URI_PREFIX,
    TOO_LARGE_MESSAGE,
    UNREADABLE_MESSAGE,
    clean_signature_png,
    sign_refusal,
)

CATEGORY_PREFIX = "ZZT"  # Asset Master names itself ASSET-<first 3 letters of the category>-###
FAKE_PDF = b"%PDF-1.4 fake declaration"


def _fake_cloud_url(tag):
    """A stored URL shaped like production's: Frappe's own attach hook ignores `/api/method/...` URLs."""
    return f"/api/method/frappe_gcp_attachment.controller.generate_file?key=test-esign/{tag}.pdf&file_name={tag}.pdf"


def _png_uri(draw=True, size=(600, 200), image_format="PNG", mode="RGBA"):
    """A canvas-like drawing: white background, one dark stroke unless `draw` is False."""
    white = {"RGBA": (255, 255, 255, 255), "RGB": (255, 255, 255), "L": 255}[mode]
    ink = {"RGBA": (20, 20, 20, 255), "RGB": (20, 20, 20), "L": 20}[mode]
    img = Image.new(mode, size, white)
    if draw:
        ImageDraw.Draw(img).line([(40, 150), (120, 50), (200, 160), (320, 60), (480, 140)], fill=ink, width=6)
    buf = io.BytesIO()
    img.save(buf, format=image_format)
    return PNG_DATA_URI_PREFIX + base64.b64encode(buf.getvalue()).decode()


def _two_users():
    rows = frappe.db.sql(
        """select nu.name from "tabNirmaan Users" nu join "tabUser" u on u.name = nu.name
           where u.enabled = 1 and nu.name != 'Administrator' order by nu.name limit 2""",
        pluck=True,
    )
    if len(rows) < 2:
        raise RuntimeError("test_declaration needs two enabled Nirmaan Users on this site")
    return rows


def _purge(category, assets, departments=()):
    """Remove every row this suite created, even after a poisoned transaction (see module docstring)."""
    frappe.db.rollback()
    scopes = [
        ("Asset Management", {"asset": ["in", assets]}),
        # Child rows: a raw delete of the asset leaves them behind.
        ("Asset History", {"parent": ["in", assets], "parenttype": "Asset Master"}),
        ("Asset Master", {"name": ["in", assets]}),
        ("Asset Category", {"name": category}),
        ("Nirmaan Department", {"name": ["in", list(departments) or ["__none__"]]}),
        # The naming-series counter Asset Master's autoname created for this suite's prefix.
        ("Series", {"name": f"ASSET-{CATEGORY_PREFIX}-"}),
    ]
    problems = []
    for doctype, filters in scopes:
        try:
            if doctype not in ("Series", "Asset History"):
                for name in frappe.get_all(doctype, filters=filters, pluck="name"):
                    frappe.db.delete("Version", {"ref_doctype": doctype, "docname": name})
            frappe.db.delete(doctype, filters)
            frappe.db.commit()
        except Exception as exc:  # noqa: BLE001 -- reported, never swallowed
            frappe.db.rollback()
            problems.append(f"{doctype}: {exc}")
    if problems:
        print("WARNING -- test_declaration purge INCOMPLETE, rows left in the live DB: %s" % "; ".join(problems))
    return problems


class TestSignRefusal(FrappeTestCase):
    """The pure "may this person sign now" rule."""

    def test_assignee_may_sign(self):
        self.assertIsNone(sign_refusal("a@x", "a@x", "a@x", False))

    def test_someone_else_is_refused(self):
        self.assertEqual(sign_refusal("b@x", "a@x", "a@x", False), NOT_ASSIGNEE)

    def test_already_signed_is_refused(self):
        self.assertEqual(sign_refusal("a@x", "a@x", "a@x", True), ALREADY_SIGNED)

    def test_holder_mismatch_is_refused(self):
        # The asset says someone else holds it: the PDF would print the wrong name.
        self.assertEqual(sign_refusal("a@x", "a@x", "b@x", False), OUT_OF_SYNC)
        self.assertEqual(sign_refusal("a@x", "a@x", None, False), OUT_OF_SYNC)


class TestCleanSignature(FrappeTestCase):
    """The drawn signature must be a real, small, non-blank PNG."""

    def _assert_refused(self, data_uri, message):
        with self.assertRaises(ValueError) as ctx:
            clean_signature_png(data_uri)
        self.assertEqual(str(ctx.exception), message)

    def test_drawing_is_cropped_to_the_ink_on_white(self):
        png = clean_signature_png(_png_uri())
        with Image.open(io.BytesIO(png)) as out:
            self.assertEqual(out.format, "PNG")
            self.assertEqual(out.mode, "RGB")
            self.assertLess(out.width, 600)  # cropped to the stroke plus padding
            self.assertLess(out.height, 200)

    def test_transparent_canvas_still_reads_as_ink(self):
        img = Image.new("RGBA", (300, 100), (0, 0, 0, 0))
        ImageDraw.Draw(img).line([(20, 80), (280, 20)], fill=(0, 0, 0, 255), width=5)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png = clean_signature_png(PNG_DATA_URI_PREFIX + base64.b64encode(buf.getvalue()).decode())
        self.assertTrue(png.startswith(b"\x89PNG"))

    def test_blank_drawing_is_refused(self):
        self._assert_refused(_png_uri(draw=False), BLANK_MESSAGE)

    def test_not_a_png_data_uri_is_refused(self):
        self._assert_refused("data:image/jpeg;base64,/9j/4AAQ", NOT_PNG_MESSAGE)
        self._assert_refused("hello", NOT_PNG_MESSAGE)
        self._assert_refused(None, NOT_PNG_MESSAGE)

    def test_jpeg_bytes_behind_a_png_prefix_are_refused(self):
        jpeg_as_png = _png_uri(image_format="JPEG", mode="RGB")
        self._assert_refused(jpeg_as_png, NOT_PNG_MESSAGE)

    def test_garbage_base64_is_refused(self):
        self._assert_refused(PNG_DATA_URI_PREFIX + "not*base64!", UNREADABLE_MESSAGE)
        self._assert_refused(PNG_DATA_URI_PREFIX + base64.b64encode(b"not an image").decode(), UNREADABLE_MESSAGE)

    def test_oversized_payload_is_refused(self):
        too_big = PNG_DATA_URI_PREFIX + "A" * (MAX_SIGNATURE_BYTES * 2)
        self._assert_refused(too_big, TOO_LARGE_MESSAGE)

    def test_huge_dimensions_are_refused(self):
        self._assert_refused(_png_uri(draw=False, size=(5000, 10), mode="L"), TOO_LARGE_MESSAGE)


class TestSignDeclarationEndpoint(FrappeTestCase):
    """The endpoint against real rows; render and upload mocked."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.assignee, cls.other = _two_users()
        cls.category = f"{CATEGORY_PREFIX} E-Sign Test {frappe.generate_hash(length=6)}"
        cls.assets = []
        cls.departments = [
            name for name in ("Projects",) if not frappe.db.exists("Nirmaan Department", name)
        ]
        for name in cls.departments:
            frappe.get_doc({"doctype": "Nirmaan Department", "department_name": name}).insert(ignore_permissions=True)
        frappe.set_user("Administrator")
        frappe.get_doc({"doctype": "Asset Category", "asset_category": cls.category, "category_type": "IT"}).insert(
            ignore_permissions=True
        )
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        _purge(cls.category, cls.assets or ["__none__"], cls.departments)
        super().tearDownClass()

    def setUp(self):
        frappe.set_user("Administrator")
        asset = frappe.get_doc({
            "doctype": "Asset Master",
            "asset_name": "E-sign test laptop",
            "asset_category": self.category,
            "department": "Projects",
        }).insert(ignore_permissions=True)
        self.assets.append(asset.name)
        self.asset = asset.name
        # The Asset Management after_insert hook makes the assignee the asset's holder.
        row = frappe.get_doc({
            "doctype": "Asset Management",
            "asset": asset.name,
            "asset_assigned_to": self.assignee,
            "asset_assigned_on": frappe.utils.today(),
        })
        # The assignee is a live person in whatever department the site gives them; with a reason the
        # asset may follow them there (it is dropped when nothing moves), so setUp works on any site.
        row.flags.department_change_reason = "E-sign test: the asset follows its assignee"
        self.row = row.insert(ignore_permissions=True)
        frappe.db.commit()
        self.url = _fake_cloud_url(self.row.name)

    def tearDown(self):
        frappe.set_user("Administrator")

    def _sign(self, as_user=None, signature=None, format_ready=True):
        """Call the endpoint as `as_user` with render/upload mocked; returns (result, render_mock)."""
        frappe.set_user(as_user or self.assignee)
        with patch.object(declaration, "_declaration_format_ready", return_value=format_ready), \
             patch.object(declaration, "_render_declaration_pdf", return_value=FAKE_PDF) as render, \
             patch.object(declaration, "_save_declaration_file", return_value=self.url) as save:
            result = declaration.sign_declaration(self.row.name, signature or _png_uri())
        frappe.set_user("Administrator")
        return result, render, save

    def _stored_declaration(self):
        return frappe.db.get_value("Asset Management", self.row.name, "asset_declaration_attachment")

    def test_assignee_signs_and_the_pdf_is_attached(self):
        result, render, save = self._sign()

        self.assertEqual(result, {"file_url": self.url})
        self.assertEqual(self._stored_declaration(), self.url)
        history = frappe.get_all(
            "Asset History", filters={"parent": self.asset}, fields=["event", "done_by", "declaration"], order_by="idx"
        )
        self.assertEqual(history[-1].event, "Declaration Signed")
        self.assertEqual(history[-1].done_by, self.assignee)
        self.assertEqual(history[-1].declaration, self.url)

        rendered_asset = render.call_args.args[0]
        self.assertEqual(rendered_asset.name, self.asset)
        self.assertTrue(rendered_asset.declaration.signature.startswith(PNG_DATA_URI_PREFIX))
        expected_name = frappe.db.get_value("Nirmaan Users", self.assignee, "full_name") or self.assignee
        self.assertEqual(rendered_asset.declaration.signer_name, expected_name)
        self.assertTrue(rendered_asset.declaration.signed_on)

        saved_row, saved_pdf = save.call_args.args
        self.assertEqual(saved_row.name, self.row.name)
        self.assertEqual(saved_pdf, FAKE_PDF)

    def test_someone_else_is_refused_and_nothing_is_saved(self):
        with self.assertRaises(frappe.PermissionError):
            self._sign(as_user=self.other)
        frappe.set_user("Administrator")
        self.assertFalse(self._stored_declaration())

    def test_second_signature_is_refused(self):
        self._sign()
        with self.assertRaises(frappe.ValidationError):
            self._sign()
        frappe.set_user("Administrator")
        self.assertEqual(self._stored_declaration(), self.url)

    def test_hr_upload_already_present_is_refused(self):
        frappe.db.set_value("Asset Management", self.row.name, "asset_declaration_attachment", _fake_cloud_url("scan"))
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            self._sign()

    def test_holder_mismatch_is_refused(self):
        frappe.db.set_value("Asset Master", self.asset, "current_assignee", self.other)
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            self._sign()
        frappe.set_user("Administrator")
        self.assertFalse(self._stored_declaration())

    def test_form_without_signature_support_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            self._sign(format_ready=False)
        frappe.set_user("Administrator")
        self.assertFalse(self._stored_declaration())

    def test_blank_signature_is_refused_before_rendering(self):
        frappe.set_user(self.assignee)
        with patch.object(declaration, "_declaration_format_ready", return_value=True), \
             patch.object(declaration, "_render_declaration_pdf", return_value=FAKE_PDF) as render, \
             patch.object(declaration, "_save_declaration_file", return_value=self.url) as save:
            with self.assertRaises(frappe.ValidationError):
                declaration.sign_declaration(self.row.name, _png_uri(draw=False))
        frappe.set_user("Administrator")
        render.assert_not_called()
        save.assert_not_called()
        self.assertFalse(self._stored_declaration())

    def test_signed_while_rendering_is_caught_under_the_lock(self):
        """A second tab signs while this request renders: the re-check after rendering refuses."""
        other_url = _fake_cloud_url("other-tab")

        def render_while_other_tab_signs(asset):
            frappe.db.set_value("Asset Management", self.row.name, "asset_declaration_attachment", other_url)
            return FAKE_PDF

        frappe.set_user(self.assignee)
        with patch.object(declaration, "_declaration_format_ready", return_value=True), \
             patch.object(declaration, "_render_declaration_pdf", side_effect=render_while_other_tab_signs), \
             patch.object(declaration, "_save_declaration_file", return_value=self.url) as save:
            with self.assertRaises(frappe.ValidationError):
                declaration.sign_declaration(self.row.name, _png_uri())
        frappe.set_user("Administrator")
        save.assert_not_called()

    def test_signing_already_in_progress_is_refused(self):
        """Another tab holds the signing lock (it is uploading): this one stops before saving anything."""
        other_tab = declaration.signing_lock(self.row.name)
        self.assertTrue(other_tab.acquire(blocking=False))
        try:
            with self.assertRaisesRegex(frappe.ValidationError, "being signed in another window"):
                self._sign()
        finally:
            other_tab.release()
        self.assertFalse(self._stored_declaration())

        result, _, _ = self._sign()  # once the other tab is done, signing works again
        self.assertEqual(result, {"file_url": self.url})

    # -- reading the form before signing (owner, 2026-10-15: every holder, whatever the project) ----------

    def _read(self, as_user=None):
        """Call `read_declaration_form` as `as_user` with the render mocked; returns (response, render_mock)."""
        frappe.set_user(as_user or self.assignee)
        frappe.local.response = frappe._dict()
        with patch.object(declaration, "_render_declaration_pdf", return_value=FAKE_PDF) as render:
            declaration.read_declaration_form(self.row.name)
        frappe.set_user("Administrator")
        return frappe.local.response, render

    def test_the_holder_reads_the_blank_form(self):
        response, render = self._read()
        self.assertEqual((response.type, response.filecontent), ("pdf", FAKE_PDF))
        self.assertEqual(response.filename, "E-sign test laptop_Declaration_Form.pdf")
        rendered_asset = render.call_args.args[0]
        self.assertEqual(rendered_asset.name, self.asset)
        self.assertFalse(rendered_asset.get("declaration"))  # unsigned: the blank form

    def test_the_holder_can_still_read_it_after_signing(self):
        self._sign()
        response, _ = self._read()
        self.assertEqual(response.type, "pdf")

    def test_someone_else_cant_read_the_form(self):
        frappe.local.response = frappe._dict()
        frappe.set_user(self.other)
        with patch.object(declaration, "_render_declaration_pdf", return_value=FAKE_PDF) as render:
            with self.assertRaisesRegex(frappe.PermissionError, "read its declaration form"):
                declaration.read_declaration_form(self.row.name)
        frappe.set_user("Administrator")
        render.assert_not_called()

    def test_a_holder_mismatch_cant_read_the_form(self):
        frappe.db.set_value("Asset Master", self.asset, "current_assignee", self.other)
        frappe.db.commit()
        frappe.set_user(self.assignee)
        with patch.object(declaration, "_render_declaration_pdf", return_value=FAKE_PDF) as render:
            with self.assertRaises(frappe.ValidationError):
                declaration.read_declaration_form(self.row.name)
        frappe.set_user("Administrator")
        render.assert_not_called()


class TestDeclarationRender(FrappeTestCase):
    """The PDF renders for the holder even when they can't read the Asset Master (2026-10-14).

    A PM's project User Permissions hid ASSET-ANE-002 (booked to GURGAON-PROJ-00037) from its holder, and
    Frappe's print view refused the signature with "You need the 'print' permission". The signer is checked
    as the holder before rendering, so the render skips print permissions -- for that call only.
    """

    def test_print_permissions_are_skipped_for_the_render_and_restored(self):
        seen = {}

        def fake_get_print(*args, **kwargs):
            seen["during"] = frappe.flags.ignore_print_permissions
            return FAKE_PDF

        before = frappe.flags.ignore_print_permissions
        with patch.object(frappe, "get_print", side_effect=fake_get_print):
            self.assertEqual(declaration._render_declaration_pdf(frappe._dict(name="ASSET-X-001")), FAKE_PDF)
        self.assertTrue(seen["during"])
        self.assertEqual(frappe.flags.ignore_print_permissions, before)

    def test_the_flag_is_restored_when_the_render_fails(self):
        before = frappe.flags.ignore_print_permissions
        with patch.object(frappe, "get_print", side_effect=RuntimeError("wkhtmltopdf died")):
            with self.assertRaises(RuntimeError):
                declaration._render_declaration_pdf(frappe._dict(name="ASSET-X-001"))
        self.assertEqual(frappe.flags.ignore_print_permissions, before)
