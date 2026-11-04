# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The bill downloader's guard (#1591, spec #1585 "The bill downloader"). Pure: the transport is faked.

Run: DEVENV unit nirmaan_stack.services.outflow_import.test_bill_download
"""

import unittest

import requests

from nirmaan_stack.services.outflow_import.bill_download import (
    MAX_BILL_BYTES,
    BillFile,
    BillRefused,
    download_bill,
)

LINK = (
    "https://storage.googleapis.com/prod-payments-private/transaction-attachments/"
    "OBO1700000000001AAAAAA/1.jpeg?X-Goog-Date=20261030T090000Z&X-Goog-Expires=604800"
)
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 100
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
PDF = b"%PDF-1.4\n" + b"\x00" * 100


class _Response:
    def __init__(self, status: int, body: bytes = b"", chunk: int = 64 * 1024):
        self.status_code = status
        self._body = body
        self._chunk = chunk
        self.read = 0

    def iter_content(self, chunk_size=None):
        for start in range(0, len(self._body), self._chunk):
            piece = self._body[start : start + self._chunk]
            self.read += len(piece)
            yield piece

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class _Transport:
    """Answers each call with the next of `answers`: a `_Response`, or an exception to raise."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = []

    def __call__(self, url, **kwargs):
        self.calls.append((url, kwargs))
        answer = self.answers.pop(0)
        if isinstance(answer, BaseException):
            raise answer
        return answer


def _download(url, *answers):
    transport = _Transport(*answers)
    return download_bill(url, get=transport, sleep=lambda _s: None), transport


class TestAcceptedBills(unittest.TestCase):
    def test_a_jpeg_comes_back_with_its_bytes_and_type(self):
        result, transport = _download(LINK, _Response(200, JPEG))
        self.assertEqual(result, BillFile(content=JPEG, kind="jpeg"))
        self.assertFalse(transport.calls[0][1]["allow_redirects"])

    def test_a_png_and_a_pdf_are_accepted(self):
        self.assertEqual(_download(LINK, _Response(200, PNG))[0].kind, "png")
        self.assertEqual(_download(LINK, _Response(200, PDF))[0].kind, "pdf")


class TestTheGuardRefuses(unittest.TestCase):
    def _refused(self, url, *answers) -> tuple[str, _Transport]:
        result, transport = _download(url, *answers)
        self.assertIsInstance(result, BillRefused)
        return result.reason, transport

    def test_http(self):
        reason, transport = self._refused(LINK.replace("https://", "http://"))
        self.assertEqual(reason, "the link is not https")
        self.assertEqual(transport.calls, [])

    def test_another_host(self):
        reason, transport = self._refused(LINK.replace("storage.googleapis.com", "evil.example.com"))
        self.assertEqual(reason, "the link is not on the wallet's bill storage")
        self.assertEqual(transport.calls, [])

    def test_a_look_alike_host(self):
        reason, _ = self._refused(LINK.replace("storage.googleapis.com", "storage.googleapis.com.evil.io"))
        self.assertEqual(reason, "the link is not on the wallet's bill storage")

    def test_another_path(self):
        reason, transport = self._refused(LINK.replace("/prod-payments-private/", "/other-bucket/"))
        self.assertEqual(reason, "the link is not on the wallet's bill storage")
        self.assertEqual(transport.calls, [])

    def test_a_path_that_climbs_out_of_the_prefix(self):
        reason, _ = self._refused(
            LINK.replace("transaction-attachments/", "transaction-attachments/../../other/")
        )
        self.assertEqual(reason, "the link is not on the wallet's bill storage")

    def test_a_redirect(self):
        reason, transport = self._refused(LINK, _Response(302))
        self.assertEqual(reason, "the storage answered with a redirect")
        self.assertEqual(len(transport.calls), 1)

    def test_a_stream_over_10_mb_is_cut_off_while_reading(self):
        big = _Response(200, b"\xff\xd8\xff" + b"\x00" * (MAX_BILL_BYTES + 1024 * 1024))
        reason, _ = self._refused(LINK, big)
        self.assertEqual(reason, "the bill is larger than 10 MB")
        self.assertLessEqual(big.read, MAX_BILL_BYTES + 64 * 1024)

    def test_a_body_that_is_not_jpeg_png_or_pdf(self):
        reason, _ = self._refused(LINK, _Response(200, b"<html>AccessDenied</html>"))
        self.assertEqual(reason, "the file is not a JPEG, PNG or PDF")

    def test_an_empty_body(self):
        reason, _ = self._refused(LINK, _Response(200, b""))
        self.assertEqual(reason, "the file is not a JPEG, PNG or PDF")


class TestRetries(unittest.TestCase):
    def test_a_5xx_is_tried_three_times_in_all_then_refused(self):
        """ADR-0015 Amendment B decision 3, story 19: "fails to download after three tries"."""
        result, transport = _download(LINK, *[_Response(503) for _ in range(3)])
        self.assertEqual(result, BillRefused("the storage failed (HTTP 503) after 3 tries"))
        self.assertEqual(len(transport.calls), 3)

    def test_a_5xx_then_a_good_answer_succeeds(self):
        result, transport = _download(LINK, _Response(500), _Response(200, PDF))
        self.assertEqual(result.kind, "pdf")
        self.assertEqual(len(transport.calls), 2)

    def test_a_timeout_is_retried(self):
        result, transport = _download(LINK, requests.Timeout(), requests.Timeout(), _Response(200, JPEG))
        self.assertEqual(result.kind, "jpeg")
        self.assertEqual(len(transport.calls), 3)

    def test_timeouts_every_time_are_refused_after_3_tries(self):
        result, transport = _download(LINK, *[requests.Timeout() for _ in range(3)])
        self.assertEqual(result, BillRefused("the storage did not answer (timed out) after 3 tries"))
        self.assertEqual(len(transport.calls), 3)

    def test_a_403_is_not_retried(self):
        result, transport = _download(LINK, _Response(403))
        self.assertEqual(result, BillRefused("the storage refused it (HTTP 403)"))
        self.assertEqual(len(transport.calls), 1)


if __name__ == "__main__":
    unittest.main()
