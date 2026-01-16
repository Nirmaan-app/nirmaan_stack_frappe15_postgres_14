"""
Authentication utilities for Nirmaan Stack.

This module provides authentication-related API endpoints including
CSRF token refresh functionality to handle token staleness in production.
"""
import frappe


@frappe.whitelist()
def get_csrf_token():
    """
    Return the current valid CSRF token for the session.

    This endpoint allows the frontend to fetch a fresh CSRF token when the
    existing token becomes stale (e.g., after session timeout/refresh).

    Returns:
        dict: Contains the csrf_token key with the current valid token.

    Note:
        This is a GET-compatible endpoint (no CSRF required to call it)
        that returns the token needed for subsequent POST requests.
    """
    return {"csrf_token": frappe.sessions.get_csrf_token()}
