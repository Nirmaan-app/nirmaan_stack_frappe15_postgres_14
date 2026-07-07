# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Classifier engine registry (Classifier CL-1b).

The SINGLE source the picker AND start/verdict validation read -- nothing that consumes
engines hardcodes an engine name. Adding a future engine is a REGISTRY-ENTRY EDIT ONLY.

`available` is a per-entry flag: an engine may be LISTED before its ruleset exists
(available=False -> the picker shows it disabled), and flips True only once that engine has
its own ruleset + certified prompt in services/boq_category. Today only Electrical is
available (runner.load_ruleset raises for any other discipline). A later slice may source
this registry from Work Headers.
"""

_ENGINE_REGISTRY = [
    {"id": "electrical", "label": "Electrical", "discipline": "Electrical", "available": True},
    {"id": "hvac", "label": "HVAC", "discipline": "HVAC", "available": False},
    {"id": "elv", "label": "ELV", "discipline": "ELV", "available": False},
]


def list_available_engines():
    """The full engine registry (each entry copied so a caller can't mutate the source)."""
    return [dict(e) for e in _ENGINE_REGISTRY]


def get_engine(engine_id):
    for e in _ENGINE_REGISTRY:
        if e["id"] == engine_id:
            return dict(e)
    return None


def get_engine_by_discipline(discipline):
    for e in _ENGINE_REGISTRY:
        if e["discipline"] == discipline:
            return dict(e)
    return None


def is_engine_available(engine_id):
    e = get_engine(engine_id)
    return bool(e and e["available"])


def is_discipline_available(discipline):
    """Whether the engine for this discipline exists AND is available (ruleset + prompt shipped).
    The single validation gate for start_classify / set_row_category -- no hardcoded names."""
    e = get_engine_by_discipline(discipline)
    return bool(e and e["available"])
