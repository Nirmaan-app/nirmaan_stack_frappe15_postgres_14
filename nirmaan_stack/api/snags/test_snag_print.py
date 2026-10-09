"""Tests for the Snag List PDF's two photo copies (the table thumbnail and the photo-page copy).

No fixtures and no DB writes: the photos are made in memory. The jump links have their own tests
next to the shared module: `api/pdf_helper/test_keep_links.py`.
"""

import base64
import io

from frappe.tests.utils import FrappeTestCase
from PIL import Image

from nirmaan_stack.api.snags import print_photos

RED = (200, 30, 30)


def _jpeg(width, height):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), RED).save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _image(data_uri):
    return Image.open(io.BytesIO(base64.b64decode(data_uri.split(",", 1)[1]))).convert("RGB")


def _near(pixel, colour, tolerance=24):
    return all(abs(a - b) <= tolerance for a, b in zip(pixel, colour))


class TestSnagPhotoCopies(FrappeTestCase):
    def test_the_grid_copy_keeps_a_tall_photo_whole_padded_left_and_right(self):
        _, grid = print_photos.encode_photo(_jpeg(60, 200))
        img = _image(grid)
        size = print_photos.GRID_PX

        self.assertEqual(img.size, (size, size))
        self.assertTrue(_near(img.getpixel((size // 2, 2)), RED), "the photo reaches the top")
        self.assertTrue(_near(img.getpixel((size // 2, size - 3)), RED), "and the bottom")
        self.assertTrue(_near(img.getpixel((3, size // 2)), print_photos.GRID_PAD_RGB))
        self.assertTrue(_near(img.getpixel((size - 4, size // 2)), print_photos.GRID_PAD_RGB))

    def test_the_grid_copy_keeps_a_wide_photo_whole_padded_above_and_below(self):
        _, grid = print_photos.encode_photo(_jpeg(300, 50))
        img = _image(grid)
        size = print_photos.GRID_PX

        self.assertTrue(_near(img.getpixel((2, size // 2)), RED), "the photo reaches the left")
        self.assertTrue(_near(img.getpixel((size - 3, size // 2)), RED), "and the right")
        self.assertTrue(_near(img.getpixel((size // 2, 3)), print_photos.GRID_PAD_RGB))
        self.assertTrue(_near(img.getpixel((size // 2, size - 4)), print_photos.GRID_PAD_RGB))

    def test_the_thumbnail_is_a_cropped_square_with_no_padding(self):
        thumb, _ = print_photos.encode_photo(_jpeg(60, 200))
        img = _image(thumb)

        self.assertEqual(img.size, (print_photos.THUMB_PX, print_photos.THUMB_PX))
        for corner in ((2, 2), (147, 2), (2, 147), (147, 147)):
            self.assertTrue(_near(img.getpixel(corner), RED), corner)
